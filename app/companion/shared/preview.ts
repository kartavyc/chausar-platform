import { PhoneError, copyBrief, sameBinding } from '../../../platform/runtime/phone/contracts.ts';
import type { AppChannel, Brief, BriefCache, CachedBrief, DeviceBinding, PhoneCredentialStore, PhoneMethods, PhoneTransport, RequestResult, RemoteRequest, SessionGrant } from '../../../platform/runtime/phone/contracts.ts';
import { CompanionAdapterError } from './controller.ts';
import type { CompanionDeviceIdentity, CompanionDocumentPicker, CompanionReceiptReader, SelectedDocument } from './view-contracts.ts';

export const DEMO_INVITE = 'DEMO-COMPANION';
export const DEMO_FILE_SHA256 = 'bb998198e6e1f1678029fb3d89811e29c2454b95a6b144fc75300b7c517a33c3';
/** Data-only compatibility clone for older preview hosts; native objects and CryptoKeys are refused. */
export function installPreviewCloneFallback() {
  if (typeof globalThis.structuredClone === 'function') return;
  function clone(value: any): any {
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Uint8Array) return Uint8Array.from(value);
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (Array.isArray(value)) return value.map(clone);
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new CompanionAdapterError('storage');
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  Object.defineProperty(globalThis, 'structuredClone', { configurable: true, writable: true, value: clone });
}
export function demoDocument(): SelectedDocument { const text = 'Invoice,Amount\nDEMO-1,1250\n'; return { name: 'synthetic-invoice.csv', mediaType: 'text/csv', bytes: new Uint8Array([...text].map(character => character.charCodeAt(0))) }; }
export class MemoryPreviewCredentials implements PhoneCredentialStore {
  private grant?: SessionGrant;
  async load() { return this.grant ? structuredClone(this.grant) : undefined; }
  async save(grant: SessionGrant) { this.grant = structuredClone(grant); }
  async clear() { this.grant = undefined; }
}
/** Demo-only ephemeral cache. Live hosts must inject EncryptedBriefCache/secure storage. */
export class MemoryPreviewBriefCache implements BriefCache {
  private entries = new Map<string, { binding: DeviceBinding; brief: CachedBrief }>();
  private readonly clock: () => number;
  constructor(clock: () => number = Date.now) { this.clock = clock; }
  async put(binding: DeviceBinding, brief: Brief) { const time = this.clock(); this.entries.set(brief.id, { binding: structuredClone(binding), brief: { ...copyBrief(brief), cachedAt: new Date(time).toISOString(), expiresAt: new Date(time + 86400000).toISOString() } }); }
  async read(binding: DeviceBinding, id: string) { const entry = this.entries.get(id); return entry && sameBinding(binding, entry.binding) && Date.parse(entry.brief.expiresAt) > this.clock() ? structuredClone(entry.brief) : undefined; }
  async list(binding: DeviceBinding) { const rows: CachedBrief[] = []; for (const id of this.entries.keys()) { const brief = await this.read(binding, id); if (brief) rows.push(brief); } return rows; }
  async clear() { this.entries.clear(); }
}
export const previewIdentity = (channel: AppChannel): CompanionDeviceIdentity => ({ preparePairing: async () => ({ deviceId: `demo_${channel}_phone`, devicePublicKey: 'synthetic-preview-public-key', proof: 'synthetic-preview-proof' }) });
export const previewPicker: CompanionDocumentPicker = { pick: async () => demoDocument() };
export const previewReceipts: CompanionReceiptReader = { read: async id => ({ id, title: 'Synthetic receipt', generatedAt: new Date().toISOString(), source: 'Made-up preview invoices. No real workspace was queried.', method: 'Fixed fixture calculation, shown only to exercise the receipt screen.', coverage: 'Preview rows only. This is not a result from your business.', details: 'Example total: 1,250 minor units from one synthetic invoice. A live result must be read from the engine receipt ledger.' }) };

/** Only the bundled synthetic attachment is supported; this is not general/native cryptography. */
export const syntheticDocumentCrypto = {
  subtle: { digest: async (algorithm: string, input: ArrayBuffer | ArrayBufferView) => {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const sample = demoDocument().bytes;
    if (algorithm !== 'SHA-256' || bytes.length !== sample.length || bytes.some((byte, index) => byte !== sample[index])) throw new CompanionAdapterError('crypto');
    return new Uint8Array(DEMO_FILE_SHA256.match(/../g)!.map(hex => Number.parseInt(hex, 16))).buffer;
  } },
} as unknown as Crypto;

/** Pure local fixture endpoints. No network, vendor, data engine or real pairing. */
export class PreviewPhoneTransport implements PhoneTransport {
  private grant?: SessionGrant;
  private requests = new Map<string, RemoteRequest<RequestResult>>();
  private uploads = new Map<string, { requestId: string; size: number; offset: number; digest: string }>();
  private consumed = new Set<string>();
  private version = 'demo-note:1.0';
  private loseResponse?: keyof PhoneMethods;
  readonly calls: (keyof PhoneMethods)[] = [];
  private readonly options: { clock?: () => number; provisionCache?: (binding: DeviceBinding) => Promise<void> };
  constructor(options: { clock?: () => number; provisionCache?: (binding: DeviceBinding) => Promise<void> } = {}) { this.options = options; }
  private time() { return (this.options.clock ?? Date.now)(); }
  dropNextResponse(method: keyof PhoneMethods) { this.loseResponse = method; }
  changeOperationVersion(version: string) { this.version = version; }
  revoke() { this.grant = undefined; }
  private briefs(): Brief[] { return [
    { id: 'demo_weekly_brief', workspaceId: 'demo_shop', version: 'v1', generatedAt: new Date(this.time()).toISOString(), title: 'Your week, at a glance', summary: 'Synthetic preview: one invoice is ready for review. Open its receipt to see the example behind the number.', receiptIds: ['demo_receipt_invoice'] },
    { id: 'demo_cash_brief', workspaceId: 'demo_shop', version: 'v1', generatedAt: new Date(this.time()).toISOString(), title: 'A quieter cash check', summary: 'Synthetic preview: the next step is to review the working draft. This brief contains no real financial data.', receiptIds: ['demo_receipt_cash'] },
  ]; }
  async request<M extends keyof PhoneMethods>(method: M, input: PhoneMethods[M]['input'], options: { credential?: string; signal: AbortSignal }): Promise<PhoneMethods[M]['output']> {
    if (options.signal.aborted) throw new PhoneError('VALIDATION_REQUIRED'); this.calls.push(method);
    const value = input as any; const time = this.time(); let output: unknown;
    if (method === 'pairing.accept') {
      if (value.inviteCode !== DEMO_INVITE || value.proof !== 'synthetic-preview-proof') throw new PhoneError('INVALID_REQUEST');
      const binding = { workspaceId: 'demo_shop', memberId: 'demo_owner', deviceId: value.deviceId, epoch: 1 };
      await this.options.provisionCache?.(binding);
      this.grant = { credential: 'synthetic-preview-credential-never-a-live-session', authority: { binding, sessionId: 'demo_session_v1', expiresAt: new Date(time + 86400000).toISOString(), validatedAt: new Date(time).toISOString(), capabilities: ['brief.read', 'chat', 'upload', 'approval.simple'] } };
      output = structuredClone(this.grant);
    } else {
      if (!this.grant || options.credential !== this.grant.credential) throw new PhoneError('ACCESS_REVOKED');
      if (Date.parse(this.grant.authority.expiresAt) <= time) throw new PhoneError('SESSION_EXPIRED');
      if (method === 'session.validate') output = { status: 'current', authority: { ...this.grant.authority, validatedAt: new Date(time).toISOString() } };
      else if (method === 'session.revoke') { this.grant = undefined; output = { status: 'revoked', deviceId: value.deviceId }; }
      else if (method === 'brief.list') output = this.briefs();
      else if (method === 'brief.read') { output = this.briefs().find(brief => brief.id === value.briefId); if (!output) throw new PhoneError('INVALID_REQUEST'); }
      else if (method === 'approval.list') output = [{ approvalId: 'demo_internal_note', title: 'Save the review note', eligibility: 'simple-reversible' }, { approvalId: 'demo_money', title: 'Payment — desktop decision required', eligibility: 'open-desktop' }].filter(item => !this.consumed.has(item.approvalId));
      else if (method === 'approval.inspect') {
        if (!['demo_internal_note', 'demo_money'].includes(value.approvalId) || this.consumed.has(value.approvalId)) throw new PhoneError('APPROVAL_USED');
        output = { preview: { approvalId: value.approvalId, actionId: `action_${value.approvalId}`, binding: this.grant.authority.binding, actionRevision: 1, operationVersion: this.version, digest: 'a'.repeat(64), expiresAt: new Date(time + 300000).toISOString(), title: value.approvalId === 'demo_money' ? 'Payment needs the desktop app' : 'Save the internal review note', summary: value.approvalId === 'demo_money' ? 'Money decisions stay in the desktop app.' : 'Save one reversible note inside this synthetic workspace. Nothing is sent to a customer.', eligibility: value.approvalId === 'demo_money' ? 'open-desktop' : 'simple-reversible' }, ...(value.approvalId === 'demo_money' ? {} : { token: 'b'.repeat(64) }) };
      } else if (method === 'approval.submit') {
        if (value.approvalId !== 'demo_internal_note') throw new PhoneError('OPEN_DESKTOP');
        if (this.consumed.has(value.approvalId)) throw new PhoneError('APPROVAL_USED');
        if (value.expectedOperationVersion !== this.version || value.expectedActionRevision !== 1 || value.expectedDigest !== 'a'.repeat(64) || value.token !== 'b'.repeat(64)) throw new PhoneError('PREVIEW_CHANGED');
        this.consumed.add(value.approvalId); output = { status: 'succeeded', requestId: value.requestId, result: { approvalId: value.approvalId, actionId: `action_${value.approvalId}`, decision: value.decision === 'approve' ? 'approved' : 'rejected', decidedAt: new Date(time).toISOString() } }; this.requests.set(value.requestId, output as RemoteRequest<RequestResult>);
      } else if (method === 'chat.start') { output = { status: 'pending', requestId: value.requestId }; this.requests.set(value.requestId, output as RemoteRequest<RequestResult>); }
      else if (method === 'upload.begin') { const uploadId = `upload_${value.requestId}`; this.uploads.set(uploadId, { requestId: value.requestId, size: value.metadata.sizeBytes, offset: 0, digest: value.metadata.sha256 }); output = { uploadId, maxChunkBytes: 65536, expiresAt: new Date(time + 300000).toISOString() }; }
      else if (method === 'upload.chunk') { const slot = this.uploads.get(value.uploadId); if (!slot || slot.offset !== value.offset || !(value.bytes instanceof Uint8Array) || slot.offset + value.bytes.length > slot.size) throw new PhoneError('INVALID_REQUEST'); slot.offset += value.bytes.length; output = { nextOffset: slot.offset }; }
      else if (method === 'upload.finish') { const slot = this.uploads.get(value.uploadId); if (!slot || slot.offset !== slot.size || value.sha256 !== slot.digest) throw new PhoneError('INVALID_REQUEST'); output = { status: 'succeeded', requestId: value.requestId, result: { uploadId: value.uploadId, sourceId: 'demo_staged_document', status: 'awaiting-confirmation', sourceTainted: true } }; this.requests.set(value.requestId, output as RemoteRequest<RequestResult>); }
      else if (method === 'request.status') { let request = this.requests.get(value.requestId); if (!request) throw new PhoneError('INVALID_REQUEST'); if (request.status === 'pending') { request = { status: 'succeeded', requestId: value.requestId, result: { conversationId: `chat_${value.requestId}`, text: 'This is a synthetic preview answer. One invoice appears in the example receipt; no real workspace or model was queried.', receiptIds: ['demo_receipt_invoice'] } }; this.requests.set(value.requestId, request); } output = request; }
      else if (method === 'request.cancel') { const current = this.requests.get(value.requestId); if (current?.status === 'succeeded') output = current; else { output = { status: 'cancelled', requestId: value.requestId }; this.requests.set(value.requestId, output as RemoteRequest<RequestResult>); } }
      else throw new PhoneError('INVALID_REQUEST');
    }
    if (this.loseResponse === method) { this.loseResponse = undefined; throw new Error('SYNTHETIC_CONNECTION_LOSS'); }
    return structuredClone(output) as PhoneMethods[M]['output'];
  }
}
