// Hosted tier: the venture runtime contract. The six conformance checks (hosted-runtime-conformance.ts) run here on
// the local actor runtime, on the Rivet adapter over an in-memory stand-in, and on the local runtime with business
// vaults in the PostgreSQL stand-in. The same checks against a real PostgreSQL server are a separate qualification run
// (qualification/hosted-postgres-real.test.ts), outside the open suite. Every actor is a real Engine over a real
// encrypted vault; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { newBusinessId, newTenantId } from '../runtime/hosted/custody.ts';
import { ACTOR_ACTIONS, ACTOR_EVENTS } from '../runtime/hosted/runtime/contract.ts';
import { DRAFT_METHODS, PRE_VAULT_METHODS } from '../runtime/venture/contracts.ts';
import { LocalVentureRuntime } from '../runtime/hosted/runtime/local.ts';
import { RIVET_DESCRIPTOR, rivetActionName, ventureActorConfig } from '../runtime/hosted/runtime/rivet.ts';
import { code, harness, runtimeConformance, web } from './hosted-runtime-conformance.ts';

runtimeConformance(['local', 'rivet', 'local-postgres']);

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

test('a hosted business actor declares no draft method and no pre-vault method', () => {
  for (const method of [...DRAFT_METHODS, ...PRE_VAULT_METHODS]) assert.equal(ACTOR_ACTIONS.includes(method), false, method);
  assert.ok(ACTOR_ACTIONS.includes('venture.create'));
});
