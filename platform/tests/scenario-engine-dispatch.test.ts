import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import type { EngineScenarioService } from '../runtime/engine-scenarios.ts';
import type { ScenarioCreateRequest, ScenarioDiscoveryPage, ScenarioDiscoveryRequest, ScenarioView } from '../runtime/scenario-contracts.ts';

const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };

// Actual Engine authorization, dispatch, encrypted Vault and scenario service.
// The explicit experimental host performs no SQL, native/browser operation,
// external provider request, acquisition or credential retrieval.
test('Engine.requestAs dispatches only strict discovery parameters under current authorization', async t => {
  const base = await realpath(tmpdir());
  const directory = await realpath(await mkdtemp(join(base, 'chausar-scenario-dispatch-')));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => {
    await engine.shutdown();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-scenario-dispatch-'));
    await rm(actual, { recursive: true, force: true });
  });
  await engine.requestAs(OWNER, 'workspace.create', {
    name: 'Synthetic discovery dispatcher workspace', demo: false,
    passphrase: 'Synthetic discovery dispatcher passphrase',
  });
  const request: ScenarioCreateRequest = {
    version: 1, label: 'Synthetic retained dispatch scenario',
    baseline: { label: 'Synthetic baseline', request: {
      operation: 'scenario', branch: 'main', period: { from: '2026-09-01', to: '2026-09-30' },
      assumptions: { priceChangeBps: '0' },
    } },
    alternatives: [{ label: 'Synthetic alternative', priceChangeBps: '1000' }],
  };
  const first: ScenarioView = await engine.requestAs(OWNER, 'scenarios.create', request);
  const second: ScenarioView = await engine.requestAs(OWNER, 'scenarios.create', request);
  const service = engine.services.scenarios as EngineScenarioService;
  const discover = service.discover.bind(service);
  const calls: { context: Context; input: ScenarioDiscoveryRequest }[] = [];
  service.discover = async (context, input = {}) => {
    calls.push({ context: structuredClone(context), input: structuredClone(input) });
    return discover(context, input);
  };
  const before = engine.vault!.read();
  const initial: ScenarioDiscoveryPage = await engine.requestAs(OWNER, 'scenarios.discover', { limit: 1 });
  assert.equal(initial.items.length, 1); assert.match(initial.nextCursor!, /^[a-f0-9]{64}$/);
  const continuation = { limit: 1, cursor: initial.nextCursor! };
  const next: ScenarioDiscoveryPage = await engine.requestAs(OWNER, 'scenarios.discover', continuation);
  assert.equal(next.items.length, 1); assert.equal(next.nextCursor, null);
  assert.deepEqual(new Set([...initial.items, ...next.items].map(row => row.scenarioId)), new Set([first.scenarioId, second.scenarioId]));
  const all: ScenarioDiscoveryPage = await engine.requestAs(OWNER, 'scenarios.discover');
  assert.equal(all.items.length, 2); assert.equal(all.nextCursor, null);
  assert.deepEqual(calls, [
    { context: OWNER, input: { limit: 1 } },
    { context: OWNER, input: continuation },
    { context: OWNER, input: {} },
  ]);
  assert.deepEqual(engine.vault!.read(), before, 'Discovery dispatch remains read only.');

  for (const payload of [
    { limit: 1, label: request.label },
    { limit: 1, scenarioId: first.scenarioId, revisionId: first.revision.id },
    { limit: 1, custody: before.scenarioRecords },
  ]) await assert.rejects(engine.requestAs(OWNER, 'scenarios.discover', payload), { code: 'INVALID_SCENARIO' });
  await assert.rejects(engine.requestAs({ ...OWNER, epoch: 2 }, 'scenarios.discover', {}), { code: 'ACCESS_REVOKED' });
  assert.equal(calls.length, 3, 'Undeclared payloads and revoked contexts never reach scenario discovery.');
  const reopened: ScenarioView = await engine.requestAs(OWNER, 'scenarios.reopen', {
    scenarioId: initial.items[0].scenarioId, revisionId: initial.items[0].revisionId,
  });
  assert.equal(reopened.revision.id, initial.items[0].revisionId);
});
