import { createHash, createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import type { Context, Role, State, StateStore } from './contracts.ts';
import { PhoneError, isId, requirePhone } from './phone/contracts.ts';
import type { AppChannel, PhoneCapability, PhoneMethods, SessionAuthority, SessionGrant } from './phone/contracts.ts';
import type { PhoneHostAuthentication, PhoneHostPrincipal, PhoneHostProof } from './phone/host-contracts.ts';

export const PHONE_SESSION_KEY_ALGORITHM = 'Ed25519' as const;
export const PHONE_SESSION_RECORD_KINDS = {
  invite: 'chausar-phone-invite-v1', session: 'chausar-phone-session-v1', nonce: 'chausar-phone-nonce-v1',
} as const;
const MAX_BODY = 128 * 1024;
const capabilities: PhoneCapability[] = ['brief.read', 'chat', 'upload', 'approval.simple'];
const channels: AppChannel[] = ['ios', 'android', 'web'];
const signedMethods = ['session.validate', 'session.revoke', 'brief.list', 'brief.read', 'receipt.read', 'chat.start',
  'approval.list', 'approval.inspect', 'approval.submit', 'request.list', 'request.status', 'request.cancel'];
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const credentialHash = (credential: string) => digest(`chausar-phone-credential-v1\n${credential}`);
const inviteHash = (code: string) => digest(`chausar-phone-invite-v1\n${code}`);
const copy = <T>(value: T): T => structuredClone(value);
const iso = (time: number) => new Date(time).toISOString();
const stateOf = (current: State | StateStore): State => 'read' in current ? current.read() : current;

export type PhoneSessionInviteInput = {
  memberId: string; deviceId: string; keyId: string; channel: AppChannel; devicePublicKey: string;
  capabilities: PhoneCapability[]; inviteTtlMs: number; sessionTtlMs: number;
};
export type PhoneSessionInvite = {
  inviteId: string; inviteCode: string; binding: SessionAuthority['binding']; keyId: string;
  channel: AppChannel; capabilities: PhoneCapability[]; expiresAt: string; sessionTtlMs: number;
};
export type PhoneSessionMetadata = {
  binding: SessionAuthority['binding']; sessionId: string; channel: AppChannel; keyId: string;
  capabilities: PhoneCapability[]; expiresAt: string; revoked: boolean;
};
export type PhoneSessionOptions = {
  clock?: () => number; maxInvites?: number; maxSessions?: number; maxNonces?: number; maxClockSkewMs?: number;
};
type InviteRecord = PhoneSessionInviteInput & {
  kind: typeof PHONE_SESSION_RECORD_KINDS.invite; id: string; workspaceId: string; memberRole: Role; memberEpoch: number;
  issuerId: string; issuerEpoch: number; tokenHash: string; createdAt: string; expiresAt: string; consumedAt?: string;
};
type SessionRecord = {
  kind: typeof PHONE_SESSION_RECORD_KINDS.session; id: string; workspaceId: string; memberId: string;
  memberRole: Role; memberEpoch: number; deviceId: string; keyId: string; devicePublicKey: string;
  channel: AppChannel; capabilities: PhoneCapability[]; issuerId: string; issuerEpoch: number;
  tokenHash: string; createdAt: string; expiresAt: string; identitySalt: string; revokedAt?: string;
};
type NonceRecord = {
  kind: typeof PHONE_SESSION_RECORD_KINDS.nonce; id: string; workspaceId: string; memberId: string;
  scopeId: string; nonceHash: string; acceptedAt: string;
};
type SigningAuthentication = Omit<PhoneHostAuthentication, 'proof'> & {
  proof: Pick<PhoneHostProof, 'deviceId' | 'keyId' | 'timestamp' | 'nonce'>;
};

function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requirePhone(!!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(','), 'INVALID_REQUEST');
}
function canonicalBase64(value: unknown, length: number): Buffer {
  requirePhone(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value) && value.length <= 128, 'INVALID_REQUEST');
  const bytes = Buffer.from(value, 'base64url');
  requirePhone(bytes.length === length && bytes.toString('base64url') === value, 'INVALID_REQUEST'); return bytes;
}
function publicKey(value: unknown): KeyObject {
  const bytes = canonicalBase64(value, 44);
  try {
    const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' });
    requirePhone(key.asymmetricKeyType === 'ed25519'
      && Buffer.from(key.export({ format: 'der', type: 'spki' })).equals(bytes), 'INVALID_REQUEST');
    return key;
  } catch { throw new PhoneError('INVALID_REQUEST'); }
}
function properCapabilities(value: unknown, role: Role): asserts value is PhoneCapability[] {
  requirePhone(Array.isArray(value) && value.length > 0 && value.length <= capabilities.length
    && value.every(item => capabilities.includes(item)) && new Set(value).size === value.length, 'INVALID_REQUEST');
  requirePhone(!value.includes('approval.simple') || role === 'owner', 'CAPABILITY_FORBIDDEN');
  requirePhone(role !== 'viewer' || value.every(item => item === 'brief.read'), 'CAPABILITY_FORBIDDEN');
}
function currentMember(state: State, id: string, epoch?: number, role?: Role) {
  const rows = state.members.filter(member => member.id === id);
  requirePhone(rows.length === 1 && rows[0].active && Number.isSafeInteger(rows[0].epoch) && rows[0].epoch > 0
    && (epoch === undefined || rows[0].epoch === epoch) && (role === undefined || rows[0].role === role), 'ACCESS_REVOKED');
  return rows[0];
}
function desktopOwner(state: State, owner: Context) {
  requirePhone(owner?.channel === 'desktop' && !owner.sourceTainted, 'CHANNEL_FORBIDDEN');
  const member = currentMember(state, owner.memberId, owner.epoch, owner.role);
  requirePhone(member.role === 'owner', 'CAPABILITY_FORBIDDEN'); return member;
}
function withinIssuer(issuer: State['members'][number], target: State['members'][number]) {
  requirePhone(Array.isArray(issuer.branches) && Array.isArray(target.branches)
    && (issuer.branches.includes('*') || target.branches.every(branch => branch !== '*' && issuer.branches.includes(branch))), 'CAPABILITY_FORBIDDEN');
}
function sessionIdentity(record: SessionRecord): string {
  return 'phone_session_' + digest(JSON.stringify(['chausar-phone-session-identity-v1', record.workspaceId, record.memberId,
    record.memberRole, record.memberEpoch, record.deviceId, record.keyId, record.devicePublicKey, record.channel,
    record.capabilities, record.issuerId, record.issuerEpoch, record.tokenHash, record.createdAt, record.expiresAt, record.identitySalt]));
}
function principal(record: SessionRecord, at: number): PhoneHostPrincipal {
  return { authority: { binding: { workspaceId: record.workspaceId, memberId: record.memberId,
    deviceId: record.deviceId, epoch: record.memberEpoch }, sessionId: record.id, expiresAt: record.expiresAt,
    validatedAt: iso(at), capabilities: [...record.capabilities] }, channel: record.channel,
    role: record.memberRole === 'owner' ? 'owner' : record.memberRole === 'accountant' ? 'accountant' : 'staff' };
}

/** Signature transcript: ordered JSON metadata, one LF, then the exact UTF-8 body bytes.
 * The fixed HTTP verb/path are protocol constants, not body-supplied authority. */
export function phoneRequestSigningBytes(request: SigningAuthentication): Uint8Array {
  requirePhone(request?.bytes instanceof Uint8Array && request.bytes.byteLength > 0 && request.bytes.byteLength <= MAX_BODY, 'INVALID_REQUEST');
  const metadata = JSON.stringify(['chausar-phone-request-v1', 'POST', '/api/companion/rpc', request.proof.deviceId,
    request.proof.keyId, request.proof.timestamp, request.proof.nonce,
    request.credential === undefined ? null : credentialHash(request.credential), request.bytes.byteLength]);
  return Buffer.concat([Buffer.from(metadata + '\n', 'utf8'), Buffer.from(request.bytes)]);
}
/** Independent pairing-key possession preimage; the outer request proof additionally
 * signs the complete body including this inner proof, without circular self-signing. */
export function phonePairingSigningBytes(input: {
  inviteCode: string; deviceId: string; channel: AppChannel; devicePublicKey: string; keyId: string;
}): Uint8Array {
  return Buffer.from(JSON.stringify(['chausar-phone-pairing-v1', input.inviteCode, input.deviceId,
    input.channel, input.keyId, input.devicePublicKey]), 'utf8');
}

/** Authoritative phone identity only. No listener, credential provider, business
 * grant, model dispatch, file store, native private key or approval executor. */
export class PhoneSessionService {
  readonly store: StateStore;
  private readonly clock: () => number;
  private readonly limits: { invites: number; sessions: number; nonces: number; skew: number };
  constructor(store: StateStore, options: PhoneSessionOptions = {}) {
    this.store = store; this.clock = options.clock ?? Date.now;
    this.limits = { invites: options.maxInvites ?? 1024, sessions: options.maxSessions ?? 1024,
      nonces: options.maxNonces ?? 100000, skew: options.maxClockSkewMs ?? 30000 };
    for (const bound of [this.limits.invites, this.limits.sessions, this.limits.nonces])
      requirePhone(Number.isSafeInteger(bound) && bound >= 1 && bound <= 1000000, 'INVALID_REQUEST');
    requirePhone(Number.isSafeInteger(this.limits.skew) && this.limits.skew >= 0 && this.limits.skew <= 120000, 'INVALID_REQUEST');
  }
  private time(): number {
    const at = this.clock(); requirePhone(Number.isSafeInteger(at) && at >= 0 && at <= 253402300799999, 'INVALID_REQUEST'); return at;
  }
  private records<T>(state: State, kind: string): T[] {
    requirePhone(Array.isArray(state.sessions), 'CACHE_INVALID'); return state.sessions.filter(item => item?.kind === kind) as T[];
  }
  private active(state: State, record: SessionRecord, at: number) {
    requirePhone(record.workspaceId === state.workspace.id && !record.revokedAt && record.id === sessionIdentity(record), 'ACCESS_REVOKED');
    requirePhone(isId(record.memberId) && isId(record.deviceId) && isId(record.keyId) && channels.includes(record.channel), 'ACCESS_REVOKED');
    requirePhone(Number.isFinite(Date.parse(record.createdAt)) && Date.parse(record.createdAt) <= at
      && Number.isFinite(Date.parse(record.expiresAt)) && Date.parse(record.expiresAt) > at, 'SESSION_EXPIRED');
    const member = currentMember(state, record.memberId, record.memberEpoch, record.memberRole);
    const issuer = currentMember(state, record.issuerId, record.issuerEpoch, 'owner');
    withinIssuer(issuer, member); properCapabilities(record.capabilities, record.memberRole);
    publicKey(record.devicePublicKey);
  }
  private envelope(request: PhoneHostAuthentication) {
    requirePhone(request?.bytes instanceof Uint8Array && request.bytes.length > 0 && request.bytes.length <= MAX_BODY, 'INVALID_REQUEST');
    let body: Record<string, unknown>;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(request.bytes)); }
    catch { throw new PhoneError('INVALID_REQUEST'); }
    exact(body, ['protocolVersion', 'method', 'payload']);
    requirePhone(body.protocolVersion === 1 && typeof body.method === 'string'
      && body.payload !== null && typeof body.payload === 'object' && !Array.isArray(body.payload), 'INVALID_REQUEST');
    return body;
  }
  private proof(request: PhoneHostAuthentication, key: string, deviceId: string, keyId: string, at: number) {
    exact(request.proof, ['deviceId', 'keyId', 'timestamp', 'nonce', 'proof']);
    requirePhone(request.proof.deviceId === deviceId && request.proof.keyId === keyId && isId(deviceId) && isId(keyId), 'ACCESS_REVOKED');
    const when = Date.parse(request.proof.timestamp);
    requirePhone(Number.isFinite(when) && iso(when) === request.proof.timestamp && Math.abs(when - at) <= this.limits.skew, 'INVALID_REQUEST');
    canonicalBase64(request.proof.nonce, 32);
    requirePhone(verify(null, phoneRequestSigningBytes(request), publicKey(key), canonicalBase64(request.proof.proof, 64)), 'INVALID_REQUEST');
  }
  private nonce(state: State, memberId: string, scopeId: string, nonce: string, at: number) {
    const nonceHash = digest(nonce), records = this.records<NonceRecord>(state, PHONE_SESSION_RECORD_KINDS.nonce);
    requirePhone(!records.some(item => item.scopeId === scopeId && item.nonceHash === nonceHash), 'INVALID_REQUEST');
    requirePhone(records.length < this.limits.nonces, 'OPEN_DESKTOP');
    const record: NonceRecord = { kind: PHONE_SESSION_RECORD_KINDS.nonce, id: 'phone_nonce_' + digest(`${scopeId}\n${nonceHash}`),
      workspaceId: state.workspace.id, memberId, scopeId, nonceHash, acceptedAt: iso(at) };
    state.sessions.push(record);
  }
  async issueInvite(owner: Context, input: PhoneSessionInviteInput): Promise<PhoneSessionInvite> {
    owner = copy(owner); input = copy(input);
    exact(input, ['memberId', 'deviceId', 'keyId', 'channel', 'devicePublicKey', 'capabilities', 'inviteTtlMs', 'sessionTtlMs']);
    requirePhone(isId(input.memberId) && isId(input.deviceId) && isId(input.keyId) && channels.includes(input.channel), 'INVALID_REQUEST');
    publicKey(input.devicePublicKey);
    requirePhone(Number.isSafeInteger(input.inviteTtlMs) && input.inviteTtlMs >= 60000 && input.inviteTtlMs <= 900000
      && Number.isSafeInteger(input.sessionTtlMs) && input.sessionTtlMs >= 60000 && input.sessionTtlMs <= 86400000, 'INVALID_REQUEST');
    return this.store.update(state => {
      const at = this.time(), issuer = desktopOwner(state, owner), member = currentMember(state, input.memberId);
      withinIssuer(issuer, member); properCapabilities(input.capabilities, member.role);
      requirePhone(this.records(state, PHONE_SESSION_RECORD_KINDS.invite).length < this.limits.invites, 'OPEN_DESKTOP');
      const code = 'phone_invite_v1_' + randomBytes(32).toString('base64url');
      const record: InviteRecord = { ...input, capabilities: [...input.capabilities].sort(), kind: PHONE_SESSION_RECORD_KINDS.invite,
        id: 'phone_invite_' + randomBytes(24).toString('base64url'), workspaceId: state.workspace.id,
        memberRole: member.role, memberEpoch: member.epoch, issuerId: issuer.id, issuerEpoch: issuer.epoch,
        tokenHash: inviteHash(code), createdAt: iso(at), expiresAt: iso(at + input.inviteTtlMs) };
      state.sessions.push(record);
      return { inviteId: record.id, inviteCode: code, binding: { workspaceId: record.workspaceId, memberId: member.id,
        deviceId: record.deviceId, epoch: member.epoch }, keyId: record.keyId, channel: record.channel,
        capabilities: [...record.capabilities], expiresAt: record.expiresAt, sessionTtlMs: record.sessionTtlMs };
    });
  }
  async pair(request: PhoneHostAuthentication, input: PhoneMethods['pairing.accept']['input']): Promise<SessionGrant> {
    request = copy(request); input = copy(input);
    const envelope = this.envelope(request);
    exact(input, ['inviteCode', 'deviceId', 'channel', 'devicePublicKey', 'proof']);
    exact(envelope.payload, ['inviteCode', 'deviceId', 'channel', 'devicePublicKey', 'proof']);
    const payload = envelope.payload;
    requirePhone(envelope.method === 'pairing.accept' && request.credential === undefined
      && Object.keys(input).every(key => input[key as keyof typeof input] === payload[key])
      && /^phone_invite_v1_[A-Za-z0-9_-]{43}$/.test(input.inviteCode), 'INVALID_REQUEST');
    return this.store.update(state => {
      const at = this.time(), matches = this.records<InviteRecord>(state, PHONE_SESSION_RECORD_KINDS.invite)
        .filter(item => item.tokenHash === inviteHash(input.inviteCode));
      requirePhone(matches.length === 1, 'UNPAIRED'); const invite = matches[0];
      requirePhone(invite.workspaceId === state.workspace.id && !invite.consumedAt, 'UNPAIRED');
      requirePhone(Date.parse(invite.expiresAt) > at && Date.parse(invite.createdAt) <= at, 'SESSION_EXPIRED');
      const issuer = currentMember(state, invite.issuerId, invite.issuerEpoch, 'owner');
      const member = currentMember(state, invite.memberId, invite.memberEpoch, invite.memberRole);
      withinIssuer(issuer, member); properCapabilities(invite.capabilities, invite.memberRole);
      requirePhone(input.deviceId === invite.deviceId && input.channel === invite.channel && input.devicePublicKey === invite.devicePublicKey, 'ACCESS_REVOKED');
      this.proof(request, invite.devicePublicKey, invite.deviceId, invite.keyId, at);
      requirePhone(verify(null, phonePairingSigningBytes({ ...input, keyId: invite.keyId }), publicKey(invite.devicePublicKey),
        canonicalBase64(input.proof, 64)), 'INVALID_REQUEST');
      const sessions = this.records<SessionRecord>(state, PHONE_SESSION_RECORD_KINDS.session);
      requirePhone(sessions.length < this.limits.sessions, 'OPEN_DESKTOP');
      const occupied = sessions.some(item => {
        if (item.workspaceId !== state.workspace.id || item.deviceId !== invite.deviceId) return false;
        try { this.active(state, item, at); return true; }
        catch (error) {
          if (error instanceof PhoneError && ['ACCESS_REVOKED', 'SESSION_EXPIRED', 'CAPABILITY_FORBIDDEN'].includes(error.code)) return false;
          throw error;
        }
      });
      requirePhone(!occupied, 'REQUEST_EXISTS');
      const credential = 'phone_v1_' + randomBytes(32).toString('base64url');
      const session: SessionRecord = { kind: PHONE_SESSION_RECORD_KINDS.session, id: '', workspaceId: state.workspace.id,
        memberId: invite.memberId, memberRole: invite.memberRole, memberEpoch: invite.memberEpoch, deviceId: invite.deviceId,
        keyId: invite.keyId, devicePublicKey: invite.devicePublicKey, channel: invite.channel, capabilities: [...invite.capabilities],
        issuerId: invite.issuerId, issuerEpoch: invite.issuerEpoch, tokenHash: credentialHash(credential),
        createdAt: iso(at), expiresAt: iso(at + invite.sessionTtlMs), identitySalt: randomBytes(32).toString('base64url') };
      session.id = sessionIdentity(session);
      this.nonce(state, invite.memberId, invite.id, request.proof.nonce, at);
      invite.consumedAt = iso(at); state.sessions.push(session);
      return { authority: principal(session, at).authority, credential };
    });
  }
  async authenticate(request: PhoneHostAuthentication): Promise<PhoneHostPrincipal> {
    request = copy(request); const envelope = this.envelope(request);
    requirePhone(typeof envelope.method === 'string' && signedMethods.includes(envelope.method), 'INVALID_REQUEST');
    requirePhone(typeof request.credential === 'string'
      && /^phone_v1_[A-Za-z0-9_-]{43}$/.test(request.credential), 'UNPAIRED');
    return this.store.update(state => {
      const at = this.time(), matches = this.records<SessionRecord>(state, PHONE_SESSION_RECORD_KINDS.session)
        .filter(item => item.tokenHash === credentialHash(request.credential!));
      requirePhone(matches.length === 1, 'ACCESS_REVOKED'); const session = matches[0]; this.active(state, session, at);
      this.proof(request, session.devicePublicKey, session.deviceId, session.keyId, at);
      this.nonce(state, session.memberId, session.id, request.proof.nonce, at); return principal(session, at);
    });
  }
  assertPrincipal(value: PhoneHostPrincipal, current: State | StateStore = this.store, capability?: PhoneCapability): Context {
    const state = stateOf(current), at = this.time();
    requirePhone(value?.authority && isId(value.authority.sessionId), 'ACCESS_REVOKED');
    const matches = this.records<SessionRecord>(state, PHONE_SESSION_RECORD_KINDS.session).filter(item => item.id === value.authority.sessionId);
    requirePhone(matches.length === 1, 'ACCESS_REVOKED'); const session = matches[0]; this.active(state, session, at);
    const expected = principal(session, at), supplied = value.authority;
    requirePhone(value.channel === expected.channel && value.role === expected.role
      && supplied.binding?.workspaceId === expected.authority.binding.workspaceId && supplied.binding.memberId === session.memberId
      && supplied.binding.deviceId === session.deviceId && supplied.binding.epoch === session.memberEpoch
      && supplied.expiresAt === session.expiresAt && Array.isArray(supplied.capabilities)
      && JSON.stringify(supplied.capabilities) === JSON.stringify(session.capabilities)
      && Number.isFinite(Date.parse(supplied.validatedAt)) && Date.parse(supplied.validatedAt) >= Date.parse(session.createdAt)
      && Date.parse(supplied.validatedAt) <= at, 'ACCESS_REVOKED');
    if (capability) requirePhone(session.capabilities.includes(capability), 'CAPABILITY_FORBIDDEN');
    return { memberId: session.memberId, role: session.memberRole, epoch: session.memberEpoch, channel: 'phone' };
  }
  target(owner: Context, sessionId: string, current: State | StateStore = this.store): PhoneHostPrincipal {
    const state = stateOf(current); desktopOwner(state, owner);
    const matches = this.records<SessionRecord>(state, PHONE_SESSION_RECORD_KINDS.session).filter(item => item.id === sessionId);
    requirePhone(matches.length === 1 && matches[0].issuerId === owner.memberId && matches[0].issuerEpoch === owner.epoch, 'ACCESS_REVOKED');
    const session = matches[0], at = this.time(); this.active(state, session, at); return principal(session, at);
  }
  list(owner: Context): PhoneSessionMetadata[] {
    const state = this.store.read(); desktopOwner(state, owner);
    return this.records<SessionRecord>(state, PHONE_SESSION_RECORD_KINDS.session)
      .filter(item => item.workspaceId === state.workspace.id && item.issuerId === owner.memberId && item.issuerEpoch === owner.epoch)
      .map(item => ({ binding: { workspaceId: item.workspaceId, memberId: item.memberId, deviceId: item.deviceId, epoch: item.memberEpoch },
        sessionId: item.id, channel: item.channel, keyId: item.keyId, capabilities: [...item.capabilities], expiresAt: item.expiresAt, revoked: !!item.revokedAt }));
  }
  async revoke(value: PhoneHostPrincipal, deviceId: string): Promise<void> {
    value = copy(value);
    await this.store.update(state => {
      this.assertPrincipal(value, state); requirePhone(deviceId === value.authority.binding.deviceId, 'CAPABILITY_FORBIDDEN');
      const session = this.records<SessionRecord>(state, PHONE_SESSION_RECORD_KINDS.session).find(item => item.id === value.authority.sessionId)!;
      session.revokedAt = iso(this.time());
    });
  }
  async revokeByOwner(owner: Context, sessionId: string): Promise<void> {
    owner = copy(owner);
    await this.store.update(state => {
      desktopOwner(state, owner);
      const matches = this.records<SessionRecord>(state, PHONE_SESSION_RECORD_KINDS.session)
        .filter(item => item.id === sessionId && item.workspaceId === state.workspace.id && item.issuerId === owner.memberId && item.issuerEpoch === owner.epoch);
      requirePhone(matches.length === 1, 'ACCESS_REVOKED'); matches[0].revokedAt ??= iso(this.time());
    });
  }
}
