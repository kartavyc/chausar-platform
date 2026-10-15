import { PhoneError, copyAuthority, copyBinding, copyApprovalListItem, copyBrief, isApprovalEligibility, isApprovalToken, isId, isOperationVersion, requirePhone, sameBinding, validAuthority, validBinding, validBrief } from './contracts.ts';
import type { AppChannel, ApprovalChallenge, ApprovalReceipt, BriefCache, BriefView, ChatAnswer, ConnectionState, DeviceBinding, PairingState, PhoneCapability, PhoneCredentialStore, PhoneErrorCode, PhoneMethods, PhoneTransport, RemoteRequest, RequestResult, RequestState, SessionAuthority, SessionGrant, UploadMetadata, UploadReceipt } from './contracts.ts';
import type { PhoneReceipt } from './host-contracts.ts';

const revokedCodes = new Set(['ACCESS_REVOKED', 'UNPAIRED', 'INVALID_SESSION', 'UNAUTHENTICATED']);
const knownCodes = new Set<PhoneErrorCode>(['OFFLINE', 'VALIDATION_REQUIRED', 'ACCESS_REVOKED', 'SESSION_EXPIRED', 'UNPAIRED', 'INVALID_RESPONSE', 'INVALID_REQUEST', 'CHANNEL_FORBIDDEN', 'CAPABILITY_FORBIDDEN', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'PREVIEW_CHANGED', 'OPEN_DESKTOP', 'REQUEST_EXISTS', 'TRANSPORT_UNKNOWN', 'CACHE_INVALID']);
const publicError = (error: unknown) => error instanceof PhoneError ? error : new PhoneError('TRANSPORT_UNKNOWN');
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Identity only, scoped by the host to the validated session and device binding. */
export type PhoneRequestIdentity = { requestId: string; kind: 'chat' | 'upload' | 'approval'; target?: string };
export interface PhoneRequestRestoration {
  /** Authenticated read: never return question/upload bodies, credentials or approval challenges. */
  list(authority: SessionAuthority, credential: string, signal: AbortSignal): Promise<readonly PhoneRequestIdentity[]>;
}
export interface PhoneReceiptReader {
  /** Authenticated current read; the host supplies the receipt text and checks release authority. */
  read(authority: SessionAuthority, credential: string, receiptId: string, signal: AbortSignal): Promise<PhoneReceipt>;
}

/** A phone drives a remote engine. It never executes actions or stores a retry queue. */
export class PhoneClient {
  readonly channel: AppChannel;
  private readonly transport: PhoneTransport;
  private readonly credentials: PhoneCredentialStore;
  private readonly cache: BriefCache;
  private readonly clock: () => number;
  private readonly crypto: Crypto;
  private readonly requestRestoration?: PhoneRequestRestoration;
  private readonly receiptReader?: PhoneReceiptReader;
  private grant?: SessionGrant;
  private pairing: PairingState = { status: 'unpaired' };
  private connection: ConnectionState = 'offline';
  private generation = 0;
  private active = new Set<AbortController>();
  private requests = new Map<string, RequestState>();
  private requestKinds = new Map<string, { kind: 'chat' | 'upload' | 'approval'; generation: number; target?: string }>();
  private requestScope?: { binding: DeviceBinding; sessionId: string };
  private requestRevisions = new Map<string, number>();
  private requestSerial = 0;
  private requestControllers = new Map<string, Set<AbortController>>();
  private stopped = new Set<string>();
  private startedRemote = new Set<string>();
  private validationRevision = 0;
  private challenges = new Map<string, ApprovalChallenge>();
  private credentialWrites = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  constructor(options: { channel: AppChannel; transport: PhoneTransport; credentials: PhoneCredentialStore; cache: BriefCache; clock?: () => number; crypto?: Crypto; requestRestoration?: PhoneRequestRestoration; receiptReader?: PhoneReceiptReader }) {
    requirePhone(['ios', 'android', 'web'].includes(options.channel), 'CHANNEL_FORBIDDEN');
    this.channel = options.channel; this.transport = options.transport; this.credentials = options.credentials;
    this.cache = options.cache; this.clock = options.clock ?? Date.now; this.crypto = options.crypto ?? globalThis.crypto;
    this.requestRestoration = options.requestRestoration;
    this.receiptReader = options.receiptReader;
  }
  /** Renderable state deliberately omits credentials, challenge tokens and uploaded content. */
  snapshot() {
    const pairing = this.pairing.status === 'paired' && Date.parse(this.pairing.authority.expiresAt) <= this.clock() ? { status: 'validation-required' as const, binding: this.pairing.authority.binding } : this.pairing;
    return structuredClone({ pairing, connection: this.connection, requests: [...this.requests.values()] });
  }
  /** Foreground views can observe reservations and cancellations while IO is pending. */
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) { try { listener(); } catch { /* An observer cannot change request delivery semantics. */ } } }
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
    this.changed();
  }
  private async forget(status: 'revoked' | 'expired' | 'unpaired') {
    const binding = this.grant?.authority.binding; this.invalidate(); this.grant = undefined;
    this.pairing = status === 'unpaired' ? { status } : { status, ...(binding ? { binding } : {}) };
    this.clearRequests();
    this.changed();
    // Clear both even when one adapter fails; expose a fixed code, never adapter error text.
    const cleared = await Promise.allSettled([this.persist(() => this.credentials.clear()), this.cache.clear()]);
    requirePhone(cleared.every(item => item.status === 'fulfilled'), 'CACHE_INVALID');
  }
  private clearRequests() {
    this.requests.clear(); this.requestKinds.clear(); this.requestRevisions.clear(); this.stopped.clear(); this.startedRemote.clear(); this.requestControllers.clear(); this.requestScope = undefined;
  }
  private bindRequests(authority: SessionAuthority) {
    if (this.requestScope && (this.requestScope.sessionId !== authority.sessionId || !sameBinding(this.requestScope.binding, authority.binding))) { this.clearRequests(); this.changed(); }
    this.requestScope = { binding: copyBinding(authority.binding), sessionId: authority.sessionId };
  }
  async restore() {
    const generation = this.generation;
    let restored: SessionGrant | undefined;
    try { restored = await this.credentials.load(); } catch { throw new PhoneError('VALIDATION_REQUIRED'); }
    requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
    if (!restored) return;
    requirePhone(isRecord(restored) && typeof restored.credential === 'string' && restored.credential.length >= 32 && restored.credential.length <= 4096 && validBinding(restored.authority?.binding), 'INVALID_RESPONSE');
    requirePhone(validAuthority(restored.authority, Date.parse(restored.authority.validatedAt)) && Date.parse(restored.authority.validatedAt) <= this.clock(), 'INVALID_RESPONSE');
    if (this.grant && (this.grant.credential !== restored.credential || this.grant.authority.sessionId !== restored.authority.sessionId || !sameBinding(this.grant.authority.binding, restored.authority.binding))) {
      this.invalidate(); this.connection = 'offline';
      if (this.grant.authority.sessionId !== restored.authority.sessionId || !sameBinding(this.grant.authority.binding, restored.authority.binding)) this.clearRequests();
    }
    this.grant = { credential: restored.credential, authority: copyAuthority(restored.authority) };
    this.pairing = { status: 'validation-required', binding: structuredClone(restored.authority.binding) };
    this.changed();
    if (!validAuthority(restored.authority, this.clock())) await this.forget('expired');
  }
  private async call<M extends keyof PhoneMethods>(method: M, input: PhoneMethods[M]['input'], credential = this.grant?.credential, operationId?: string): Promise<PhoneMethods[M]['output']> {
    requirePhone(this.isConnected(), 'OFFLINE');
    if (operationId) requirePhone(this.requests.has(operationId) && this.requestKinds.get(operationId)?.generation === this.generation && !this.stopped.has(operationId), 'VALIDATION_REQUIRED');
    const generation = this.generation; const controller = new AbortController(); this.active.add(controller);
    if (operationId) { const controllers = this.requestControllers.get(operationId) ?? new Set<AbortController>(); controllers.add(controller); this.requestControllers.set(operationId, controllers); }
    try {
      if (operationId) this.startedRemote.add(operationId);
      const result = await this.transport.request(method, input, { ...(credential ? { credential } : {}), signal: controller.signal });
      requirePhone(generation === this.generation && !controller.signal.aborted && this.isConnected(), 'VALIDATION_REQUIRED');
      return result;
    } catch (error) { return await this.transportFailure(error, generation, controller); }
    finally { this.active.delete(controller); if (operationId) this.requestControllers.get(operationId)?.delete(controller); }
  }
  private async transportFailure(error: unknown, generation: number, controller: AbortController): Promise<never> {
    if (generation !== this.generation || controller.signal.aborted) throw new PhoneError('VALIDATION_REQUIRED');
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
    if (code && revokedCodes.has(code)) { await this.forget('revoked'); throw new PhoneError('ACCESS_REVOKED'); }
    if (code === 'SESSION_EXPIRED') { await this.forget('expired'); throw new PhoneError('SESSION_EXPIRED'); }
    if (code === 'TRANSPORT_UNKNOWN') { this.disconnect(); throw new PhoneError('TRANSPORT_UNKNOWN'); }
    if (error instanceof PhoneError || (code && knownCodes.has(code as PhoneErrorCode))) throw error instanceof PhoneError ? error : new PhoneError(code as PhoneErrorCode);
    this.disconnect(); throw new PhoneError('TRANSPORT_UNKNOWN');
  }
  private isConnected() { return this.connection !== 'offline'; }
  /** Every request obtains fresh online validation. A restored grant is never authority. */
  async validate() {
    requirePhone(this.grant, 'UNPAIRED');
    requirePhone(this.connection !== 'offline', 'OFFLINE');
    const validation = ++this.validationRevision; const generation = this.generation;
    this.pairing = { status: 'validation-required', binding: copyBinding(this.grant.authority.binding) };
    this.changed();
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
      this.changed();
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
    this.invalidate(); this.connection = 'connecting'; const generation = this.generation;
    if (!this.grant) { this.pairing = { status: 'unpaired' }; this.connection = 'online'; this.changed(); return; }
    const authority = await this.validate(); requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
    this.bindRequests(authority);
    if (this.requestRestoration) {
      const credential = this.grant!.credential; const controller = new AbortController(); this.active.add(controller);
      try {
        const descriptors = await this.requestRestoration.list(copyAuthority(authority), credential, controller.signal);
        requirePhone(generation === this.generation && !controller.signal.aborted && this.isConnected() && this.grant?.credential === credential && this.grant.authority.sessionId === authority.sessionId && sameBinding(this.grant.authority.binding, authority.binding), 'VALIDATION_REQUIRED');
        requirePhone(validAuthority(this.grant.authority, this.clock()), 'SESSION_EXPIRED');
        this.restoreRequests(descriptors, generation);
      } catch (error) { return await this.transportFailure(error, generation, controller); }
      finally { this.active.delete(controller); }
    }
    requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
    // Reconcile IDs only. No chat, upload body or approval is replayed.
    for (const state of [...this.requests.values()]) if (['pending', 'unknown', 'cancelling'].includes(state.status)) {
      requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
      const descriptor = this.requestKinds.get(state.requestId)!; descriptor.generation = generation;
      await this.refreshRequest(state.requestId); requirePhone(generation === this.generation, 'VALIDATION_REQUIRED');
    }
  }
  private restoreRequests(descriptors: readonly PhoneRequestIdentity[], generation: number) {
    requirePhone(Array.isArray(descriptors) && descriptors.length <= 100, 'INVALID_RESPONSE');
    const identities = new Map<string, PhoneRequestIdentity>();
    for (const descriptor of descriptors) {
      requirePhone(isRecord(descriptor) && Object.keys(descriptor).every(key => ['requestId', 'kind', 'target'].includes(key)), 'INVALID_RESPONSE');
      const { requestId, kind, target } = descriptor;
      requirePhone(isId(requestId) && (kind === 'chat' || kind === 'upload' || kind === 'approval') && (target === undefined || isId(target)) && (kind !== 'approval' || isId(target)) && !identities.has(requestId), 'INVALID_RESPONSE');
      const existing = this.requestKinds.get(requestId);
      requirePhone(!existing || (existing.kind === kind && existing.target === target), 'INVALID_RESPONSE');
      identities.set(requestId, { requestId, kind, ...(target === undefined ? {} : { target }) });
    }
    requirePhone(new Set([...this.requests.keys(), ...identities.keys()]).size <= 100, 'INVALID_RESPONSE');
    for (const descriptor of identities.values()) {
      this.startedRemote.add(descriptor.requestId);
      if (this.requests.has(descriptor.requestId)) continue;
      this.requests.set(descriptor.requestId, { status: 'unknown', requestId: descriptor.requestId });
      this.requestKinds.set(descriptor.requestId, { kind: descriptor.kind, generation, ...(descriptor.target === undefined ? {} : { target: descriptor.target }) });
      this.nextRequestRevision(descriptor.requestId);
    }
    this.changed();
  }
  async pair(input: PhoneMethods['pairing.accept']['input']) {
    requirePhone(input.channel === this.channel && isId(input.deviceId) && typeof input.inviteCode === 'string' && input.inviteCode.length >= 8 && input.inviteCode.length <= 4096 && typeof input.devicePublicKey === 'string' && input.devicePublicKey.length > 0 && input.devicePublicKey.length <= 4096 && typeof input.proof === 'string' && input.proof.length > 0 && input.proof.length <= 4096, 'INVALID_REQUEST');
    requirePhone(!this.grant && this.pairing.status !== 'pairing', 'REQUEST_EXISTS'); this.pairing = { status: 'pairing' };
    this.changed();
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
    } catch (error) { if (generation === this.generation && !this.grant) { this.pairing = { status: 'unpaired' }; this.changed(); } throw publicError(error); }
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
  async listCachedBriefs() {
    requirePhone(this.grant, 'UNPAIRED'); const generation = this.generation; const binding = copyBinding(this.grant.authority.binding);
    const briefs = this.cache.list ? await this.cache.list(binding) : [];
    requirePhone(generation === this.generation && this.grant && sameBinding(binding, this.grant.authority.binding), 'VALIDATION_REQUIRED');
    requirePhone(Array.isArray(briefs) && briefs.length <= 50 && briefs.every(brief => validBrief(brief) && brief.workspaceId === binding.workspaceId && Date.parse(brief.expiresAt) > this.clock()), 'CACHE_INVALID');
    return structuredClone(briefs);
  }
  async listApprovals() {
    await this.fresh('approval.simple'); const items = await this.call('approval.list', {});
    requirePhone(Array.isArray(items) && items.length <= 100 && items.every(item => item && isId(item.approvalId) && typeof item.title === 'string' && item.title.length <= 200 && (item.eligibility === undefined || isApprovalEligibility(item.eligibility))), 'INVALID_RESPONSE');
    return items.map(copyApprovalListItem);
  }
  async readReceipt(receiptId: string): Promise<PhoneReceipt> {
    requirePhone(isId(receiptId), 'INVALID_REQUEST');
    const generation = this.generation; const authority = await this.fresh('brief.read', generation);
    requirePhone(this.receiptReader, 'CAPABILITY_FORBIDDEN');
    const credential = this.grant!.credential; const controller = new AbortController(); this.active.add(controller);
    try {
      const receipt = await this.receiptReader.read(copyAuthority(authority), credential, receiptId, controller.signal);
      requirePhone(generation === this.generation && !controller.signal.aborted && this.isConnected() && this.grant?.credential === credential && this.grant.authority.sessionId === authority.sessionId && sameBinding(this.grant.authority.binding, authority.binding), 'VALIDATION_REQUIRED');
      requirePhone(validAuthority(this.grant.authority, this.clock()), 'SESSION_EXPIRED');
      requirePhone(isRecord(receipt) && receipt.id === receiptId && receipt.workspaceId === authority.binding.workspaceId && typeof receipt.text === 'string' && receipt.text.length <= 64000, 'INVALID_RESPONSE');
      return { id: receipt.id, workspaceId: receipt.workspaceId, text: receipt.text };
    } catch (error) { return await this.transportFailure(error, generation, controller); }
    finally { this.active.delete(controller); }
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
    requirePhone(this.grant, 'UNPAIRED'); this.bindRequests(this.grant.authority);
    requirePhone(isId(requestId), 'INVALID_REQUEST'); requirePhone(!this.requests.has(requestId), 'REQUEST_EXISTS');
    requirePhone(this.requests.size < 100, 'INVALID_REQUEST'); this.requests.set(requestId, { status: 'pending', requestId }); this.requestKinds.set(requestId, { kind, generation: this.generation, ...(target ? { target } : {}) });
    const revision = this.nextRequestRevision(requestId); this.changed(); return revision;
  }
  private nextRequestRevision(requestId: string) { const revision = ++this.requestSerial; this.requestRevisions.set(requestId, revision); return revision; }
  private response(expectedId: string, result: RemoteRequest<ChatAnswer>, revision: number): RemoteRequest<ChatAnswer>;
  private response(expectedId: string, result: RemoteRequest<UploadReceipt>, revision: number): RemoteRequest<UploadReceipt>;
  private response(expectedId: string, result: RemoteRequest<ApprovalReceipt>, revision: number): RemoteRequest<ApprovalReceipt>;
  private response(expectedId: string, result: RemoteRequest<RequestResult>, revision: number): RemoteRequest<RequestResult>;
  private response(expectedId: string, result: RemoteRequest<RequestResult>, revision: number): RemoteRequest<RequestResult> {
    requirePhone(this.requests.has(expectedId) && this.requestRevisions.get(expectedId) === revision, 'VALIDATION_REQUIRED');
    requirePhone(!!result && result.requestId === expectedId && ['pending', 'unknown', 'succeeded', 'cancelled', 'failed'].includes(result.status), 'INVALID_RESPONSE');
    if (result.status === 'failed') requirePhone(knownCodes.has(result.code), 'INVALID_RESPONSE');
    let safe: RemoteRequest<RequestResult>;
    if (result.status === 'succeeded') {
      const r = result.result;
      const descriptor = this.requestKinds.get(expectedId);
      requirePhone(isRecord(r), 'INVALID_RESPONSE');
      let output: RequestResult;
      if (descriptor?.kind === 'chat') {
        requirePhone('conversationId' in r && isId(r.conversationId) && typeof r.text === 'string' && r.text.length <= 64000
          && Array.isArray(r.receiptIds) && r.receiptIds.length <= 100 && r.receiptIds.every(isId), 'INVALID_RESPONSE');
        output = { conversationId: r.conversationId, text: r.text, receiptIds: r.receiptIds };
      } else if (descriptor?.kind === 'upload') {
        requirePhone('uploadId' in r && isId(r.uploadId) && isId(r.sourceId) && r.status === 'awaiting-confirmation'
          && r.sourceTainted === true, 'INVALID_RESPONSE');
        output = { uploadId: r.uploadId, sourceId: r.sourceId, status: 'awaiting-confirmation', sourceTainted: true };
      } else {
        requirePhone(descriptor?.kind === 'approval' && 'approvalId' in r && isId(r.approvalId) && r.approvalId === descriptor.target
          && isId(r.actionId) && (r.decision === 'approved' || r.decision === 'rejected') && typeof r.decidedAt === 'string'
          && Number.isFinite(Date.parse(r.decidedAt)), 'INVALID_RESPONSE');
        output = { approvalId: r.approvalId, actionId: r.actionId, decision: r.decision, decidedAt: r.decidedAt };
      }
      safe = { status: 'succeeded', requestId: expectedId, result: structuredClone(output) };
    } else if (result.status === 'failed') safe = { status: 'failed', requestId: expectedId, code: result.code };
    else safe = { status: result.status, requestId: expectedId };
    this.requests.set(expectedId, safe); this.changed(); return safe;
  }
  private unknown(requestId: string, revision: number) { if (this.requests.has(requestId) && this.requestRevisions.get(requestId) === revision && !['succeeded', 'cancelled', 'failed'].includes(this.requests.get(requestId)?.status ?? '')) { this.requests.set(requestId, { status: 'unknown', requestId }); this.changed(); } }
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
    const revision = this.nextRequestRevision(requestId); const generation = this.generation;
    try { await this.fresh(undefined, generation); requirePhone(generation === this.generation, 'VALIDATION_REQUIRED'); return this.response(requestId, await this.call('request.status', { requestId }), revision); }
    catch (error) { this.unknown(requestId, revision); throw publicError(error); }
  }
  async cancel(requestId: string) {
    const state = this.requests.get(requestId); requirePhone(state && ['pending', 'unknown', 'cancelling'].includes(state.status), 'INVALID_REQUEST');
    const revision = this.nextRequestRevision(requestId); const generation = this.generation;
    this.stopped.add(requestId); for (const controller of this.requestControllers.get(requestId) ?? []) controller.abort();
    if (!this.startedRemote.has(requestId)) { const cancelled = { status: 'cancelled' as const, requestId }; this.requests.set(requestId, cancelled); this.changed(); return cancelled; }
    this.requests.set(requestId, { status: 'cancelling', requestId });
    this.changed();
    try { await this.fresh(undefined, generation); requirePhone(generation === this.generation, 'VALIDATION_REQUIRED'); return this.response(requestId, await this.call('request.cancel', { requestId }), revision); }
    catch (error) { this.unknown(requestId, revision); throw publicError(error); }
  }
}
