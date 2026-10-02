import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { AuthService } from '../runtime/auth.ts';
import { TrustService } from '../runtime/trust.ts';
import { PhoneSessionService, PHONE_SESSION_RECORD_KINDS, phonePairingSigningBytes, phoneRequestSigningBytes,
  type PhoneSessionInvite, type PhoneSessionInviteInput, type PhoneSessionOptions } from '../runtime/engine-phone-sessions.ts';
import type { PhoneHostAuthentication } from '../runtime/phone/host-contracts.ts';
import type { PhoneMethods, SessionGrant } from '../runtime/phone/contracts.ts';

// Explicit synthetic revision-bound reference store. This is neither a native
// database nor protected mobile key custody; root owns real Vault/HTTP joins.
class RevisionFixture implements StateStore {
  #state: State; #tail = Promise.resolve(); failCommit = false;
  constructor(state = initialState('SYNTHETIC PHONE SESSION REFERENCE')) { this.#state = structuredClone(state); }
  read() { return structuredClone(this.#state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const operation = this.#tail.then(async () => {
      const state = this.read(), value = await change(state);
      if (this.failCommit) { this.failCommit = false; throw new Error('Synthetic pre-commit failure'); }
      state.revision++; this.#state = state; return structuredClone(value);
    });
    this.#tail = operation.then(() => undefined, () => undefined); return operation;
  }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
function fixture(options: PhoneSessionOptions = {}, targetRole: Context['role'] = 'owner') {
  const initial = initialState('SYNTHETIC PHONE SESSION REFERENCE');
  const memberId = targetRole === 'owner' ? 'owner' : 'target-member';
  if (memberId !== 'owner') initial.members.push({ id: memberId, name: 'Synthetic phone target', role: targetRole, active: true, epoch: 1, branches: ['main'] });
  const store = new RevisionFixture(initial), keys = generateKeyPairSync('ed25519');
  const devicePublicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  let at = Date.UTC(2030, 0, 1);
  const service = new PhoneSessionService(store, { ...options, clock: () => at });
  const choice: PhoneSessionInviteInput = { memberId, deviceId: 'phone-a', keyId: 'key-a', channel: 'web', devicePublicKey,
    capabilities: ['brief.read', 'chat'], inviteTtlMs: 60000, sessionTtlMs: 60000 };
  function request(credential?: string, method = 'session.validate', payload: unknown = {}, nonce = randomBytes(32).toString('base64url')): PhoneHostAuthentication {
    const value: PhoneHostAuthentication = { bytes: Buffer.from(JSON.stringify({ protocolVersion: 1, method, payload })),
      ...(credential === undefined ? {} : { credential }),
      proof: { deviceId: choice.deviceId, keyId: choice.keyId, timestamp: new Date(at).toISOString(), nonce, proof: '' } };
    value.proof.proof = sign(null, phoneRequestSigningBytes(value), keys.privateKey).toString('base64url'); return value;
  }
  function pairing(invite: PhoneSessionInvite) {
    const input: PhoneMethods['pairing.accept']['input'] = { inviteCode: invite.inviteCode, deviceId: choice.deviceId,
      channel: choice.channel, devicePublicKey, proof: '' };
    input.proof = sign(null, phonePairingSigningBytes({ ...input, keyId: choice.keyId }), keys.privateKey).toString('base64url');
    return { input, request: request(undefined, 'pairing.accept', input) };
  }
  async function paired(): Promise<{ invite: PhoneSessionInvite; grant: SessionGrant }> {
    const invite = await service.issueInvite(owner, choice), call = pairing(invite);
    return { invite, grant: await service.pair(call.request, call.input) };
  }
  return { store, service, choice, keys, memberId, request, pairing, paired,
    advance: (ms: number) => { at += ms; }, clock: () => at };
}
const code = (value: string) => ({ code: value });

test('phone session protocol has fixed literal request and pairing signature domains over exact bytes', () => {
  const body = '{"protocolVersion":1,"method":"session.validate","payload":{}}', nonce = 'A'.repeat(43);
  const request = { bytes: Buffer.from(body), proof: { deviceId: 'device-a', keyId: 'key-a', timestamp: '2030-01-01T00:00:00.000Z', nonce } };
  const expected = `["chausar-phone-request-v1","POST","/api/companion/rpc","device-a","key-a","2030-01-01T00:00:00.000Z","${nonce}",null,${Buffer.byteLength(body)}]\n${body}`;
  assert.equal(Buffer.from(phoneRequestSigningBytes(request)).toString(), expected);
  assert.equal(Buffer.from(phonePairingSigningBytes({ inviteCode: 'invite-literal', deviceId: 'device-a', keyId: 'key-a', channel: 'ios', devicePublicKey: 'public-literal' })).toString(),
    '["chausar-phone-pairing-v1","invite-literal","device-a","ios","key-a","public-literal"]');
});

test('real Ed25519 pairing yields one distinct opaque credential and current host-derived principal through revision writes', async () => {
  const f = fixture(), { invite, grant } = await f.paired();
  assert.match(invite.inviteCode, /^phone_invite_v1_[A-Za-z0-9_-]{43}$/);
  assert.match(grant.credential, /^phone_v1_[A-Za-z0-9_-]{43}$/); assert.notEqual(invite.inviteCode, grant.credential);
  assert.equal(f.store.read().revision, 2, 'Invite and atomic pairing are exactly two supported writer revisions.');
  const principal = await f.service.authenticate(f.request(grant.credential));
  assert.equal(f.store.read().revision, 3);
  assert.deepEqual(f.service.assertPrincipal(principal), { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' });
  assert.equal(principal.role, 'owner'); assert.deepEqual(principal.authority.capabilities, ['brief.read', 'chat']);
  assert.deepEqual(principal.authority.binding, { workspaceId: f.store.read().workspace.id, memberId: 'owner', deviceId: 'phone-a', epoch: 1 });
  const stored = JSON.stringify(f.store.read());
  assert.ok(!stored.includes(invite.inviteCode)); assert.ok(!stored.includes(grant.credential));
  assert.equal(f.store.read().sessions.filter(item => item.kind === PHONE_SESSION_RECORD_KINDS.session).length, 1);
  assert.equal(f.store.read().sessions.filter(item => item.kind === PHONE_SESSION_RECORD_KINDS.nonce).length, 2);
});

test('concurrent pairing consumes an invitation once and failed commit creates no credential or nonce authority', async () => {
  const f = fixture(), invite = await f.service.issueInvite(owner, f.choice), call = f.pairing(invite);
  const results = await Promise.allSettled([f.service.pair(call.request, call.input), f.service.pair(call.request, call.input)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = results.find(item => item.status === 'rejected') as PromiseRejectedResult;
  assert.equal(rejected.reason.code, 'UNPAIRED'); assert.equal(f.store.read().revision, 2);
  assert.equal(f.store.read().sessions.filter(item => item.kind === PHONE_SESSION_RECORD_KINDS.session).length, 1);
  const other = fixture(), nextInvite = await other.service.issueInvite(owner, other.choice), next = other.pairing(nextInvite), before = other.store.read();
  other.store.failCommit = true;
  await assert.rejects(other.service.pair(next.request, next.input), /Synthetic pre-commit failure/);
  assert.deepEqual(other.store.read(), before);
  assert.match((await other.service.pair(next.request, next.input)).credential, /^phone_v1_/);
});

test('phone authentication rejects desktop member credentials and unrelated method envelopes without consuming a nonce', async () => {
  const f = fixture(), { grant } = await f.paired();
  const desktop = await new AuthService(f.store).issueSession(owner), before = f.store.read();
  await assert.rejects(f.service.authenticate(f.request(desktop.token)), code('UNPAIRED'));
  await assert.rejects(f.service.authenticate(f.request('cli-session-fixture-token')), code('UNPAIRED'));
  await assert.rejects(f.service.authenticate(f.request(grant.credential, 'workspace.delete', { confirmation: 'SYNTHETIC' })), code('INVALID_REQUEST'));
  assert.deepEqual(f.store.read(), before);
});

test('exact body, route domain and all proof metadata are required even with the correct phone credential', async () => {
  const f = fixture(), { grant } = await f.paired(), valid = f.request(grant.credential, 'brief.list'), before = f.store.read();
  const variants: PhoneHostAuthentication[] = [];
  const changedBody = structuredClone(valid); changedBody.bytes = Buffer.from('{"protocolVersion":1,"method":"brief.read","payload":{"briefId":"another"}}'); variants.push(changedBody);
  for (const name of ['deviceId', 'keyId', 'nonce', 'timestamp'] as const) {
    const changed = structuredClone(valid);
    changed.proof[name] = name === 'nonce' ? randomBytes(32).toString('base64url') : name === 'timestamp' ? '2030-01-01T00:00:00.001Z' : 'other-device-or-key';
    variants.push(changed);
  }
  const wrongRoute = structuredClone(valid);
  const otherDomain = Buffer.from(phoneRequestSigningBytes(wrongRoute)).toString().replace('/api/companion/rpc', '/api/rpc');
  wrongRoute.proof.proof = sign(null, Buffer.from(otherDomain), f.keys.privateKey).toString('base64url'); variants.push(wrongRoute);
  const wrongKey = structuredClone(valid);
  wrongKey.proof.proof = sign(null, phoneRequestSigningBytes(valid), generateKeyPairSync('ed25519').privateKey).toString('base64url'); variants.push(wrongKey);
  for (const changed of variants) await assert.rejects(f.service.authenticate(changed));
  assert.deepEqual(f.store.read(), before); await f.service.authenticate(valid);
});

test('pairing requires the owner-pinned device key and separate real possession proof', async () => {
  const f = fixture(), invite = await f.service.issueInvite(owner, f.choice), call = f.pairing(invite), before = f.store.read();
  const wrongInner = structuredClone(call.input);
  wrongInner.proof = sign(null, phonePairingSigningBytes({ ...wrongInner, keyId: f.choice.keyId }), generateKeyPairSync('ed25519').privateKey).toString('base64url');
  await assert.rejects(f.service.pair(f.request(undefined, 'pairing.accept', wrongInner), wrongInner), code('INVALID_REQUEST'));
  const wrongPublic = structuredClone(call.input);
  wrongPublic.devicePublicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  await assert.rejects(f.service.pair(f.request(undefined, 'pairing.accept', wrongPublic), wrongPublic), code('ACCESS_REVOKED'));
  assert.deepEqual(f.store.read(), before); await f.service.pair(call.request, call.input);
});

test('persisted one-use nonce refuses reuse after re-signing or service restart and full capacity retains every identity', async () => {
  const f = fixture({ maxNonces: 2 }), { grant } = await f.paired();
  const nonce = randomBytes(32).toString('base64url'); await f.service.authenticate(f.request(grant.credential, 'session.validate', {}, nonce));
  f.advance(1);
  const before = f.store.read(), reopened = new PhoneSessionService(f.store, { clock: f.clock, maxNonces: 2 });
  await assert.rejects(reopened.authenticate(f.request(grant.credential, 'session.validate', {}, nonce)), code('INVALID_REQUEST'));
  await assert.rejects(reopened.authenticate(f.request(grant.credential)), code('OPEN_DESKTOP'));
  assert.deepEqual(f.store.read(), before); assert.equal(reopened.list(owner).length, 1);
});

test('expired invitations and sessions, stale proof times, malformed algorithms and bounds fail closed', async () => {
  const inviteHost = fixture(), invite = await inviteHost.service.issueInvite(owner, inviteHost.choice), call = inviteHost.pairing(invite), before = inviteHost.store.read();
  inviteHost.advance(60001);
  await assert.rejects(inviteHost.service.pair(call.request, call.input), code('SESSION_EXPIRED'));
  assert.deepEqual(inviteHost.store.read(), before);
  const f = fixture(), { grant } = await f.paired(), stale = f.request(grant.credential);
  f.advance(30001); const stillCurrent = f.store.read();
  await assert.rejects(f.service.authenticate(stale), code('INVALID_REQUEST')); assert.deepEqual(f.store.read(), stillCurrent);
  const current = await f.service.authenticate(f.request(grant.credential)); f.advance(30000);
  assert.throws(() => f.service.assertPrincipal(current), code('SESSION_EXPIRED'));
  await assert.rejects(f.service.authenticate(f.request(grant.credential)), code('SESSION_EXPIRED'));
  const malformed = fixture();
  const xKey = generateKeyPairSync('x25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  await assert.rejects(malformed.service.issueInvite(owner, { ...malformed.choice, devicePublicKey: xKey }), code('INVALID_REQUEST'));
  await assert.rejects(malformed.service.issueInvite(owner, { ...malformed.choice, sessionTtlMs: 86400001 }), code('INVALID_REQUEST'));
  assert.throws(() => new PhoneSessionService(malformed.store, { maxClockSkewMs: 120001 }), code('INVALID_REQUEST'));
  assert.throws(() => new PhoneSessionService(malformed.store, { maxNonces: 0 }), code('INVALID_REQUEST'));
});

test('full invitation and session bounds refuse new authority without deleting even consumed or revoked identities', async () => {
  const invitations = fixture({ maxInvites: 1 }); await invitations.paired();
  const full = invitations.store.read();
  await assert.rejects(invitations.service.issueInvite(owner, { ...invitations.choice, deviceId: 'phone-b' }), code('OPEN_DESKTOP'));
  assert.deepEqual(invitations.store.read(), full);
  const sessions = fixture({ maxSessions: 1 }), { grant } = await sessions.paired();
  await sessions.service.revokeByOwner(owner, grant.authority.sessionId);
  const invite = await sessions.service.issueInvite(owner, sessions.choice), call = sessions.pairing(invite), before = sessions.store.read();
  await assert.rejects(sessions.service.pair(call.request, call.input), code('OPEN_DESKTOP'));
  assert.deepEqual(sessions.store.read(), before);
  assert.equal(sessions.store.read().sessions.filter(item => item.kind === PHONE_SESSION_RECORD_KINDS.session).length, 1);
});

test('phone role mapping stays conservative and explicit non-owner/viewer capabilities never create approval authority', async () => {
  const f = fixture({}, 'cofounder'), { grant } = await f.paired(), principal = await f.service.authenticate(f.request(grant.credential));
  assert.equal(principal.role, 'staff'); assert.equal(f.service.assertPrincipal(principal).role, 'cofounder');
  assert.throws(() => f.service.assertPrincipal(principal, f.store, 'approval.simple'), code('CAPABILITY_FORBIDDEN'));
  await assert.rejects(f.service.issueInvite(owner, { ...f.choice, deviceId: 'phone-b', capabilities: ['approval.simple'] }), code('CAPABILITY_FORBIDDEN'));
  await assert.rejects(f.service.issueInvite({ ...owner, channel: 'phone' }, f.choice), code('CHANNEL_FORBIDDEN'));
  await assert.rejects(f.service.issueInvite({ ...owner, sourceTainted: true }, f.choice), code('CHANNEL_FORBIDDEN'));
  const viewer = fixture({}, 'viewer');
  await assert.rejects(viewer.service.issueInvite(owner, viewer.choice), code('CAPABILITY_FORBIDDEN'));
  const allowed = await viewer.service.issueInvite(owner, { ...viewer.choice, capabilities: ['brief.read'] });
  const pairing = viewer.pairing(allowed), reader = await viewer.service.pair(pairing.request, pairing.input);
  assert.equal((await viewer.service.authenticate(viewer.request(reader.credential))).role, 'staff');
});

test('target and list resolve only explicit current issuer sessions and expose narrow metadata without writer revisions', async () => {
  const f = fixture(), { grant } = await f.paired(), before = f.store.read();
  const target = f.service.target(owner, grant.authority.sessionId);
  assert.deepEqual(target.authority, grant.authority); assert.deepEqual(f.service.assertPrincipal(target, before), { ...owner, channel: 'phone' });
  const rows = f.service.list(owner); assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['binding', 'capabilities', 'channel', 'expiresAt', 'keyId', 'revoked', 'sessionId']);
  assert.equal(rows[0].revoked, false); assert.ok(!JSON.stringify(rows).includes(grant.credential));
  assert.ok(!JSON.stringify(rows).includes(f.choice.devicePublicKey)); assert.deepEqual(f.store.read(), before);
  const tampered = structuredClone(target); tampered.authority.capabilities.push('approval.simple');
  assert.throws(() => f.service.assertPrincipal(tampered), code('ACCESS_REVOKED'));
  await f.service.revoke(target, f.choice.deviceId);
  assert.throws(() => f.service.target(owner, grant.authority.sessionId), code('ACCESS_REVOKED'));
  assert.throws(() => f.service.assertPrincipal(target), code('ACCESS_REVOKED')); assert.equal(f.service.list(owner)[0].revoked, true);
});

test('current member epoch, issuer branch coverage and immutable issued key are rechecked at final release', async () => {
  const f = fixture({}, 'accountant'), { grant } = await f.paired(), principal = await f.service.authenticate(f.request(grant.credential));
  await f.store.update(state => { state.members.find(member => member.id === 'owner')!.branches = ['west']; });
  assert.throws(() => f.service.assertPrincipal(principal), code('CAPABILITY_FORBIDDEN'));
  const g = fixture(), paired = await g.paired(), current = await g.service.authenticate(g.request(paired.grant.credential));
  await g.store.update(state => { state.sessions.find(item => item.kind === PHONE_SESSION_RECORD_KINDS.session).keyId = 'replacement-key'; });
  assert.throws(() => g.service.assertPrincipal(current), code('ACCESS_REVOKED'));
  const h = fixture({}, 'cofounder'), session = await h.paired(), memberPrincipal = await h.service.authenticate(h.request(session.grant.credential));
  await h.store.update(state => { state.members.find(member => member.id === h.memberId)!.epoch++; });
  assert.throws(() => h.service.assertPrincipal(memberPrincipal), code('ACCESS_REVOKED'));
  await assert.rejects(h.service.authenticate(h.request(session.grant.credential)), code('ACCESS_REVOKED'));
  const limited = fixture({}, 'accountant');
  await limited.store.update(state => { state.members.find(member => member.id === 'owner')!.branches = ['west']; });
  await assert.rejects(limited.service.issueInvite(owner, limited.choice), code('CAPABILITY_FORBIDDEN'));
});

test('a new current owner can explicitly replace an unusable issuer grant without erasing the old session identity', async () => {
  const f = fixture({}, 'accountant'), { grant } = await f.paired();
  const other: Context = { memberId: 'owner-b', role: 'owner', epoch: 1, channel: 'desktop' };
  await f.store.update(state => { state.members.push({ id: other.memberId, name: 'Synthetic replacement owner', role: 'owner', active: true, epoch: 1, branches: ['*'] }); });
  assert.throws(() => f.service.target(other, grant.authority.sessionId), code('ACCESS_REVOKED'));
  await new TrustService(f.store).revokeMember(other, 'owner');
  const invite = await f.service.issueInvite(other, f.choice), call = f.pairing(invite);
  const replaced = await f.service.pair(call.request, call.input);
  assert.notEqual(replaced.authority.sessionId, grant.authority.sessionId);
  assert.equal(f.store.read().sessions.filter(item => item.kind === PHONE_SESSION_RECORD_KINDS.session).length, 2);
  await assert.rejects(f.service.authenticate(f.request(grant.credential)), code('ACCESS_REVOKED'));
  assert.equal((await f.service.authenticate(f.request(replaced.credential))).authority.sessionId, replaced.authority.sessionId);
});
