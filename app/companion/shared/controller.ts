import { PhoneError, copyBrief, isId, requirePhone, sameBinding } from '../../../platform/runtime/phone/contracts.ts';
import type { PhoneClient } from '../../../platform/runtime/phone/client.ts';
import type { CompanionDeviceIdentity, CompanionDocumentPicker, CompanionReceiptReader, CompanionScreen, CompanionScreenController, CompanionViewState, SelectedDocument } from './view-contracts.ts';

export class CompanionAdapterError extends Error {
  readonly feature: 'identity' | 'picker' | 'receipt' | 'storage' | 'crypto' | 'transport';
  constructor(feature: CompanionAdapterError['feature']) { super('ADAPTER_UNAVAILABLE'); this.feature = feature; }
}
const errorText = (error: unknown): string => {
  if (error instanceof CompanionAdapterError) return ({ identity: 'Device pairing is not connected yet.', picker: 'The document picker is not connected yet.', receipt: 'Receipt details are not connected yet.', storage: 'Protected storage is not connected yet.', crypto: 'Protected document processing is not connected yet.', transport: 'The remote companion connection is not connected yet.' })[error.feature];
  if (!(error instanceof PhoneError)) return 'Could not complete this request. Reconnect and check its status.';
  return ({ OFFLINE: 'You are offline. Saved briefs remain available. Reconnect to continue.', VALIDATION_REQUIRED: 'The connection changed. Reconnect and review again.', ACCESS_REVOKED: 'This device no longer has access. Ask the owner for a new invite.', SESSION_EXPIRED: 'Your session expired. Pair this device again.', UNPAIRED: 'Pair this phone with an invite from the workspace owner.', INVALID_RESPONSE: 'The connection could not confirm this result. Check its status.', INVALID_REQUEST: 'Check the invite, question or document and try again.', CHANNEL_FORBIDDEN: 'Open Chausar on your computer to continue.', CAPABILITY_FORBIDDEN: 'Your current access does not allow this request.', APPROVAL_EXPIRED: 'This decision expired. Open a fresh preview before deciding.', APPROVAL_USED: 'This decision was already used. Check its outcome in Activity.', PREVIEW_CHANGED: 'This action changed. Review a fresh preview before deciding.', OPEN_DESKTOP: 'This action needs your decision in the desktop app.', REQUEST_EXISTS: 'This request already exists. Check its status in Activity.', TRANSPORT_UNKNOWN: 'The connection was lost. The outcome is unknown until you check its status.', CACHE_INVALID: 'Saved briefs could not be opened. Reconnect for a fresh copy.' })[error.code];
};
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const entry of Object.values(value)) immutable(entry); Object.freeze(value); }
  return value;
}
const noWorkspace = { briefs: [], approvalInbox: [], messages: [], uploads: [], brief: undefined, approval: undefined, receipt: undefined };

/** Screen workflow owner; immediate operations only, no background write/approval queue. */
export class CompanionController implements CompanionScreenController {
  private readonly client: PhoneClient;
  private readonly identity: CompanionDeviceIdentity;
  private readonly picker: CompanionDocumentPicker;
  private readonly receipts: CompanionReceiptReader;
  private readonly crypto: Crypto;
  private readonly requestId: () => string;
  private readonly listeners = new Set<() => void>();
  private readonly busy = new Map<string, number>();
  private actionSerial = 0;
  private lifetime = 0;
  private navigationVersion = 0;
  private state: CompanionViewState;
  constructor(options: { client: PhoneClient; identity: CompanionDeviceIdentity; picker: CompanionDocumentPicker; receipts: CompanionReceiptReader; crypto: Crypto; mode: 'demo' | 'live'; requestId?: () => string }) {
    this.client = options.client; this.identity = options.identity; this.picker = options.picker; this.receipts = options.receipts; this.crypto = options.crypto;
    let sequence = 0; const instance = Date.now().toString(36); this.requestId = options.requestId ?? (() => `request_${instance}_${++sequence}`);
    this.state = immutable({ mode: options.mode, screen: 'pairing', client: this.client.snapshot(), busy: [], ...noWorkspace });
    this.client.subscribe(() => this.syncResults());
  }
  getState() { return this.state; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private update(patch: Partial<CompanionViewState> = {}) {
    const client = this.client.snapshot(); const lost = ['revoked', 'expired', 'unpaired'].includes(client.pairing.status);
    this.state = immutable({ ...this.state, ...patch, ...(lost ? noWorkspace : {}), client, busy: [...this.busy.keys()] });
    for (const listener of this.listeners) { try { listener(); } catch { /* Rendering failures do not change request delivery. */ } }
  }
  private async run(key: string, work: (lifetime: number) => Promise<void>) {
    if (this.busy.has(key)) return;
    const lifetime = this.lifetime; const action = ++this.actionSerial; this.busy.set(key, action); this.update({ notice: undefined });
    try { await work(lifetime); }
    catch (error) { if (lifetime === this.lifetime) this.update({ notice: { tone: 'error', text: errorText(error) } }); }
    finally { if (this.busy.get(key) === action) this.busy.delete(key); if (lifetime === this.lifetime) { this.syncResults(); this.update(); } }
  }
  private current(lifetime: number) { requirePhone(lifetime === this.lifetime, 'VALIDATION_REQUIRED'); }
  private async tracked(task: Promise<unknown>, requestId: string) {
    try { await task; return true; }
    catch (error) { const status = this.client.snapshot().requests.find(request => request.requestId === requestId)?.status; if (status === 'cancelled' || status === 'succeeded') return false; throw error; }
  }
  private syncResults() {
    const snapshot = this.client.snapshot(); const messages = [...this.state.messages];
    for (const request of snapshot.requests) if (request.status === 'succeeded' && 'conversationId' in request.result && !messages.some(message => message.id === `answer_${request.requestId}`)) messages.push({ id: `answer_${request.requestId}`, role: 'companion', text: request.result.text, requestId: request.requestId, receiptIds: [...request.result.receiptIds] });
    const uploads = this.state.uploads.map(upload => { const request = snapshot.requests.find(request => request.requestId === upload.requestId); return { ...upload, status: request?.status === 'succeeded' && 'uploadId' in request.result ? request.result.status : request?.status ?? upload.status }; });
    this.update({ messages, uploads });
  }
  navigate(screen: CompanionScreen) {
    requirePhone(['pairing', 'briefs', 'chat', 'uploads', 'approvals', 'activity', 'device', 'receipt'].includes(screen), 'INVALID_REQUEST');
    this.navigationVersion += 1; this.update({ screen, ...(screen === 'briefs' ? { brief: undefined } : {}), ...(screen === 'approvals' ? { approval: undefined } : {}), ...(screen !== 'receipt' ? { receipt: undefined } : {}) });
  }
  dismissNotice() { this.update({ notice: undefined }); }
  async start() {
    await this.run('start', async lifetime => {
      await this.client.restore(); this.current(lifetime);
      if (this.client.snapshot().pairing.status === 'validation-required') { const briefs = await this.client.listCachedBriefs(); this.current(lifetime); this.update({ briefs: briefs.map(brief => ({ ...copyBrief(brief), freshness: 'cached', cachedAt: brief.cachedAt, expiresAt: brief.expiresAt })), screen: 'briefs' }); }
      await this.client.reconnect(); this.current(lifetime);
      if (this.client.snapshot().pairing.status === 'paired') this.update({ screen: 'briefs' });
    });
  }
  async pair(inviteCode: string) {
    await this.run('pair', async lifetime => {
      requirePhone(typeof inviteCode === 'string' && inviteCode.trim().length >= 8 && inviteCode.length <= 4096, 'INVALID_REQUEST');
      const identity = await this.identity.preparePairing(inviteCode.trim()); this.current(lifetime);
      await this.client.pair({ ...identity, inviteCode: inviteCode.trim(), channel: this.client.channel }); this.current(lifetime);
      const briefs = await this.client.listBriefs(); this.current(lifetime);
      this.update({ screen: 'briefs', briefs, notice: { tone: 'success', text: this.state.mode === 'demo' ? 'Preview workspace paired. All data shown is synthetic.' : 'This phone is paired with your workspace.' } });
    });
  }
  async reconnect() {
    await this.run('connection', async lifetime => { await this.client.reconnect(); this.current(lifetime); this.update({ approval: undefined, notice: { tone: 'info', text: 'Connection checked. Pending requests were checked without resending them.' } }); });
  }
  disconnect() { this.lifetime += 1; this.client.disconnect(); this.busy.clear(); this.update({ brief: undefined, approval: undefined, notice: { tone: 'info', text: 'You are offline. Open a saved brief to keep reading.' } }); }
  async loadBriefs() {
    await this.run('briefs', async lifetime => {
      const offline = this.client.snapshot().connection === 'offline'; const briefs = offline ? await this.client.listCachedBriefs() : await this.client.listBriefs(); this.current(lifetime);
      this.update({ briefs: briefs.map(brief => ({ ...copyBrief(brief), freshness: offline ? 'cached' : 'current' })), ...(offline ? { notice: { tone: 'info', text: 'Showing saved brief snapshots. They are read only.' } } : {}) });
    });
  }
  async openBrief(briefId: string) {
    const navigation = this.navigationVersion;
    await this.run('brief', async lifetime => { const brief = await this.client.readBrief(briefId); this.current(lifetime); if (navigation === this.navigationVersion) this.update({ screen: 'briefs', brief }); });
  }
  async sendChat(question: string) {
    await this.run('chat', async lifetime => {
      requirePhone(typeof question === 'string' && question.trim().length > 0 && question.length <= 8000, 'INVALID_REQUEST');
      requirePhone(this.client.snapshot().connection === 'online', 'OFFLINE'); requirePhone(this.client.snapshot().pairing.status === 'paired', 'UNPAIRED');
      const requestId = this.requestId(); const text = question.trim();
      this.update({ messages: [...this.state.messages, { id: `question_${requestId}`, role: 'owner', text, requestId, receiptIds: [] }] });
      const task = this.client.chat(requestId, text); this.update(); await this.tracked(task, requestId); this.current(lifetime);
    });
  }
  async chooseDocument() {
    await this.run('picker', async lifetime => { const document = await this.picker.pick(); this.current(lifetime); if (document) await this.uploadDocument(document); });
  }
  async uploadDocument(document: SelectedDocument) {
    await this.run('upload', async lifetime => {
      requirePhone(document && typeof document.name === 'string' && document.name.length > 0 && document.name.length <= 200 && !/[\x00-\x1f/\\]/.test(document.name) && ['image/jpeg', 'image/png', 'application/pdf', 'text/csv'].includes(document.mediaType) && document.bytes instanceof Uint8Array && document.bytes.byteLength > 0 && document.bytes.byteLength <= 10 * 1024 * 1024, 'INVALID_REQUEST');
      requirePhone(this.client.snapshot().connection === 'online', 'OFFLINE');
      const file = { name: document.name, mediaType: document.mediaType, bytes: Uint8Array.from(document.bytes) };
      const bytes = new Uint8Array(await this.crypto.subtle.digest('SHA-256', file.bytes)); this.current(lifetime);
      const sha256 = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); const requestId = this.requestId();
      this.update({ uploads: [...this.state.uploads, { requestId, name: file.name, status: 'pending' }] });
      const task = this.client.upload(requestId, { name: file.name, mediaType: file.mediaType, sizeBytes: file.bytes.byteLength, sha256 }, file.bytes); this.update(); const completed = await this.tracked(task, requestId); this.current(lifetime);
      if (completed) this.update({ notice: { tone: 'info', text: 'Document staged for review. Confirm its import in the desktop app.' } });
    });
  }
  async loadApprovals() { await this.run('approvals', async lifetime => { const approvalInbox = await this.client.listApprovals(); this.current(lifetime); this.update({ approvalInbox }); }); }
  async inspectApproval(approvalId: string) { const navigation = this.navigationVersion; await this.run('approval', async lifetime => { const approval = await this.client.inspectApproval(approvalId); this.current(lifetime); if (navigation === this.navigationVersion) this.update({ screen: 'approvals', approval }); }); }
  async decideApproval(decision: 'approve' | 'reject') {
    await this.run('decision', async lifetime => {
      const approvalId = this.state.approval?.approvalId; requirePhone(approvalId, 'VALIDATION_REQUIRED');
      const requestId = this.requestId(); this.update({ approval: undefined }); const task = this.client.decideApproval(requestId, approvalId, decision); this.update(); const completed = await this.tracked(task, requestId); this.current(lifetime);
      if (completed) this.update({ notice: { tone: 'info', text: 'Decision submitted. Activity shows the confirmed result or any unknown outcome.' } });
    });
  }
  async refreshRequest(requestId: string) { await this.run(`status_${requestId}`, async lifetime => { await this.client.refreshRequest(requestId); this.current(lifetime); }); }
  async cancelRequest(requestId: string) { await this.run(`cancel_${requestId}`, async lifetime => { const task = this.client.cancel(requestId); this.update(); const result = await task; this.current(lifetime); this.update({ notice: { tone: 'info', text: result.status === 'cancelled' ? 'Cancellation confirmed.' : result.status === 'succeeded' ? 'The request already completed. Check its result in Activity.' : 'Cancellation is pending. Check its status in Activity.' } }); }); }
  async openReceipt(receiptId: string) {
    const navigation = this.navigationVersion;
    await this.run('receipt', async lifetime => {
      requirePhone(isId(receiptId), 'INVALID_REQUEST'); const authority = await this.client.validate(); this.current(lifetime); requirePhone(authority.capabilities.includes('brief.read'), 'CAPABILITY_FORBIDDEN');
      const receipt = await this.receipts.read(receiptId); this.current(lifetime);
      const snapshot = this.client.snapshot(); requirePhone(snapshot.connection === 'online' && snapshot.pairing.status === 'paired' && sameBinding(authority.binding, snapshot.pairing.authority.binding) && authority.sessionId === snapshot.pairing.authority.sessionId, 'VALIDATION_REQUIRED');
      requirePhone(receipt && receipt.id === receiptId && ['title', 'generatedAt', 'source', 'method', 'coverage', 'details'].every(key => typeof receipt[key as keyof typeof receipt] === 'string' && receipt[key as keyof typeof receipt].length <= 16000), 'INVALID_RESPONSE');
      if (navigation === this.navigationVersion) this.update({ screen: 'receipt', receipt: { id: receipt.id, title: receipt.title, generatedAt: receipt.generatedAt, source: receipt.source, method: receipt.method, coverage: receipt.coverage, details: receipt.details } });
    });
  }
  async revokeDevice() {
    if (this.busy.has('device')) return;
    this.lifetime += 1; this.busy.clear();
    await this.run('device', async lifetime => { await this.client.revoke(); this.current(lifetime); this.update({ ...noWorkspace, screen: 'pairing', notice: { tone: 'success', text: 'This device was removed from the workspace.' } }); });
  }
  async forgetDevice() {
    if (this.busy.has('device')) return;
    this.lifetime += 1; this.busy.clear();
    await this.run('device', async lifetime => { await this.client.forgetDevice(); this.current(lifetime); this.update({ ...noWorkspace, screen: 'pairing', notice: { tone: 'info', text: "This phone's saved connection and briefs were erased. Server access is removed only after an online revoke." } }); });
  }
}
