import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { insertFacts } from '../runtime/memory.ts';
import type { Context } from '../runtime/contracts.ts';

const september = { from: '2026-09-01', to: '2026-09-30' };
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
  // The owner adds a member and hands over a session for that member.
  async function member(name: string, role: Context['role'], branches: string[]) {
    const added = await rpc('members.add', { name, role, branches }); assert.equal(added.status, 200);
    const session = await rpc('auth.session', { memberId: added.result.id }); assert.equal(session.status, 200);
    return { member: added.result, token: session.result.token as string, sessionId: session.result.sessionId as string };
  }
  return { engine, app, origin, token, rpc, member };
}

test('HTTP member sessions enforce current roles and end with the session or the member', async t => {
  const { rpc, member, engine } = await fixture(t);
  const viewer = await member('Delhi reader', 'viewer', ['Delhi']);
  const read = await rpc('trust.get', {}, viewer.token); assert.equal(read.status, 200);
  assert.equal((await rpc('trust.update', { send: 'shape' }, viewer.token)).status, 403);
  assert.equal((await rpc('workspace.lock', {}, viewer.token)).status, 403);
  assert.equal((await rpc('members.add', { name: 'Escalation', role: 'owner' }, viewer.token)).status, 403);
  assert.equal((await rpc('auth.session', { memberId: 'owner' }, viewer.token)).status, 403);
  const rotated = await rpc('auth.session', {}, viewer.token); assert.equal(rotated.status, 200);
  assert.equal((await rpc('auth.revoke', { sessionId: viewer.sessionId })).status, 200);
  assert.equal((await rpc('trust.get', {}, viewer.token)).status, 401);
  assert.equal((await rpc('trust.get', {}, rotated.result.token)).status, 200);
  assert.equal((await rpc('members.revoke', { id: viewer.member.id })).status, 200);
  assert.equal((await rpc('trust.get', {}, rotated.result.token)).status, 401);
  assert.equal(engine.context.memberId, 'owner');
});

test('overlapping real HTTP member requests retain independent async contexts and branch filters', async t => {
  const { rpc, member, engine } = await fixture(t);
  await engine.vault!.update(state => { insertFacts(state, [
    { entityId: 'mumbai-sale', sourceId: 'shop-file', sourceRow: 1, kind: 'sale', validFrom: '2026-09-01', branch: 'Mumbai', fields: { amountMinor: '10000', currency: 'INR', customerId: 'mumbai-customer' } },
    { entityId: 'delhi-sale', sourceId: 'shop-file', sourceRow: 2, kind: 'sale', validFrom: '2026-09-01', branch: 'Delhi', fields: { amountMinor: '20000', currency: 'INR', customerId: 'delhi-customer' } },
  ], new Date().toISOString()); });
  const mumbai = await member('Mumbai accountant', 'accountant', ['Mumbai']);
  const delhi = await member('Delhi accountant', 'accountant', ['Delhi']);
  const original = engine.services.calculator.calculate.bind(engine.services.calculator);
  let arrivals = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  engine.services.calculator.calculate = async (context: Context, request: any) => {
    const before = engine.context.memberId;
    if (++arrivals === 2) release();
    await barrier;
    const after = engine.context.memberId;
    return { ...await original(context, request), observedContext: { before, after } };
  };
  const earned = (bearer: string) => rpc('calculation.run', { operation: 'earned', period: september }, bearer);
  const [left, right] = await Promise.all([earned(mumbai.token), earned(delhi.token)]);
  assert.equal(left.status, 200); assert.equal(right.status, 200);
  assert.equal(left.result.totalMinor, '10000');
  assert.equal(right.result.totalMinor, '20000');
  assert.deepEqual(left.result.observedContext, { before: mumbai.member.id, after: mumbai.member.id });
  assert.deepEqual(right.result.observedContext, { before: delhi.member.id, after: delhi.member.id });
  assert.equal(engine.context.memberId, 'owner');
});

test('revoking a member during an awaited HTTP request withholds the result under its old epoch', async t => {
  const { rpc, member, engine } = await fixture(t);
  const accountant = await member('Revoked accountant', 'accountant', ['*']);
  const original = engine.services.calculator.calculate.bind(engine.services.calculator);
  let entered!: () => void; let resume!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { resume = resolve; });
  engine.services.calculator.calculate = async (context: Context, request: any) => { entered(); await paused; return original(context, request); };
  const pending = rpc('calculation.run', { operation: 'earned', period: september }, accountant.token); await started;
  assert.equal((await rpc('members.revoke', { id: accountant.member.id })).status, 200);
  resume(); const result = await pending;
  assert.equal(result.status, 400); assert.equal(result.error.code, 'ACCESS_REVOKED'); assert.equal(result.result, undefined);
  assert.equal((await rpc('trust.get', {}, accountant.token)).status, 401);
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

test('the draft methods need the trusted local owner bootstrap session, never a member session', async t => {
  const { rpc, member } = await fixture(t);
  const cofounder = await member('Partner', 'cofounder', ['*']);
  const methods = ['venture.ai.options', 'venture.ai.connect', 'venture.ai.disconnect', 'venture.ai.status', 'venture.country.suggest'];
  for (const method of methods) {
    const refused = await rpc(method, {}, cofounder.token);
    assert.equal(refused.status, 403, method);
    assert.equal(refused.error?.code ?? refused.code, 'FORBIDDEN', method);
  }
  const options = await rpc('venture.ai.options', {});
  assert.equal(options.status, 200);
  assert.deepEqual(options.result.options.map((option: any) => option.id), ['api-key', 'claude-code', 'codex', 'chatgpt-sign-in']);
  assert.deepEqual((await rpc('venture.ai.status', {})).result.connections, []);
});

test('the ten custody methods need the trusted local owner bootstrap session, never a member session', async t => {
  const { rpc, member } = await fixture(t);
  const { CUSTODY_METHODS } = await import('../runtime/workspace-custody-contracts.ts');
  const { BOOTSTRAP_ONLY_METHODS } = await import('../runtime/server.ts');
  for (const method of CUSTODY_METHODS) assert.ok(BOOTSTRAP_ONLY_METHODS.includes(method), method);
  const cofounder = await member('Partner', 'cofounder', ['*']);
  for (const method of CUSTODY_METHODS) {
    const refused = await rpc(method, {}, cofounder.token);
    assert.equal(refused.status, 403, method);
    assert.equal(refused.error?.code, 'FORBIDDEN', method);
  }
  const custody = await rpc('workspace.custody.get', {});
  assert.equal(custody.status, 200);
  assert.equal(custody.result.computer.reason, 'not-configured', 'this test engine is composed without workspaceCustody');
  const list = await rpc('workspace.list', {});
  assert.equal(list.status, 200); assert.deepEqual(list.result.businesses.map((row: any) => row.folder), ['main']);
});

test('a DEVICE_KEYS_UNAVAILABLE answer carries its reason beside the words', async t => {
  const { rpc } = await fixture(t);
  await rpc('workspace.lock', {});
  const refused = await rpc('workspace.create', { name: 'No keys here', pack: 'services', folder: null });
  assert.equal(refused.status, 400);
  assert.equal(refused.error.code, 'DEVICE_KEYS_UNAVAILABLE');
  assert.equal(refused.error.reason, 'not-configured');
});
