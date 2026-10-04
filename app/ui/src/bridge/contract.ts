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
/** Exact fixed Today/review refusal codes already declared by the native preload. */
export const todayRefusalCodes = [
  'TODAY_INVALID_REQUEST', 'INVALID_TODAY_REQUEST', 'TODAY_AUTHORITY_REQUIRED', 'TODAY_HOST_AUTHORITY_REQUIRED',
  'TODAY_SERVICE_REQUIRED', 'TODAY_AUTHORITY_STORE_MISMATCH', 'TODAY_AUTHORITY_UNAVAILABLE', 'TODAY_AUTHORITY_CHANGED', 'TODAY_READ_ONLY',
  'TODAY_SELECTION_POLICY_REQUIRED', 'TODAY_SELECTION_INVALID', 'TODAY_CONFIGURATION_INVALID', 'TODAY_PREPARATION_FORBIDDEN',
  'TODAY_CAPTURE_UNAVAILABLE', 'TODAY_TILES_SERVICE_UNAVAILABLE', 'TODAY_TILES_CALCULATOR_REQUIRED', 'TODAY_TILES_INVALID_REQUEST',
  'TODAY_TILES_DEFINITION_CHANGED', 'TODAY_TILES_INPUT_CHANGED', 'TODAY_TILES_RECEIPT_CHANGED', 'TODAY_TILES_HELD_RESULT_FORBIDDEN',
  'TODAY_TILES_RECEIPT_MISMATCH', 'TODAY_TILES_RETENTION_EXPIRED', 'TODAY_ATTENTION_SERVICE_UNAVAILABLE', 'INVALID_TODAY_ATTENTION',
  'TODAY_ATTENTION_STALE', 'TODAY_ATTENTION_REFERENCE_UNAVAILABLE', 'TODAY_EVENTS_SERVICE_UNAVAILABLE', 'INVALID_TODAY_DAY',
  'INVALID_TODAY_EVENT_REFERENCE', 'TODAY_VIEW_CHANGED', 'TODAY_HELD_RESULT_FORBIDDEN', 'TODAY_EVENT_REFERENCE_UNAVAILABLE',
  'TODAY_REVIEW_SERVICE_UNAVAILABLE', 'REVIEW_WORKSPACE_CHANGED', 'REVIEW_AUTHORITY_UNAVAILABLE', 'REVIEW_AUTHORITY_CHANGED',
  'INVALID_REVIEW_PAGE', 'REVIEW_QUEUE_CHANGED', 'REVIEW_REFERENCE_UNAVAILABLE',
  'INVALID_JOB_ACCEPTANCE_REFERENCE', 'PREVIEW_CHANGED', 'JOB_EVIDENCE_REVOKED',
] as const;
export type TodayFailureCode = ReadFailureCode | typeof todayRefusalCodes[number] | 'TODAY_CONFIGURATION_CHANGED';
export type ReadResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: ReadFailureCode };
export interface DesktopReceiptReader { readonly environment: 'desktop'; receipt(id: string): Promise<ReadResult<CalculationReceiptEvidence>>; invalidate(): void }
export interface BrowserReceiptReader { readonly environment: 'browser'; receipt(id: string): Promise<ReadResult<CalculationReceiptEvidence>>; invalidate(): void }
export interface EnterpriseStatusReader { readonly environment: 'enterprise'; investigation(id: string): Promise<ReadResult<EnterpriseInvestigationStatus>>; invalidate(): void }
