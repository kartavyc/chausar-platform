// TR-14: trustx.hosted reads hosted-link's cached hosted.status for the plan. Synthetic data; the fake hosted
// service is never reached (hosted.status reads only what the vault cached at the last account refresh).
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const passphrase = 'Synthetic hosted plan passphrase';
const ORIGIN = 'https://relay.chausar.test';
const ENTITLED = { plan: 'paid', relay: true, backup: true, backupQuotaBytes: 1048576, backupKeep: 5, allowance: false, allowanceMonthlyPaise: '0', worker: true, monthlyMessages: 30 };
const FREE = { ...ENTITLED, plan: 'free', relay: false, backup: false, worker: false };

async function setup(t: TestContext, o: { configured?: boolean; demo?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-rtt-hosted-')));
  let fetched = 0;
  const fetch = async () => { fetched++; throw new Error('The hosted service is never reached by trustx.hosted.'); };
  const modules = o.configured === false ? undefined : { 'hosted-link': { origin: ORIGIN, fetch, clock: () => new Date('2026-10-14T06:00:00.000Z') } };
  const engine = o.demo ? new Engine({ directory, demo: true, storage: 'experimental-file', modules })
    : new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), modules });
  t.after(async () => { try { await engine.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Hosted Plan Shop', passphrase, demo: !!o.demo, pack: 'services' });
  const rpc = (method: string, payload: Record<string, unknown> = {}) => engine.requestAs(owner, method, payload);
  /** Writes what hosted-link would cache after pairing and an account refresh. */
  const cache = (plan: 'free' | 'paid' | null) => engine.vault!.update((state: any) => {
    const ns = ((state.extensions ??= {})['hosted-link'] ??= {});
    ns.pairing = { accountId: 'acct_synthetic', deviceId: 'dev_synthetic', sessionToken: 'synthetic-session', pairedAt: '2026-10-01T00:00:00.000Z', phoneMasked: '+91******3210', sessionExpiresAt: '2026-11-01T00:00:00.000Z' };
    ns.relayKey = Buffer.alloc(32, 7).toString('base64');
    ns.account = plan === null ? null : { plan, entitlements: plan === 'paid' ? ENTITLED : FREE, deviceCount: 1, refreshedAt: '2026-10-14T05:00:00.000Z' };
  });
  return { engine, rpc, cache, fetched: () => fetched };
}

test('not set up, demo or unpaired: every paid part is planned, not available', async t => {
  const plain = await setup(t, { configured: false });
  const a = await plain.rpc('trustx.hosted');
  assert.equal(a.plan, 'planned-not-available');
  assert.deepEqual(a.hosted, { state: 'not-configured', refreshedAt: null, entitlements: null });
  assert.ok(a.jobs.every((job: any) => job.on === false));

  const demo = await setup(t, { demo: true });
  const b = await demo.rpc('trustx.hosted');
  assert.equal(b.plan, 'planned-not-available'); assert.equal(b.hosted.state, 'demo');

  const configured = await setup(t);
  const c = await configured.rpc('trustx.hosted');
  assert.equal(c.plan, 'planned-not-available'); assert.equal(c.hosted.state, 'not-paired');
  await configured.cache(null);
  const d = await configured.rpc('trustx.hosted');
  assert.equal(d.plan, 'planned-not-available'); assert.deepEqual(d.hosted, { state: 'paired', refreshedAt: null, entitlements: null });
  assert.equal(configured.fetched(), 0);
});

test('a free account that was never paid is planned; paid shows paid; paid then free is "ended"', async t => {
  const f = await setup(t);
  await f.cache('free');
  const never = await f.rpc('trustx.hosted');
  assert.equal(never.plan, 'planned-not-available');
  assert.deepEqual(never.hosted.entitlements, { backup: false, worker: false, relay: false, allowance: false });

  await f.cache('paid');
  const paid = await f.rpc('trustx.hosted');
  assert.equal(paid.plan, 'paid');
  assert.deepEqual(paid.hosted, { state: 'paired', refreshedAt: '2026-10-14T05:00:00.000Z', entitlements: { backup: true, worker: true, relay: true, allowance: false } });
  const seen = (f.engine.vault!.read().extensions as any)['reports-tools-trust'].tools.hosted.paidSeenAt;
  assert.ok(typeof seen === 'string' && Number.isFinite(Date.parse(seen)));

  await f.cache('free');
  const ended = await f.rpc('trustx.hosted');
  assert.equal(ended.plan, 'ended');
  // Reading again keeps the first time the paid plan was seen; nothing else is written.
  assert.equal((f.engine.vault!.read().extensions as any)['reports-tools-trust'].tools.hosted.paidSeenAt, seen);
  assert.equal(f.fetched(), 0);
});

test('a cached account that is not understood reads as paired with no plan', async t => {
  const f = await setup(t);
  await f.cache('paid');
  await f.engine.vault!.update((state: any) => { state.extensions['hosted-link'].account.plan = 'gold'; });
  const reply = await f.rpc('trustx.hosted');
  assert.equal(reply.plan, 'planned-not-available');
  assert.deepEqual(reply.hosted, { state: 'paired', refreshedAt: null, entitlements: null });
});
