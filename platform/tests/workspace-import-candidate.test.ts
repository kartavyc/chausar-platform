import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError, initialState, type Context, type State } from '../runtime/contracts.ts';
import { proveEmptyWorkspaceTarget, WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import { captureWorkspaceInterchange, encodeWorkspaceInterchange, interchangeDigest, readHistoricalWorkspaceState,
  workspaceStateProfile } from '../runtime/workspace-interchange.ts';
import type { EmptyTargetInspection, WorkspaceImportCandidate, WorkspaceImportHooks } from '../runtime/workspace-interchange-contracts.ts';

// Independent, synthetic source acceptance only. No Engine/Vault, filesystem,
// database, native consumer, live model, credential, action or activation port.
const AT = '2026-09-30T10:00:00.000Z';
const CONTEXT: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const TARGET_ID = 'synthetic-empty-target';
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
// Independently transcribed from the persisted State contract and lane scope.
const EXPECTED_COLLECTIONS = ['members', 'facts', 'imports', 'receipts', 'answers', 'decisions', 'actions', 'jobs',
  'learning', 'plugins', 'modelReceipts', 'activity', 'conflicts', 'merges', 'tombstones', 'conversations', 'routes',
  'sessions', 'unsupported', 'schedules', 'sourceRules'];
const EXPECTED_SINGLETONS = ['schemaVersion', 'revision', 'workspace', 'policy', 'ontology'];
const EXPECTED_CATEGORIES = ['source-originals', 'mapping-recipes', 'dictionary-artifacts', 'report-files',
  'plugin-assets', 'research-evidence', 'conversation-files', 'sync-evidence', 'other-retained'];

function sourceState(): State {
  const state = initialState('Synthetic historical workspace', true);
  state.workspace = { id: 'synthetic-source-workspace', name: 'Synthetic historical workspace', currency: 'INR', demo: true, createdAt: AT };
  state.revision = 7;
  state.facts = [{ id: 'historical-fact', entityId: 'invoice-1', sourceId: 'synthetic-source', sourceRow: 2, kind: 'invoice',
    validFrom: '2026-03-01', validTo: null, learnedAt: AT, supersededAt: null,
    fields: { amountMinor: '-12345', currency: 'INR', description: '=HARMLESS("literal,with,commas")', largeId: '900719925474099312345' }, branch: 'main' }];
  for (const store of workspaceStateProfile().stores) {
    if (store.kind === 'collection' && !['members', 'facts'].includes(store.name)) {
      (state as unknown as Record<string, unknown>)[store.name] = [{ id: `historical-${store.name}`, at: AT, kind: 'synthetic-retained-evidence' }];
    }
  }
  state.receipts = [{ id: 'historical-receipt', createdAt: AT, memberId: 'owner', epoch: 1, totalMinor: '-12345', rowIds: ['historical-fact'] }];
  state.actions = [{ id: 'historical-action', status: 'approved', approvedAt: AT, payload: { text: '=HARMLESS()' } }];
  state.jobs = [{ id: 'historical-job', status: 'running', lease: { holder: 'historical-device', expiresAt: AT } }];
  state.sessions = [{ id: 'historical-session', kind: 'member-session', tokenHash: 'synthetic-inert-token-hash', memberId: 'owner', epoch: 1 }];
  state.plugins = [{ id: 'historical-plugin', status: 'enabled', moduleBase64: 'AA==', approval: { memberId: 'owner', epoch: 1 } }];
  state.routes = [{ id: 'historical-route', status: 'configured', provider: 'synthetic-inert-provider' }];
  return state;
}

function emptyTarget(): EmptyTargetInspection {
  const profile = workspaceStateProfile();
  return { targetId: TARGET_ID, workspaceId: 'synthetic-new-workspace', generation: 'empty-target-fence-1',
    accessDigest: 'a'.repeat(64), ready: true, profile,
    stores: profile.stores.map(store => ({ name: store.name, records: 0 })),
    categoryCounts: profile.artifactCategories.map(category => ({ category, count: 0 })),
    authorityRecords: 0, unexpectedEntries: [] };
}

function fixture(options: { source?: State; guard?: WorkspaceImportHooks['assertCompleteRead'] } = {}) {
  const state = options.source ?? sourceState();
  const capture = captureWorkspaceInterchange(state, { complete: true, enumerationId: 'synthetic-complete-enumeration',
    generation: { workspaceId: state.workspace.id, revision: state.revision, captureId: 'synthetic-source-fence-1' },
    categories: workspaceStateProfile().artifactCategories, artifacts: [] });
  const current = { inventory: structuredClone(capture.inventory), sourceReady: true, target: emptyTarget() };
  const calls = { source: 0, target: 0, completeRead: 0 };
  let guard = options.guard;
  let onSource: ((call: number) => void) | undefined;
  let onTarget: ((call: number) => void) | undefined;
  const service = new WorkspaceImportCandidateService({
    source: context => {
      calls.source++;
      const snapshot = { ready: current.sourceReady, inventory: structuredClone(current.inventory) };
      context.memberId = 'detached-source-hook-context';
      onSource?.(calls.source);
      return snapshot;
    },
    target: (context, targetId) => {
      assert.equal(targetId, TARGET_ID);
      calls.target++;
      const snapshot = structuredClone(current.target);
      context.memberId = 'detached-target-hook-context';
      onTarget?.(calls.target);
      return snapshot;
    },
    assertCompleteRead: (context, historicalState) => {
      calls.completeRead++;
      assert.equal(context.memberId, 'owner');
      assert.equal(context.epoch, 1);
      assert.deepEqual(historicalState, state);
      const result = guard?.(context, historicalState);
      // The service must not retain objects made available to a host guard.
      historicalState.facts.length = 0;
      context.memberId = 'detached-read-hook-context';
      return result;
    },
  });
  const text = encodeWorkspaceInterchange(capture.package);
  const prepare = (context: Context = CONTEXT) => service.prepare(context, { text, targetId: TARGET_ID });
  const review = (candidate: WorkspaceImportCandidate, context: Context = CONTEXT) =>
    service.review(context, { id: candidate.id, reviewedDigest: interchangeDigest(candidate) });
  return { state, capture, current, calls, service, text, prepare, review,
    setGuard: (value: WorkspaceImportHooks['assertCompleteRead'] | undefined) => { guard = value; },
    setSourceHook: (value: typeof onSource) => { onSource = value; },
    setTargetHook: (value: typeof onTarget) => { onTarget = value; } };
}

test('empty target proof independently covers all collections, singleton stores and retained artifact categories', () => {
  const target = emptyTarget();
  assert.equal(target.profile.stores.length, 26);
  assert.equal(target.profile.stores.filter(store => store.kind === 'collection').length, 21);
  assert.equal(target.profile.stores.filter(store => store.kind === 'singleton').length, 5);
  assert.equal(target.profile.artifactCategories.length, 9);
  assert.deepEqual(target.profile.stores.filter(store => store.kind === 'collection').map(store => store.name).sort(), EXPECTED_COLLECTIONS.toSorted());
  assert.deepEqual(target.profile.stores.filter(store => store.kind === 'singleton').map(store => store.name).sort(), EXPECTED_SINGLETONS.toSorted());
  assert.deepEqual(target.profile.artifactCategories.toSorted(), EXPECTED_CATEGORIES.toSorted());
  assert.ok(target.stores.every(store => store.records === 0));
  assert.ok(target.categoryCounts.every(category => category.count === 0));
  assert.equal(proveEmptyWorkspaceTarget(target), interchangeDigest(target));
  assert.equal(proveEmptyWorkspaceTarget(structuredClone(target)), proveEmptyWorkspaceTarget(target));
});

test('every persisted target store refuses both a record and an omitted inventory entry', async t => {
  for (const store of workspaceStateProfile().stores) {
    await t.test(`${store.kind} ${store.name} must be absent and explicitly enumerated`, () => {
      const nonempty = emptyTarget();
      nonempty.stores.find(item => item.name === store.name)!.records = 1;
      assert.throws(() => proveEmptyWorkspaceTarget(nonempty), code('INTERCHANGE_TARGET_NOT_EMPTY'));
      const missing = emptyTarget();
      missing.stores = missing.stores.filter(item => item.name !== store.name);
      assert.throws(() => proveEmptyWorkspaceTarget(missing), code('INTERCHANGE_TARGET_NOT_EMPTY'));
      const f = fixture(); f.current.target = nonempty;
      assert.throws(f.prepare, code('INTERCHANGE_TARGET_NOT_EMPTY'));
      f.current.target = missing;
      assert.throws(f.prepare, code('INTERCHANGE_TARGET_NOT_EMPTY'));
      const reviewed = fixture(), candidate = reviewed.prepare(); reviewed.current.target = missing;
      assert.throws(() => reviewed.review(candidate), code('INTERCHANGE_TARGET_NOT_EMPTY'));
    });
  }
});

test('every retained target artifact category refuses both retained material and omitted enumeration', async t => {
  for (const category of workspaceStateProfile().artifactCategories) {
    await t.test(category, () => {
      const nonempty = emptyTarget();
      nonempty.categoryCounts.find(item => item.category === category)!.count = 1;
      assert.throws(() => proveEmptyWorkspaceTarget(nonempty), code('INTERCHANGE_TARGET_NOT_EMPTY'));
      const missing = emptyTarget();
      missing.categoryCounts = missing.categoryCounts.filter(item => item.category !== category);
      assert.throws(() => proveEmptyWorkspaceTarget(missing), code('INTERCHANGE_TARGET_NOT_EMPTY'));
      const f = fixture(); f.current.target = nonempty;
      assert.throws(f.prepare, code('INTERCHANGE_TARGET_NOT_EMPTY'));
      f.current.target = missing;
      assert.throws(f.prepare, code('INTERCHANGE_TARGET_NOT_EMPTY'));
      const reviewed = fixture(), candidate = reviewed.prepare(); reviewed.current.target = missing;
      assert.throws(() => reviewed.review(candidate), code('INTERCHANGE_TARGET_NOT_EMPTY'));
    });
  }
});

test('authority records, unclassified entries, duplicate inventory entries and missing fields defeat empty proof', async t => {
  const cases: [string, (target: EmptyTargetInspection) => void, string][] = [
    ['existing authority', target => { target.authorityRecords = 1; }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
    ['unexpected retained file', target => { target.unexpectedEntries = ['synthetic-unclassified-file']; }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
    ['duplicate store', target => { target.stores.push(structuredClone(target.stores[0])); }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
    ['duplicate category', target => { target.categoryCounts.push(structuredClone(target.categoryCounts[0])); }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
    ['missing authority count', target => { Reflect.deleteProperty(target, 'authorityRecords'); }, 'INTERCHANGE_TARGET_PROOF'],
    ['missing unexpected-entry inventory', target => { Reflect.deleteProperty(target, 'unexpectedEntries'); }, 'INTERCHANGE_TARGET_PROOF'],
    ['unknown proof field', target => { Object.assign(target, { trusted: true }); }, 'INTERCHANGE_TARGET_PROOF'],
    ['negative authority count', target => { target.authorityRecords = -1; }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
    ['fractional record count', target => { target.stores[0].records = 0.5; }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
    ['unknown store', target => { target.stores.push({ name: 'unreviewed-store', records: 0 }); }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
    ['unknown artifact category', target => { target.categoryCounts.push({ category: 'unreviewed-category', count: 0 }); }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
  ];
  for (const [name, mutate, error] of cases) await t.test(name, () => {
    const target = emptyTarget(); mutate(target);
    assert.throws(() => proveEmptyWorkspaceTarget(target), code(error));
  });
});

test('target proof refuses unavailable storage, unsupported profile and malformed identity or access pins', async t => {
  const cases: [string, (target: EmptyTargetInspection) => void, string][] = [
    ['not ready', target => { target.ready = false; }, 'INTERCHANGE_NOT_READY'],
    ['changed profile', target => { target.profile.id = 'unreviewed-profile'; }, 'INTERCHANGE_PROFILE'],
    ['missing profile store', target => { target.profile.stores.pop(); }, 'INTERCHANGE_PROFILE'],
    ['path-shaped target identity', target => { target.targetId = '../target'; }, 'INTERCHANGE_TARGET_PROOF'],
    ['empty workspace identity', target => { target.workspaceId = ''; }, 'INTERCHANGE_TARGET_PROOF'],
    ['missing generation fence', target => { target.generation = ''; }, 'INTERCHANGE_TARGET_PROOF'],
    ['invalid access digest', target => { target.accessDigest = 'unverified'; }, 'INTERCHANGE_TARGET_PROOF'],
  ];
  for (const [name, mutate, error] of cases) await t.test(name, () => {
    const target = emptyTarget(); mutate(target);
    assert.throws(() => proveEmptyWorkspaceTarget(target), code(error));
  });
});

test('prepare and review retain historical identities and executable-looking evidence inertly without source or target writes', () => {
  const f = fixture();
  const sourceBefore = structuredClone(f.state), inventoryBefore = structuredClone(f.current.inventory), targetBefore = structuredClone(f.current.target);
  const context = structuredClone(CONTEXT), contextBefore = structuredClone(context);
  const candidate = f.prepare(context);
  assert.equal(candidate.inert, true); assert.equal(candidate.activation, 'root-only');
  assert.equal(candidate.targetWorkspaceId, targetBefore.workspaceId);
  assert.notEqual(candidate.targetWorkspaceId, sourceBefore.workspace.id);
  assert.equal(candidate.sourceInventoryDigest, interchangeDigest(inventoryBefore));
  assert.equal(candidate.targetProofDigest, interchangeDigest(targetBefore));
  assert.equal(candidate.contextDigest, interchangeDigest(contextBefore));
  assert.equal(candidate.packageDigest, f.capture.package.digest);
  const historical = readHistoricalWorkspaceState(candidate.archive);
  assert.deepEqual(historical, sourceBefore);
  assert.equal(historical.receipts[0].id, 'historical-receipt'); assert.equal(historical.receipts[0].createdAt, AT);
  assert.equal(historical.actions[0].status, 'approved'); assert.equal(historical.jobs[0].status, 'running');
  assert.equal(historical.plugins[0].status, 'enabled'); assert.equal(historical.sessions[0].tokenHash, 'synthetic-inert-token-hash');
  assert.equal(historical.facts[0].fields.largeId, '900719925474099312345');
  assert.equal(historical.facts[0].fields.description, '=HARMLESS("literal,with,commas")');
  assert.deepEqual(f.review(candidate, context), candidate);
  assert.equal(f.calls.completeRead, 2);
  assert.deepEqual(f.state, sourceBefore); assert.deepEqual(f.current.inventory, inventoryBefore);
  assert.deepEqual(f.current.target, targetBefore); assert.deepEqual(context, contextBefore);
});

test('candidate identity is deterministic and detached mutations cannot overwrite the retained archive or review pins', () => {
  const f = fixture(), candidate = f.prepare(), baseline = structuredClone(candidate);
  assert.deepEqual(f.prepare(), baseline);
  assert.deepEqual(fixture().prepare(), baseline);
  candidate.archive.stores.find(item => item.manifest.name === 'receipts')!.text = '[]';
  candidate.archive.readable.definitions = 'forged-readable-definitions';
  candidate.targetWorkspaceId = 'forged-target'; candidate.inert = false as true;
  assert.throws(() => f.review(candidate), code('INTERCHANGE_REVIEW_CHANGED'));
  const reviewed = f.review(baseline);
  assert.deepEqual(reviewed, baseline);
  reviewed.archive.stores.length = 0;
  assert.deepEqual(f.review(baseline), baseline);
  assert.deepEqual(readHistoricalWorkspaceState(baseline.archive), f.state);
});

test('review needs the exact complete candidate digest and a retained candidate identity', () => {
  const f = fixture(), candidate = f.prepare();
  for (const reviewedDigest of ['', '0'.repeat(64), candidate.packageDigest, candidate.sourceInventoryDigest, candidate.targetProofDigest]) {
    assert.throws(() => f.service.review(CONTEXT, { id: candidate.id, reviewedDigest }), code('INTERCHANGE_REVIEW_CHANGED'));
  }
  assert.throws(() => f.service.review(CONTEXT, { id: 'unretained-candidate', reviewedDigest: interchangeDigest(candidate) }), code('INTERCHANGE_CANDIDATE_NOT_FOUND'));
  assert.deepEqual(f.review(candidate), candidate);
});

test('the host must supply all three synchronous source, target and complete-read guards', () => {
  const hooks: WorkspaceImportHooks = { source: () => { throw new Error('unused'); }, target: () => emptyTarget(), assertCompleteRead: () => {} };
  for (const name of ['source', 'target', 'assertCompleteRead'] as const) {
    const missing = { ...hooks }; Reflect.deleteProperty(missing, name);
    assert.throws(() => new WorkspaceImportCandidateService(missing), code('INTERCHANGE_HOST_REQUIRED'));
  }
});

test('denied complete-read guard prevents candidate retention during prepare and withholds review afterward', () => {
  const f = fixture();
  const identity = fixture().prepare();
  f.setGuard(() => { throw new ChausarError('ACCESS_REVOKED', 'Synthetic complete-read denial.'); });
  assert.throws(f.prepare, code('ACCESS_REVOKED')); assert.equal(f.calls.completeRead, 1);
  assert.throws(() => f.review(identity), code('INTERCHANGE_CANDIDATE_NOT_FOUND'));
  f.setGuard(undefined); const candidate = f.prepare();
  f.setGuard(() => { throw new ChausarError('ACCESS_REVOKED', 'Synthetic review-time denial.'); });
  assert.throws(() => f.review(candidate), code('ACCESS_REVOKED'));
  f.setGuard(undefined); assert.deepEqual(f.review(candidate), candidate);
});

test('asynchronous, rejected and non-void complete-read results cannot grant import authority', async t => {
  const guards: [string, WorkspaceImportHooks['assertCompleteRead']][] = [
    ['async success', async () => {}],
    ['async access denial', async () => { throw new ChausarError('ACCESS_REVOKED', 'Synthetic asynchronous permission denial.'); }],
    ['resolved Promise', () => Promise.resolve()],
    ['rejected Promise', () => Promise.reject(new ChausarError('ACCESS_REVOKED', 'Synthetic rejected permission check.'))],
    ['false', () => false], ['true', () => true], ['zero', () => 0],
    ['claimed permission text', () => 'approved'], ['object result', () => ({ approved: true })],
    ['thenable result', () => ({ then: () => {} })],
  ];
  for (const [name, guard] of guards) for (const operation of ['prepare', 'review'] as const) {
    await t.test(`${operation}: ${name}`, async () => {
      const f = fixture(), candidate = operation === 'review' ? f.prepare() : fixture().prepare();
      f.setGuard(guard);
      assert.throws(() => operation === 'prepare' ? f.prepare() : f.review(candidate), code('INTERCHANGE_HOST_GUARD'));
      if (operation === 'prepare') assert.throws(() => f.review(candidate), code('INTERCHANGE_CANDIDATE_NOT_FOUND'));
      // A refused rejected Promise must be consumed by the host boundary.
      await new Promise<void>(resolve => setImmediate(resolve));
      f.setGuard(undefined);
      if (operation === 'review') assert.deepEqual(f.review(candidate), candidate);
    });
  }
});

test('historical membership revocation and insufficient administrator role refuse preparation before full read', async t => {
  for (const [name, mutate, error] of [
    ['revoked owner', (state: State) => { state.members[0].active = false; }, 'ACCESS_REVOKED'],
    ['changed owner epoch', (state: State) => { state.members[0].epoch = 2; }, 'ACCESS_REVOKED'],
    ['viewer membership', (state: State) => { state.members[0].role = 'viewer'; }, 'FORBIDDEN'],
    ['accountant membership', (state: State) => { state.members[0].role = 'accountant'; }, 'FORBIDDEN'],
  ] as const) await t.test(name, () => {
    const state = sourceState(); mutate(state); const f = fixture({ source: state });
    const context = { ...CONTEXT, role: state.members[0].role };
    assert.throws(() => f.prepare(context), code(error)); assert.equal(f.calls.completeRead, 0);
  });
});

test('distinct root target identity and the requested root target inspection are mandatory', () => {
  const f = fixture(); f.current.target.workspaceId = f.state.workspace.id;
  assert.throws(f.prepare, code('INTERCHANGE_TARGET_IDENTITY'));
  const changed = fixture(); changed.current.target.targetId = 'other-root-target';
  assert.throws(changed.prepare, code('INTERCHANGE_TARGET_CHANGED'));
});

test('review refuses changed source generation, content, current access, readiness and target fences', async t => {
  const cases: [string, (f: ReturnType<typeof fixture>) => void, string][] = [
    ['source capture', f => { f.current.inventory.generation.captureId = 'new-source-cut'; }, 'INTERCHANGE_AUTHORITY_CHANGED'],
    ['source revision', f => { f.current.inventory.generation.revision++; }, 'INTERCHANGE_AUTHORITY_CHANGED'],
    ['source content', f => { f.current.inventory.stateDigest = 'b'.repeat(64); }, 'INTERCHANGE_AUTHORITY_CHANGED'],
    ['source access', f => { f.current.inventory.accessDigest = 'b'.repeat(64); }, 'INTERCHANGE_AUTHORITY_CHANGED'],
    ['source readiness', f => { f.current.sourceReady = false; }, 'INTERCHANGE_NOT_READY'],
    ['target fence', f => { f.current.target.generation = 'new-target-cut'; }, 'INTERCHANGE_TARGET_CHANGED'],
    ['target identity', f => { f.current.target.workspaceId = 'other-empty-workspace'; }, 'INTERCHANGE_TARGET_CHANGED'],
    ['target access', f => { f.current.target.accessDigest = 'b'.repeat(64); }, 'INTERCHANGE_TARGET_CHANGED'],
    ['target readiness', f => { f.current.target.ready = false; }, 'INTERCHANGE_NOT_READY'],
    ['target authority', f => { f.current.target.authorityRecords = 1; }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
  ];
  for (const [name, mutate, error] of cases) await t.test(name, () => {
    const f = fixture(), candidate = f.prepare(); mutate(f);
    assert.throws(() => f.review(candidate), code(error));
  });
});

test('review refuses changes to any preparing context pin', async t => {
  const variants: [string, Context][] = [
    ['member', { ...CONTEXT, memberId: 'different-member' }], ['role', { ...CONTEXT, role: 'cofounder' }],
    ['epoch', { ...CONTEXT, epoch: 2 }], ['channel', { ...CONTEXT, channel: 'phone' }],
    ['source taint', { ...CONTEXT, sourceTainted: true }],
  ];
  for (const [name, context] of variants) await t.test(name, () => {
    const f = fixture(), candidate = f.prepare(), reads = f.calls.completeRead;
    assert.throws(() => f.review(candidate, context), code('INTERCHANGE_CONTEXT_CHANGED'));
    assert.equal(f.calls.completeRead, reads);
  });
});

test('source and target changes inside complete-read guards defeat both prepare and review', async t => {
  const races: [string, (f: ReturnType<typeof fixture>) => void, string][] = [
    ['source generation', f => { f.current.inventory.generation.captureId = 'racing-source'; }, 'INTERCHANGE_AUTHORITY_CHANGED'],
    ['source access', f => { f.current.inventory.accessDigest = 'c'.repeat(64); }, 'INTERCHANGE_AUTHORITY_CHANGED'],
    ['source readiness', f => { f.current.sourceReady = false; }, 'INTERCHANGE_NOT_READY'],
    ['target generation', f => { f.current.target.generation = 'racing-target'; }, 'INTERCHANGE_TARGET_CHANGED'],
    ['target access', f => { f.current.target.accessDigest = 'c'.repeat(64); }, 'INTERCHANGE_TARGET_CHANGED'],
    ['target readiness', f => { f.current.target.ready = false; }, 'INTERCHANGE_NOT_READY'],
    ['target authority', f => { f.current.target.authorityRecords = 1; }, 'INTERCHANGE_TARGET_NOT_EMPTY'],
  ];
  for (const [name, mutate, error] of races) for (const operation of ['prepare', 'review'] as const) {
    await t.test(`${operation}: ${name}`, () => {
      const f = fixture(), baseline = operation === 'review' ? f.prepare() : fixture().prepare();
      f.setGuard(() => mutate(f));
      assert.throws(() => operation === 'prepare' ? f.prepare() : f.review(baseline), code(error));
      if (operation === 'prepare') assert.throws(() => f.review(baseline), code('INTERCHANGE_CANDIDATE_NOT_FOUND'));
    });
  }
});

test('source and target inspection TOCTOU after returning a matching snapshot are caught by final fence rechecks', async t => {
  for (const hook of ['source', 'target'] as const) for (const operation of ['prepare', 'review'] as const) {
    await t.test(`${operation}: ${hook}`, () => {
      const f = fixture(), candidate = operation === 'review' ? f.prepare() : fixture().prepare();
      const baseCalls = f.calls[hook];
      const after = operation === 'prepare' ? 2 : 1;
      const changeAfterSnapshot = (call: number) => {
        if (call !== baseCalls + after) return;
        if (hook === 'source') f.current.inventory.enumerationId = 'changed-after-source-inspection';
        else f.current.target.generation = 'changed-after-target-inspection';
      };
      if (hook === 'source') f.setSourceHook(changeAfterSnapshot); else f.setTargetHook(changeAfterSnapshot);
      assert.throws(() => operation === 'prepare' ? f.prepare() : f.review(candidate),
        code(hook === 'source' ? 'INTERCHANGE_AUTHORITY_CHANGED' : 'INTERCHANGE_TARGET_CHANGED'));
      if (operation === 'prepare') assert.throws(() => f.review(candidate), code('INTERCHANGE_CANDIDATE_NOT_FOUND'));
    });
  }
});

test('discard removes only the inert retained candidate and requires its exact preparing context', () => {
  const f = fixture(), candidate = f.prepare(), source = structuredClone(f.state), target = structuredClone(f.current.target);
  assert.throws(() => f.service.discard({ ...CONTEXT, epoch: 2 }, candidate.id), code('INTERCHANGE_CONTEXT_CHANGED'));
  assert.deepEqual(f.review(candidate), candidate);
  f.service.discard(CONTEXT, candidate.id);
  assert.throws(() => f.review(candidate), code('INTERCHANGE_CANDIDATE_NOT_FOUND'));
  assert.deepEqual(f.state, source); assert.deepEqual(f.current.target, target);
});
