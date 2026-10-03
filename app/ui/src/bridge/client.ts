import type {
  BrowserReceiptReader, BrowserRpcReadPort, DesktopEngineReadPort, DesktopReceiptReader,
  EvidenceDenialCode, EnterpriseReadPort, EnterpriseStatusReader, ReadFailureCode, ReadResult,
} from './contract.ts';
import { ReplyValidationError, projectCalculationReceipt, validateEnterpriseStatus } from './validate.ts';

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
