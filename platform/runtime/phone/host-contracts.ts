import type { AppChannel, ApprovalChallenge, ApprovalDecision, ApprovalPreview, Brief, DeviceBinding, PhoneCapability, PhoneMethods, RemoteRequest, RequestResult, SessionAuthority, SessionGrant } from './contracts.ts';

export type PhoneRequestIdentity = { requestId: string; kind: 'chat' | 'upload' | 'approval'; target?: string };
export type PhoneReceipt = { id: string; workspaceId: string; text: string };
/** Additive companion endpoints. Existing portable PhoneMethods remain unchanged. */
export type PhoneHostMethods = PhoneMethods & {
  'request.list': { input: Record<string, never>; output: PhoneRequestIdentity[] };
  'receipt.read': { input: { receiptId: string }; output: PhoneReceipt };
};
export type PhoneHostMethod = keyof PhoneHostMethods;
export type PhoneHostProof = { deviceId: string; keyId: string; timestamp: string; nonce: string; proof: string };
/** Exact signed bytes, never a reserialized body. Do not log this object. */
export type PhoneHostAuthentication = { bytes: Uint8Array; credential?: string; proof: PhoneHostProof };
/** Constructed exclusively by the current session adapter, never by request JSON. */
export type PhoneHostPrincipal = { authority: SessionAuthority; channel: AppChannel; role: 'owner' | 'staff' | 'accountant' };
export type PhoneHostRelease =
  | { kind: 'session' }
  | { kind: 'brief'; briefs: Pick<Brief, 'id' | 'version' | 'receiptIds'>[] }
  | { kind: 'receipt'; receiptId: string }
  | { kind: 'approval-list'; approvalIds: string[] }
  | { kind: 'approval'; preview: ApprovalPreview }
  | { kind: 'requests'; records: Pick<PhoneCustodyRecord, 'identity' | 'binding' | 'sessionId' | 'operationId' | 'scope' | 'expiresAt'>[] };
export type PhoneRequestScope = {
  /** Trusted permission/source/action revision, checked again before every read or write. */
  revision: string; operationVersion: string; sourceIds: string[];
};
export type PhoneHostOperation =
  | { kind: 'chat'; input: PhoneMethods['chat.start']['input'] }
  | { kind: 'approval'; input: ApprovalDecision };
export type PhoneCustodyRecord = {
  identity: PhoneRequestIdentity; binding: DeviceBinding; sessionId: string;
  operationId: string; inputDigest: string; scope: PhoneRequestScope;
  createdAt: string; expiresAt: string; state: RemoteRequest<RequestResult>;
};
/** Synchronous work under a durable atomic writer boundary; errors roll back all writes. */
export interface PhoneCustodyStorage {
  transaction<T>(work: (records: PhoneCustodyRecord[]) => T): Promise<T>;
}
export interface PhoneHostPorts {
  /** Verify exact-body device signature, timestamp and one-use nonce, scoped credential,
   * current membership/device/epoch/session/revocation/expiry. Reject desktop/CLI tokens.
   * Do not return cached authority; live backend mutations must recheck atomically. */
  authenticate(request: PhoneHostAuthentication): Promise<PhoneHostPrincipal>;
  /** Final protected-read release checkpoint after asynchronous projection. Re-read
   * current grant/capabilities and source/row access for these exact retained references;
   * bind brief version and approval digest/revision/catalogue before returning. A
   * qualified guarded read/lease may implement this boundary. Never use cached authority. */
  release(principal: PhoneHostPrincipal, resource: PhoneHostRelease): Promise<void>;
  /** Existing desktop-authorized single-use invite and device proof implementation. */
  pair?(request: PhoneHostAuthentication, input: PhoneMethods['pairing.accept']['input']): Promise<SessionGrant>;
  revoke?(principal: PhoneHostPrincipal, deviceId: string): Promise<void>;
  briefs(principal: PhoneHostPrincipal, briefId?: string): Promise<Brief[]>;
  receipt(principal: PhoneHostPrincipal, receiptId: string): Promise<PhoneReceipt>;
  approvals?(principal: PhoneHostPrincipal): Promise<{ approvalId: string; title: string }[]>;
  inspectApproval?(principal: PhoneHostPrincipal, approvalId: string): Promise<ApprovalChallenge>;
  /** Resolve trusted current source/action/access identity; question text has no authority.
   * Approval admission MUST check the exact decision against its current desktop offer. */
  admit(principal: PhoneHostPrincipal, operation: PhoneHostOperation): Promise<PhoneRequestScope>;
  /** Recheck grant, current capability, source existence/access and exact scope revision.
   * Refuse stale or deleted data even for already retained results. */
  check(principal: PhoneHostPrincipal, record: PhoneCustodyRecord): Promise<void>;
  /** Durable idempotency by operationId. Commit result/receipt and effects atomically with
   * current authorization and exact scope checks before resolving. Approval consumes the
   * existing one-time challenge and records disposition only; never execute an action.
   * Chat uses the existing disclosure/receipt-backed conversation boundary. */
  start(principal: PhoneHostPrincipal, record: PhoneCustodyRecord, operation: PhoneHostOperation): Promise<RemoteRequest<RequestResult>>;
  /** Read-only reconciliation of operationId; never rerun input or manufacture success. */
  status(principal: PhoneHostPrincipal, record: PhoneCustodyRecord): Promise<RemoteRequest<RequestResult>>;
  /** Atomically cancel before effect commit, or return the already committed outcome.
   * An absent operation must receive a durable cancellation tombstone before success. */
  cancel(principal: PhoneHostPrincipal, record: PhoneCustodyRecord): Promise<RemoteRequest<RequestResult>>;
}
export const phoneRequestCapability = (kind: PhoneRequestIdentity['kind']): PhoneCapability =>
  kind === 'chat' ? 'chat' : kind === 'approval' ? 'approval.simple' : 'upload';
