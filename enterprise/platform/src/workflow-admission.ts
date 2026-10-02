import { createHash } from 'node:crypto';

export type AdmissionScope = {
  businessId: string;
  businessIncarnation: string;
  environmentIncarnation: string;
  namespace: string;
  taskQueue: string;
};
export type AdmissionBinding = AdmissionScope & {
  version: 1;
  tenantId: string;
  investigationId: string;
  workflowId: string;
  workflowType: 'investigate';
  generation: string;
  inputDigest: string;
  semanticInputDigest: string;
};
export type AdmissionCause = { name: string; message: string; code?: string };
export type ExecutionReceipt = { workflowId: string; runId: string };
export type AdmissionExecution = ExecutionReceipt & {
  namespace: string;
  workflowType: string;
  taskQueue: string;
  inputDigest: string;
  binding: AdmissionBinding;
};
export type AdmissionReadback =
  | { status: 'found'; execution: AdmissionExecution }
  | { status: 'missing' }
  | { status: 'unavailable'; cause: AdmissionCause };

/** The native adapter must read the ORIGINAL start event's type, decoded arguments,
 * binding and run identity. Mutable memo/ID existence or an unqualified cache is
 * insufficient. Custom codecs and continue-as-new chains require native qualification.
 * This port transports restricted references/digests, never credentials or source rows.
 */
export interface WorkflowAdmissionPort {
  start(request: {
    binding: AdmissionBinding;
    args: [{ investigationId: string }];
    workflowIdReusePolicy: 'REJECT_DUPLICATE';
  }): Promise<ExecutionReceipt>;
  read(binding: AdmissionBinding, runId?: string): Promise<AdmissionReadback>;
}
export type AdmissionClaim = {
  binding: AdmissionBinding;
  token: string;
  attempt: number;
  startRequested: boolean;
  expectedRunId?: string;
};
export type AdmissionFinish = {
  state: 'pending' | 'conflict' | 'admitted';
  cause?: AdmissionCause;
  startCause?: AdmissionCause;
  receipt?: AdmissionExecution;
};
export interface AdmissionStore {
  listPending(tenantId: string, limit: number, maxAttempts: number): Promise<string[]>;
  claim(tenantId: string, id: string, scope: AdmissionScope,
    policy: { maxAttempts: number; leaseMs: number }): Promise<AdmissionClaim | undefined>;
  markStartRequested(claim: AdmissionClaim): Promise<boolean>;
  recordStartReceipt(claim: AdmissionClaim, receipt: ExecutionReceipt): Promise<boolean>;
  finish(claim: AdmissionClaim, result: AdmissionFinish): Promise<AdmissionFinish['state'] | false>;
}

// Closed JSON values, ordinal key order, no coercion, lossy integers, cycles or holes.
// Callers pass an already parsed authoritative value; this is not a wire JSON parser.
function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)
      && (!Number.isInteger(value) || Number.isSafeInteger(value)) && !Object.is(value, -0)) return JSON.stringify(value);
  if (typeof value !== 'object' || value === null || seen.has(value)) throw new Error('Invalid admission JSON');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new Error('Invalid admission array');
      return '[' + Array.from(value, item => canonical(item, seen)).join(',') + ']';
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      throw new Error('Invalid admission object');
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key], seen)).join(',') + '}';
  } finally { seen.delete(value); }
}
export function admissionDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function reference(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 240 || value.trim() !== value
      || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Invalid admission ${name}`);
}
export function validateAdmissionScope(scope: AdmissionScope): void {
  if (!scope || Object.keys(scope).sort().join(',') !== 'businessId,businessIncarnation,environmentIncarnation,namespace,taskQueue')
    throw new Error('Explicit admission deployment scope required');
  for (const [key, value] of Object.entries(scope)) reference(value, key);
}
export function createAdmissionBinding(work: { tenantId: string; investigationId: string; semanticInput: unknown },
  scope: AdmissionScope, generation = '1'): AdmissionBinding {
  validateAdmissionScope(scope);
  reference(work.tenantId, 'tenantId'); reference(work.investigationId, 'investigationId');
  if (typeof generation !== 'string' || !/^[1-9][0-9]*$/.test(generation) || BigInt(generation) > 9223372036854775807n)
    throw new Error('Invalid admission generation');
  return Object.freeze({ version: 1, ...scope, tenantId: work.tenantId, investigationId: work.investigationId,
    workflowId: work.investigationId, workflowType: 'investigate', generation,
    inputDigest: admissionDigest([{ investigationId: work.investigationId }]),
    semanticInputDigest: admissionDigest(work.semanticInput) });
}

/** Every independent execution field and the complete immutable binding must agree. */
export function matchingExecution(binding: AdmissionBinding, execution: AdmissionExecution, expectedRunId?: string): string[] {
  const mismatches: string[] = [];
  if (!execution || typeof execution !== 'object') return ['execution'];
  if (Object.keys(execution).sort().join(',') !== 'binding,inputDigest,namespace,runId,taskQueue,workflowId,workflowType')
    mismatches.push('executionFields');
  for (const key of ['namespace', 'workflowId', 'workflowType', 'taskQueue', 'inputDigest'] as const)
    if (execution[key] !== binding[key]) mismatches.push(key);
  if (typeof execution.runId !== 'string' || !execution.runId.trim() || execution.runId.trim() !== execution.runId
      || execution.runId.length > 240 || /[\u0000-\u001f\u007f]/.test(execution.runId)) mismatches.push('runId');
  else if (expectedRunId !== undefined && execution.runId !== expectedRunId) mismatches.push('runId');
  try {
    if (canonical(execution.binding) !== canonical(binding)) mismatches.push('binding');
  } catch { mismatches.push('binding'); }
  return mismatches;
}
export function admissionCause(error: unknown): AdmissionCause {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return { name: error.name, message: error.message, ...(code === undefined ? {} : { code }) };
  }
  // Do not stringify arbitrary thrown objects, which may contain secrets/raw records.
  return { name: 'NonErrorThrow', message: typeof error === 'string' ? error : 'Non-Error thrown value' };
}
class AdmissionTimeout extends Error {
  code = 'admission_call_timeout';
  constructor(operation: string) { super(`${operation} did not return within the admission deadline`); this.name = 'AdmissionTimeout'; }
}
async function bounded<T>(operation: string, ms: number, call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(call), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AdmissionTimeout(operation)), ms);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export type DispatchOptions = {
  tenantId: string;
  scope: AdmissionScope;
  maxAttempts?: number;
  batchSize?: number;
  leaseMs?: number;
  callTimeoutMs?: number;
};
function integer(value: number, min: number, max: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid admission ${name}`);
  return value;
}

/** Admission delivery only. It never schedules, retries an activity, executes work,
 * invents a replacement identity, or equates admitted with completed business work.
 */
export async function dispatchAdmissions(store: AdmissionStore, port: WorkflowAdmissionPort, options: DispatchOptions) {
  reference(options.tenantId, 'tenantId'); validateAdmissionScope(options.scope);
  if (!port || typeof port.start !== 'function' || typeof port.read !== 'function')
    throw new Error('Qualified workflow admission port required');
  const maxAttempts = integer(options.maxAttempts ?? 3, 1, 10, 'maxAttempts');
  const batchSize = integer(options.batchSize ?? 100, 1, 100, 'batchSize');
  const callTimeoutMs = integer(options.callTimeoutMs ?? 10000, 1, 30000, 'callTimeoutMs');
  const leaseMs = integer(options.leaseMs ?? 45000, 1, 120000, 'leaseMs');
  if (leaseMs <= 2 * callTimeoutMs) throw new Error('Admission lease must cover both native call deadlines');
  const summary = { examined: 0, admitted: 0, pending: 0, conflicts: 0, lostClaims: 0 };
  const ids = await store.listPending(options.tenantId, batchSize, maxAttempts);
  for (const id of ids) {
    const claim = await store.claim(options.tenantId, id, options.scope, { maxAttempts, leaseMs });
    if (!claim) continue;
    summary.examined += 1;
    let startCause: AdmissionCause | undefined;
    // Pin a durable send-intent BEFORE the call. A crashed/uncertain attempt is
    // read back only, even when the provider no longer retains its history.
    if (!claim.startRequested) {
      if (!await store.markStartRequested(claim)) { summary.lostClaims += 1; continue; }
      let returned: ExecutionReceipt | undefined;
      try {
        returned = await bounded('start', callTimeoutMs, () => port.start({ binding: claim.binding,
          args: [{ investigationId: claim.binding.investigationId }], workflowIdReusePolicy: 'REJECT_DUPLICATE' }));
      } catch (error) { startCause = admissionCause(error); }
      if (returned) {
        if (returned.workflowId !== claim.binding.workflowId || typeof returned.runId !== 'string' || !returned.runId.trim()) {
          const result: AdmissionFinish = { state: 'conflict', cause: { name: 'AdmissionConflict',
            code: 'start_receipt_conflict', message: JSON.stringify({ reason: 'Returned execution receipt does not bind the requested identity',
              expectedWorkflowId: claim.binding.workflowId, returnedWorkflowId: returned.workflowId, returnedRunId: returned.runId }) } };
          if (await store.finish(claim, result)) summary.conflicts += 1; else summary.lostClaims += 1;
          continue;
        }
        if (!await store.recordStartReceipt(claim, returned)) { summary.lostClaims += 1; continue; }
        claim.expectedRunId = returned.runId;
      }
    }
    let readback: AdmissionReadback;
    try { readback = await bounded('readback', callTimeoutMs, () => port.read(claim.binding, claim.expectedRunId)); }
    catch (error) { readback = { status: 'unavailable', cause: admissionCause(error) }; }
    let result: AdmissionFinish;
    if (readback?.status === 'found') {
      const mismatches = matchingExecution(claim.binding, readback.execution, claim.expectedRunId);
      result = mismatches.length ? { state: 'conflict', cause: { name: 'AdmissionConflict', code: 'execution_binding_conflict',
        message: `Existing execution disagrees on: ${mismatches.join(',')}` } }
        : { state: 'admitted', receipt: readback.execution, ...(startCause ? { cause: startCause } : {}) };
    } else {
      const readCause = readback?.status === 'unavailable' ? readback.cause : readback?.status === 'missing'
        ? { name: 'AdmissionReadbackMissing', code: 'admission_readback_missing',
          message: 'Original execution evidence is missing; explicit lifecycle recovery required' }
        : { name: 'AdmissionReadbackInvalid', code: 'admission_readback_invalid', message: 'Coordinator returned an unsupported readback contract' };
      // Preserve both exact restricted transport causes; neither is converted to success.
      result = { state: 'pending', cause: startCause ? { name: 'AdmissionUnresolved', code: 'admission_unresolved',
        message: JSON.stringify({ start: startCause, readback: readCause }) } : readCause };
    }
    if (startCause) result.startCause = startCause;
    const committed = await store.finish(claim, result);
    if (!committed) summary.lostClaims += 1;
    else if (committed === 'admitted') summary.admitted += 1;
    else if (committed === 'conflict') summary.conflicts += 1;
    else summary.pending += 1;
  }
  return summary;
}
