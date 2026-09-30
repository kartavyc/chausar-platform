import type { PoolClient } from 'pg';
import { Denied, metricBindings, subset } from './shared.ts';
import type { Identity, MetricId, Scope } from './shared.ts';

// All authority mutations in this implementation take tenant FOR UPDATE first.
// Readers hold FOR SHARE through query/result commit. This is a local DB protocol,
// not a distributed permission guarantee or a security boundary against DB admins.
export async function lockTenant(db: PoolClient, tenantId: string): Promise<number> {
  const r=await db.query('SELECT active,policy_epoch FROM chausar_core.tenants WHERE tenant_id=$1 FOR SHARE',[tenantId]);
  if (!r.rows[0]?.active) throw new Denied('authority_denied');
  return Number(r.rows[0].policy_epoch);
}
export async function currentScope(db: PoolClient, identity: Identity, operations: string[], metrics: MetricId[], grantId?: string): Promise<Scope> {
  const epoch=await lockTenant(db,identity.tenantId);
  const {rows}=await db.query(`SELECT g.*,p.active AS principal_active,d.active AS dataset_active,d.source_revision,d.permitted_fields,
     pol.active AS policy_active,pol.revision AS policy_revision,pr.body AS policy_body
     FROM chausar_core.grants g JOIN chausar_core.principals p USING(tenant_id,principal_id)
     JOIN chausar_core.datasets d USING(tenant_id,dataset_id)
     JOIN chausar_core.policies pol USING(tenant_id,policy_id)
     JOIN chausar_core.policy_revisions pr ON pr.tenant_id=pol.tenant_id AND pr.policy_id=pol.policy_id AND pr.revision=pol.revision
     WHERE g.tenant_id=$1 AND g.principal_id=$2 AND g.dataset_id='invoices' AND g.purpose='profitability'
       AND ($3::text IS NULL OR g.grant_id=$3) AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()`,
    [identity.tenantId,identity.principalId,grantId??null]);
  const required=[...new Set(['invoice_id','region',...metrics.flatMap(id=>[...metricBindings[id].fields])])];
  const eligible=rows.filter(g=>g.principal_active&&g.dataset_active&&g.policy_active&&subset(operations,g.operations)
    &&subset(required,g.fields)&&subset(required,g.permitted_fields)&&g.regions.length>0);
  if (eligible.length!==1) throw new Denied('authority_denied');
  const g=eligible[0];
  const retention=Number(g.policy_body.retention_seconds);
  if (!Number.isInteger(retention)||retention<=0||retention>86400) throw new Denied('unsupported_retention_policy');
  return {tenantId:identity.tenantId,principalId:identity.principalId,grantId:g.grant_id,grantRevision:Number(g.revision),
    policyId:g.policy_id,policyRevision:Number(g.policy_revision),policyEpoch:epoch,sourceRevision:Number(g.source_revision),
    datasetId:g.dataset_id,purpose:g.purpose,regions:g.regions,fields:g.fields,retentionSeconds:retention};
}
export async function mandateAuthority(db: PoolClient,tenantId:string,mandateId:string) {
  await lockTenant(db,tenantId);
  const m=(await db.query('SELECT * FROM chausar_core.mandates WHERE tenant_id=$1 AND mandate_id=$2',[tenantId,mandateId])).rows[0];
  if (!m || !['active','suspended_owner'].includes(m.state)) throw new Denied('authority_denied');
  const service=(await db.query("SELECT principal_id FROM chausar_core.principals WHERE tenant_id=$1 AND principal_id=$2 AND kind='service' AND active",[tenantId,m.principal_id])).rows[0];
  if(!service)throw new Denied('authority_denied');
  const owners=(await db.query(`SELECT o.owner_id FROM chausar_core.mandate_owners o JOIN chausar_core.principals p
     ON p.tenant_id=o.tenant_id AND p.principal_id=o.owner_id
     WHERE o.tenant_id=$1 AND o.mandate_id=$2 AND o.active AND p.active AND p.kind='human'`,[tenantId,mandateId])).rows.map(r=>r.owner_id as string);
  return {mandate:m,owners};
}
