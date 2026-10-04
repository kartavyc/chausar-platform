import test from 'node:test';
import assert from 'node:assert/strict';
import { check, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService, digest, sourceAccess } from '../runtime/actions.ts';
import type { PreparedAction } from '../runtime/actions.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { ImportService } from '../runtime/ingest.ts';
import type { MappingRecipe } from '../runtime/ingest.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { JobService } from '../runtime/jobs.ts';
import type { JobConfig } from '../runtime/jobs.ts';
import { createEngineJobRunner } from '../runtime/engine-jobs.ts';
import { createEngineLessonService } from '../runtime/engine-lessons.ts';
import { lessonEvaluationDigest } from '../runtime/lessons.ts';
import type {
  LessonCandidate, LessonDecision, LessonEvaluationAuthority, LessonEvaluationReference,
  LessonEvaluationResult, LessonPin, LessonProposal, LessonTarget, LessonTargetAuthority, LessonView,
} from '../runtime/lesson-contracts.ts';
import { TodayReviewService } from '../runtime/today-review.ts';

const owner: Context = { memberId: 'owner', epoch: 1, role: 'owner', channel: 'desktop' };
const cofounder: Context = { memberId: 'cofounder', epoch: 1, role: 'cofounder', channel: 'desktop' };
const accountant: Context = { memberId: 'accountant', epoch: 1, role: 'accountant', channel: 'desktop' };
const pin = (candidate: LessonCandidate): LessonPin => ({ id: candidate.id, revision: candidate.revision, digest: candidate.digest });
const jsonDigest = (value: unknown) => digest(JSON.parse(JSON.stringify(value)));
const code = (expected: string) => (failure: unknown) => !!failure && typeof failure === 'object' && 'code' in failure && failure.code === expected;

class AtomicStore implements StateStore {
  state = initialState('Synthetic imported Today review source proof', false);
  private queue: Promise<unknown> = Promise.resolve();
  read(): State { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const draft = this.read(), result = await change(draft);
      draft.revision++; this.state = draft; return structuredClone(result);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

const recipe: MappingRecipe = {
  version: 1, id: 'synthetic-today-sales-v1', system: 'synthetic-csv', edition: '1',
  scope: { company: 'Synthetic Today review company', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
    ...['currency', 'status', 'branch'].map(target => ({ target, source: target, type: 'string' as const, nulls: 'reject' as const })),
  ],
  allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
};

/** Real runtime services over generated CSV. Installed personal/evaluation ports are synthetic protocol evidence only. */
async function fixture() {
  const store = new AtomicStore();
  store.state.members[0].branches = ['main'];
  store.state.members.push(
    { id: cofounder.memberId, name: 'Synthetic cofounder', role: 'cofounder', epoch: 1, active: true, branches: ['main'] },
    { id: accountant.memberId, name: 'Synthetic accountant', role: 'accountant', epoch: 1, active: true, branches: ['main'] },
  );
  store.state.policy.allowedSources = ['today-review-import'];
  store.state.policy.autonomy = true;
  await new OntologyService(store).publish(owner, 'ecommerce');
  const imported = await new ImportService(store).commit(owner, {
    sourceId: 'today-review-import', format: 'csv', recipe,
    content: 'id,kind,date,amount,currency,status,branch\nsale-1,sale,2026-09-15,1200,INR,delivered,main\nsale-2,sale,2026-09-16,2300,INR,delivered,main',
    expectedTotals: { rowCount: 2, amountMinor: '3500' },
  });
  const calculator = new CalculatorService(store);
  const receipt = await calculator.calculate(owner, { operation: 'earned', period: { from: '2026-09-01', to: '2026-09-30' }, sourceIds: ['today-review-import'], branch: 'main' });
  assert.equal(receipt.valueMinor, '3500');
  assert.equal(imported.qualification, 'experimental');
  assert.equal(receipt.coverage.completeness, 'reconciled-imports');
  assert.deepEqual(new Set(receipt.rowIds), new Set(imported.rowIds));
  let executionCalls = 0, readbackCalls = 0, providerCalls = 0, actionReadable = true, outputReleased = true;
  const actions = new ActionService(store, [{
    id: 'synthetic-review', title: 'Synthetic source review', operations: {
      annotate: {
        title: 'Review generated sales', description: 'Synthetic reversible local annotation preview', impact: 'reversible',
        idempotency: 'Exact synthetic annotation key', readback: 'Synthetic protocol readback is never invoked by Today reads',
        validate(payload) {
          check(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_SYNTHETIC_PREVIEW', 'Supply the explicit synthetic preview.');
          const value = payload as Record<string, unknown>;
          check(typeof value.receiptId === 'string' && typeof value.note === 'string', 'INVALID_SYNTHETIC_PREVIEW', 'Pin a real imported calculation receipt.');
          return value;
        },
        authorize(state, context, mode) {
          sourceAccess(state, context, ['today-review-import']);
          check(mode !== 'read' || actionReadable, 'SYNTHETIC_ACTION_READ_WITHHELD', 'The installed synthetic source authority withheld this preview.');
        },
        async execute() { executionCalls++; throw new Error('Today source proof must never execute an action.'); },
        async reconcile() { readbackCalls++; throw new Error('Today source proof must never invoke action readback.'); },
      },
    },
  }]);
  const currentReceipt = (context: Context, receiptId = receipt.id) => {
    const current = calculator.receipt(context, receiptId);
    check(!current.stale, 'SYNTHETIC_RECEIPT_STALE', 'Only the current real imported receipt is usable by the synthetic installed authority.');
    return current;
  };
  const jobs = new JobService(store, { clock: () => Date.parse('2026-10-03T12:00:00.000Z') });
  const host = createEngineJobRunner(store, jobs, actions, {}, { workerId: 'synthetic-today-source', maxActiveJobs: 20, leaseMs: 1000, networkAvailable: () => true });
  const localCalculation = host.providers.get('local-calculation')!;
  assert.equal(localCalculation.kind, 'read-only');
  if (localCalculation.kind === 'read-only') {
    const dispatch = localCalculation.dispatch;
    localCalculation.dispatch = async request => { providerCalls++; return dispatch(request); };
  }
  jobs.deliverableGuard = (context, job) => outputReleased && host.canRelease(context, job);
  function jobConfig(patch: Partial<JobConfig> = {}): Omit<JobConfig, 'plan'> & { type: string } {
    return {
      type: 'calculation-set', goal: 'Review generated source evidence',
      input: { requests: [{ id: 'earned-source-proof', input: { operation: 'earned', sourceIds: ['today-review-import'], branch: 'main', period: { from: '2026-09-01', to: '2026-09-30' } }, reserveMinor: '10', durationMs: 1000 }] },
      budgetMinor: '20', reserveMinor: '10', limits: { durationMs: 2000, modelUnits: 0, actionExposureMinor: '0' },
      sourceIds: ['today-review-import'], allowedActions: ['synthetic-review.annotate'], testedRoutes: [], background: false,
      requiresApproval: false, stopRule: { maxRuns: 1, deadline: '2026-10-05T12:00:00.000Z' },
      nextRunAt: '2026-10-03T12:00:00.000Z', intervalMs: 60000, catchup: 'latest', graceMs: 0, ...patch,
    };
  }
  const previewConfig = (note: string) => jobConfig({ type: 'action-preparation', input: { actions: [{ id: 'generated-annotation', input: { connector: 'synthetic-review', operation: 'annotate', payload: { receiptId: receipt.id, note }, sourceIds: ['today-review-import'] }, reserveMinor: '10', durationMs: 1000 }] } });
  const target: LessonTarget = {
    kind: 'personal-preference', id: 'synthetic-today-summary', revision: 'synthetic-target-v1', digest: '',
    owner: { memberId: 'owner', role: 'owner', epoch: 1 }, value: 'overview-first',
  };
  const repinTarget = () => { const { digest: ignored, ...body } = target; target.digest = digest(body); };
  repinTarget();
  let targetAccess = true, evaluationAccess = true;
  const evaluationRuns = new Map<string, LessonEvaluationResult>();
  const targets: LessonTargetAuthority = {
    authorityRevision: () => digest({ target, targetAccess }),
    resolve(context, requested) {
      check(targetAccess && requested.kind === target.kind && requested.id === target.id && context.memberId === target.owner.memberId && context.epoch === target.owner.epoch && context.role === target.owner.role,
        'SYNTHETIC_TARGET_WITHHELD', 'The explicitly installed synthetic personal target is currently unavailable.');
      return structuredClone(target);
    },
    validateChange(_context, _target, after) {
      check(typeof after === 'string' && ['overview-first', 'receipt-first', 'details-first'].includes(after), 'SYNTHETIC_TARGET_SCHEMA', 'Only the three explicit fixture preference choices exist.');
    },
  };
  const evaluations: LessonEvaluationAuthority = {
    authorityRevision: () => digest({ runs: [...evaluationRuns.entries()], evaluationAccess }),
    resolve(_context, reference) {
      const run = evaluationRuns.get(reference.id);
      check(evaluationAccess && run && digest(run.reference) === digest(reference), 'SYNTHETIC_EVALUATION_WITHHELD', 'Resolve an exact completed synthetic protocol run.');
      return structuredClone(run);
    },
    assertSourceAccess(context, sourceIds) { sourceAccess(store.read(), context, sourceIds); },
  };
  const lessons = createEngineLessonService(store, { targets, evaluations,
    evidenceResolver(state, context, reference) {
      check(reference.kind === 'calculation', 'SYNTHETIC_EVIDENCE_UNKNOWN', 'This explicit protocol authority uses real generated calculation receipts only.');
      const snapshotReceipt = state.receipts.find(record => record.id === reference.id);
      const current = currentReceipt(context, reference.id);
      check(snapshotReceipt && jsonDigest(snapshotReceipt) === jsonDigest(current), 'SYNTHETIC_EVIDENCE_CHANGED', 'The real calculation authority and the supplied transaction snapshot must agree.');
      return {
        pin: { kind: 'calculation', id: current.id, revision: current.createdAt, digest: jsonDigest(current), sourceIds: [...current.sourceIds].sort(), branchIds: ['main'] },
        available: true, sourceTainted: false,
        sourceMarkings: [{ sourceId: 'today-review-import', marking: 'Synthetic protocol classification: generated sales receipt; no imported text is promoted as an instruction.' }],
        summary: 'Explicit synthetic protocol evidence for the real imported sales calculation receipt.',
      };
    },
  });
  function proposal(task = 'synthetic-today-summary', overrides: Partial<LessonProposal> = {}): LessonProposal {
    return {
      title: 'Review generated sales', rationale: 'Explicit synthetic protocol proposal based on the generated imported calculation.',
      evidence: [{ kind: 'calculation', id: receipt.id }],
      change: { kind: target.kind, targetId: target.id, before: 'overview-first', after: 'receipt-first' },
      applicability: { memberId: 'owner', branchIds: ['main'], sourceIds: ['today-review-import'], conditions: { task } },
      counterexamples: [{ conditions: { task: 'urgent-summary' }, reason: 'The explicit urgent-summary condition retains the current preference.' }],
      ...structuredClone(overrides),
    };
  }
  function registerEvaluations(candidate: LessonPin, pass = true) {
    const references = {} as { open: LessonEvaluationReference; hidden: LessonEvaluationReference };
    for (const set of ['open', 'hidden'] as const) {
      const artifact = (id: string) => ({ id, revision: 'synthetic-protocol-v1', digest: digest({ id, qualification: 'synthetic-protocol' }) });
      const result: LessonEvaluationResult = {
        reference: { id: `${candidate.id}-${candidate.revision}-${set}`, revision: 'synthetic-run-v1', digest: '' },
        candidate: structuredClone(candidate), set, authorityId: 'synthetic-today-protocol', qualification: 'synthetic-protocol',
        suite: artifact(`synthetic-${set}-suite`), harness: artifact(`synthetic-${set}-harness`), build: artifact('synthetic-build'), configuration: artifact('synthetic-config'),
        comparisonId: `synthetic-comparison-${candidate.id}-${candidate.revision}`, completedAt: '2026-10-03T12:00:00.000Z', status: 'complete',
        baseline: { guidance: 'off', digest: digest({ candidate, fixture: 'synthetic-protocol-baseline' }) }, treatment: { guidance: 'on', candidate: structuredClone(candidate) },
        metrics: [{ name: 'explicit-synthetic-protocol-score', direction: 'higher-is-better', before: 8, after: pass ? 9 : 7 }],
        sourceTainted: false, sourceIds: ['today-review-import'],
      };
      result.reference.digest = lessonEvaluationDigest(result);
      evaluationRuns.set(result.reference.id, structuredClone(result)); references[set] = structuredClone(result.reference);
    }
    return references;
  }
  async function ready(input = proposal(), humanReview = true): Promise<LessonView> {
    const proposed = await lessons.propose(owner, input), candidate = pin(proposed.candidate);
    const bound = await lessons.bindEvaluations(owner, candidate, registerEvaluations(candidate));
    return humanReview ? lessons.review(owner, candidate) : bound;
  }
  const decision = (view: LessonView, choice: LessonDecision['decision']): LessonDecision => {
    assert.ok(view.review);
    return { candidate: pin(view.candidate), reviewId: view.review.id, reviewDigest: view.review.digest, decision: choice, reason: 'The human owner decides this exact synthetic protocol proposal.' };
  };
  const review = new TodayReviewService(store, { actions, jobs, lessons: { service: lessons, targets, evaluations } });
  const prepare = (note: string, context = owner) => actions.prepare(context, { connector: 'synthetic-review', operation: 'annotate', payload: { receiptId: receipt.id, note }, sourceIds: ['today-review-import'], idempotencyKey: `synthetic-today-${note}` });
  return {
    store, imported, receipt, actions, jobs, host, lessons, targets, evaluations, target, evaluationRuns,
    review, prepare, proposal, registerEvaluations, ready, decision, jobConfig, previewConfig, repinTarget,
    calls: () => ({ executionCalls, readbackCalls, providerCalls }),
    actionReadable: (value: boolean) => { actionReadable = value; },
    outputReleased: (value: boolean) => { outputReleased = value; },
    targetAccess: (value: boolean) => { targetAccess = value; },
    evaluationAccess: (value: boolean) => { evaluationAccess = value; },
  };
}

test('real imported services produce seven scoped obligations, first four rows, full continuation and exact action provenance', async () => {
  const f = await fixture();
  const first = await f.prepare('first'), second = await f.prepare('second');
  const mandate = await f.host.create(owner, f.jobConfig({ requiresApproval: true }));
  const calculation = await f.host.create(owner, f.jobConfig());
  assert.equal((await f.host.run(owner, calculation.id)).status, 'awaiting-acceptance');
  const preview = await f.host.create(owner, f.previewConfig('runner-preview'));
  assert.equal((await f.host.run(owner, preview.id)).status, 'awaiting-acceptance');
  const prepared = f.store.state.actions.find((action: PreparedAction) => action.id !== first.id && action.id !== second.id) as PreparedAction;
  assert.ok(prepared); assert.equal(prepared.status, 'prepared'); assert.equal(prepared.attempts.length, 0);
  const lesson = await f.ready();
  assert.equal(lesson.evaluation?.open.qualification, 'synthetic-protocol');
  const before = jsonDigest(f.store.read()), calls = f.calls(), evaluationsBefore = jsonDigest([...f.evaluationRuns.entries()]), targetBefore = jsonDigest(f.target);
  const today = f.review.list(owner);
  assert.equal(today.completeness, 'complete'); assert.equal(today.count, 7); assert.equal(today.knownCount, 7);
  assert.equal(today.rows.length, 4); assert.ok(today.nextCursor);
  const rows = [] as typeof today.rows;
  let page = f.review.list(owner, { limit: 2 });
  for (let pages = 0; ; pages++) {
    assert.ok(pages < 5, 'The bounded full queue must reach every eligible obligation.');
    assert.equal(page.count, 7); rows.push(...page.rows);
    if (!page.nextCursor) break;
    page = f.review.list(owner, { limit: 2, cursor: page.nextCursor });
  }
  assert.equal(rows.length, 7); assert.equal(new Set(rows.map(row => jsonDigest(row.reference))).size, 7);
  assert.deepEqual(today.rows, rows.slice(0, 4), 'The default preview and full continuation use the same ordered authorized set.');
  assert.deepEqual(rows.filter(row => row.kind === 'action-approval').map(row => row.reference.id).sort(), [first.id, second.id, prepared.id].sort());
  assert.deepEqual(rows.filter(row => row.kind === 'job-approval').map(row => row.reference.id), [mandate.id]);
  assert.deepEqual(rows.filter(row => row.kind === 'job-acceptance').map(row => row.reference.id).sort(), [calculation.id, preview.id].sort());
  const alias = rows.find(row => row.reference.id === prepared.id)!;
  assert.equal(alias.provenance.length, 2, 'The same exact action gets its direct and persisted job-preparation provenance.');
  assert.deepEqual(alias.provenance.find(item => item.producer === 'job-action-preview'), {
    producer: 'job-action-preview', id: preview.id, revision: preview.revision, digest: preview.digest,
    stepId: 'generated-annotation', operationKey: prepared.idempotencyKey, actionId: prepared.id, actionDigest: prepared.digest,
    deliverableDigest: digest(f.jobs.list(owner).find(job => job.id === preview.id)!.deliverable),
  });
  assert.equal(alias.reference.digest, prepared.digest); assert.equal(alias.reference.revision, prepared.revision);
  const lessonRow = rows.find(row => row.kind === 'lesson-decision')!;
  assert.equal(lessonRow.reference.id, lesson.candidate.id);
  assert.equal(lessonRow.reference.revision, lesson.candidate.revision);
  assert.equal(lessonRow.reference.digest, lesson.candidate.digest);
  assert.ok('reviewId' in lessonRow.reference && 'reviewDigest' in lessonRow.reference && 'evaluationDigest' in lessonRow.reference);
  assert.equal(lessonRow.reference.reviewId, lesson.review!.id);
  assert.equal(lessonRow.reference.reviewDigest, lesson.review!.digest);
  assert.equal(lessonRow.reference.evaluationDigest, lesson.evaluation!.digest);
  for (const row of rows) {
    assert.deepEqual(f.review.resolve(owner, row.reference), row);
    if (row.kind === 'action-approval' || row.kind === 'job-approval') {
      assert.deepEqual(row.request, { method: row.kind === 'action-approval' ? 'actions.approve' : 'jobs.approve', payload: { id: row.reference.id, digest: row.reference.digest } });
    } else if (row.kind === 'job-acceptance') {
      assert.deepEqual(row.request, { method: 'jobs.accept', payload: { id: row.reference.id } });
      assert.ok('deliverableDigest' in row.reference);
      assert.equal(row.reference.deliverableDigest, digest(f.jobs.list(owner).find(job => job.id === row.reference.id)!.deliverable));
    } else {
      assert.deepEqual(row.request, { method: 'memory.decideLesson', payload: { candidate: pin(lesson.candidate), reviewId: lesson.review!.id, reviewDigest: lesson.review!.digest }, requiredHumanFields: ['decision', 'reason'] });
    }
  }
  assert.ok(rows.every(row => row.canApprove));
  assert.equal(jsonDigest(f.store.read()), before, 'Listing, paging and resolving must never issue a lesson review or mutate business state.');
  assert.equal(jsonDigest([...f.evaluationRuns.entries()]), evaluationsBefore); assert.deepEqual(f.calls(), calls);
  assert.equal(jsonDigest(f.target), targetBefore, 'The external target authority is also read-only.');
  assert.equal(f.calls().executionCalls, 0); assert.equal(f.calls().readbackCalls, 0); assert.equal(f.calls().providerCalls, 1);
});

test('released real job output is required for acceptance and hidden output removes its preparation aliases', async () => {
  const f = await fixture();
  const privateGoal = 'PRIVATE_SYNTHETIC_HELD_DELIVERABLE_GOAL';
  const job = await f.host.create(owner, { ...f.previewConfig('held-preview'), goal: privateGoal });
  assert.equal((await f.host.run(owner, job.id)).status, 'awaiting-acceptance');
  const released = f.review.list(owner);
  assert.equal(released.count, 2);
  const acceptance = released.rows.find(row => row.kind === 'job-acceptance')!;
  const action = released.rows.find(row => row.kind === 'action-approval')!;
  const before = jsonDigest(f.store.read()); f.outputReleased(false);
  assert.equal(Object.hasOwn(f.jobs.list(owner)[0], 'deliverable'), false);
  const held = f.review.list(owner);
  assert.equal(held.count, null); assert.equal(held.knownCount, 1); assert.equal(held.completeness, 'incomplete');
  assert.equal(held.rows[0].reference.id, action.reference.id);
  assert.equal(held.rows[0].provenance.length, 1);
  assert.equal(JSON.stringify(held).includes(job.id), false, 'Withheld output must not reveal its names or provenance.');
  assert.equal(JSON.stringify(held).includes(privateGoal), false);
  assert.throws(() => f.review.resolve(owner, acceptance.reference), code('REVIEW_REFERENCE_UNAVAILABLE'));
  assert.equal(jsonDigest(f.store.read()), before); assert.equal(f.calls().executionCalls, 0);
});

test('a released review-ready lesson needs an existing exact human review; all lifecycle states remain distinct', async t => {
  for (const status of ['proposed', 'evaluation-blocked', 'review-ready', 'approved', 'rejected', 'deferred', 'retired', 'superseded'] as const) {
    await t.test(status, async () => {
      const f = await fixture();
      let view = await f.lessons.propose(owner, f.proposal());
      if (status !== 'proposed') {
        const candidate = pin(view.candidate);
        view = await f.lessons.bindEvaluations(owner, candidate, f.registerEvaluations(candidate, status !== 'evaluation-blocked'));
      }
      if (!['proposed', 'evaluation-blocked'].includes(status)) {
        const unreviewed = f.review.list(owner), before = jsonDigest(f.store.read());
        assert.equal(unreviewed.count, 0, 'A passing evaluation alone must not issue or imply a human review token.');
        assert.equal(jsonDigest(f.store.read()), before);
        view = await f.lessons.review(owner, pin(view.candidate));
      }
      if (['approved', 'retired', 'superseded'].includes(status)) view = await f.lessons.decideLesson(owner, f.decision(view, 'approve'));
      if (status === 'rejected' || status === 'deferred') view = await f.lessons.decideLesson(owner, f.decision(view, status === 'rejected' ? 'reject' : 'defer'));
      if (status === 'retired') view = await f.lessons.retire(owner, pin(view.candidate), 'Explicit synthetic retirement.');
      if (status === 'superseded') {
        const successor = await f.ready(f.proposal('synthetic-today-summary', {
          change: { kind: 'personal-preference', targetId: f.target.id, before: 'receipt-first', after: 'details-first' }, supersedes: pin(view.candidate),
        }));
        await f.lessons.decideLesson(owner, f.decision(successor, 'approve'));
        assert.equal(f.lessons.history(owner, view.candidate.id).events.at(-1)?.type, 'supersede');
      } else assert.equal(view.status, status);
      const before = jsonDigest(f.store.read()), queue = f.review.list(owner);
      assert.equal(queue.count, status === 'review-ready' ? 1 : 0);
      assert.ok(queue.rows.every(row => row.kind === 'lesson-decision'));
      assert.equal(jsonDigest(f.store.read()), before);
    });
  }
});

test('lesson references bind the exact review and candidate revision, and source, target and evaluation authorities are current', async t => {
  for (const change of ['review', 'revision', 'source', 'receipt', 'target-value', 'target-access', 'evaluation-result', 'evaluation-access', 'epoch', 'role'] as const) {
    await t.test(change, async () => {
      const f = await fixture(), reviewed = await f.ready();
      const row = f.review.list(owner).rows[0]; assert.equal(row.kind, 'lesson-decision');
      if (change === 'review') await f.lessons.review(owner, pin(reviewed.candidate));
      if (change === 'revision') await f.lessons.revise(owner, pin(reviewed.candidate), f.proposal('revised-task'));
      if (change === 'source') f.store.state.sourceRules.push({ sourceId: 'today-review-import', revoked: true });
      if (change === 'receipt') f.store.state.receipts[0].stale = true;
      if (change === 'target-value') { f.target.value = 'details-first'; f.target.revision = 'synthetic-target-v2'; f.repinTarget(); }
      if (change === 'target-access') f.targetAccess(false);
      if (change === 'evaluation-result') {
        const run = f.evaluationRuns.get(reviewed.evaluation!.hidden.reference.id)!;
        run.status = 'declined'; run.reference.digest = lessonEvaluationDigest(run);
      }
      if (change === 'evaluation-access') f.evaluationAccess(false);
      if (change === 'epoch') f.store.state.members[0].epoch++;
      if (change === 'role') f.store.state.members[0].role = 'cofounder';
      const context = change === 'epoch' ? { ...owner, epoch: 2 } : change === 'role' ? { ...owner, role: 'cofounder' as const } : owner;
      const before = jsonDigest(f.store.read());
      assert.throws(() => f.review.resolve(context, row.reference), code('REVIEW_REFERENCE_UNAVAILABLE'));
      const queue = f.review.list(context);
      if (['receipt', 'target-value', 'target-access', 'evaluation-result', 'evaluation-access'].includes(change)) {
        assert.equal(queue.completeness, 'incomplete'); assert.equal(queue.count, null); assert.equal(queue.knownCount, 0);
        assert.equal(queue.producers.lessons.status, 'incomplete');
      } else assert.equal(queue.count, change === 'review' ? 1 : 0);
      if (change === 'review') assert.notDeepEqual(queue.rows[0].reference, row.reference);
      else assert.equal(JSON.stringify(queue).includes(reviewed.candidate.title), false);
      assert.equal(jsonDigest(f.store.read()), before);
    });
  }
});

test('a retained approved lesson still blocks approval of an overlapping released review when predecessor evaluation authority is withheld', async () => {
  const f = await fixture();
  const predecessor = await f.ready(f.proposal('shared-explicit-task'));
  await f.lessons.decideLesson(owner, f.decision(predecessor, 'approve'));
  const candidate = await f.ready(f.proposal('shared-explicit-task', {
    change: { kind: f.target.kind, targetId: f.target.id, before: 'overview-first', after: 'details-first' },
  }));
  f.evaluationRuns.delete(predecessor.evaluation!.hidden.reference.id);
  assert.equal(f.lessons.lessons(owner).some(view => view.candidate.id === predecessor.candidate.id), false);
  assert.equal(f.lessons.lessons(owner).some(view => view.candidate.id === candidate.candidate.id), true);
  const before = jsonDigest(f.store.read()), queue = f.review.list(owner);
  assert.equal(queue.completeness, 'incomplete'); assert.equal(queue.count, null); assert.equal(queue.knownCount, 1);
  assert.equal(queue.rows.length, 1); assert.equal(queue.rows[0].reference.id, candidate.candidate.id);
  assert.equal(queue.rows[0].canApprove, false, 'The real decision service still enforces the retained approved overlap.');
  assert.equal(JSON.stringify(queue).includes(predecessor.candidate.id), false, 'Missing current authority must not disclose the withheld predecessor.');
  assert.deepEqual(f.review.resolve(owner, queue.rows[0].reference), queue.rows[0]);
  assert.equal(jsonDigest(f.store.read()), before);
  await assert.rejects(f.lessons.decideLesson(owner, f.decision(candidate, 'approve')), code('LESSON_CONFLICT'));
  assert.equal(jsonDigest(f.store.read()), before, 'The real lesson service rolls back the refused approval.');
});

test('hidden approved guidance from a prior epoch or role still blocks a fresh same-member overlapping lesson', async t => {
  for (const change of ['epoch', 'role'] as const) {
    await t.test(change, async () => {
      const f = await fixture(), privateTitle = 'PRIVATE_SYNTHETIC_PRIOR_ACTOR_GUIDANCE';
      const task = 'same-member-explicit-summary';
      const previous = await f.ready(f.proposal(task, { title: privateTitle }));
      await f.lessons.decideLesson(owner, f.decision(previous, 'approve'));
      const context: Context = change === 'epoch' ? { ...owner, epoch: 2 } : { ...owner, role: 'cofounder' };
      f.store.state.members[0].epoch = context.epoch; f.store.state.members[0].role = context.role;
      f.target.owner = { memberId: context.memberId, role: context.role, epoch: context.epoch };
      f.target.revision = 'synthetic-current-actor-target-v2'; f.repinTarget();
      const receipt = await new CalculatorService(f.store).calculate(context, {
        operation: 'earned', period: { from: '2026-09-01', to: '2026-09-30' }, sourceIds: ['today-review-import'], branch: 'main',
      });
      assert.equal(receipt.valueMinor, '3500');
      const proposed = await f.lessons.propose(context, f.proposal(task, {
        title: 'Current actor generated-sales preference', evidence: [{ kind: 'calculation', id: receipt.id }],
        change: { kind: f.target.kind, targetId: f.target.id, before: 'overview-first', after: 'details-first' },
      }));
      const candidate = pin(proposed.candidate);
      await f.lessons.bindEvaluations(context, candidate, f.registerEvaluations(candidate));
      const reviewed = await f.lessons.review(context, candidate);
      assert.deepEqual(f.lessons.lessons(context).map(view => view.candidate.id), [candidate.id]);
      const before = jsonDigest(f.store.read()), queue = f.review.list(context);
      assert.equal(queue.completeness, 'complete'); assert.equal(queue.count, 1); assert.equal(queue.knownCount, 1);
      assert.equal(queue.rows.length, 1); assert.equal(queue.rows[0].reference.id, candidate.id);
      assert.equal(queue.rows[0].canApprove, false, 'Real lesson overlap uses the same member ID across permission epochs and roles.');
      assert.equal(JSON.stringify(queue).includes(previous.candidate.id), false); assert.equal(JSON.stringify(queue).includes(privateTitle), false);
      assert.deepEqual(f.review.resolve(context, queue.rows[0].reference), queue.rows[0]);
      assert.equal(jsonDigest(f.store.read()), before);
      await assert.rejects(f.lessons.decideLesson(context, f.decision(reviewed, 'approve')), code('LESSON_CONFLICT'));
      assert.equal(jsonDigest(f.store.read()), before);
    });
  }
});

test('real job mandate approvals disappear once valid, exact owner roles stay private, and current action visibility is separate from approval permission', async () => {
  const f = await fixture(), action = await f.prepare('shared-preview');
  const privateGoal = 'PRIVATE_SYNTHETIC_MANDATE_REVIEW_GOAL';
  const job = await f.host.create(owner, f.jobConfig({ requiresApproval: true, goal: privateGoal }));
  assert.equal((await f.host.run(owner, job.id)).status, 'approval-blocked');
  const queue = f.review.list(owner), reference = queue.rows.find(row => row.kind === 'job-approval')!.reference;
  assert.equal(queue.count, 2);
  const visible = f.review.list(accountant);
  assert.equal(visible.count, 1); assert.equal(visible.rows[0].reference.id, action.id); assert.equal(visible.rows[0].canApprove, false);
  assert.equal(JSON.stringify(visible).includes(job.id), false);
  assert.equal(JSON.stringify(visible).includes(privateGoal), false);
  const otherOwner = f.review.list(cofounder);
  assert.equal(otherOwner.count, 1); assert.equal(otherOwner.rows[0].canApprove, true);
  assert.equal(JSON.stringify(otherOwner).includes(privateGoal), false);
  await f.jobs.approve(owner, job.id, job.digest);
  assert.equal(f.review.list(owner).count, 1);
  assert.throws(() => f.review.resolve(owner, reference), code('REVIEW_REFERENCE_UNAVAILABLE'));
  f.actionReadable(false);
  assert.equal(f.review.list(owner).count, 0);
  const before = jsonDigest(f.store.read());
  assert.throws(() => f.review.resolve(owner, queue.rows.find(row => row.kind === 'action-approval')!.reference), code('REVIEW_REFERENCE_UNAVAILABLE'));
  assert.equal(jsonDigest(f.store.read()), before); assert.equal(f.calls().executionCalls, 0);
});
