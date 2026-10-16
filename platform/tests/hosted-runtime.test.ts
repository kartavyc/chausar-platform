// Hosted tier: the venture runtime contract. The same conformance checks run on the local actor runtime, on the Rivet
// adapter over an in-memory stand-in, and on the local runtime with business vaults in PostgreSQL: over the PostgreSQL
// stand-in always, and over a real server when CHAUSAR_TEST_POSTGRES_URL points at a disposable loopback database.
// Every actor is a real Engine over a real encrypted vault; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError } from '../runtime/contracts.ts';
import { loopbackPostgresUrl, openLoopbackPool, type PostgresPool } from '../runtime/postgres.ts';
import { HostedCustody, newBusinessId, newTenantId, type Sealed } from '../runtime/hosted/custody.ts';
import { prepareHostedTables } from '../runtime/hosted/directory.ts';
import { hostedVaultSlot } from '../runtime/hosted/runtime/business.ts';
import { ACTOR_ACTIONS, ACTOR_EVENTS, type ActorEvent, type ActorKey, type VentureRuntime } from '../runtime/hosted/runtime/contract.ts';
import { LocalVentureRuntime } from '../runtime/hosted/runtime/local.ts';
import { RIVET_DESCRIPTOR, RivetVentureRuntime, rivetActionName, ventureActorConfig } from '../runtime/hosted/runtime/rivet.ts';
import type { ModelTransport } from '../runtime/venture/contracts.ts';
import { createPostgresStandIn } from './hosted-postgres-standin.ts';
import { createRivetStandIn } from './hosted-rivet-standin.ts';

const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';
const API_KEY = 'sk-ant-test-not-a-real-key-0000';
const web = { channel: 'web' } as const;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };

export const noNetwork: ModelTransport = {
  replay: false,
  async http() { throw new ChausarError('MODEL_FAILED', 'No network in tests.'); },
  async process() { throw new ChausarError('MODEL_FAILED', 'No processes in tests.'); },
};

type Kind = 'local' | 'rivet' | 'local-postgres' | 'local-real-postgres';
const POSTGRES_URL = process.env.CHAUSAR_TEST_POSTGRES_URL;
const skipFor = (kind: Kind) => kind === 'local-real-postgres' && !POSTGRES_URL ? 'set CHAUSAR_TEST_POSTGRES_URL to a disposable loopback database to run this' : false;

type Harness = {
  name: string; runtime: VentureRuntime; root: string;
  key(tenant?: string): ActorKey;
  create(key: ActorKey, name: string): Promise<{ recoveryCode: string }>;
  forget(key: ActorKey): void;
  sleep(): Promise<void>;
  /** On PostgreSQL, whether the business's vault row exists. Null on file storage. */
  hasRow(key: ActorKey): Promise<boolean | null>;
};

async function waitFor(condition: () => boolean, label: string) {
  for (let i = 0; i < 100 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(condition(), label);
}

async function harness(t: any, kind: Kind): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), `chausar-hosted-runtime-${kind}-`));
  const custody = HostedCustody.fromKey(randomBytes(32).toString('base64url'));
  const sealed = new Map<string, Sealed>();
  const id = (key: ActorKey) => `${key[0]}/${key[1]}`;
  const passphrase = async (key: ActorKey) => {
    const value = sealed.get(id(key));
    if (!value) throw new ChausarError('BUSINESS_NOT_FOUND', 'That business is not on your account.');
    return custody.unwrapPassphrase(key[0], key[1], value);
  };
  let postgres: PostgresPool | undefined;
  const slots = new Set<string>();
  if (kind === 'local-postgres') postgres = createPostgresStandIn().pool;
  if (kind === 'local-real-postgres') {
    const pool = postgres = await openLoopbackPool(loopbackPostgresUrl(POSTGRES_URL!), 'chausar-test');
    t.after(async () => {
      try { if (slots.size) await pool.query('DELETE FROM public.chausar_vault_authority WHERE slot = ANY($1)', [[...slots]]); }
      finally { await pool.end(); }
    });
  }
  if (postgres) await prepareHostedTables(postgres);
  const engineOptions = () => ({ demo: true, storage: postgres ? 'postgres' as const : 'experimental-file' as const, venture: { host: 'hosted-web' as const, modelTransport: noNetwork } });
  let now = Date.parse('2026-10-16T09:00:00.000Z');
  let runtime: VentureRuntime, sleep: () => Promise<void>;
  if (kind !== 'rivet') {
    const local = new LocalVentureRuntime({ root, engineOptions, passphrase, idleMs: 60_000, maxAwake: 3, clock: () => now, postgres });
    runtime = local;
    sleep = async () => { now += 61_000; await local.sleepIdle(); };
  } else {
    const standIn = createRivetStandIn(ventureActorConfig(() => ({}), { root, engineOptions, passphrase, idleMs: 60_000 }));
    runtime = new RivetVentureRuntime(standIn.client);
    sleep = () => standIn.sleepAll();
  }
  t.after(async () => { await sleep().catch(() => {}); await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const tenant = newTenantId();
  return {
    name: kind, runtime, root, sleep,
    key: (owner = tenant) => [owner, newBusinessId()] as const,
    async create(key, name) {
      slots.add(hostedVaultSlot(key));
      const secret = custody.newVaultPassphrase();
      sealed.set(id(key), custody.wrapPassphrase(key[0], key[1], secret));
      return runtime.create(key, { name, passphrase: secret });
    },
    forget(key) { sealed.delete(id(key)); },
    async hasRow(key) {
      if (!postgres) return null;
      return (await postgres.query('SELECT revision, envelope FROM public.chausar_vault_authority WHERE slot = $1', [hostedVaultSlot(key)])).rows.length === 1;
    },
  };
}

for (const kind of ['local', 'rivet', 'local-postgres', 'local-real-postgres'] as const) {
  test(`${kind} runtime: one actor per business, created once, acting through declared actions only`, { skip: skipFor(kind) }, async t => {
    const h = await harness(t, kind);
    const key = h.key();
    const created = await h.create(key, 'Ledger Cafe Books');
    assert.match(created.recoveryCode, /^CHR-/);
    await assert.rejects(h.create(key, 'Again'), code('BUSINESS_EXISTS'));

    const actor = h.runtime.get(key);
    assert.equal((await actor.action('workspace.status', {}, web) as any).workspace.name, 'Ledger Cafe Books');
    const view = await actor.action('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' }, web) as any;
    assert.equal((await actor.action('venture.get', {}, web) as any).venture.id, view.venture.id);

    await assert.rejects(actor.action('workspace.backup', {}, web), code('ACTION_NOT_DECLARED'));
    await assert.rejects(actor.action('sources.import', {}, web), code('ACTION_NOT_DECLARED'));
    await assert.rejects(actor.action('venture.get', {}, { channel: 'desktop' } as any), code('FORBIDDEN'));
    assert.throws(() => actor.on('not-an-event', () => {}), code('EVENT_NOT_DECLARED'));
  });

  test(`${kind} runtime: declared events reach listeners, and a failed action changes nothing`, { skip: skipFor(kind) }, async t => {
    const h = await harness(t, kind);
    const key = h.key();
    await h.create(key, 'Event Books');
    const actor = h.runtime.get(key);
    const heard: ActorEvent[] = [];
    const off = actor.on('venture-created', event => heard.push(event));
    actor.on('blueprint-drafted', event => heard.push(event));
    await actor.action('venture.create', { idea: IDEA, countryCode: 'IN' }, web);
    await waitFor(() => heard.some(event => event.name === 'venture-created'), 'venture-created was heard');
    const first = heard.find(event => event.name === 'venture-created')!;
    assert.ok(first.seq >= 1 && typeof first.at === 'string');
    off();

    const before = await actor.action('venture.events', { limit: 100 }, web) as any;
    await assert.rejects(actor.action('venture.blueprint.accept', { digest: 'not-the-digest' }, web));
    const after = await actor.action('venture.events', { limit: 100 }, web) as any;
    assert.equal(after.lastSeq, before.lastSeq);
  });

  test(`${kind} runtime: a sleeping business wakes with its records and without the keys typed into it`, { skip: skipFor(kind) }, async t => {
    const h = await harness(t, kind);
    const key = h.key();
    await h.create(key, 'Sleepy Books');
    const actor = h.runtime.get(key);
    const view = await actor.action('venture.create', { idea: IDEA, countryCode: 'IN' }, web) as any;
    const presets = await actor.action('venture.models.presets', {}, web) as any[];
    const haiku = presets.find(p => p.id === 'anthropic-haiku-5-5');
    const status = await actor.action('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: haiku.consentDigest, apiKey: API_KEY, tiers: ['fast'] }, web) as any;
    assert.equal(status.connections[0].keyLoaded, true);

    await h.sleep();
    if (kind === 'local') assert.equal(h.runtime.state(key), 'asleep');
    const again = await actor.action('venture.get', {}, web) as any;
    assert.equal(again.venture.id, view.venture.id);
    const woke = await actor.action('venture.models.status', {}, web) as any;
    assert.equal(woke.connections[0].keyLoaded, false, 'keys live in memory only and go when the business sleeps');
  });

  test(`${kind} runtime: command-line AI never runs on the hosted server`, { skip: skipFor(kind) }, async t => {
    const h = await harness(t, kind);
    const key = h.key();
    await h.create(key, 'Key Only Books');
    const actor = h.runtime.get(key);
    await actor.action('venture.create', { idea: IDEA, countryCode: 'IN' }, web);
    const presets = await actor.action('venture.models.presets', {}, web) as any[];
    for (const id of ['claude-code-cli', 'codex-cli']) {
      const preset = presets.find(p => p.id === id);
      assert.equal(preset.availability, 'unavailable', id);
      assert.match(preset.availabilityReason, /desktop app/);
      await assert.rejects(actor.action('venture.models.connect', { presetId: id, consentDigest: preset.consentDigest }, web), code('PRESET_UNAVAILABLE'));
    }
    const capabilities = await actor.action('venture.capabilities', {}, web) as any[];
    assert.equal(capabilities.find(row => row.id === 'hosted-actors').state, 'unverified');
    assert.equal(capabilities.find(row => row.id === 'tier-container').state, 'unavailable');
    // Agent-written code and PDF reading stay off on a shared server (the delivery harness refuses them there too).
    assert.equal(capabilities.find(row => row.id === 'tier-wasm-lite').state, 'unavailable');
    assert.match(capabilities.find(row => row.id === 'agent-tools').reason, /can't read PDFs or run code they write/);
    // File storage says planned; PostgreSQL on the hosted server says experimental until a real deploy is tested.
    assert.equal(capabilities.find(row => row.id === 'durable-storage').state, kind.endsWith('postgres') ? 'unverified' : 'planned');
  });

  test(`${kind} runtime: tenants and businesses never see each other`, { skip: skipFor(kind) }, async t => {
    const h = await harness(t, kind);
    const mine = h.key(), theirs = h.key(newTenantId());
    await h.create(mine, 'Mine Books');
    await h.create(theirs, 'Theirs Books');
    await h.runtime.get(mine).action('venture.create', { idea: IDEA, countryCode: 'IN' }, web);
    assert.equal(await h.runtime.get(theirs).action('venture.get', {}, web), null);
    assert.equal((await h.runtime.get(theirs).action('workspace.status', {}, web) as any).workspace.name, 'Theirs Books');
    assert.deepEqual((await readdir(h.root)).sort(), [mine[0], theirs[0]].sort());
    assert.deepEqual(await readdir(join(h.root, mine[0])), [mine[1]]);
    assert.throws(() => h.runtime.get(['../x', mine[1]] as any), code('INVALID_ACTOR_KEY'));
    assert.throws(() => h.runtime.get([mine[0], '..'] as any), code('INVALID_ACTOR_KEY'));
  });

  test(`${kind} runtime: destroy needs the business name, then the vault and its folder are gone`, { skip: skipFor(kind) }, async t => {
    const h = await harness(t, kind);
    const key = h.key();
    await h.create(key, 'Short Lived');
    await assert.rejects(h.runtime.destroy(key, 'Wrong Name'), code('CONFIRMATION_REQUIRED'));
    assert.equal((await h.runtime.get(key).action('workspace.status', {}, web) as any).workspace.name, 'Short Lived');
    assert.notEqual(await h.hasRow(key), false);
    await h.runtime.destroy(key, 'Short Lived');
    assert.notEqual(await h.hasRow(key), true, 'on PostgreSQL the vault row is gone too');
    h.forget(key);
    await assert.rejects(stat(join(h.root, key[0], key[1])), (error: any) => error.code === 'ENOENT');
    await assert.rejects(h.runtime.get(key).action('workspace.status', {}, web), code('BUSINESS_NOT_FOUND'));
  });
}

test('the local runtime keeps at most maxAwake businesses awake, sleeping the one idle longest to make room', async t => {
  const h = await harness(t, 'local');
  const keys = [h.key(), h.key(), h.key(), h.key()];
  for (const [index, key] of keys.entries()) await h.create(key, `Business ${index}`);
  const awake = () => keys.filter(key => h.runtime.state(key) === 'awake').length;
  assert.equal(awake(), 3, 'the oldest idle business slept to make room');
  assert.equal(h.runtime.state(keys[0]), 'asleep');
  await h.runtime.get(keys[0]).action('workspace.status', {}, web);
  assert.equal(h.runtime.state(keys[0]), 'awake');
  assert.equal(awake(), 3);
});

test('the local runtime describes itself honestly: nothing hosted claims available except atomic commits', () => {
  const descriptor = new LocalVentureRuntime({ root: tmpdir(), engineOptions: () => ({ demo: true, storage: 'experimental-file' }), passphrase: async () => '', idleMs: 60_000, maxAwake: 1 }).descriptor;
  assert.equal(descriptor.apiVersion, 'chausar.dev/venture-runtime/v1alpha1');
  assert.deepEqual(descriptor.events, ACTOR_EVENTS);
  assert.ok(descriptor.actions.includes('venture.blueprint.accept') && !descriptor.actions.includes('venture.preview') && !descriptor.actions.includes('workspace.delete'));
  assert.deepEqual(descriptor.capabilities.filter(c => c.state === 'available').map(c => c.capability), ['state.atomic']);
  for (const name of ['schedule', 'cron', 'queue', 'workflow']) assert.equal(descriptor.capabilities.find(c => c.capability === name)?.state, 'planned');
});

test('the Rivet adapter says planned for everything and names its actions without dots', () => {
  assert.ok(RIVET_DESCRIPTOR.capabilities.every(c => c.state === 'planned' && /stand-in/.test(c.reason)));
  assert.equal(rivetActionName('venture.blueprint.accept'), 'venture_blueprint_accept');
  const config = ventureActorConfig(() => ({}), { root: tmpdir(), engineOptions: () => ({ demo: true, storage: 'experimental-file' }), passphrase: async () => '', idleMs: 60_000 });
  assert.deepEqual(Object.keys(config.events).sort(), [...ACTOR_EVENTS].sort());
  for (const action of ACTOR_ACTIONS) assert.equal(typeof config.actions[rivetActionName(action)], 'function', action);
  assert.ok(Object.keys(config.actions).every(name => !name.includes('.')));
  const state = config.createState({ key: [newTenantId(), newBusinessId()] }, {});
  assert.deepEqual(Object.keys(state).sort(), ['businessId', 'hasVault', 'lastSeq', 'schemaVersion', 'tenantId'], 'actor state holds pointers only');
  assert.throws(() => config.createState({ key: ['tenant', '../b'] }, {}), code('INVALID_ACTOR_KEY'));
});
