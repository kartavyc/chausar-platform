import { PhoneError, copyAuthority, copyBinding, copyBrief, isApprovalToken, isId, isOperationVersion, requirePhone, sameBinding, validAuthority, validBinding, validBrief } from './contracts.ts';
import type { AppChannel, ApprovalChallenge, ApprovalReceipt, BriefCache, BriefView, ChatAnswer, ConnectionState, PairingState, PhoneCapability, PhoneCredentialStore, PhoneErrorCode, PhoneMethods, PhoneTransport, RemoteRequest, RequestResult, RequestState, SessionGrant, UploadMetadata, UploadReceipt } from './contracts.ts';

const revokedCodes = new Set(['ACCESS_REVOKED', 'UNPAIRED', 'INVALID_SESSION', 'UNAUTHENTICATED']);
const knownCodes = new Set<PhoneErrorCode>(['OFFLINE', 'VALIDATION_REQUIRED', 'ACCESS_REVOKED', 'SESSION_EXPIRED', 'UNPAIRED', 'INVALID_RESPONSE', 'INVALID_REQUEST', 'CHANNEL_FORBIDDEN', 'CAPABILITY_FORBIDDEN', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'PREVIEW_CHANGED', 'OPEN_DESKTOP', 'REQUEST_EXISTS', 'TRANSPORT_UNKNOWN', 'CACHE_INVALID']);
const publicError = (error: unknown) => error instanceof PhoneError ? error : new PhoneError('TRANSPORT_UNKNOWN');
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A phone drives a remote engine. It never executes actions or stores a retry queue. */
export class PhoneClient {
  readonly channel: AppChannel;
  private readonly transport: PhoneTransport;
  private readonly credentials: PhoneCredentialStore;
  private readonly cache: BriefCache;
  private readonly clock: () => number;
  private readonly crypto: Crypto;
  private grant?: SessionGrant;
  private pairing: PairingState = { status: 'unpaired' };
  private connection: ConnectionState = 'offline';
  private generation = 0;
  private active = new Set<AbortController>();
  private requests = new Map<string, RequestState>();
  private requestKinds = new Map<string, { kind: 'chat' | 'upload' | 'approval'; generation: number; target?: string }>();
  private requestRevisions = new Map<string, number>();
  private requestSerial = 0;
  private requestControllers = new Map<string, Set<AbortController>>();
  private stopped = new Set<string>();
  private startedRemote = new Set<string>();
  private validationRevision = 0;
  private challenges = new Map<string, ApprovalChallenge>();
  private credentialWrites = Promise.resolve();
  constructor(options: { channel: AppChannel; transport: PhoneTransport; credentials: PhoneCredentialStore; cache: BriefCache; clock?: () => number; crypto?: Crypto }) {
    requirePhone(['ios', 'android', 'web'].includes(options.channel), 'CHANNEL_FORBIDDEN');
    this.channel = options.channel; this.transport = options.transport; this.credentials = options.credentials;
    this.cache = options.cache; this.clock = options.clock ?? Date.now; this.crypto = options.crypto ?? globalThis.crypto;
  }
  /** Renderable state deliberately omits credentials, challenge tokens and uploaded content. */
  snapshot() {
    const pairing = this.pairing.status === 'paired' && Date.parse(this.pairing.authority.expiresAt) <= this.clock() ? { status: 'validation-required', binding: this.pairing.authority.binding } : this.pairing;
    return structuredClone({ pairing, connection: this.connection, requests: [...this.requests.values()] });
  }
  private persist(change: () => Promise<void>) { const task = this.credentialWrites.then(change); this.credentialWrites = task.catch(() => {}); return task; }
  private invalidate() {
    this.generation += 1;
    for (const controller of this.active) controller.abort();
    this.active.clear(); this.challenges.clear();
    for (const [id, state] of this.requests) if (['pending', 'cancelling'].includes(state.status)) this.requests.set(id, { status: 'unknown', requestId: id });
  }
  disconnect() {
    this.invalidate(); this.connection = 'offline';
    if (this.grant) this.pairing = { status: 'validation-required', binding: structuredClone(this.grant.authority.binding) };
    else if (this.pairing.status === 'pairing') this.pairing = { status: 'unpaired' };
  }
  private async forget(status: 'revoked' | 'expired' | 'unpaired') {
    const binding = this.grant?.authority.binding; this.invalidate(); this.grant = undefined;
    this.pairing = status === 'unpaired' ? { status } : { status, ...(binding ? { binding } : {}) };
    this.requests.clear(); this.requestKinds.clear(); this.requestRevisions.clear(); this.stopped.clear(); this.startedRemote.clear(); this.requestControllers.clear();
    // Clear both even when one adapter fails; expose a fixed code, never adapter error text.
    const cleared = await Promise.allSettled([this.persist(() => this.credentials.clear()), this.cache.clear()]);
    requirePhone(cleared.every(item => item.status === 'fulfilled'), 'CACHE_INVALID');
  }
  async restore() {
    const generation = this.generation;
    let restored: SessionGrant | undefined;
    try { restored = await this.credentials.load(); } catch { throw new PhoneError('VALIDATION_REQUIRED'); }
    requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
    if (!restored) return;
    requirePhone(isRecord(restored) && typeof restored.credential === 'string' && restored.credential.length >= 32 && restored.credential.length <= 4096 && validBinding(restored.authority?.binding), 'INVALID_RESPONSE');
    requirePhone(validAuthority(restored.authority, Date.parse(restored.authority.validatedAt)) && Date.parse(restored.authority.validatedAt) <= this.clock(), 'INVALID_RESPONSE');
    this.grant = { credential: restored.credential, authority: copyAuthority(restored.authority) };
    this.pairing = { status: 'validation-required', binding: structuredClone(restored.authority.binding) };
    if (!validAuthority(restored.authority, this.clock())) await this.forget('expired');
  }
  private async call<M extends keyof PhoneMethods>(method: M, input: PhoneMethods[M]['input'], credential = this.grant?.credential, operationId?: string): Promise<PhoneMethods[M]['output']> {
    requirePhone(this.connection !== 'offline', 'OFFLINE');
    if (operationId) requirePhone(this.requests.has(operationId) && this.requestKinds.get(operationId)?.generation === this.generation && !this.stopped.has(operationId), 'VALIDATION_REQUIRED');
    const generation = this.generation; const controller = new AbortController(); this.active.add(controller);
    if (operationId) { const controllers = this.requestControllers.get(operationId) ?? new Set<AbortController>(); controllers.add(controller); this.requestControllers.set(operationId, controllers); }
    try {
      if (operationId) this.startedRemote.add(operationId);
      const result = await this.transport.request(method, input, { ...(credential ? { credential } : {}), signal: controller.signal });
      requirePhone(generation === this.generation && !controller.signal.aborted && this.connection !== 'offline', 'VALIDATION_REQUIRED');
      return result;
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) throw new PhoneError('VALIDATION_REQUIRED');
      const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
      if (code && revokedCodes.has(code)) { await this.forget('revoked'); throw new PhoneError('ACCESS_REVOKED'); }
      if (code === 'SESSION_EXPIRED') { await this.forget('expired'); throw new PhoneError('SESSION_EXPIRED'); }
      if (error instanceof PhoneError || (code && knownCodes.has(code as PhoneErrorCode))) throw error instanceof PhoneError ? error : new PhoneError(code as PhoneErrorCode);
      this.disconnect(); throw new PhoneError('TRANSPORT_UNKNOWN');
    } finally { this.active.delete(controller); if (operationId) this.requestControllers.get(operationId)?.delete(controller); }
  }
  /** Every request obtains fresh online validation. A restored grant is never authority. */
  async validate() {
    requirePhone(this.grant, 'UNPAIRED');
    requirePhone(this.connection !== 'offline', 'OFFLINE');
    const validation = ++this.validationRevision; const generation = this.generation;
    this.pairing = { status: 'validation-required', binding: copyBinding(this.grant.authority.binding) };
    try {
      const grant = this.grant; const requestedAt = this.clock(); const result = await this.call('session.validate', {});
      requirePhone(validation === this.validationRevision, 'VALIDATION_REQUIRED');
      requirePhone(isRecord(result), 'INVALID_RESPONSE');
      if (result.status !== 'current') {
        requirePhone(['revoked', 'expired', 'unpaired'].includes(result.status), 'INVALID_RESPONSE');
        await this.forget(result.status); throw new PhoneError(result.status === 'revoked' ? 'ACCESS_REVOKED' : result.status === 'expired' ? 'SESSION_EXPIRED' : 'UNPAIRED');
      }
      requirePhone(validAuthority(result.authority, this.clock()) && Date.parse(result.authority.validatedAt) >= requestedAt - 30000 && sameBinding(grant.authority.binding, result.authority.binding) && grant.authority.sessionId === result.authority.sessionId, 'INVALID_RESPONSE');
      this.grant = { credential: grant.credential, authority: copyAuthority(result.authority) };
      this.pairing = { status: 'paired', authority: copyAuthority(result.authority) }; this.connection = 'online';
      return copyAuthority(result.authority);
    } catch (error) {
      if (this.grant && validation === this.validationRevision && generation === this.generation) this.disconnect();
      throw publicError(error);
    }
  }
  private async fresh(capability?: PhoneCapability, generation = this.generation) {
    requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
    const authority = await this.validate();
    requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
    if (capability) requirePhone(authority.capabilities.includes(capability), 'CAPABILITY_FORBIDDEN');
    return authority;
  }
  async reconnect() {
    this.invalidate(); this.connection = 'connecting';
    if (!this.grant) { this.pairing = { status: 'unpaired' }; this.connection = 'online'; return; }
    await this.validate();
    // Reconcile IDs only. No chat, upload body or approval is replayed.
    for (const state of [...this.requests.values()]) if (['pending', 'unknown', 'cancelling'].includes(state.status)) await this.refreshRequest(state.requestId);
  }
  async pair(input: PhoneMethods['pairing.accept']['input']) {
    requirePhone(input.channel === this.channel && isId(input.deviceId) && typeof input.inviteCode === 'string' && input.inviteCode.length >= 8 && input.inviteCode.length <= 4096 && typeof input.devicePublicKey === 'string' && input.devicePublicKey.length > 0 && input.devicePublicKey.length <= 4096 && typeof input.proof === 'string' && input.proof.length > 0 && input.proof.length <= 4096, 'INVALID_REQUEST');
    requirePhone(!this.grant && this.pairing.status !== 'pairing', 'REQUEST_EXISTS'); this.pairing = { status: 'pairing' };
    const generation = this.generation;
    try {
      const request = { inviteCode: input.inviteCode, deviceId: input.deviceId, channel: input.channel, devicePublicKey: input.devicePublicKey, proof: input.proof };
      const grant = await this.call('pairing.accept', request, undefined);
      requirePhone(!!grant && typeof grant.credential === 'string' && grant.credential.length >= 32 && grant.credential.length <= 4096 && validAuthority(grant.authority, this.clock()) && grant.authority.binding.deviceId === request.deviceId, 'INVALID_RESPONSE');
      const safeGrant = { credential: grant.credential, authority: copyAuthority(grant.authority) };
      await this.persist(async () => { requirePhone(generation === this.generation, 'VALIDATION_REQUIRED'); await this.credentials.save(safeGrant); });
      requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
      this.grant = safeGrant; this.pairing = { status: 'validation-required', binding: copyBinding(grant.authority.binding) };
      await this.validate();
    } catch (error) { if (generation === this.generation && !this.grant) this.pairing = { status: 'unpaired' }; throw publicError(error); }
  }
  /** Online revocation is acknowledged by the server; a failed request is not success. */
  async revoke() {
    const authority = await this.fresh(); const result = await this.call('session.revoke', { deviceId: authority.binding.deviceId });
    requirePhone(result.status === 'revoked' && result.deviceId === authority.binding.deviceId, 'INVALID_RESPONSE'); await this.forget('revoked');
  }
  async forgetDevice() { await this.forget('unpaired'); }
  async listBriefs() {
    const authority = await this.fresh('brief.read'); const briefs = await this.call('brief.list', {});
    requirePhone(Array.isArray(briefs) && briefs.length <= 100 && briefs.every(brief => validBrief(brief) && brief.workspaceId === authority.binding.workspaceId), 'INVALID_RESPONSE');
    return briefs.map(copyBrief);
  }
  async readBrief(briefId: string): Promise<BriefView> {
    requirePhone(isId(briefId), 'INVALID_REQUEST');
    if (this.connection === 'offline') {
      requirePhone(this.grant, 'UNPAIRED'); const generation = this.generation; const binding = copyBinding(this.grant.authority.binding);
      const brief = await this.cache.read(binding, briefId);
      requirePhone(generation === this.generation && this.grant && sameBinding(binding, this.grant.authority.binding), 'VALIDATION_REQUIRED');
      requirePhone(brief, 'OFFLINE'); return { brief, freshness: 'cached', readOnly: true };
    }
    const authority = await this.fresh('brief.read'); const generation = this.generation; const brief = await this.call('brief.read', { briefId });
    requirePhone(validBrief(brief) && brief.id === briefId && brief.workspaceId === authority.binding.workspaceId, 'INVALID_RESPONSE');
    const safeBrief = copyBrief(brief); await this.cache.put(authority.binding, safeBrief); requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
    return { brief: safeBrief, freshness: 'current' };
  }
  private reserve(requestId: string, kind: 'chat' | 'upload' | 'approval', target?: string) {
    requirePhone(isId(requestId), 'INVALID_REQUEST'); requirePhone(!this.requests.has(requestId), 'REQUEST_EXISTS');
    requirePhone(this.requests.size < 100, 'INVALID_REQUEST'); this.requests.set(requestId, { status: 'pending', requestId }); this.requestKinds.set(requestId, { kind, generation: this.generation, ...(target ? { target } : {}) });
    return this.nextRequestRevision(requestId);
  }
  private nextRequestRevision(requestId: string) { const revision = ++this.requestSerial; this.requestRevisions.set(requestId, revision); return revision; }
  private response<T extends RequestResult>(expectedId: string, result: RemoteRequest<T>, revision: number): RemoteRequest<T> {
    requirePhone(this.requests.has(expectedId) && this.requestRevisions.get(expectedId) === revision, 'VALIDATION_REQUIRED');
    requirePhone(!!result && result.requestId === expectedId && ['pending', 'unknown', 'succeeded', 'cancelled', 'failed'].includes(result.status), 'INVALID_RESPONSE');
    if (result.status === 'failed') requirePhone(knownCodes.has(result.code), 'INVALID_RESPONSE');
    let safe: RemoteRequest<T>;
    if (result.status === 'succeeded') {
      const r = result.result;
      const descriptor = this.requestKinds.get(expectedId);
      requirePhone(isRecord(r) && (
        (descriptor?.kind === 'chat' && 'conversationId' in r && isId(r.conversationId) && typeof r.text === 'string' && r.text.length <= 64000 && Array.isArray(r.receiptIds) && r.receiptIds.length <= 100 && r.receiptIds.every(isId)) ||
        (descriptor?.kind === 'upload' && 'uploadId' in r && isId(r.uploadId) && isId(r.sourceId) && r.status === 'awaiting-confirmation' && r.sourceTainted === true) ||
        (descriptor?.kind === 'approval' && 'approvalId' in r && r.approvalId === descriptor.target && isId(r.actionId) && ['approved', 'rejected'].includes(r.decision as string) && Number.isFinite(Date.parse(r.decidedAt as string)))
      ), 'INVALID_RESPONSE');
      const output = descriptor?.kind === 'chat' ? { conversationId: r.conversationId, text: r.text, receiptIds: r.receiptIds } : descriptor?.kind === 'upload' ? { uploadId: r.uploadId, sourceId: r.sourceId, status: 'awaiting-confirmation', sourceTainted: true } : { approvalId: r.approvalId, actionId: r.actionId, decision: r.decision, decidedAt: r.decidedAt };
      safe = { status: 'succeeded', requestId: expectedId, result: structuredClone(output) as T };
    } else if (result.status === 'failed') safe = { status: 'failed', requestId: expectedId, code: result.code };
    else safe = { status: result.status, requestId: expectedId };
    this.requests.set(expectedId, safe); return safe;
  }
  private unknown(requestId: string, revision: number) { if (this.requests.has(requestId) && this.requestRevisions.get(requestId) === revision && !['succeeded', 'cancelled', 'failed'].includes(this.requests.get(requestId)?.status ?? '')) this.requests.set(requestId, { status: 'unknown', requestId }); }
  async chat(requestId: string, question: string): Promise<RemoteRequest<ChatAnswer>> {
    requirePhone(typeof question === 'string' && question.trim().length > 0 && question.length <= 8000, 'INVALID_REQUEST');
    await this.fresh('chat'); const revision = this.reserve(requestId, 'chat');
    try { return this.response(requestId, await this.call('chat.start', { requestId, question }, this.grant?.credential, requestId), revision); }
    catch (error) { this.unknown(requestId, revision); throw publicError(error); }
  }
  async upload(requestId: string, metadata: UploadMetadata, bytes: Uint8Array): Promise<RemoteRequest<UploadReceipt>> {
    requirePhone(!!metadata && typeof metadata.name === 'string' && metadata.name.length > 0 && metadata.name.length <= 200 && !/[\x00-\x1f/\\]/.test(metadata.name) && ['image/jpeg', 'image/png', 'application/pdf', 'text/csv'].includes(metadata.mediaType) && bytes instanceof Uint8Array && Number.isSafeInteger(metadata.sizeBytes) && metadata.sizeBytes === bytes.byteLength && bytes.byteLength > 0 && bytes.byteLength <= 10 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(metadata.sha256), 'INVALID_REQUEST');
    requirePhone(this.connection !== 'offline', 'OFFLINE'); requirePhone(this.grant, 'UNPAIRED');
    const generation = this.generation; const content = Uint8Array.from(bytes); const file: UploadMetadata = { name: metadata.name, mediaType: metadata.mediaType, sizeBytes: metadata.sizeBytes, sha256: metadata.sha256 };
    const revision = this.reserve(requestId, 'upload');
    try {
      const checksum = [...new Uint8Array(await this.crypto.subtle.digest('SHA-256', content))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      requirePhone(generation === this.generation && this.requestRevisions.get(requestId) === revision && !this.stopped.has(requestId), 'VALIDATION_REQUIRED'); requirePhone(checksum === file.sha256, 'INVALID_REQUEST'); await this.fresh('upload', generation);
      const slot = await this.call('upload.begin', { requestId, metadata: file }, this.grant?.credential, requestId);
      requirePhone(isId(slot.uploadId) && Number.isSafeInteger(slot.maxChunkBytes) && slot.maxChunkBytes > 0 && slot.maxChunkBytes <= 1024 * 1024 && Date.parse(slot.expiresAt) > this.clock(), 'INVALID_RESPONSE');
      for (let offset = 0; offset < content.byteLength;) {
        requirePhone(Date.parse(slot.expiresAt) > this.clock(), 'INVALID_RESPONSE'); await this.fresh('upload', generation);
        const chunk = content.slice(offset, offset + slot.maxChunkBytes); const result = await this.call('upload.chunk', { uploadId: slot.uploadId, offset, bytes: chunk }, this.grant?.credential, requestId);
        requirePhone(result.nextOffset === offset + chunk.byteLength, 'INVALID_RESPONSE'); offset = result.nextOffset;
      }
      await this.fresh('upload', generation); return this.response(requestId, await this.call('upload.finish', { requestId, uploadId: slot.uploadId, sha256: checksum }, this.grant?.credential, requestId), revision);
    } catch (error) { this.unknown(requestId, revision); throw publicError(error); }
  }
  async inspectApproval(approvalId: string) {
    requirePhone(isId(approvalId), 'INVALID_REQUEST'); this.challenges.delete(approvalId); const authority = await this.fresh('approval.simple');
    const challenge = await this.call('approval.inspect', { approvalId }); const p = challenge?.preview;
    requirePhone(!!p && p.approvalId === approvalId && isId(p.actionId) && validBinding(p.binding) && sameBinding(p.binding, authority.binding) && Number.isSafeInteger(p.actionRevision) && p.actionRevision > 0 && isOperationVersion(p.operationVersion) && /^[a-f0-9]{64}$/.test(p.digest) && typeof p.title === 'string' && p.title.length <= 200 && typeof p.summary === 'string' && p.summary.length <= 16000 && ['simple-reversible', 'open-desktop'].includes(p.eligibility), 'INVALID_RESPONSE');
    requirePhone(Date.parse(p.expiresAt) > this.clock() && Date.parse(p.expiresAt) <= this.clock() + 300000, 'APPROVAL_EXPIRED');
    const preview = { approvalId: p.approvalId, actionId: p.actionId, binding: copyBinding(p.binding), actionRevision: p.actionRevision, operationVersion: p.operationVersion, digest: p.digest, expiresAt: p.expiresAt, title: p.title, summary: p.summary, eligibility: p.eligibility };
    if (p.eligibility === 'simple-reversible') { requirePhone(isApprovalToken(challenge.token), 'INVALID_RESPONSE'); this.challenges.set(approvalId, { preview, token: challenge.token }); }
    else this.challenges.set(approvalId, { preview });
    return structuredClone(preview);
  }
  async decideApproval(requestId: string, approvalId: string, decision: 'approve' | 'reject'): Promise<RemoteRequest<ApprovalReceipt>> {
    requirePhone(decision === 'approve' || decision === 'reject', 'INVALID_REQUEST');
    const authority = await this.fresh('approval.simple'); const challenge = this.challenges.get(approvalId);
    requirePhone(challenge, 'VALIDATION_REQUIRED'); const p = challenge.preview;
    requirePhone(p.eligibility === 'simple-reversible', 'OPEN_DESKTOP'); requirePhone(Date.parse(p.expiresAt) > this.clock(), 'APPROVAL_EXPIRED');
    requirePhone(sameBinding(p.binding, authority.binding), 'ACCESS_REVOKED'); requirePhone(challenge.token, 'INVALID_RESPONSE');
    const revision = this.reserve(requestId, 'approval', approvalId); this.challenges.delete(approvalId);
    try { return this.response(requestId, await this.call('approval.submit', { requestId, approvalId, token: challenge.token, decision, expectedDigest: p.digest, expectedActionRevision: p.actionRevision, expectedOperationVersion: p.operationVersion }, this.grant?.credential, requestId), revision); }
    catch (error) { this.unknown(requestId, revision); throw publicError(error); }
  }
  async refreshRequest(requestId: string) {
    const state = this.requests.get(requestId); requirePhone(state, 'INVALID_REQUEST');
    if (['succeeded', 'cancelled', 'failed'].includes(state.status)) return structuredClone(state);
    const revision = this.nextRequestRevision(requestId);
    try { await this.fresh(); return this.response(requestId, await this.call('request.status', { requestId }), revision); }
    catch (error) { this.unknown(requestId, revision); throw publicError(error); }
  }
  async cancel(requestId: string) {
    const state = this.requests.get(requestId); requirePhone(state && ['pending', 'unknown', 'cancelling'].includes(state.status), 'INVALID_REQUEST');
    const revision = this.nextRequestRevision(requestId);
    this.stopped.add(requestId); for (const controller of this.requestControllers.get(requestId) ?? []) controller.abort();
    if (!this.startedRemote.has(requestId)) { const cancelled = { status: 'cancelled' as const, requestId }; this.requests.set(requestId, cancelled); return cancelled; }
    this.requests.set(requestId, { status: 'cancelling', requestId });
    try { await this.fresh(); return this.response(requestId, await this.call('request.cancel', { requestId }), revision); }
    catch (error) { this.unknown(requestId, revision); throw publicError(error); }
  }
}
