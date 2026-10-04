import type {
  BrowserReceiptReader, BrowserRpcReadPort, DesktopEngineReadPort, DesktopReceiptReader,
  EvidenceDenialCode, EnterpriseReadPort, EnterpriseStatusReader, ReadFailureCode, ReadResult,
} from './contract.ts';
import { ReplyValidationError, projectCalculationReceipt, validateEnterpriseStatus } from './validate.ts';
import { todayRefusalCodes } from './contract.ts';

/** Additive preload protocol; callers still receive raw results or a local Error. */
export interface DesktopEnvelopePort {
  requestEnvelope(method: string, payload?: unknown): Promise<unknown>;
}
// Sandbox preload cannot import this module. Its matching allowlist is tested.
const desktopRefusalCodes = [
  'INVALID_REPLY', 'READ_INVALIDATED', 'ACCESS_DENIED', 'VAULT_LOCKED', 'UNAUTHENTICATED', 'EVIDENCE_UNAVAILABLE',
  'ACCESS_REVOKED', 'SOURCE_REVOKED', 'BRANCH_FORBIDDEN', 'RECEIPT_FORBIDDEN', 'FORBIDDEN', 'RECEIPT_NOT_FOUND',
  'INVALID_SESSION', 'ROUTE_REVOKED', 'OUTBOUND_APPROVAL_REQUIRED', 'CONVERSATION_CONTINUATION_RESOLVED',
  'CONVERSATION_CONTINUATION_LIMIT', 'PREVIEW_STALE', 'PAYLOAD_CHANGED', 'PREVIEW_REQUEST_CHANGED', 'SYNTHESIS_STALE',
  'CONVERSATION_CONTINUATION_STALE', 'MODEL_RECEIPT_EXPIRED', 'CALCULATION_STALE', 'CONVERSATION_NOT_FOUND',
  'CONVERSATION_CONTINUATION_UNAVAILABLE', 'MODEL_RECEIPT_NOT_FOUND', 'SYNTHESIS_UNAVAILABLE',
  'SCENARIO_UNAVAILABLE', 'SCENARIO_REVISION_UNAVAILABLE', 'SCENARIO_EVIDENCE_UNAVAILABLE', 'SCENARIO_FORBIDDEN', 'SCENARIO_AUTHORITY_CHANGED',
  'SCENARIO_ARTIFACT_CHANGED', 'SCENARIO_RETENTION_EXPIRED', 'SCENARIO_HOST_REQUIRED', 'SCENARIO_CUSTODY_INVALID', 'SCENARIO_CUSTODY_CONFLICT',
  'SCENARIO_TAINTED_CONTEXT', 'SCENARIO_WORKSPACE_CHANGED', 'SCENARIO_RUN_UNAVAILABLE', 'SCENARIO_READ_ONLY', 'SCENARIO_HEAD_CHANGED',
  'SCENARIO_JOB_UNAVAILABLE', 'SCENARIO_BRANCH_UNAVAILABLE', 'SCENARIO_GRAPH_INVALID', 'SCENARIO_VECTOR_MISMATCH', 'INVALID_SCENARIO',
  'LESSON_AUTHORITY_REQUIRED', 'LESSON_AUTHORITY_REVISION_REQUIRED', 'LESSON_AUTHORITY_CHANGED', 'LESSON_REVIEW_CHANGED',
  'LESSON_EVALUATION_BLOCKED', 'EVALUATION_AUTHORITY_REQUIRED', 'EVALUATION_CHANGED', 'EVALUATION_CANDIDATE_MISMATCH', 'EVALUATION_PROVENANCE_REQUIRED',
  'EVALUATION_COMPARISON_MISMATCH', 'INVALID_LESSON_EVALUATION', 'LESSON_EVIDENCE_UNAVAILABLE', 'LESSON_EVIDENCE_CHANGED', 'LESSON_TARGET_CHANGED',
  'LESSON_OWNER_REQUIRED', 'LESSON_WORKSPACE_CHANGED', 'LESSON_NOT_FOUND', 'LESSON_CHANGED', 'INVALID_LESSON', 'INVALID_LESSON_DECISION',
  'INVALID_LESSON_STATE', 'INVALID_LESSON_TARGET', 'APP_LESSON_REVIEW_REQUIRED', 'TAINTED_LESSON', 'LESSON_CONFLICT', 'INVALID_SUPERSESSION',
  'INVALID_DICTIONARY', 'INVALID_CURRENCY', 'INVALID_GST_MODE', 'INVALID_FIELD', 'INVALID_DEFINITION', 'RESERVED_MEASURE',
  'UNKNOWN_PACK', 'COMPILED_SUM_INVALID', 'INVALID_DICTIONARY_OPTIONS', 'INVALID_DICTIONARY_RECEIPT',
  'DICTIONARY_REVIEW_REQUIRED', 'DICTIONARY_CONFLICT', 'DICTIONARY_ATTEMPT_REUSED', 'DICTIONARY_ATTEMPT_AUTHORITY', 'INVALID_DICTIONARY_MODE',
  'INVALID_REQUEST', 'REQUEST_TOO_LARGE', 'UNTRUSTED_SENDER', 'REQUEST_FAILED',
  ...todayRefusalCodes,
] as const;
export type DesktopRefusalCode = typeof desktopRefusalCodes[number];
export type DesktopRequestEnvelope<T = unknown> =
  | { readonly version: 1; readonly ok: true; readonly result: T }
  | { readonly version: 1; readonly ok: false; readonly error: { readonly code: DesktopRefusalCode } };
function envelopeFields(value: unknown, keys: readonly string[]): Record<string, PropertyDescriptor> | null {
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(name => typeof name !== 'string' || !keys.includes(name))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some(name => !descriptors[name]?.enumerable || !Object.hasOwn(descriptors[name]!, 'value'))) return null;
  return descriptors;
}
function desktopFailure(code: DesktopRefusalCode): Error & { code: DesktopRefusalCode } {
  return Object.assign(new Error('The desktop request failed.'), { code });
}
/** Decode only the explicit envelope port. Raw business results are never inferred to be envelopes. */
export function unwrapDesktopRequestEnvelope(value: unknown): unknown {
  let code: DesktopRefusalCode = 'REQUEST_FAILED';
  try {
    const success = envelopeFields(value, ['version', 'ok', 'result']);
    if (success?.version?.value === 1 && success.ok?.value === true) return success.result!.value;
    const refusal = envelopeFields(value, ['version', 'ok', 'error']);
    if (refusal?.version?.value === 1 && refusal.ok?.value === false) {
      const error = envelopeFields(refusal.error!.value, ['code']);
      const declared = desktopRefusalCodes.find(item => item === error?.code?.value);
      if (declared) code = declared;
    }
  } catch { /* Malformed descriptors/proxies cannot turn a refusal into success. */ }
  throw desktopFailure(code);
}
/** Bind once in the trusted desktop entry before injecting the existing host/controller ports. */
export function createDesktopRequestPort(port: DesktopEnvelopePort): {
  request(method: string, payload?: unknown): Promise<unknown>;
} {
  return Object.freeze({ async request(method: string, payload: unknown = {}) {
    let reply: unknown;
    try { reply = await port.requestEnvelope(method, payload); }
    catch { throw desktopFailure('REQUEST_FAILED'); }
    return unwrapDesktopRequestEnvelope(reply);
  } });
}

function opaqueId(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(id)) throw new ReplyValidationError('request.id');
}
const evidenceDenials: readonly EvidenceDenialCode[] = ['ACCESS_DENIED', 'VAULT_LOCKED', 'UNAUTHENTICATED', 'EVIDENCE_UNAVAILABLE'];
/** Controllers must clear retained evidence on these codes; no old result accompanies them. */
export function isEvidenceDenial(code: ReadFailureCode): code is EvidenceDenialCode { return (evidenceDenials as readonly string[]).includes(code); }
/** Shared sanitized failure mapping for additional checked host read adapters. */
export function readFailureCode(error: unknown): ReadFailureCode {
  if (error instanceof ReplyValidationError) return 'INVALID_REPLY';
  let descriptor: PropertyDescriptor | undefined;
  try { descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined; }
  catch { return 'REQUEST_FAILED'; }
  const code: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  const knownCodes: readonly ReadFailureCode[] = ['INVALID_REPLY', 'READ_INVALIDATED', ...evidenceDenials];
  const declared = knownCodes.find(item => item === code); if (declared) return declared;
  if (code === 'VAULT_LOCKED') return 'VAULT_LOCKED';
  if (code === 'UNAUTHENTICATED' || code === 'authentication_required') return 'UNAUTHENTICATED';
  if (typeof code === 'string' && ['ACCESS_REVOKED', 'SOURCE_REVOKED', 'BRANCH_FORBIDDEN', 'RECEIPT_FORBIDDEN', 'FORBIDDEN', 'authority_denied'].includes(code)) return 'ACCESS_DENIED';
  if (code === 'RECEIPT_NOT_FOUND' || code === 'not_found' || code === 'model_artifact_unavailable') return 'EVIDENCE_UNAVAILABLE';
  return 'REQUEST_FAILED';
}
/** A shared generation guard, including asynchronous checked receipt rereads. */
export async function checkedRead<T>(read: () => Promise<unknown>, check: (value: unknown) => T | Promise<T>, current: () => boolean, invalidate: () => void): Promise<ReadResult<T>> {
  try {
    const reply = await read();
    if (!current()) return Object.freeze({ ok: false, code: 'READ_INVALIDATED' });
    const value = await check(reply);
    if (!current()) return Object.freeze({ ok: false, code: 'READ_INVALIDATED' });
    return Object.freeze({ ok: true, value });
  } catch (error) {
    if (!current()) return Object.freeze({ ok: false, code: 'READ_INVALIDATED' });
    const code = readFailureCode(error); if (isEvidenceDenial(code)) invalidate();
    return Object.freeze({ ok: false, code });
  }
}
/** Reads are fresh. No saved receipt bypasses the engine's current authorization. */
export function createDesktopReceiptReader(port: DesktopEngineReadPort): DesktopReceiptReader {
  let generation = Symbol();
  return Object.freeze({ environment: 'desktop', invalidate() { generation = Symbol(); }, receipt(id: string) {
    const requestedGeneration = generation;
    return checkedRead(() => { opaqueId(id); return port.request('receipts.get', { id }); }, value => {
      const receipt = projectCalculationReceipt(value); if (receipt.id !== id) throw new ReplyValidationError('receipt.id'); return receipt;
    }, () => generation === requestedGeneration, () => { generation = Symbol(); });
  } });
}
/** Browser RPC is injected separately. Components contain no fetch or bearer tokens. */
export function createBrowserReceiptReader(port: BrowserRpcReadPort): BrowserReceiptReader {
  let generation = Symbol();
  return Object.freeze({ environment: 'browser', invalidate() { generation = Symbol(); }, receipt(id: string) {
    const requestedGeneration = generation;
    return checkedRead(() => { opaqueId(id); return port.call({ method: 'receipts.get', payload: { id } }); }, value => {
      const receipt = projectCalculationReceipt(value); if (receipt.id !== id) throw new ReplyValidationError('receipt.id'); return receipt;
    }, () => generation === requestedGeneration, () => { generation = Symbol(); });
  } });
}
/** Enterprise status uses its actual route. There is deliberately no receipt alias. */
export function createEnterpriseStatusReader(port: EnterpriseReadPort): EnterpriseStatusReader {
  let generation = Symbol();
  return Object.freeze({ environment: 'enterprise', invalidate() { generation = Symbol(); }, investigation(id: string) {
    const requestedGeneration = generation;
    return checkedRead(() => { opaqueId(id); return port.get(`/v1/investigations/${id}`); }, value => {
      const status = validateEnterpriseStatus(value); if (status.investigationId !== id) throw new ReplyValidationError('investigation.id'); return status;
    }, () => generation === requestedGeneration, () => { generation = Symbol(); });
  } });
}
