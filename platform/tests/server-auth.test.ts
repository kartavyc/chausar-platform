import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Context } from '../runtime/contracts.ts';

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-session-http-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function rpc(method: string, payload: any = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, ...(await response.json() as any) };
  }
  assert.equal((await rpc('workspace.create', { name: 'Member access test', passphrase: 'long-enough-passphrase', demo: false })).status, 200);
  async function member(name: string, role: Context['role'], branches: string[]) {
    const invitation = await rpc('auth.invite', { name, role, branches }); assert.equal(invitation.status, 200);
    const accepted = await rpc('auth.accept', { token: invitation.result.token }); assert.equal(accepted.status, 200);
    return accepted.result;
  }
  return { engine, app, origin, token, rpc, member };
}

test('HTTP invitation sessions enforce current roles and expose metadata without token hashes', async t => {
  const { rpc, member, engine } = await fixture(t);
  const viewer = await member('Delhi reader', 'viewer', ['Delhi']);
  const read = await rpc('memory.list', {}, viewer.token); assert.equal(read.status, 200);
  assert.equal((await rpc('trust.update', { send: 'shape' }, viewer.token)).status, 403);
  assert.equal((await rpc('workspace.lock', {}, viewer.token)).status, 403);
  assert.equal((await rpc('auth.invite', { name: 'Escalation', role: 'owner' }, viewer.token)).status, 403);
  assert.equal((await rpc('auth.accept', { token: viewer.token }, viewer.token)).status, 403);
  assert.equal((await rpc('auth.session', { memberId: 'owner' }, viewer.token)).status, 403);
  const ownSessions = await rpc('auth.sessions', {}, viewer.token);
  assert.equal(ownSessions.status, 200); assert.ok(ownSessions.result.every((s: any) => s.memberId === viewer.member.id));
  assert.ok(ownSessions.result.every((s: any) => !('tokenHash' in s) && !('token' in s)));
  const rotated = await rpc('auth.session', {}, viewer.token); assert.equal(rotated.status, 200);
  assert.equal((await rpc('auth.revoke', { sessionId: viewer.sessionId })).status, 200);
  assert.equal((await rpc('memory.list', {}, viewer.token)).status, 401);
  assert.equal((await rpc('memory.list', {}, rotated.result.token)).status, 200);
  assert.equal((await rpc('members.revoke', { id: viewer.member.id })).status, 200);
  assert.equal((await rpc('memory.list', {}, rotated.result.token)).status, 401);
  assert.equal(engine.context.memberId, 'owner');
});

test('overlapping real HTTP member requests retain independent async contexts and branch filters', async t => {
  const { rpc, member, engine } = await fixture(t);
  await engine.services.memory.append(engine.context, [
    { entityId: 'mumbai-sale', sourceId: 'shop-file', sourceRow: 1, kind: 'sale', validFrom: '2026-09-01', branch: 'Mumbai', fields: { amountMinor: '10000', currency: 'INR', customerId: 'mumbai-customer' } },
    { entityId: 'delhi-sale', sourceId: 'shop-file', sourceRow: 2, kind: 'sale', validFrom: '2026-09-01', branch: 'Delhi', fields: { amountMinor: '20000', currency: 'INR', customerId: 'delhi-customer' } },
  ]);
  const mumbai = await member('Mumbai accountant', 'accountant', ['Mumbai']);
  const delhi = await member('Delhi accountant', 'accountant', ['Delhi']);
  const original = engine.services.memory.query.bind(engine.services.memory);
  let arrivals = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  engine.services.memory.query = async (context: Context, filter: any) => {
    const before = engine.context.memberId;
    if (++arrivals === 2) release();
    await barrier;
    const after = engine.context.memberId;
    return { ...original(context, filter), observedContext: { before, after } };
  };
  const [left, right] = await Promise.all([rpc('memory.list', {}, mumbai.token), rpc('memory.list', {}, delhi.token)]);
  assert.equal(left.status, 200); assert.equal(right.status, 200);
  assert.deepEqual(left.result.facts.map((f: any) => f.branch), ['Mumbai']);
  assert.deepEqual(right.result.facts.map((f: any) => f.branch), ['Delhi']);
  assert.deepEqual(left.result.observedContext, { before: mumbai.member.id, after: mumbai.member.id });
  assert.deepEqual(right.result.observedContext, { before: delhi.member.id, after: delhi.member.id });
  assert.equal(engine.context.memberId, 'owner');
});

test('revoking a member during an awaited HTTP request withholds the result under its old epoch', async t => {
  const { rpc, member, engine } = await fixture(t);
  const accountant = await member('Revoked accountant', 'accountant', ['*']);
  const original = engine.services.memory.query.bind(engine.services.memory);
  let entered!: () => void; let resume!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { resume = resolve; });
  engine.services.memory.query = async (context: Context, filter: any) => { entered(); await paused; return original(context, filter); };
  const pending = rpc('memory.list', {}, accountant.token); await started;
  assert.equal((await rpc('members.revoke', { id: accountant.member.id })).status, 200);
  resume(); const result = await pending;
  assert.equal(result.status, 400); assert.equal(result.error.code, 'ACCESS_REVOKED'); assert.equal(result.result, undefined);
  assert.equal((await rpc('memory.list', {}, accountant.token)).status, 401);
});

test('HTTP encrypted sync requires administrators and a configured transport, and stays experimental', async t => {
  const { rpc, member } = await fixture(t);
  const viewer = await member('Sync reader', 'viewer', ['*']);
  for (const method of ['sync.status', 'sync.identity', 'sync.enable', 'sync.preview', 'sync.approve', 'sync.push', 'sync.pull', 'sync.trust', 'sync.writer.status', 'sync.writer.review', 'sync.reconcile']) {
    assert.equal((await rpc(method, { enabled: true }, viewer.token)).status, 403, method);
  }
  const status = await rpc('sync.status'); assert.equal(status.status, 200);
  assert.equal(status.result.enabled, false); assert.equal(status.result.transport, null); assert.equal(status.result.experimental, true);
  assert.equal(status.result.verification, 'no-real-second-device-test');
  assert.equal((await rpc('sync.preview')).error.code, 'SYNC_DISABLED');
  const identity = await rpc('sync.identity'); assert.equal(identity.status, 200); assert.match(identity.result.publicKey, /^-----BEGIN PUBLIC KEY-----/); assert.equal(identity.result.privateKey, undefined);
  const enable = await rpc('sync.enable', { enabled: true });
  assert.equal(enable.status, 400);
  assert.equal(enable.error.code, 'SYNC_WRITER_ADMISSION_REQUIRED');
  assert.equal((await rpc('sync.status')).result.enabled, false);
  assert.equal((await rpc('sync.preview')).error.code, 'SYNC_DISABLED');
});

test('loopback bootstrap discovery rejects cross-site browser fetch metadata', async t => {
  const { origin } = await fixture(t);
  const response = await fetch(`${origin}/api/session`, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(response.status, 403); assert.equal((await response.json() as any).error.code, 'INVALID_ORIGIN');
});

test('owner token validation never discloses bootstrap credentials to anonymous or member callers', async t => {
  const { origin, token, member } = await fixture(t);
  const viewer = await member('Paired viewer', 'viewer', ['*']);
  const anonymous = await fetch(`${origin}/api/session`); assert.equal(anonymous.status, 401); assert.equal((await anonymous.json() as any).token, undefined);
  const scoped = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${viewer.token}` } }); assert.equal(scoped.status, 401); assert.equal((await scoped.json() as any).token, undefined);
  const owner = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } }); assert.equal(owner.status, 200); assert.equal((await owner.json() as any).token, token);
});
