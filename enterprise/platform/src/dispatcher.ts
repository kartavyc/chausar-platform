import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { admissionDigest, createAdmissionBinding, dispatchAdmissions, matchingExecution } from './workflow-admission.ts';
import type {
  AdmissionBinding, AdmissionClaim, AdmissionFinish, AdmissionScope, AdmissionStore, DispatchOptions,
  ExecutionReceipt, WorkflowAdmissionPort,
} from './workflow-admission.ts';

async function transaction<T>(pool: Pool, action: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='5s'");
    const value = await action(db);
    await db.query('COMMIT');
    return value;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
const claimPredicate = `tenant_id=$1 AND investigation_id=$2 AND claim_token=$3
  AND dispatched_at IS NULL AND admission_state='pending' AND lease_until>clock_timestamp()`;
const claimValues = (claim: AdmissionClaim) => [claim.binding.tenantId, claim.binding.investigationId, claim.token];

/** PostgreSQL provides short admission transactions and commit fences only.
 * Native calls happen outside transactions; Temporal remains the sole coordinator.
 * Migration 001_workflow_admission.sql is required and intentionally fails closed
 * when absent. The original workflow ID/args remain compatible with core operations.
 */
export function postgresAdmissionStore(pool: Pool): AdmissionStore {
  return {
    async listPending(tenantId, limit, maxAttempts) {
      const { rows } = await pool.query(`SELECT investigation_id FROM chausar_core.work_outbox
        WHERE tenant_id=$1 AND dispatched_at IS NULL AND admission_state='pending' AND attempts<$2
        AND (lease_until IS NULL OR lease_until<=clock_timestamp())
        ORDER BY investigation_id LIMIT $3`, [tenantId, maxAttempts, limit]);
      return rows.map(row => row.investigation_id as string);
    },
    async claim(tenantId, id, scope, policy) {
      return transaction(pool, async db => {
        const { rows } = await db.query(`SELECT o.*, i.principal_id, i.grant_id, i.purpose, i.mandate_id,
          i.requested_by, i.request_id, i.request_digest, i.metric_ids, i.query_regions,
          i.definition_revision::text, i.model_invocation_id, i.input_expires_at
          FROM chausar_core.work_outbox o JOIN chausar_core.investigations i USING(tenant_id,investigation_id)
          WHERE o.tenant_id=$1 AND o.investigation_id=$2 AND o.dispatched_at IS NULL
          AND o.admission_state='pending' AND o.attempts<$3
          AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp())
          FOR UPDATE OF o SKIP LOCKED FOR SHARE OF i`, [tenantId, id, policy.maxAttempts]);
        const row = rows[0];
        if (!row) return undefined;
        let binding = row.admission_binding as AdmissionBinding | null;
        if (binding) {
          const expectedScope = Object.fromEntries(Object.keys(scope).map(key => [key, binding![key as keyof AdmissionScope]]));
          if (admissionDigest(expectedScope) !== admissionDigest(scope) || binding.tenantId !== tenantId
              || binding.investigationId !== id || binding.generation !== String(row.admission_generation)) {
            const cause = { name: 'AdmissionConflict', code: 'deployment_binding_conflict',
              message: 'Configured deployment or outbox identity disagrees with the immutable admission binding' };
            await db.query(`UPDATE chausar_core.work_outbox SET admission_state='conflict',last_cause=$3::jsonb
              WHERE tenant_id=$1 AND investigation_id=$2`, [tenantId, id, JSON.stringify(cause)]);
            await db.query(`INSERT INTO chausar_core.workflow_admission_events
              (tenant_id,investigation_id,attempt,state,cause) VALUES($1,$2,$3,'conflict',$4::jsonb)`,
            [tenantId, id, row.attempts, JSON.stringify(cause)]);
            return undefined;
          }
        } else {
          // Capture authoritative semantic selectors, excluding mutable work state,
          // task lease/revision and later expiry-erasure. Keep only the resulting digest.
          binding = createAdmissionBinding({ tenantId, investigationId: id, semanticInput: {
            principalId: row.principal_id, grantId: row.grant_id, purpose: row.purpose,
            mandateId: row.mandate_id, requestedBy: row.requested_by, requestId: row.request_id,
            requestDigest: row.request_digest, metricIds: row.metric_ids, queryRegions: row.query_regions,
            definitionRevision: row.definition_revision, modelInvocationId: row.model_invocation_id,
            inputExpiresAt: row.input_expires_at === null ? null : new Date(row.input_expires_at).toISOString(),
          } }, scope, String(row.admission_generation));
        }
        const token = randomUUID();
        const { rows: claimed } = await db.query(`UPDATE chausar_core.work_outbox SET admission_binding=$3::jsonb,
          claim_token=$4,lease_until=clock_timestamp()+($5::int * interval '1 millisecond'),attempts=attempts+1
          WHERE tenant_id=$1 AND investigation_id=$2 RETURNING attempts`,
        [tenantId, id, JSON.stringify(binding), token, policy.leaseMs]);
        return { binding, token, attempt: Number(claimed[0].attempts), startRequested: row.start_requested_at !== null,
          ...(row.expected_run_id === null ? {} : { expectedRunId: row.expected_run_id as string }) };
      });
    },
    async markStartRequested(claim) {
      const { rowCount } = await pool.query(`UPDATE chausar_core.work_outbox SET start_requested_at=clock_timestamp()
        WHERE ${claimPredicate} AND start_requested_at IS NULL AND admission_binding=$4::jsonb`,
      [...claimValues(claim), JSON.stringify(claim.binding)]);
      return rowCount === 1;
    },
    async recordStartReceipt(claim, receipt: ExecutionReceipt) {
      if (receipt.workflowId !== claim.binding.workflowId || !receipt.runId) throw new Error('Invalid start receipt');
      const { rowCount } = await pool.query(`UPDATE chausar_core.work_outbox SET expected_run_id=$4
        WHERE ${claimPredicate} AND start_requested_at IS NOT NULL AND expected_run_id IS NULL
        AND admission_binding=$5::jsonb`, [...claimValues(claim), receipt.runId, JSON.stringify(claim.binding)]);
      return rowCount === 1;
    },
    async finish(claim, result: AdmissionFinish) {
      if (result.state === 'admitted' && (!result.receipt || matchingExecution(claim.binding, result.receipt, claim.expectedRunId).length))
        throw new Error('Matching execution evidence required for admission');
      return transaction(pool, async db => {
        const { rows } = await db.query(`SELECT admission_binding,expected_run_id FROM chausar_core.work_outbox
          WHERE ${claimPredicate} FOR UPDATE`, claimValues(claim));
        const current = rows[0];
        if (!current || admissionDigest(current.admission_binding) !== admissionDigest(claim.binding)) return false;
        if (result.state === 'admitted') {
          if (matchingExecution(claim.binding, result.receipt!, current.expected_run_id ?? undefined).length)
            throw new Error('Returned execution changed after the start receipt');
          // Unique execution identity and immutable receipts are database-enforced.
          // Existing receipts must be exactly equal before acknowledging redelivery.
          await db.query(`INSERT INTO chausar_core.workflow_admissions
            (tenant_id,investigation_id,generation,namespace,workflow_id,run_id,binding,execution_receipt)
            VALUES($1,$2,$3::bigint,$4,$5,$6,$7::jsonb,$8::jsonb) ON CONFLICT DO NOTHING`,
          [claim.binding.tenantId, claim.binding.investigationId, claim.binding.generation, claim.binding.namespace,
            claim.binding.workflowId, result.receipt!.runId, JSON.stringify(claim.binding), JSON.stringify(result.receipt)]);
          const { rows: receipts } = await db.query(`SELECT binding,execution_receipt FROM chausar_core.workflow_admissions
            WHERE tenant_id=$1 AND investigation_id=$2 AND generation=$3::bigint`,
          [claim.binding.tenantId, claim.binding.investigationId, claim.binding.generation]);
          if (receipts.length !== 1 || admissionDigest(receipts[0].binding) !== admissionDigest(claim.binding)
              || admissionDigest(receipts[0].execution_receipt) !== admissionDigest(result.receipt)) {
            result = { state: 'conflict', ...(result.startCause ? { startCause: result.startCause } : {}),
              cause: { name: 'AdmissionConflict', code: 'durable_receipt_conflict',
              message: 'Existing immutable admission receipt disagrees with the reconciled execution' } };
          }
        }
        await db.query(`INSERT INTO chausar_core.workflow_admission_events
          (tenant_id,investigation_id,attempt,state,cause,start_cause) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [claim.binding.tenantId, claim.binding.investigationId, claim.attempt, result.state,
          result.cause === undefined ? null : JSON.stringify(result.cause),
          result.startCause === undefined ? null : JSON.stringify(result.startCause)]);
        const { rowCount } = await db.query(`UPDATE chausar_core.work_outbox SET admission_state=$4,last_cause=$5::jsonb,
          claim_token=NULL,lease_until=NULL,dispatched_at=CASE WHEN $4='admitted' THEN clock_timestamp() ELSE NULL END
          WHERE ${claimPredicate}`,
        [...claimValues(claim), result.state, result.cause === undefined ? null : JSON.stringify(result.cause)]);
        if (rowCount !== 1) throw new Error('Admission commit fence lost');
        return result.state;
      });
    },
  };
}

/** Previous four-argument calls cannot infer deployment incarnations. The enterprise
 * coordinator must join an explicit qualified native port and deployment scope.
 * Return value counts acknowledged admissions only, never pending/conflicting rows.
 */
export async function dispatchPending(pool: Pool, port: WorkflowAdmissionPort, taskQueue: string, tenantId: string,
  options: Omit<DispatchOptions, 'tenantId' | 'scope'> & { scope: Omit<AdmissionScope, 'taskQueue'> }) {
  if (!options?.scope) throw new Error('Explicit admission deployment scope and qualified native port required');
  const summary = await dispatchAdmissions(postgresAdmissionStore(pool), port,
    { ...options, tenantId, scope: { ...options.scope, taskQueue } });
  return summary.admitted;
}
