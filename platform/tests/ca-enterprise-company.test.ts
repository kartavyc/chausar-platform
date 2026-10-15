import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Context } from '../runtime/contracts.ts';

// Synthetic workspace only; no network.
const code = (name: string) => (e: any) => { assert.equal(e.code, name, e.message); return true; };
const SUBS = ['signin', 'health', 'recovery', 'keys', 'support', 'computers', 'quality', 'build', 'licence'];

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ca-enterprise-company-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', version: '0.1.0-preview.1' });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function rpc(method: string, payload: any = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as any; assert.equal(response.status, 200, `${method}: ${JSON.stringify(body.error)}`); return body.result;
  }
  await rpc('workspace.create', { name: 'Synthetic installation', passphrase: 'Synthetic-company-fixture', demo: false });
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  async function member(name: string, role: string): Promise<Context> {
    const invite = await rpc('auth.invite', { name, role }); const accepted = await rpc('auth.accept', { token: invite.token }); return { ...accepted.context, channel: 'desktop' };
  }
  const as = (ctx: Context, method: string, payload: any = {}) => engine.requestAs(ctx, method, payload);
  return { engine, rpc, member, as, owner };
}
const isFactValue = (v: unknown) => v === null || typeof v === 'boolean' || (Number.isSafeInteger(v) && (v as number) >= 0) || (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.+:-]{0,63}$/.test(v));

test('company.overview answers one entry per Company sub, each from what the engine says', async t => {
  const f = await fixture(t);
  await assert.rejects(f.as(f.owner, 'company.overview'), code('ENTERPRISE_NOT_ON'));
  await f.as(f.owner, 'enterprise.setup', { on: true });
  await f.as(f.owner, 'workspace.backup');
  const { subs } = await f.as(f.owner, 'company.overview');
  assert.deepEqual(subs.map((s: any) => s.id), SUBS);
  const by = Object.fromEntries(subs.map((s: any) => [s.id, s]));
  for (const s of subs) {
    assert.ok(['ready', 'not-built', 'needs-founder', 'out-of-service'].includes(s.state), s.id);
    assert.equal(s.state === 'ready', s.code === null, s.id);
    for (const fact of s.facts) { assert.match(fact.key, /^[a-zA-Z.-]+$/); assert.ok(isFactValue(fact.value), `${s.id}.${fact.key}: ${fact.value}`); }
  }
  assert.deepEqual(by.signin, { id: 'signin', state: 'not-built', code: 'ENTERPRISE_SERVER_ONLY', facts: [] });
  assert.deepEqual(by.support, { id: 'support', state: 'needs-founder', code: 'ENTERPRISE_SUPPORT_ACCESS_NEEDS_FOUNDER', facts: [] });
  assert.deepEqual(by.licence, { id: 'licence', state: 'needs-founder', code: 'ENTERPRISE_LICENCE_NEEDS_FOUNDER', facts: [] });
  // Health probes each engine family; every one answers in this build.
  assert.equal(by.health.state, 'ready');
  assert.deepEqual(by.health.facts.map((x: any) => x.key), ['workspace', 'sources', 'jobs', 'actions', 'models', 'trust', 'jobs-ext', 'bench', 'hosted', 'sync']);
  assert.ok(by.health.facts.every((x: any) => x.value === 'ready'), JSON.stringify(by.health.facts));
  // Recovery counts this engine's own encrypted copies; nothing is paired with a hosted backup.
  assert.equal(by.recovery.state, 'ready');
  const recovery = Object.fromEntries(by.recovery.facts.map((x: any) => [x.key, x.value]));
  assert.equal(recovery.localCopies, 1); assert.ok(!Number.isNaN(Date.parse(recovery.lastLocalCopyAt))); assert.equal(recovery.hostedPaired, false);
  // Without the installed app's resources the custody helper report is refused: out of service with the release lane's code.
  assert.deepEqual(by.keys, { id: 'keys', state: 'out-of-service', code: 'KEYCHAIN_STATUS_INVALID', facts: [] });
  // core-sync-jobs' device list answers: this computer's sync switch, and no machines while sync is off.
  assert.deepEqual(by.computers, { id: 'computers', state: 'ready', code: null, facts: [{ key: 'syncEnabled', value: false }, { key: 'syncTransport', value: false },
    { key: 'syncMode', value: 'single-writer' }, { key: 'devices', value: 0 }] });
  assert.deepEqual(by.quality, { id: 'quality', state: 'ready', code: null, facts: [{ key: 'benchRuns', value: 0 }, { key: 'lastBenchAt', value: null }, { key: 'lastBenchPassed', value: null }] });
  assert.equal(by.build.state, 'ready');
  assert.deepEqual(by.build.facts, [{ key: 'version', value: '0.1.0-preview.1' }, { key: 'storage', value: 'experimental-file' }, { key: 'channel', value: 'stable' },
    { key: 'updatesConfigured', value: false }, { key: 'vaultCompatible', value: true }]);
});

test('company.overview is for administrators only', async t => {
  const f = await fixture(t);
  const acc = await f.member('Synthetic Accountant', 'accountant'); const viewer = await f.member('Synthetic Viewer', 'viewer'); const co = await f.member('Synthetic Cofounder', 'cofounder');
  await f.as(f.owner, 'enterprise.setup', { on: true });
  for (const ctx of [acc, viewer]) await assert.rejects(f.as(ctx, 'company.overview'), code('FORBIDDEN'));
  await assert.rejects(f.as(co, 'company.overview'), code('ENTERPRISE_NOT_ADMINISTRATOR'));
  await f.as(f.owner, 'enterprise.access.set', { memberId: co.memberId, administers: true });
  assert.equal((await f.as(co, 'company.overview')).subs.length, 9);
});
