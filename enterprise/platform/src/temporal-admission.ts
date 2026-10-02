import { admissionDigest, matchingExecution, validateAdmissionScope } from './workflow-admission.ts';
import type { AdmissionBinding, AdmissionScope, ExecutionReceipt, WorkflowAdmissionPort } from './workflow-admission.ts';

export const admissionMemoKey = 'chausarWorkflowAdmission';

/** These callbacks call the genuine SDK; they do not supply admitted execution fields.
 * The connected runner uses the default payload converter with no payload codecs.
 * Additional codecs and native run-chain behavior require separate qualification.
 */
export interface TemporalAdmissionAccess {
  namespace: string;
  start(workflowType: 'investigate', options: {
    workflowId: string; taskQueue: string; args: [{ investigationId: string }];
    workflowIdReusePolicy: 'REJECT_DUPLICATE'; memo: Record<string, AdmissionBinding>;
  }): Promise<ExecutionReceipt>;
  history(workflowId: string, runId?: string): Promise<unknown>;
  decode(payload: unknown): unknown | Promise<unknown>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Original start history is incomplete');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 240
      || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Original start identity is incomplete');
  return value;
}
function originalStart(history: unknown): Record<string, unknown> {
  const events = object(history).events;
  if (!Array.isArray(events) || !events.length) throw new Error('Original start history is unavailable');
  const first = object(events[0]);
  if (String(first.eventId) !== '1') throw new Error('History does not begin at the original start event');
  return object(first.workflowExecutionStartedEventAttributes);
}

export function temporalAdmissionPort(native: TemporalAdmissionAccess): WorkflowAdmissionPort {
  text(native.namespace);
  return {
    async start(request) {
      if (request.binding.namespace !== native.namespace) throw new Error('Temporal namespace disagrees with admission scope');
      return native.start(request.binding.workflowType, {
        workflowId: request.binding.workflowId, taskQueue: request.binding.taskQueue,
        args: request.args, workflowIdReusePolicy: request.workflowIdReusePolicy,
        memo: { [admissionMemoKey]: request.binding },
      });
    },
    async read(binding, expectedRunId) {
      try {
        // An unpinned lookup can return a later run. Resolve its first run, then
        // read that exact run's immutable start event instead of current memo.
        const located = originalStart(await native.history(binding.workflowId, expectedRunId));
        const runId = text(located.firstExecutionRunId);
        const started = originalStart(await native.history(binding.workflowId, runId));
        if (text(started.firstExecutionRunId) !== runId || text(started.originalExecutionRunId) !== runId
            || (started.continuedExecutionRunId !== undefined && started.continuedExecutionRunId !== null
              && started.continuedExecutionRunId !== '')) throw new Error('Original run history cannot be established');
        const payloads = object(started.input).payloads;
        if (!Array.isArray(payloads)) throw new Error('Original start input is unavailable');
        const args = await Promise.all(payloads.map(payload => native.decode(payload)));
        const fields = object(object(started.memo).fields);
        if (!(admissionMemoKey in fields)) throw new Error('Original admission binding is unavailable');
        const originalBinding = await native.decode(fields[admissionMemoKey]);
        return { status: 'found', execution: {
          namespace: native.namespace, workflowId: binding.workflowId, runId,
          workflowType: text(object(started.workflowType).name), taskQueue: text(object(started.taskQueue).name),
          inputDigest: admissionDigest(args), binding: originalBinding as AdmissionBinding,
        } };
      } catch {
        // Missing, archived, malformed or undecodable evidence never becomes a
        // receipt or permission to send again. Keep operational causes restricted.
        return { status: 'unavailable', cause: { name: 'TemporalOriginalStartUnavailable',
          code: 'temporal_original_start_unavailable', message: 'Original Temporal start history could not be established' } };
      }
    },
  };
}

export type StoredAdmission = {
  tenant_id: string; investigation_id: string; admission_generation: string;
  admission_state: string; dispatched_at: unknown; expected_run_id: string | null;
  admission_binding: AdmissionBinding | null; execution_receipt: unknown;
};

/** An empty dispatcher batch alone cannot hide exhausted pending/conflict rows. */
export function assertSettledAdmissions(rows: readonly StoredAdmission[], tenantId: string, scope: AdmissionScope): void {
  validateAdmissionScope(scope);
  for (const row of rows) {
    const binding = row.admission_binding;
    if (row.tenant_id !== tenantId || row.admission_state !== 'admitted' || row.dispatched_at == null || !binding
        || binding.tenantId !== tenantId || binding.investigationId !== row.investigation_id
        || binding.generation !== row.admission_generation
        || admissionDigest(Object.fromEntries(Object.keys(scope).map(key => [key, binding[key as keyof AdmissionScope]]))) !== admissionDigest(scope)
        || matchingExecution(binding, row.execution_receipt as Parameters<typeof matchingExecution>[1], row.expected_run_id ?? undefined).length)
      throw new Error(`Workflow admission remains unresolved or conflicting: ${row.investigation_id}`);
  }
}
