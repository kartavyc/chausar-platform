import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActionService, digest, type ActionResult, type Connector, type PreparedAction } from '../runtime/actions.ts';
import { check, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { createJournalExecutionResolver } from '../runtime/journal-execution.ts';
import type { JournalContent } from '../runtime/decision-journal.ts';
import { ReportService } from '../runtime/reports.ts';
import { TrustService } from '../runtime/trust.ts';

// Every action, effect, source and connector in this suite is synthetic. Provider
// execution and independent readback are in-process fixtures with no transport.
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const VIEWER: Context = { memberId: 'execution-viewer', role: 'viewer', epoch: 1 };
const PRIVATE: Context = { memberId: 'private-founder', role: 'cofounder', epoch: 1, channel: 'desktop' };
const SOURCE = 'synthetic-execution-source';
const ROW = 'synthetic-source-row';
const SECRET_PAYLOAD = 'PRIVATE SYNTHETIC ACTION PAYLOAD';
const SECRET_RESULT = 'PRIVATE SYNTHETIC PROVIDER RESULT';
const SECRET_READBACK = 'PRIVATE SYNTHETIC READBACK DATA';
const code = (expected: string) => (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === expected;

class MemoryStore implements StateStore {
  state = initialState('Synthetic execution fixture', true);
  queue: Promise<unknown> = Promise.resolve();
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const draft = this.read(), value = await change(draft);
      draft.revision++; this.state = draft; return value;
    });
    this.queue = run.then(() => {}, () => {}); return run;
  }
}

function readOnly(state: State): StateStore {
  return { read: () => structuredClone(state), update: async () => { throw new Error('Read-only synthetic transaction view.'); } };
}

function fixture() {
  const store = new MemoryStore(), effects = new Map<string, { result: ActionResult; payloadDigest: string }>();
  let writes = 0, readbacks = 0, loseAcknowledgement = false, absent = false, providerBusinessSuccess = false;
  store.state.members.push(
    { id: VIEWER.memberId, role: VIEWER.role, epoch: 1, active: true, name: 'Synthetic reader', branches: ['main'] },
    { id: PRIVATE.memberId, role: PRIVATE.role, epoch: 1, active: true, name: 'Synthetic private founder', branches: ['main'] });
  store.state.facts.push({ id: ROW, entityId: 'synthetic-entity', sourceId: SOURCE, sourceRow: 2,
    kind: 'sale', branch: 'main', validFrom: '2026-09-01', validTo: null,
    learnedAt: new Date().toISOString(), supersededAt: null, fields: { description: 'Synthetic source row' } });
  store.state.imports.push({ type: 'synthetic-execution-read-grant', read: true, write: true });
  const connector: Connector = { id: 'synthetic-effects', title: 'Synthetic effect fixture', operations: {
    apply: { title: 'Apply synthetic effect', description: 'In-process effect with independent keyed readback.',
      impact: 'reversible', idempotency: 'Fixture map uses the exact key.', readback: 'Fixture map is read by exact key and payload digest.',
      validate(payload) {
        check(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_PAYLOAD', 'Provide a synthetic payload.');
        const value = payload as Record<string, unknown>;
        check(typeof value.text === 'string' && typeof value.targetRow === 'string', 'INVALID_PAYLOAD', 'Provide exact synthetic fields.');
        return { text: value.text, targetRow: value.targetRow };
      },
      authorize(state, _ctx, mode) {
        const grant = state.imports.find(item => item.type === 'synthetic-execution-read-grant');
        check(grant?.[mode] === true, mode === 'read' ? 'FIXTURE_READ_REVOKED' : 'FIXTURE_WRITE_REVOKED', 'The synthetic operation grant changed.');
      },
      async execute(payload, key) {
        writes++;
        if (absent) throw new Error('Synthetic write was never applied.');
        const result: ActionResult = { externalId: 'synthetic-provider-effect', data: { private: SECRET_RESULT }, businessSuccess: providerBusinessSuccess };
        effects.set(key, { result, payloadDigest: digest(payload) });
        if (loseAcknowledgement) throw new Error('Synthetic acknowledgement was lost after application.');
        return structuredClone(result);
      },
      async reconcile(payload, key) {
        readbacks++; const effect = effects.get(key), verified = !!effect && effect.payloadDigest === digest(payload);
        return { verified, businessSuccess: verified && providerBusinessSuccess, absent: !effect,
          ...(effect?.result.externalId ? { externalId: effect.result.externalId } : {}), data: { private: SECRET_READBACK } };
      },
    },
  } };
  const actions = new ActionService(store, [connector]), resolve = createJournalExecutionResolver(actions);
  return { store, actions, resolve, trust: new TrustService(store),
    calls: () => ({ writes, readbacks }), disconnect: () => { loseAcknowledgement = true; },
    denyEffect: () => { absent = true; }, reportBusinessSuccess: () => { providerBusinessSuccess = true; } };
}
type Fixture = ReturnType<typeof fixture>;
async function prepare(f: Fixture, ctx = OWNER, sourceIds = [SOURCE], key = 'synthetic-execution-idempotency') {
  return f.actions.prepare(ctx, { connector: 'synthetic-effects', operation: 'apply',
    payload: { text: SECRET_PAYLOAD, targetRow: ROW }, sourceIds, idempotencyKey: key });
}
async function verified(f: Fixture, ctx = OWNER, sourceIds = [SOURCE]) {
  const action = await prepare(f, ctx, sourceIds);
  await f.actions.approve(ctx, action.id, action.digest);
  return f.actions.execute(ctx, action.id);
}

test('real synthetic action and attempt IDs resolve the same verified effect without repeating provider work', async () => {
  const f = fixture(), action = await verified(f), before = f.calls();
  const byAction = f.resolve(OWNER, action.id, f.store), byAttempt = f.resolve(OWNER, action.attempts[0].id, f.store);
  assert.equal(byAction.id, action.id); assert.equal(byAttempt.id, action.attempts[0].id);
  assert.deepEqual(byAction.snapshot, byAttempt.snapshot);
  assert.deepEqual(byAction.sourceIds, [SOURCE]); assert.deepEqual(byAttempt.sourceIds, [SOURCE]);
  assert.deepEqual(byAction.rowIds, [], 'Payload target strings are not authoritative row lineage.');
  assert.equal(byAction.snapshot.kind, 'verified-action-execution');
  assert.equal(byAction.snapshot.actionId, action.id); assert.equal(byAction.snapshot.attemptId, action.attempts[0].id);
  assert.deepEqual(byAction.snapshot.executionVerification, { state: 'verified', basis: 'persisted-provider-readback',
    externalId: 'synthetic-provider-effect', readbackDigest: digest(action.readback) });
  assert.equal(byAction.snapshot.providerReportedBusinessSuccess, false); assert.equal(byAction.snapshot.businessOutcome, 'not-assessed');
  assert.deepEqual(f.calls(), before);
  byAction.sourceIds.length = 0; byAction.snapshot.businessOutcome = 'injected';
  assert.deepEqual(f.resolve(OWNER, action.id, f.store).sourceIds, [SOURCE]);
  assert.equal(f.resolve(OWNER, action.id, f.store).snapshot.businessOutcome, 'not-assessed');
});

test('whitelisted execution snapshots omit payload, provider results and readback bodies', async () => {
  const f = fixture(); f.reportBusinessSuccess();
  const action = await verified(f), receipt = f.resolve(OWNER, action.id, f.store), text = JSON.stringify(receipt);
  assert.equal(receipt.snapshot.providerReportedBusinessSuccess, true);
  assert.equal(receipt.snapshot.businessOutcome, 'not-assessed');
  for (const secret of [SECRET_PAYLOAD, SECRET_RESULT, SECRET_READBACK, ROW]) assert.equal(text.includes(secret), false, secret);
  assert.equal(Object.hasOwn(receipt.snapshot, 'payload'), false);
  assert.equal(Object.hasOwn(receipt.snapshot, 'result'), false);
  assert.equal(Object.hasOwn(receipt.snapshot, 'readback'), false);
  assert.deepEqual(Object.keys(receipt.snapshot).sort(), ['kind', 'actionId', 'attemptId', 'connector', 'operation', 'impact',
    'revision', 'digest', 'idempotencyKey', 'createdAt', 'startedAt', 'finishedAt', 'executionVerification',
    'providerReportedBusinessSuccess', 'businessOutcome', 'approval', 'ledger'].sort());
});

test('an actual revised action retains its revision ledger and approval snapshots exclude undeclared data', async () => {
  const f = fixture(), original = await prepare(f);
  const revised = await f.actions.revise(OWNER, original.id, { text: 'Revised private synthetic payload', targetRow: ROW });
  await f.actions.approve(OWNER, revised.id, revised.digest);
  const action = await f.actions.execute(OWNER, revised.id);
  assert.equal(action.revision, 2);
  await f.store.update(state => { state.actions[0].approval.opaquePayload = { text: SECRET_PAYLOAD }; });
  const receipt = f.resolve(OWNER, action.id, f.store), approval = receipt.snapshot.approval as Record<string, unknown>;
  assert.equal(receipt.snapshot.revision, 2); assert.equal(receipt.snapshot.digest, revised.digest);
  assert.equal(Object.hasOwn(approval, 'opaquePayload'), false);
  assert.equal(JSON.stringify(receipt).includes(SECRET_PAYLOAD), false);
  assert.deepEqual(Object.keys(approval).sort(), ['memberId', 'role', 'epoch', 'digest', 'revision', 'workspaceRevision', 'at'].sort());
  const noRevisionLedger = f.store.read(); noRevisionLedger.activity = noRevisionLedger.activity.filter(item => item.event !== 'action.revised');
  assert.throws(() => f.resolve(OWNER, action.id, readOnly(noRevisionLedger)), code('INVALID_EXECUTION_RECEIPT'));
});

test('lost acknowledgement stays unverified until independent reconciliation and never repeats the write', async () => {
  const f = fixture(); f.disconnect();
  const action = await verified(f);
  assert.equal(action.status, 'unknown'); assert.deepEqual(f.calls(), { writes: 1, readbacks: 0 });
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('EXECUTION_EFFECT_UNVERIFIED'));
  assert.throws(() => f.resolve(OWNER, action.attempts[0].id, f.store), code('EXECUTION_EFFECT_UNVERIFIED'));
  const reconciled = await f.actions.reconcile(OWNER, action.id);
  assert.equal(reconciled.status, 'verified');
  const receipt = f.resolve(OWNER, action.id, f.store);
  assert.equal(receipt.snapshot.businessOutcome, 'not-assessed');
  const ledger = receipt.snapshot.ledger as Record<string, unknown>;
  assert.equal(f.store.read().activity.find(item => item.id === ledger.verificationEventId)!.event, 'action.reconciled');
  assert.deepEqual(f.calls(), { writes: 1, readbacks: 1 });
});

test('prepared, approved, cancelled and independently refuted actions cannot become effect receipts', async () => {
  const f = fixture(), action = await prepare(f);
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('EXECUTION_EFFECT_UNVERIFIED'));
  await f.actions.approve(OWNER, action.id, action.digest);
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('EXECUTION_EFFECT_UNVERIFIED'));
  await f.actions.cancel(OWNER, action.id);
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('EXECUTION_EFFECT_UNVERIFIED'));
  const denied = fixture(); denied.denyEffect(); const failed = await verified(denied);
  assert.equal(failed.status, 'unknown');
  assert.throws(() => denied.resolve(OWNER, failed.id, denied.store), code('EXECUTION_EFFECT_UNVERIFIED'));
  const refuted = await denied.actions.reconcile(OWNER, failed.id);
  assert.equal(refuted.status, 'rejected');
  assert.throws(() => denied.resolve(OWNER, failed.attempts[0].id, denied.store), code('EXECUTION_EFFECT_UNVERIFIED'));
});

test('jobs, operation keys, calculation IDs and unknown IDs are unsupported execution namespaces', async () => {
  const f = fixture(), action = await verified(f);
  await f.store.update(state => { state.jobs.push({ id: 'job_synthetic-unsupported', status: 'accepted' }); state.receipts.push({ id: 'receipt_synthetic-unsupported' }); });
  for (const id of ['job_synthetic-unsupported', 'job_synthetic-unsupported:revision:1:occurrence:synthetic:step:apply',
    'receipt_synthetic-unsupported', 'unknown-execution', action.id + ':invented'])
    assert.throws(() => f.resolve(OWNER, id, f.store), code('EXECUTION_RECEIPT_NOT_FOUND'));
});

test('current operation read authority is required while a later write revocation does not erase verified readback', async () => {
  const f = fixture(), action = await verified(f), before = f.calls();
  await f.store.update(state => { state.imports[0].write = false; });
  assert.equal(f.resolve(VIEWER, action.id, f.store).snapshot.actionId, action.id);
  await f.store.update(state => { state.imports[0].read = false; });
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('FIXTURE_READ_REVOKED'));
  assert.deepEqual(f.calls(), before);
});

test('source, branch and current permission epochs guard action and attempt lookups', async () => {
  const f = fixture(), action = await verified(f);
  assert.equal(f.resolve(VIEWER, action.attempts[0].id, f.store).snapshot.actionId, action.id);
  assert.throws(() => f.resolve({ ...VIEWER, epoch: 0 }, action.id, f.store), code('ACCESS_REVOKED'));
  await f.store.update(state => { state.members.find(item => item.id === VIEWER.memberId)!.branches = ['west']; });
  assert.throws(() => f.resolve(VIEWER, action.id, f.store), code('BRANCH_FORBIDDEN'));
  await f.trust.grantSource(OWNER, { sourceId: SOURCE, memberIds: ['owner'] });
  assert.throws(() => f.resolve(VIEWER, action.attempts[0].id, f.store), code('SOURCE_REVOKED'));
  await f.trust.grantSource(OWNER, { sourceId: SOURCE, revoked: true });
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('SOURCE_REVOKED'));
});

test('empty-source receipts preserve creator epoch privacy and unrestricted owner review', async () => {
  const f = fixture(), action = await verified(f, PRIVATE, []);
  assert.equal(f.resolve(PRIVATE, action.id, f.store).snapshot.actionId, action.id);
  assert.equal(f.resolve(OWNER, action.attempts[0].id, f.store).snapshot.actionId, action.id);
  assert.throws(() => f.resolve(VIEWER, action.id, f.store), code('ACTION_FORBIDDEN'));
  await f.store.update(state => { state.members.find(item => item.id === PRIVATE.memberId)!.epoch = 2; });
  assert.throws(() => f.resolve(PRIVATE, action.id, f.store), code('ACCESS_REVOKED'));
  assert.throws(() => f.resolve({ ...PRIVATE, epoch: 2 }, action.id, f.store), code('ACTION_FORBIDDEN'));
});

test('action, approval, readback and attempt tampering cannot manufacture verified evidence', async () => {
  const f = fixture(), action = await verified(f), base = f.store.read();
  const edits: ((item: PreparedAction) => void)[] = [
    item => { item.payload.text = 'changed payload'; }, item => { item.digest = 'f'.repeat(64); },
    item => { item.approval!.digest = 'e'.repeat(64); }, item => { item.approval!.revision++; },
    item => { item.attempts[0].id = 'attempt_invented'; }, item => { item.attempts[0].outcome = 'unknown'; },
    item => { item.attempts.push(structuredClone(item.attempts[0])); },
    item => { item.readback!.verified = false; }, item => { item.readback!.absent = true; },
    item => { (item.readback as unknown as Record<string, unknown>).absent = 'false'; },
    item => { item.businessSuccess = !item.businessSuccess; },
    item => { item.attempts[0].readback = { ...item.attempts[0].readback!, externalId: 'different-effect' }; },
    item => { delete item.attempts[0].finishedAt; },
  ];
  for (const edit of edits) {
    const draft = structuredClone(base); edit(draft.actions[0]);
    assert.throws(() => f.resolve(OWNER, action.id, readOnly(draft)), code('INVALID_EXECUTION_RECEIPT'));
  }
  const duplicate = structuredClone(base); duplicate.actions.push(structuredClone(duplicate.actions[0]));
  assert.throws(() => f.resolve(OWNER, action.id, readOnly(duplicate)), code('INVALID_EXECUTION_RECEIPT'));
  assert.equal(f.resolve(OWNER, action.id, f.store).snapshot.actionId, action.id);
});

test('missing, contradictory, ambiguous or future durable ledger evidence is refused', async () => {
  const f = fixture(), action = await verified(f), base = f.store.read();
  for (const event of ['action.prepared', 'action.approved', 'action.attempt', 'action.settled']) {
    const draft = structuredClone(base); draft.activity = draft.activity.filter(item => item.event !== event);
    assert.throws(() => f.resolve(OWNER, action.id, readOnly(draft)), code('INVALID_EXECUTION_RECEIPT'));
  }
  const edits: ((state: State) => void)[] = [
    state => { state.activity.find(item => item.event === 'action.attempt')!.details.attemptId = 'wrong-attempt'; },
    state => { state.activity.find(item => item.event === 'action.settled')!.details.outcome = 'unknown'; },
    state => { state.activity.find(item => item.event === 'action.settled')!.details.businessSuccess = true; },
    state => { state.activity.find(item => item.event === 'action.settled')!.at = new Date(Date.now() + 86_400_000).toISOString(); },
    state => { state.activity.find(item => item.event === 'action.settled')!.id = state.activity.find(item => item.event === 'action.attempt')!.id; },
    state => { state.activity.push({ ...structuredClone(state.activity.find(item => item.event === 'action.attempt')!), id: 'duplicate-synthetic-attempt-event' }); },
  ];
  for (const edit of edits) {
    const draft = structuredClone(base); edit(draft);
    assert.throws(() => f.resolve(OWNER, action.id, readOnly(draft)), code('INVALID_EXECUTION_RECEIPT'));
  }
});

test('the supplied transaction draft, rather than the ActionService-bound store, determines current authority and evidence', async () => {
  const f = fixture(), action = await verified(f), base = f.store.read();
  const revoked = structuredClone(base); revoked.imports[0].read = false;
  assert.throws(() => f.resolve(OWNER, action.id, readOnly(revoked)), code('FIXTURE_READ_REVOKED'));
  const missing = structuredClone(base); missing.actions = [];
  assert.throws(() => f.resolve(OWNER, action.id, readOnly(missing)), code('EXECUTION_RECEIPT_NOT_FOUND'));
  const invalid = structuredClone(base); invalid.actions[0].approval.digest = 'f'.repeat(64);
  assert.throws(() => f.resolve(OWNER, action.id, readOnly(invalid)), code('INVALID_EXECUTION_RECEIPT'));
  await f.store.update(state => { state.actions = []; state.imports[0].read = false; });
  assert.equal(f.resolve(OWNER, action.id, readOnly(base)).snapshot.actionId, action.id);
});

test('catalogue removal or changed effect class cannot reuse an old verified receipt', async () => {
  const f = fixture(), action = await verified(f);
  f.actions.operation('synthetic-effects', 'apply').impact = 'money';
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('CATALOGUE_CHANGED'));
  f.actions.registry.delete('synthetic-effects');
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('UNSUPPORTED_ACTION'));
});

test('current retention, identity tombstones and source deletion withhold verified execution receipts', async t => {
  const clock = Date.now(); t.mock.timers.enable({ apis: ['Date'], now: clock });
  const f = fixture(), action = await verified(f);
  const tombstoned = f.store.read(); tombstoned.tombstones.push({ kind: 'payload', digest: action.digest, deletedAt: new Date(clock).toISOString() });
  assert.throws(() => f.resolve(OWNER, action.id, readOnly(tombstoned)), code('EXECUTION_RECEIPT_DELETED'));
  t.mock.timers.setTime(clock + 91 * 86_400_000);
  assert.throws(() => f.resolve(OWNER, action.attempts[0].id, f.store), code('EXECUTION_RECEIPT_EXPIRED'));
  await f.trust.cleanup(OWNER);
  assert.throws(() => f.resolve(OWNER, action.id, f.store), code('EXECUTION_RECEIPT_NOT_FOUND'));
  t.mock.timers.setTime(clock);
  const deleted = fixture(), second = await verified(deleted);
  await deleted.trust.deleteSource(OWNER, SOURCE);
  assert.throws(() => deleted.resolve(OWNER, second.id, deleted.store), code('EXECUTION_RECEIPT_NOT_FOUND'));
});

test('the real decision journal retains verified execution metadata and rechecks current read and source access', async () => {
  const f = fixture(), action = await verified(f), reports = new ReportService(f.store, { executionReceipt: f.resolve });
  const content: JournalContent = {
    text: 'Review this synthetic operational intervention after its observation window.',
    options: [{ id: 'observe', label: 'Observe', reason: 'Wait for independent business evidence.', evidence: [] }],
    assumptions: [{ id: 'lag', text: 'The business result may require a later observation.', status: 'unverified', evidence: [] }],
    selectedOptionId: 'observe', ownerId: OWNER.memberId, branch: 'main',
    expectedOutcome: { description: 'Observe the synthetic business result.', measure: 'human-reviewed outcome',
      population: 'synthetic fixture', window: { from: '2026-10-01', to: '2026-10-10' }, maturityDate: '2026-10-15',
      lagRule: 'Review after the declared window.', uncertainty: ['Execution verification does not establish business achievement.'] },
    reviewDate: '2026-10-15', hypotheses: ['The objective has not been measured.'],
  };
  const draft = reports.draftDecision(OWNER, content), saved = await reports.confirmDecision(OWNER, draft, { reviewedDigest: draft.digest });
  const review = { outcome: 'continue' as const, observation: { state: 'pending' as const, measurements: [],
    notes: 'A synthetic effect was verified; the business objective still awaits observation.', uncertainty: ['No causal conclusion follows.'],
    concurrentInterventions: [], executionReceiptIds: [action.id] } };
  const reviewed = await reports.reviewJournalDecision(OWNER, saved.id, review, { expectedRevision: 1 });
  const execution = reviewed.reviews[0].executionReceipts![0];
  assert.equal(execution.id, action.id); assert.deepEqual(execution.sourceIds, [SOURCE]);
  assert.equal(execution.snapshot.kind, 'verified-action-execution');
  assert.equal(execution.snapshot.businessOutcome, 'not-assessed');
  assert.equal(reviewed.reviews[0].observation.state, 'pending');
  assert.equal(reports.decisions(OWNER).length, 1);
  await f.store.update(state => { state.imports[0].read = false; });
  assert.deepEqual(reports.decisions(OWNER), []);
  await assert.rejects(reports.reviewJournalDecision(OWNER, saved.id, review, { expectedRevision: 2 }));
  assert.equal(f.store.read().decisions[0].revision, 2);
  await f.store.update(state => { state.imports[0].read = true; });
  await f.trust.grantSource(OWNER, { sourceId: SOURCE, revoked: true });
  assert.deepEqual(reports.decisions(OWNER), []);
  await assert.rejects(reports.reviewJournalDecision(OWNER, saved.id, review, { expectedRevision: 2 }));
  assert.equal(f.store.read().decisions[0].revision, 2);
});
