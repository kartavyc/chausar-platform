import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PhoneError, copyAuthority, copyBinding, copyBrief, isApprovalToken, isId, isOperationVersion, requirePhone, sameBinding, validAuthority, validBrief } from './contracts.ts';
import type { ApprovalChallenge, PhoneErrorCode, RemoteRequest, RequestResult } from './contracts.ts';
import { phoneRequestCapability } from './host-contracts.ts';
import type { PhoneCustodyRecord, PhoneHostAuthentication, PhoneHostOperation, PhoneHostPorts, PhoneHostPrincipal, PhoneHostRelease, PhoneRequestScope } from './host-contracts.ts';
import type { PhoneRequestCustody } from './request-custody.ts';

const MAX_BODY_BYTES = 128 * 1024;
const codes = new Set<PhoneErrorCode>(['OFFLINE', 'VALIDATION_REQUIRED', 'ACCESS_REVOKED', 'SESSION_EXPIRED', 'UNPAIRED', 'INVALID_RESPONSE', 'INVALID_REQUEST', 'CHANNEL_FORBIDDEN', 'CAPABILITY_FORBIDDEN', 'APPROVAL_EXPIRED', 'APPROVAL_USED', 'PREVIEW_CHANGED', 'OPEN_DESKTOP', 'REQUEST_EXISTS', 'TRANSPORT_UNKNOWN', 'CACHE_INVALID']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requirePhone(object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'INVALID_REQUEST');
}
function idInput(value: unknown, name: string): string {
  exact(value, [name]); requirePhone(isId(value[name]), 'INVALID_REQUEST'); return value[name];
}
function text(value: unknown, max: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function scopeCopy(scope: PhoneRequestScope): PhoneRequestScope {
  requirePhone(object(scope) && Object.keys(scope).sort().join(',') === 'operationVersion,revision,sourceIds'
    && isOperationVersion(scope.revision) && isOperationVersion(scope.operationVersion)
    && Array.isArray(scope.sourceIds) && scope.sourceIds.length <= 100 && scope.sourceIds.every(isId)
    && new Set(scope.sourceIds).size === scope.sourceIds.length, 'INVALID_RESPONSE');
  return { revision: scope.revision, operationVersion: scope.operationVersion, sourceIds: [...scope.sourceIds].sort() };
}
function operation(method: string, payload: unknown): PhoneHostOperation {
  if (method === 'chat.start') {
    exact(payload, ['requestId', 'question']); requirePhone(isId(payload.requestId) && text(payload.question, 8000), 'INVALID_REQUEST');
    return { kind: 'chat', input: { requestId: payload.requestId, question: payload.question } };
  }
  exact(payload, ['requestId', 'approvalId', 'token', 'decision', 'expectedDigest', 'expectedActionRevision', 'expectedOperationVersion']);
  requirePhone(isId(payload.requestId) && isId(payload.approvalId) && isApprovalToken(payload.token)
    && (payload.decision === 'approve' || payload.decision === 'reject') && typeof payload.expectedDigest === 'string' && /^[a-f0-9]{64}$/.test(payload.expectedDigest)
    && typeof payload.expectedActionRevision === 'number' && Number.isSafeInteger(payload.expectedActionRevision) && payload.expectedActionRevision > 0
    && isOperationVersion(payload.expectedOperationVersion), 'INVALID_REQUEST');
  return { kind: 'approval', input: { requestId: payload.requestId, approvalId: payload.approvalId, token: payload.token,
    decision: payload.decision, expectedDigest: payload.expectedDigest, expectedActionRevision: payload.expectedActionRevision,
    expectedOperationVersion: payload.expectedOperationVersion } };
}

/** Fixed companion boundary. Constructing this handler starts no listener or relay. */
export class PhoneHost {
  private readonly ports: PhoneHostPorts;
  private readonly custody: PhoneRequestCustody;
  private readonly clock: () => number;
  constructor(options: { ports: PhoneHostPorts; custody: PhoneRequestCustody; clock?: () => number }) {
    this.ports = options.ports; this.custody = options.custody; this.clock = options.clock ?? Date.now;
  }
  private principal(value: PhoneHostPrincipal, authentication: PhoneHostAuthentication): PhoneHostPrincipal {
    requirePhone(value && ['ios', 'android', 'web'].includes(value.channel), 'CHANNEL_FORBIDDEN');
    requirePhone(value.authority && Date.parse(value.authority.expiresAt) > this.clock(), 'SESSION_EXPIRED');
    requirePhone(validAuthority(value.authority, this.clock()) && ['owner', 'staff', 'accountant'].includes(value.role)
      && value.authority.binding.deviceId === authentication.proof.deviceId
      && Math.abs(Date.parse(value.authority.validatedAt) - this.clock()) <= 30000, 'ACCESS_REVOKED');
    return { authority: copyAuthority(value.authority), channel: value.channel, role: value.role };
  }
  private capable(principal: PhoneHostPrincipal, capability: string) {
    requirePhone(principal.authority.capabilities.some(value => value === capability), 'CAPABILITY_FORBIDDEN');
    if (capability === 'approval.simple') requirePhone(principal.role === 'owner', 'CAPABILITY_FORBIDDEN');
  }
  private async release(principal: PhoneHostPrincipal, resource: PhoneHostRelease) {
    await this.ports.release(structuredClone(principal), structuredClone(resource));
    requirePhone(Date.parse(principal.authority.expiresAt) > this.clock(), 'SESSION_EXPIRED');
  }
  private async check(principal: PhoneHostPrincipal, record: PhoneCustodyRecord) {
    requirePhone(sameBinding(record.binding, principal.authority.binding) && record.sessionId === principal.authority.sessionId, 'ACCESS_REVOKED');
    requirePhone(Date.parse(record.expiresAt) > this.clock() && Date.parse(principal.authority.expiresAt) > this.clock(), 'SESSION_EXPIRED');
    this.capable(principal, phoneRequestCapability(record.identity.kind));
    await this.ports.check(structuredClone(principal), structuredClone(record));
    requirePhone(Date.parse(record.expiresAt) > this.clock(), 'SESSION_EXPIRED');
  }
  private async read(principal: PhoneHostPrincipal, record: PhoneCustodyRecord): Promise<RemoteRequest<RequestResult>> {
    await this.check(principal, record);
    if (['unknown', 'pending'].includes(record.state.status)) {
      const response = await this.ports.status(structuredClone(principal), structuredClone(record));
      record = await this.custody.settle(principal.authority, record.identity.requestId, response);
    }
    await this.check(principal, record);
    return structuredClone(record.state);
  }
  private async start(principal: PhoneHostPrincipal, request: PhoneHostOperation) {
    this.capable(principal, phoneRequestCapability(request.kind));
    const inputDigest = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    const prior = await this.custody.get(principal.authority, request.input.requestId);
    if (prior) {
      requirePhone(prior.inputDigest === inputDigest && prior.identity.kind === request.kind, 'REQUEST_EXISTS');
      return this.read(principal, prior);
    }
    const scope = scopeCopy(await this.ports.admit(structuredClone(principal), structuredClone(request)));
    const createdAt = new Date(this.clock()).toISOString();
    const candidate: PhoneCustodyRecord = {
      identity: { requestId: request.input.requestId, kind: request.kind, ...(request.kind === 'approval' ? { target: request.input.approvalId } : {}) },
      binding: copyBinding(principal.authority.binding), sessionId: principal.authority.sessionId,
      operationId: 'phone_' + randomUUID().replaceAll('-', '_'), inputDigest, scope, createdAt,
      expiresAt: principal.authority.expiresAt, state: { status: 'unknown', requestId: request.input.requestId },
    };
    const reserved = await this.custody.reserve(candidate);
    if (!reserved.dispatch) return this.read(principal, reserved.record);
    await this.check(principal, reserved.record);
    // Admission is already encrypted and durable. A thrown/uncertain start is never replayed.
    const response = await this.ports.start(structuredClone(principal), structuredClone(reserved.record), structuredClone(request));
    const settled = await this.custody.settle(principal.authority, request.input.requestId, response);
    await this.check(principal, settled);
    return structuredClone(settled.state);
  }
  async handle(input: PhoneHostAuthentication): Promise<unknown> {
    requirePhone(input && input.bytes instanceof Uint8Array && input.bytes.byteLength > 0 && input.bytes.byteLength <= MAX_BODY_BYTES, 'INVALID_REQUEST');
    const authentication = { bytes: Uint8Array.from(input.bytes), ...(input.credential ? { credential: input.credential } : {}), proof: { ...input.proof } };
    requirePhone(authentication.proof && isId(authentication.proof.deviceId) && isId(authentication.proof.keyId) && isId(authentication.proof.nonce)
      && text(authentication.proof.proof, 4096) && !/[\r\n]/.test(authentication.proof.proof)
      && typeof authentication.proof.timestamp === 'string' && Number.isFinite(Date.parse(authentication.proof.timestamp))
      && Math.abs(Date.parse(authentication.proof.timestamp) - this.clock()) <= 30000, 'ACCESS_REVOKED');
    let envelope: unknown;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(authentication.bytes)); } catch { throw new PhoneError('INVALID_REQUEST'); }
    exact(envelope, ['protocolVersion', 'method', 'payload']);
    requirePhone(envelope.protocolVersion === 1 && typeof envelope.method === 'string', 'INVALID_REQUEST');
    const { method, payload } = envelope;
    const supported = ['pairing.accept', 'session.validate', 'session.revoke', 'brief.list', 'brief.read', 'receipt.read', 'chat.start', 'approval.list', 'approval.inspect', 'approval.submit', 'request.list', 'request.status', 'request.cancel'];
    requirePhone(supported.includes(method), method.startsWith('upload.') ? 'OPEN_DESKTOP' : 'INVALID_REQUEST');
    if (method === 'pairing.accept') {
      exact(payload, ['inviteCode', 'deviceId', 'channel', 'devicePublicKey', 'proof']);
      requirePhone(!authentication.credential && this.ports.pair && text(payload.inviteCode, 4096) && payload.inviteCode.length >= 8
        && isId(payload.deviceId) && payload.deviceId === authentication.proof.deviceId
        && ['ios', 'android', 'web'].includes(payload.channel as string) && text(payload.devicePublicKey, 4096) && text(payload.proof, 4096), 'INVALID_REQUEST');
      const grant = await this.ports.pair(authentication, { inviteCode: payload.inviteCode, deviceId: payload.deviceId,
        channel: payload.channel as 'ios' | 'android' | 'web', devicePublicKey: payload.devicePublicKey, proof: payload.proof });
      requirePhone(grant && typeof grant.credential === 'string' && grant.credential.length >= 32 && grant.credential.length <= 4096
        && validAuthority(grant.authority, this.clock()) && grant.authority.binding.deviceId === payload.deviceId, 'INVALID_RESPONSE');
      return { authority: copyAuthority(grant.authority), credential: grant.credential };
    }
    requirePhone(typeof authentication.credential === 'string' && authentication.credential.length >= 32 && authentication.credential.length <= 4096
      && !/\s/.test(authentication.credential), 'UNPAIRED');
    const principal = this.principal(await this.ports.authenticate(structuredClone(authentication)), authentication);
    switch (method) {
      case 'session.validate': exact(payload, []); await this.release(principal, { kind: 'session' }); return { status: 'current', authority: copyAuthority(principal.authority) };
      case 'session.revoke': {
        const deviceId = idInput(payload, 'deviceId'); requirePhone(deviceId === principal.authority.binding.deviceId && this.ports.revoke, 'CAPABILITY_FORBIDDEN');
        await this.ports.revoke(structuredClone(principal), deviceId); return { status: 'revoked', deviceId };
      }
      case 'brief.list': case 'brief.read': {
        const briefId = method === 'brief.read' ? idInput(payload, 'briefId') : undefined;
        if (!briefId) exact(payload, []);
        this.capable(principal, 'brief.read');
        const briefs = await this.ports.briefs(structuredClone(principal), briefId);
        requirePhone(Array.isArray(briefs) && briefs.length <= 100 && briefs.every(brief => validBrief(brief) && brief.workspaceId === principal.authority.binding.workspaceId), 'INVALID_RESPONSE');
        const safeBriefs = briefs.map(copyBrief);
        if (briefId) requirePhone(safeBriefs.length === 1 && safeBriefs[0].id === briefId, 'INVALID_RESPONSE');
        await this.release(principal, { kind: 'brief', briefs: safeBriefs.map(brief => ({ id: brief.id, version: brief.version, receiptIds: [...brief.receiptIds] })) });
        return briefId ? safeBriefs[0] : safeBriefs;
      }
      case 'receipt.read': {
        const receiptId = idInput(payload, 'receiptId'); this.capable(principal, 'brief.read');
        const receipt = await this.ports.receipt(structuredClone(principal), receiptId);
        requirePhone(receipt && receipt.id === receiptId && receipt.workspaceId === principal.authority.binding.workspaceId && typeof receipt.text === 'string' && receipt.text.length <= 64000, 'INVALID_RESPONSE');
        const safeReceipt = { id: receipt.id, workspaceId: receipt.workspaceId, text: receipt.text };
        await this.release(principal, { kind: 'receipt', receiptId });
        return safeReceipt;
      }
      case 'chat.start': case 'approval.submit': return this.start(principal, operation(method, payload));
      case 'request.list': {
        exact(payload, []); const records = await this.custody.list(principal.authority);
        for (const record of records) await this.check(principal, record);
        await this.release(principal, { kind: 'requests', records: records.map(record => ({ identity: structuredClone(record.identity), binding: copyBinding(record.binding),
          sessionId: record.sessionId, operationId: record.operationId, scope: scopeCopy(record.scope), expiresAt: record.expiresAt })) });
        return records.map(record => structuredClone(record.identity));
      }
      case 'request.status': case 'request.cancel': {
        const requestId = idInput(payload, 'requestId'); const record = await this.custody.get(principal.authority, requestId);
        if (!record) return { status: 'unknown', requestId };
        if (method === 'request.status') return this.read(principal, record);
        await this.check(principal, record);
        // A terminal result cannot be undone by a cancellation request.
        if (['succeeded', 'cancelled', 'failed'].includes(record.state.status)) return structuredClone(record.state);
        const response = await this.ports.cancel(structuredClone(principal), structuredClone(record));
        const settled = await this.custody.settle(principal.authority, requestId, response);
        await this.check(principal, settled); return structuredClone(settled.state);
      }
      case 'approval.list': {
        exact(payload, []); this.capable(principal, 'approval.simple'); requirePhone(this.ports.approvals, 'OPEN_DESKTOP');
        const items = await this.ports.approvals(structuredClone(principal));
        requirePhone(Array.isArray(items) && items.length <= 100 && items.every(item => item && isId(item.approvalId) && typeof item.title === 'string' && item.title.length <= 200), 'INVALID_RESPONSE');
        const safeItems = items.map(item => ({ approvalId: item.approvalId, title: item.title }));
        await this.release(principal, { kind: 'approval-list', approvalIds: safeItems.map(item => item.approvalId) });
        return safeItems;
      }
      case 'approval.inspect': {
        const approvalId = idInput(payload, 'approvalId'); this.capable(principal, 'approval.simple'); requirePhone(this.ports.inspectApproval, 'OPEN_DESKTOP');
        const challenge: ApprovalChallenge = await this.ports.inspectApproval(structuredClone(principal), approvalId); const preview = challenge?.preview;
        requirePhone(preview && preview.approvalId === approvalId && isId(preview.actionId) && sameBinding(preview.binding, principal.authority.binding)
          && Number.isSafeInteger(preview.actionRevision) && preview.actionRevision > 0 && isOperationVersion(preview.operationVersion)
          && /^[a-f0-9]{64}$/.test(preview.digest) && Date.parse(preview.expiresAt) > this.clock()
          && Date.parse(preview.expiresAt) <= Math.min(this.clock() + 300000, Date.parse(principal.authority.expiresAt))
          && typeof preview.title === 'string' && preview.title.length <= 200 && typeof preview.summary === 'string' && preview.summary.length <= 16000
          && ['simple-reversible', 'open-desktop'].includes(preview.eligibility), 'INVALID_RESPONSE');
        requirePhone(preview.eligibility === 'open-desktop' ? challenge.token === undefined : isApprovalToken(challenge.token), 'INVALID_RESPONSE');
        const safeChallenge = { preview: { approvalId, actionId: preview.actionId, binding: copyBinding(preview.binding), actionRevision: preview.actionRevision,
          operationVersion: preview.operationVersion, digest: preview.digest, expiresAt: preview.expiresAt, title: preview.title, summary: preview.summary, eligibility: preview.eligibility },
          ...(challenge.token ? { token: challenge.token } : {}) };
        await this.release(principal, { kind: 'approval', preview: structuredClone(safeChallenge.preview) });
        return safeChallenge;
      }
    }
    throw new PhoneError('INVALID_REQUEST');
  }
}

/** Mount explicitly in the trusted coordinator's server; no CORS, remote listener or token bootstrap. */
export function createPhoneHttpHandler(host: PhoneHost) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      requirePhone(request.method === 'POST' && request.url === '/api/companion/rpc', 'INVALID_REQUEST');
      const critical = new Set(['authorization', 'content-type', 'content-length', 'x-chausar-device', 'x-chausar-key', 'x-chausar-time', 'x-chausar-nonce', 'x-chausar-proof']);
      const seen = new Set<string>();
      for (let index = 0; index < request.rawHeaders.length; index += 2) { const name = request.rawHeaders[index].toLowerCase(); if (critical.has(name)) { requirePhone(!seen.has(name), 'INVALID_REQUEST'); seen.add(name); } }
      const header = (name: string) => { const value = request.headers[name]; requirePhone(typeof value === 'string' && value.length <= 4096, 'INVALID_REQUEST'); return value; };
      requirePhone(/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header('content-type')), 'INVALID_REQUEST');
      if (request.headers['content-length']) requirePhone(/^\d+$/.test(header('content-length')) && Number(header('content-length')) <= MAX_BODY_BYTES, 'INVALID_REQUEST');
      const authorization = request.headers.authorization;
      requirePhone(authorization === undefined || /^Bearer [^\s]{32,4096}$/.test(authorization), 'UNPAIRED');
      const proof = { deviceId: header('x-chausar-device'), keyId: header('x-chausar-key'), timestamp: header('x-chausar-time'), nonce: header('x-chausar-nonce'), proof: header('x-chausar-proof') };
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) { const bytes = Buffer.from(chunk); size += bytes.byteLength; requirePhone(size <= MAX_BODY_BYTES, 'INVALID_REQUEST'); chunks.push(bytes); }
      const result = await host.handle({ bytes: Buffer.concat(chunks), ...(authorization ? { credential: authorization.slice(7) } : {}), proof });
      response.statusCode = 200; response.end(JSON.stringify({ result }));
    } catch (error) {
      const code = error instanceof PhoneError && codes.has(error.code) ? error.code : 'TRANSPORT_UNKNOWN';
      response.statusCode = ['ACCESS_REVOKED', 'SESSION_EXPIRED', 'UNPAIRED'].includes(code) ? 401 : ['CHANNEL_FORBIDDEN', 'CAPABILITY_FORBIDDEN'].includes(code) ? 403 : code === 'TRANSPORT_UNKNOWN' || code === 'CACHE_INVALID' ? 503 : 400;
      response.end(JSON.stringify({ error: { code } }));
    }
  };
}
