/** Portable companion protocol. No desktop, database, framework, or Node imports. */
export const PHONE_PROTOCOL_VERSION = 1 as const;
export type PhoneChannel = 'ios' | 'android' | 'web' | 'whatsapp' | 'email';
export type AppChannel = Extract<PhoneChannel, 'ios' | 'android' | 'web'>;
export type DeviceBinding = { workspaceId: string; memberId: string; deviceId: string; epoch: number };
export type PhoneCapability = 'brief.read' | 'chat' | 'upload' | 'approval.simple';
export type SessionAuthority = {
  binding: DeviceBinding; sessionId: string; expiresAt: string; validatedAt: string;
  capabilities: PhoneCapability[];
};
/** Credentials belong in an OS/browser credential adapter, never URLs or diagnostic state. */
export type SessionGrant = { authority: SessionAuthority; credential: string };
export type SessionValidation =
  | { status: 'current'; authority: SessionAuthority }
  | { status: 'revoked' | 'expired' | 'unpaired' };
export type PairingState =
  | { status: 'unpaired' | 'pairing' }
  | { status: 'paired'; authority: SessionAuthority }
  | { status: 'validation-required'; binding: DeviceBinding }
  | { status: 'revoked' | 'expired'; binding?: DeviceBinding };
export type ConnectionState = 'offline' | 'connecting' | 'online';

export type Brief = {
  id: string; workspaceId: string; version: string; generatedAt: string;
  title: string; summary: string; receiptIds: string[];
};
/** A local snapshot is read-only information, never an authority or approval object. */
export type CachedBrief = Brief & { cachedAt: string; expiresAt: string };
export type BriefView = { brief: Brief; freshness: 'current' } | { brief: CachedBrief; freshness: 'cached'; readOnly: true };
export type ChatAnswer = { conversationId: string; text: string; receiptIds: string[] };
export type UploadMetadata = { name: string; mediaType: 'image/jpeg' | 'image/png' | 'application/pdf' | 'text/csv'; sizeBytes: number; sha256: string };
export type UploadSlot = { uploadId: string; maxChunkBytes: number; expiresAt: string };
export type UploadReceipt = { uploadId: string; sourceId: string; status: 'awaiting-confirmation'; sourceTainted: true };
export type ApprovalPreview = {
  approvalId: string; actionId: string; binding: DeviceBinding; actionRevision: number;
  operationVersion: string; digest: string; expiresAt: string;
  title: string; summary: string;
  eligibility: 'simple-reversible' | 'open-desktop';
};
/**
 * One inbox row. `eligibility` is an optional, display-only hint from the engine:
 * it never grants anything. Approval still needs approval.inspect (fresh preview,
 * single-use token) and approval.submit with the exact digest/revision/version.
 * A row without the hint is treated as 'open-desktop' by every client.
 */
export type ApprovalListItem = { approvalId: string; title: string; eligibility?: ApprovalPreview['eligibility'] };
export const isApprovalEligibility = (value: unknown): value is ApprovalPreview['eligibility'] => value === 'simple-reversible' || value === 'open-desktop';
/** Copies only known fields; an unknown or absent hint is dropped. */
export const copyApprovalListItem = (item: ApprovalListItem): ApprovalListItem => ({ approvalId: item.approvalId, title: item.title, ...(isApprovalEligibility(item.eligibility) ? { eligibility: item.eligibility } : {}) });
/** Returned once over an authenticated channel. Keep only in memory until a tap. */
export type ApprovalChallenge = { preview: ApprovalPreview; token?: string };
export type ApprovalDecision = {
  requestId: string; approvalId: string; token: string; decision: 'approve' | 'reject';
  expectedDigest: string; expectedActionRevision: number; expectedOperationVersion: string;
};
export type ApprovalReceipt = { approvalId: string; actionId: string; decision: 'approved' | 'rejected'; decidedAt: string };

export type RemoteRequest<T> =
  | { status: 'pending'; requestId: string }
  | { status: 'unknown'; requestId: string }
  | { status: 'succeeded'; requestId: string; result: T }
  | { status: 'cancelled'; requestId: string }
  | { status: 'failed'; requestId: string; code: PhoneErrorCode };
export type RequestResult = ChatAnswer | UploadReceipt | ApprovalReceipt;
export type RequestState<T = RequestResult> = RemoteRequest<T> | { status: 'cancelling'; requestId: string };
export type PhoneMethods = {
  'pairing.accept': { input: { inviteCode: string; deviceId: string; channel: AppChannel; devicePublicKey: string; proof: string }; output: SessionGrant };
  'session.validate': { input: Record<string, never>; output: SessionValidation };
  'session.revoke': { input: { deviceId: string }; output: { status: 'revoked'; deviceId: string } };
  'brief.list': { input: Record<string, never>; output: Brief[] };
  'brief.read': { input: { briefId: string }; output: Brief };
  'chat.start': { input: { requestId: string; question: string }; output: RemoteRequest<ChatAnswer> };
  'upload.begin': { input: { requestId: string; metadata: UploadMetadata }; output: UploadSlot };
  'upload.chunk': { input: { uploadId: string; offset: number; bytes: Uint8Array }; output: { nextOffset: number } };
  'upload.finish': { input: { requestId: string; uploadId: string; sha256: string }; output: RemoteRequest<UploadReceipt> };
  'approval.inspect': { input: { approvalId: string }; output: ApprovalChallenge };
  'approval.list': { input: Record<string, never>; output: ApprovalListItem[] };
  'approval.submit': { input: ApprovalDecision; output: RemoteRequest<ApprovalReceipt> };
  'request.status': { input: { requestId: string }; output: RemoteRequest<RequestResult> };
  'request.cancel': { input: { requestId: string }; output: RemoteRequest<RequestResult> };
};
export interface PhoneTransport {
  /** TLS remote adapter authenticates each request; must never serialize credentials into URLs/logs. */
  request<M extends keyof PhoneMethods>(method: M, input: PhoneMethods[M]['input'], options: { credential?: string; signal: AbortSignal }): Promise<PhoneMethods[M]['output']>;
}
export interface PhoneCredentialStore {
  load(): Promise<SessionGrant | undefined>;
  save(grant: SessionGrant): Promise<void>;
  clear(): Promise<void>;
}
export interface BriefCache {
  put(binding: DeviceBinding, brief: Brief): Promise<void>;
  read(binding: DeviceBinding, briefId: string): Promise<CachedBrief | undefined>;
  list?(binding: DeviceBinding): Promise<CachedBrief[]>;
  clear(): Promise<void>;
}
export type PhoneErrorCode = 'OFFLINE' | 'VALIDATION_REQUIRED' | 'ACCESS_REVOKED' | 'SESSION_EXPIRED' | 'UNPAIRED' | 'INVALID_RESPONSE' | 'INVALID_REQUEST' | 'CHANNEL_FORBIDDEN' | 'CAPABILITY_FORBIDDEN' | 'APPROVAL_EXPIRED' | 'APPROVAL_USED' | 'PREVIEW_CHANGED' | 'OPEN_DESKTOP' | 'REQUEST_EXISTS' | 'TRANSPORT_UNKNOWN' | 'CACHE_INVALID';
export class PhoneError extends Error {
  readonly code: PhoneErrorCode;
  constructor(code: PhoneErrorCode) { super(code); this.name = 'PhoneError'; this.code = code; }
}
export function requirePhone(condition: unknown, code: PhoneErrorCode): asserts condition { if (!condition) throw new PhoneError(code); }
export const sameBinding = (a: DeviceBinding, b: DeviceBinding) => a.workspaceId === b.workspaceId && a.memberId === b.memberId && a.deviceId === b.deviceId && a.epoch === b.epoch;
export const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export const isOperationVersion = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
export const isApprovalToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validBinding(binding: DeviceBinding): boolean { return !!binding && isId(binding.workspaceId) && isId(binding.memberId) && isId(binding.deviceId) && Number.isSafeInteger(binding.epoch) && binding.epoch > 0; }
export function validAuthority(authority: SessionAuthority, time: number): boolean {
  return !!authority && validBinding(authority.binding) && isId(authority.sessionId) && Number.isFinite(Date.parse(authority.expiresAt)) && Date.parse(authority.expiresAt) > time && Number.isFinite(Date.parse(authority.validatedAt)) && Date.parse(authority.validatedAt) <= time && Array.isArray(authority.capabilities) && authority.capabilities.every(c => ['brief.read', 'chat', 'upload', 'approval.simple'].includes(c));
}
export function validBrief(brief: Brief): boolean {
  return !!brief && isId(brief.id) && isId(brief.workspaceId) && isId(brief.version) && Number.isFinite(Date.parse(brief.generatedAt)) && typeof brief.title === 'string' && brief.title.length <= 200 && typeof brief.summary === 'string' && brief.summary.length <= 16000 && Array.isArray(brief.receiptIds) && brief.receiptIds.length <= 100 && brief.receiptIds.every(isId);
}
export const copyBinding = (binding: DeviceBinding): DeviceBinding => ({ workspaceId: binding.workspaceId, memberId: binding.memberId, deviceId: binding.deviceId, epoch: binding.epoch });
export const copyAuthority = (authority: SessionAuthority): SessionAuthority => ({ binding: copyBinding(authority.binding), sessionId: authority.sessionId, expiresAt: authority.expiresAt, validatedAt: authority.validatedAt, capabilities: [...authority.capabilities] });
export const copyBrief = (brief: Brief): Brief => ({ id: brief.id, workspaceId: brief.workspaceId, version: brief.version, generatedAt: brief.generatedAt, title: brief.title, summary: brief.summary, receiptIds: [...brief.receiptIds] });
