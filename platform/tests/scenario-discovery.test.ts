import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { authorize, ChausarError, type Context } from '../runtime/contracts.ts';
import { digest } from '../runtime/actions.ts';
import { ExperimentalFileSnapshotAdapter, Vault } from '../runtime/vault.ts';
import { EngineScenarioService, type EngineScenarioOptions } from '../runtime/engine-scenarios.ts';
import { compileDictionary, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type { ScenarioCreateRequest, ScenarioRecord, ScenarioView } from '../runtime/scenario-contracts.ts';

// Actual encrypted custody and installed source guards; synthetic calculator
// verification below executes no SQL, native code, browser, or business effect.
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const OTHER: Context = { memberId: 'other', role: 'owner', epoch: 1, channel: 'desktop' };
const cut = '2026-10-03T00:00:00.000Z';
const passphrase = 'Synthetic scenario discovery custody passphrase';
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
function request(label: string, sourceId = 'synthetic-authorized-source', branch = 'main', at = cut): ScenarioCreateRequest {
  return { version: 1, label, baseline: { label: 'Synthetic retained baseline', request: {
    operation: 'scenario', sourceIds: [sourceId], branch, period: { from: '2026-09-01', to: '2026-09-30' },
    assumptions: { priceChangeBps: '0' }, asOf: at,
  } }, alternatives: [{ label: 'Synthetic retained alternative', priceChangeBps: '1000' }] };
}
function reseal(record: ScenarioRecord) {
  const { digest: ignored, ...body } = record; record.digest = digest(body);
}
async function fixture(t: TestContext) {
  const base = await realpath(tmpdir()), directory = await realpath(await mkdtemp(join(base, 'chausar-scenario-discovery-')));
  assert.equal(dirname(directory), base);
  const adapter = new ExperimentalFileSnapshotAdapter(directory);
  const vault = (await Vault.create({ directory, storage: adapter, passphrase, name: 'Synthetic encrypted discovery' })).vault;
  t.after(async () => {
    await vault.close();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-scenario-discovery-'));
    await rm(actual, { recursive: true, force: true });
  });
  await vault.update(state => {
    const dictionary = compileDictionary(starterPacks.find(pack => pack.pack === 'retail')!, 1, OWNER.memberId, cut);
    state.ontology = { current: dictionary, history: [dictionary] };
    state.members.push({ id: OTHER.memberId, name: 'Synthetic other private owner', role: OTHER.role, active: true, epoch: 1, branches: ['*'] });
  });
  return { vault, adapter,
    scenarios: (options: Partial<EngineScenarioOptions> = {}) => new EngineScenarioService(vault, { now: () => cut,
      calculatorOptions: view => ({ consumerGuard: ctx => { authorize(view, ctx); }, receiptGuard: ctx => { authorize(view, ctx); } }), ...options }),
    ciphertext: () => readFile(join(directory, 'authority.encrypted.json')),
  };
}
const rowKeys = ['createdAt', 'isHead', 'label', 'noAction', 'revisionId', 'revisionMode', 'scenarioId', 'status'];

test('discovery releases only inert exact revision metadata and preserves same-label identities', async t => {
  const f = await fixture(t), service = f.scenarios(), label = 'Synthetic identical display label';
  const first = await service.create(OWNER, request(label)), second = await service.create(OWNER, request(label));
  const before = f.vault.read(), ciphertext = await f.ciphertext();
  const page = await service.discover(OWNER, {});
  assert.deepEqual(Object.keys(page).sort(), ['items', 'mode', 'nextCursor', 'noAction']);
  assert.equal(page.mode, 'retained-revisions'); assert.equal(page.noAction, true); assert.equal(page.nextCursor, null);
  assert.equal(page.items.length, 2);
  assert.deepEqual(new Set(page.items.map(row => row.scenarioId)), new Set([first.scenarioId, second.scenarioId]));
  assert.deepEqual(new Set(page.items.map(row => row.revisionId)), new Set([first.revision.id, second.revision.id]));
  for (const row of page.items) {
    assert.deepEqual(Object.keys(row).sort(), rowKeys);
    assert.equal(row.label, label); assert.equal(row.status, 'partial'); assert.equal(row.isHead, true);
    assert.equal(row.revisionMode, 'initial'); assert.equal(row.createdAt, cut); assert.equal(row.noAction, true);
  }
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.ciphertext(), ciphertext);
});

test('discovery retains selected historical pins after head changes and preserves complete versus mixed partial status', async t => {
  const f = await fixture(t); let verifierCalls = 0;
  const service = f.scenarios({ calculatorOptions: view => ({
    consumerGuard: ctx => { authorize(view, ctx); }, receiptGuard: ctx => { authorize(view, ctx); },
    verifier: async () => { verifierCalls++; return { qualification: 'synthetic-protocol', nativeSqlExecuted: false }; },
  }) });
  const initial = await service.create(OWNER, request('Synthetic historical selection'));
  for (const job of initial.revision.jobs) {
    const run = await service.beginRun(OWNER, initial.scenarioId, initial.revision.id, job.id);
    await service.evaluate(OWNER, initial.scenarioId, run.id);
  }
  await service.finalize(OWNER, initial.scenarioId, initial.revision.id);
  const selected = (await service.discover(OWNER, {})).items[0];
  assert.equal(selected.status, 'complete');
  const alternative = initial.revision.branches.find(branch => branch.role === 'alternative')!;
  const changed = await service.changeAssumption(OWNER, initial.scenarioId, initial.revision.id, alternative.id, '2000');
  assert.equal(changed.jobs.filter(job => job.status === 'ready').length, 1);
  assert.equal(changed.jobs.filter(job => job.status === 'stale').length, 1);
  const before = f.vault.read(), ciphertext = await f.ciphertext(), callsBefore = verifierCalls;
  const page = await service.discover(OWNER, {});
  assert.equal(page.items.length, 2);
  const old = page.items.find(row => row.revisionId === selected.revisionId)!, head = page.items.find(row => row.revisionId === changed.revision.id)!;
  assert.equal(old.isHead, false); assert.equal(old.status, 'complete'); assert.equal(old.revisionMode, 'initial');
  assert.equal(head.isHead, true); assert.equal(head.status, 'partial'); assert.equal(head.revisionMode, 'assumption-change');
  const reopened = await service.reopen(OWNER, selected.scenarioId, selected.revisionId);
  assert.equal(reopened.revision.id, initial.revision.id); assert.equal(reopened.headRevisionId, changed.revision.id);
  assert.deepEqual(reopened.revision, initial.revision); assert.equal(reopened.status, 'complete');
  assert.equal(reopened.comparisons.length, 1); assert.equal(reopened.noAction, true);
  assert.equal(verifierCalls, callsBefore, 'Discovery and exact reopening cannot replay calculator verification.');
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.ciphertext(), ciphertext);
  await assert.rejects(service.reopen(OWNER, selected.scenarioId, 'synthetic-missing-revision'), code('SCENARIO_REVISION_UNAVAILABLE'));
  await assert.rejects(service.changeAssumption(OWNER, selected.scenarioId, selected.revisionId, alternative.id, '3000'), code('SCENARIO_HEAD_CHANGED'));
});

test('discovery fills pages past inaccessible rows without exposing their names or counts', async t => {
  const f = await fixture(t); let clock = cut;
  const service = f.scenarios({ now: () => clock });
  const first = await service.create(OWNER, request('Synthetic available first')), second = await service.create(OWNER, request('Synthetic available second'));
  clock = '2026-10-03T01:00:00.000Z';
  await service.create(OTHER, request('Synthetic hidden other-member name'));
  const oldEpoch = await service.create(OWNER, request('Synthetic hidden old-epoch name'));
  await service.create(OWNER, request('Synthetic hidden source name', 'synthetic-revoked-source'));
  await service.create(OWNER, request('Synthetic hidden branch name', 'synthetic-authorized-source', 'synthetic-forbidden-branch'));
  const changedArtifact = await service.create(OWNER, request('Synthetic hidden changed-artifact name'));
  await f.vault.update(state => {
    state.policy.allowedSources = ['synthetic-authorized-source']; state.members[0].branches = ['main'];
    const epochRecord = state.scenarioRecords!.find(record => record.id === oldEpoch.scenarioId)!;
    epochRecord.epoch = 2; reseal(epochRecord);
    state.scenarioRecords!.find(record => record.id === changedArtifact.scenarioId)!.label = 'Synthetic tampered private artifact';
  });
  const before = f.vault.read(), ciphertext = await f.ciphertext();
  const page = await service.discover(OWNER, { limit: 2 });
  assert.equal(page.items.length, 2); assert.equal(page.nextCursor, null);
  assert.deepEqual(new Set(page.items.map(row => row.scenarioId)), new Set([first.scenarioId, second.scenarioId]));
  assert.equal(JSON.stringify(page).includes('hidden'), false); assert.equal(JSON.stringify(page).includes('tampered'), false);
  assert.deepEqual(Object.keys(page).sort(), ['items', 'mode', 'nextCursor', 'noAction']);
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.ciphertext(), ciphertext);
});

test('discovery pagination visits every reachable revision once and binds cursors to current instance, context and limit', async t => {
  const f = await fixture(t), service = f.scenarios(), created: ScenarioView[] = [];
  for (let index = 0; index < 6; index++) created.push(await service.create(OWNER, request(`Synthetic paginated ${index}`)));
  const first = await service.discover(OWNER, { limit: 2 });
  assert.equal(first.items.length, 2); assert.match(first.nextCursor!, /^[a-f0-9]{64}$/);
  const seen = [...first.items]; let cursor = first.nextCursor;
  while (cursor) {
    const page = await service.discover(OWNER, { limit: 2, cursor });
    assert.equal(page.items.length, 2); seen.push(...page.items); cursor = page.nextCursor;
  }
  assert.equal(seen.length, 6); assert.equal(new Set(seen.map(row => `${row.scenarioId}/${row.revisionId}`)).size, 6);
  assert.deepEqual(new Set(seen.map(row => row.scenarioId)), new Set(created.map(view => view.scenarioId)));
  await assert.rejects(service.discover(OWNER, { limit: 3, cursor: first.nextCursor! }), code('SCENARIO_AUTHORITY_CHANGED'));
  await assert.rejects(service.discover(OTHER, { limit: 2, cursor: first.nextCursor! }), code('SCENARIO_AUTHORITY_CHANGED'));
  await assert.rejects(f.scenarios().discover(OWNER, { limit: 2, cursor: first.nextCursor! }), code('SCENARIO_AUTHORITY_CHANGED'));
  await assert.rejects(service.discover(OWNER, { limit: 2, cursor: '0'.repeat(64) }), code('SCENARIO_AUTHORITY_CHANGED'));
  const last = created[5], alternative = last.revision.branches.find(branch => branch.role === 'alternative')!;
  await service.changeAssumption(OWNER, last.scenarioId, last.revision.id, alternative.id, '2000');
  await assert.rejects(service.discover(OWNER, { limit: 2, cursor: first.nextCursor! }), code('SCENARIO_AUTHORITY_CHANGED'));
  assert.equal((await service.discover(OWNER, { limit: 50 })).items.length, 7, 'Fresh discovery retains the original selected revision after a new head.');
});

test('discovery enforces default and bounded page sizes with explicit unavailable cursor behavior', async t => {
  const f = await fixture(t), service = f.scenarios();
  assert.deepEqual(await service.discover(OWNER, {}), { mode: 'retained-revisions', items: [], nextCursor: null, noAction: true });
  for (const limit of [0, 51, -1, 1.5, NaN, Infinity])
    await assert.rejects(async () => service.discover(OWNER, { limit }), error => error instanceof ChausarError);
  for (const cursor of ['', 'not-a-cursor', 'A'.repeat(64), '0'.repeat(63)])
    await assert.rejects(async () => service.discover(OWNER, { cursor }), error => error instanceof ChausarError);
  for (let index = 0; index < 26; index++) await service.create(OWNER, request(`Synthetic default bound ${index}`));
  const page = await service.discover(OWNER, {});
  assert.equal(page.items.length, 25); assert.match(page.nextCursor!, /^[a-f0-9]{64}$/);
  const remaining = await service.discover(OWNER, { cursor: page.nextCursor! });
  assert.equal(remaining.items.length, 1); assert.equal(remaining.nextCursor, null);
  assert.equal((await service.discover(OWNER, { limit: 50 })).items.length, 26);
});

test('clock-only retention expiry invalidates stale cursors and omits expired metadata before cleanup', async t => {
  const f = await fixture(t); let clock = cut;
  const service = f.scenarios({ now: () => clock });
  await f.vault.update(state => { state.policy.retentionDays = 1; });
  const first = await service.create(OWNER, request('Synthetic retained before clock expiry'));
  await service.create(OWNER, request('Synthetic another retained before clock expiry'));
  const page = await service.discover(OWNER, { limit: 1 }), before = f.vault.read(), ciphertext = await f.ciphertext();
  assert.ok(page.nextCursor);
  clock = '2026-10-05T00:00:00.000Z';
  await assert.rejects(service.discover(OWNER, { limit: 1, cursor: page.nextCursor! }), code('SCENARIO_AUTHORITY_CHANGED'));
  assert.deepEqual(await service.discover(OWNER, {}), { mode: 'retained-revisions', items: [], nextCursor: null, noAction: true });
  await assert.rejects(service.reopen(OWNER, first.scenarioId, first.revision.id), code('SCENARIO_RETENTION_EXPIRED'));
  assert.deepEqual(f.vault.read(), before, 'Clock-only unavailability cannot mutate encrypted custody.');
  assert.deepEqual(await f.ciphertext(), ciphertext);
  await new TrustService(f.vault).cleanup(OWNER, new Date(clock));
  assert.deepEqual(f.vault.read().scenarioRecords, []);
  assert.deepEqual((await service.discover(OWNER, {})).items, []);
  await assert.rejects(service.reopen(OWNER, first.scenarioId, first.revision.id), code('SCENARIO_UNAVAILABLE'));
});

test('current account revocation and tainted contexts refuse discovery rather than releasing empty pages', async t => {
  for (const withdrawal of ['member', 'epoch', 'role'] as const) await t.test(withdrawal, async sub => {
    const f = await fixture(sub), service = f.scenarios();
    await service.create(OWNER, request('Synthetic private revoked name'));
    await assert.rejects(service.discover({ ...OWNER, sourceTainted: true }, {}), code('SCENARIO_TAINTED_CONTEXT'));
    await f.vault.update(state => {
      if (withdrawal === 'member') state.members[0].active = false;
      else if (withdrawal === 'epoch') state.members[0].epoch++;
      else state.members[0].role = 'viewer';
    });
    await assert.rejects(service.discover(OWNER, {}), code('ACCESS_REVOKED'));
  });
});

test('delayed discovery queued behind revocation checks the committed account before exposing any metadata', async t => {
  for (const withdrawalKind of ['epoch', 'source'] as const) await t.test(withdrawalKind, async sub => {
    const f = await fixture(sub), service = f.scenarios();
    await service.create(OWNER, request('Synthetic private queued name'));
    const entered = deferred(), release = deferred(); let releasedNames = false;
    const withdrawal = f.vault.update(async state => {
      entered.resolve(); await release.promise;
      if (withdrawalKind === 'epoch') state.members[0].epoch++;
      else state.policy.allowedSources = [];
    });
    await entered.promise;
    const operation = service.discover(OWNER, {}).then(page => { releasedNames = page.items.length > 0; return page; });
    const result = withdrawalKind === 'epoch' ? assert.rejects(operation, code('ACCESS_REVOKED'))
      : operation.then(page => assert.deepEqual(page, { mode: 'retained-revisions', items: [], nextCursor: null, noAction: true }));
    release.resolve(); await withdrawal; await result;
    assert.equal(releasedNames, false); assert.equal(f.vault.read().scenarioRecords!.length, 1);
  });
});

test('current installed readiness withdrawal changes cursor authority without a Vault mutation and unknown guard errors refuse the page', async t => {
  const f = await fixture(t); let unavailable = false, unknown = false;
  const service = f.scenarios({ calculatorOptions: view => ({
    consumerGuard: (ctx, request) => {
      authorize(view, ctx);
      if (unknown) throw new ChausarError('SYNTHETIC_GUARD_FAILURE', 'Unknown installed guard failure must refuse the whole page.');
      if (unavailable && request.sourceIds?.includes('synthetic-readiness-source'))
        throw new ChausarError('SOURCE_NOT_READY', 'Synthetic installed source readiness withdrawn.');
    }, receiptGuard: ctx => { authorize(view, ctx); },
  }) });
  const hidden = await service.create(OWNER, request('Synthetic readiness private name', 'synthetic-readiness-source'));
  const shown = await service.create(OWNER, request('Synthetic readiness still available'));
  const page = await service.discover(OWNER, { limit: 1 }), before = f.vault.read(), ciphertext = await f.ciphertext();
  assert.ok(page.nextCursor); unavailable = true;
  await assert.rejects(service.discover(OWNER, { limit: 1, cursor: page.nextCursor! }), code('SCENARIO_AUTHORITY_CHANGED'));
  const fresh = await service.discover(OWNER, { limit: 1 });
  assert.equal(fresh.items.length, 1); assert.equal(fresh.items[0].scenarioId, shown.scenarioId); assert.equal(fresh.nextCursor, null);
  await assert.rejects(service.reopen(OWNER, hidden.scenarioId, hidden.revision.id), code('SOURCE_NOT_READY'));
  unknown = true;
  await assert.rejects(service.discover(OWNER, {}), code('SYNTHETIC_GUARD_FAILURE'));
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.ciphertext(), ciphertext);
});

test('source deletion removes discovery pins and exact reopen preserves the existing unavailable refusal', async t => {
  const f = await fixture(t), service = f.scenarios();
  const created = await service.create(OWNER, request('Synthetic deletion private name', 'synthetic-deleted-request-source'));
  assert.equal((await service.discover(OWNER, {})).items[0].revisionId, created.revision.id);
  await new TrustService(f.vault).deleteSource(OWNER, 'synthetic-deleted-request-source');
  assert.deepEqual(f.vault.read().scenarioRecords, []);
  assert.deepEqual(await service.discover(OWNER, {}), { mode: 'retained-revisions', items: [], nextCursor: null, noAction: true });
  await assert.rejects(service.reopen(OWNER, created.scenarioId, created.revision.id), code('SCENARIO_UNAVAILABLE'));
});

test('discovery withholds completed metadata when its retained receipts lose installed release readiness', async t => {
  const f = await fixture(t); let unavailable = false, receiptChecks = 0;
  const service = f.scenarios({ calculatorOptions: view => ({
    consumerGuard: ctx => { authorize(view, ctx); },
    receiptGuard: ctx => {
      authorize(view, ctx); receiptChecks++;
      if (unavailable) throw new ChausarError('SOURCE_NOT_READY', 'Synthetic retained receipt readiness withdrawn.');
    },
    verifier: async () => ({ qualification: 'synthetic-protocol', nativeSqlExecuted: false }),
  }) });
  const created = await service.create(OWNER, request('Synthetic completed private receipt name'));
  for (const job of created.revision.jobs) {
    const run = await service.beginRun(OWNER, created.scenarioId, created.revision.id, job.id);
    await service.evaluate(OWNER, created.scenarioId, run.id);
  }
  assert.equal((await service.discover(OWNER, {})).items[0].status, 'complete');
  const before = f.vault.read(), ciphertext = await f.ciphertext(), checks = receiptChecks; unavailable = true;
  assert.deepEqual(await service.discover(OWNER, {}), { mode: 'retained-revisions', items: [], nextCursor: null, noAction: true });
  assert.ok(receiptChecks > checks, 'Metadata release must apply the existing exact retained receipt guards.');
  await assert.rejects(service.reopen(OWNER, created.scenarioId, created.revision.id), code('SOURCE_NOT_READY'));
  assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.ciphertext(), ciphertext);
});
