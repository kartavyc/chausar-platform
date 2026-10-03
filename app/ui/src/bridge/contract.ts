import type { CalculationReceiptEvidence, EnterpriseInvestigationStatus } from './presentation.ts';

/** The trusted host owns transport, origin, identity, authentication and IPC. */
export interface DesktopEngineReadPort {
  request(method: 'receipts.get', payload: { readonly id: string }): Promise<unknown>;
}
/** This is the desktop-engine RPC schema over the browser host's transport. */
export interface BrowserRpcReadPort {
  call(message: { readonly method: 'receipts.get'; readonly payload: { readonly id: string } }): Promise<unknown>;
}
/** The recovered enterprise server has a different public API and evidence schema. */
export interface EnterpriseReadPort {
  get(path: `/v1/investigations/${string}`): Promise<unknown>;
}
export type EvidenceDenialCode = 'ACCESS_DENIED' | 'VAULT_LOCKED' | 'UNAUTHENTICATED' | 'EVIDENCE_UNAVAILABLE';
export type ReadFailureCode = 'INVALID_REPLY' | 'REQUEST_FAILED' | 'READ_INVALIDATED' | EvidenceDenialCode;
export type ReadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: ReadFailureCode };
export interface DesktopReceiptReader { readonly environment: 'desktop'; receipt(id: string): Promise<ReadResult<CalculationReceiptEvidence>>; invalidate(): void }
export interface BrowserReceiptReader { readonly environment: 'browser'; receipt(id: string): Promise<ReadResult<CalculationReceiptEvidence>>; invalidate(): void }
export interface EnterpriseStatusReader { readonly environment: 'enterprise'; investigation(id: string): Promise<ReadResult<EnterpriseInvestigationStatus>>; invalidate(): void }
