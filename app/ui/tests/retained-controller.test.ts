import { createDesktopRequestPort } from '../src/bridge/client.ts';
import { loadElectronPreloadFixture } from '../../../platform/tests/fixtures/electron-context-bridge.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHostController } from '../src/host/controller.ts';
import type { HostRpcPayloads, HostRpcPort, UiContext } from '../src/host/contracts.ts';
import {
  lessonDecisionAvailability, retainedFailureCode, scenarioColumns, scenarioOutcomeFigure, scenarioProof,
  validateLessonReviewList, validateLessonReviewView, validateRetainedScenarioView, validateScenarioSelection,
} from '../src/host/retained-contracts.ts';
import type { LessonDecisionIntent, LessonStatus, RetainedScenarioView } from '../src/host/retained-contracts.ts';
import { fullCalculationReceiptFixture, HUGE_INTEGER } from './fixtures.ts';

/**
 * Synthetic host transport only: no vault, Engine, network, native IPC, provider or model.
 * Scenario and lesson fixtures follow the actual producer shapes (calculator.ts price-scenario
 * figures and assumptions, lesson-evidence.ts released evidence, lessons.ts candidate rules) but
 * carry no real business figures, and every evaluation fixture is `synthetic-protocol`: lifecycle
 * verification, never a real hidden-suite acceptance or a real business qualification. The native
 * desktop method refusals remain covered by the explicit INVALID_REQUEST transport case.
 */
const hex = (character: string) => character.repeat(64);
const AT = '2026-10-01T09:00:00.000Z';
/** The only methods this frontend may ever dispatch; everything else is asserted absent by name. */
const ALLOWED_METHODS = ['ui.context', 'dashboard.get', 'receipts.get', 'models.list', 'workspace.lock', 'scenarios.reopen', 'memory.lessons', 'memory.decideLesson'];
const context = (contextKey = 'a'.repeat(64), role = 'owner') => ({ workspace: { id: 'workspace_fixture', name: 'Synthetic host fixture', demo: true }, member: { id: 'member_fixture', name: 'Fixture owner', role, epoch: 1, branches: ['*'] }, contextKey });
const uiContext = (role: 'owner' | 'cofounder' | 'accountant' | 'viewer' = 'owner', workspaceId = 'workspace_fixture'): UiContext => ({ workspace: { id: workspaceId, name: 'Synthetic host fixture', demo: true }, member: { id: 'member_fixture', name: 'Fixture owner', role, epoch: 1, branches: ['*'] as readonly string[] }, contextKey: 'a'.repeat(64) });
const route = { id: 'route_fixture', kind: 'codex-cli', model: 'model_fixture', enabled: true, installationVerified: false, label: 'Synthetic route' };
const clock = () => Date.parse('2026-10-03T12:00:00.000Z');
function receipt(operation: string) {
  const fixture = fullCalculationReceiptFixture();
  const rows = fixture.rows.map(row => ({ ...row, validFrom: '2026-10-01' }));
  const common = { ...fixture, id: `receipt_${operation}`, operation, period: { from: '2026-10-01', to: '2026-10-31' }, rows };
  if (operation === 'margin') return common;
  return { ...common, figures: [{ key: 'total', label: `Fixture ${operation}`, minor: HUGE_INTEGER, display: 'Engine exact synthetic display', unit: 'money', currency: 'INR' }], valueMinor: HUGE_INTEGER, totalMinor: HUGE_INTEGER, allowedNumbers: [HUGE_INTEGER] };
}
function dashboard() {
  return { workspace: { ...context().workspace, currency: 'INR', createdAt: AT }, calculations: ['billed', 'received', 'earned', 'margin'].map(receipt), factCount: 3, sources: 2, decisions: [], waitingActions: [], jobs: [], policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false }, dictionary: null, lastActivity: [] };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Reply = (method: keyof HostRpcPayloads, payload: unknown) => unknown | Promise<unknown>;
function transport(reply?: Reply) {
  const calls: { method: keyof HostRpcPayloads; payload: unknown }[] = [];
  const port: HostRpcPort = { async request(method, payload) {
    calls.push({ method, payload: structuredClone(payload) });
    if (reply) { const value = await reply(method, payload); if (value !== undefined) return value; }
    if (method === 'ui.context') return context();
    if (method === 'dashboard.get') return dashboard();
    if (method === 'receipts.get') return receipt((payload as { id: string }).id.slice('receipt_'.length));
    if (method === 'models.list') return [route];
    if (method === 'workspace.lock') return { locked: true };
    throw Error(`Unexpected synthetic dispatch ${String(method)}`);
  } };
  const count = (method: keyof HostRpcPayloads) => calls.filter(call => call.method === method).length;
  const methods = () => calls.map(call => String(call.method));
  const forbidden = () => methods().filter(method => !ALLOWED_METHODS.includes(method));
  return { port, calls, count, methods, forbidden };
}
async function ready(reply?: Reply) {
  const fixture = transport(reply), host = createHostController(fixture.port, { now: clock });
  await host.refresh(); assert.equal(host.snapshot().phase, 'ready');
  return { ...fixture, host };
}
const settle = async (ticks = 8) => { for (let i = 0; i < ticks; i++) await Promise.resolve(); };
/** An explicit issued-call barrier: the guarded port reads ui.context before it issues a request, so a held
 * transport call is proven issued only once the synthetic transport has counted it. */
async function issued(fixture: { count: (method: keyof HostRpcPayloads) => number }, method: keyof HostRpcPayloads, expected: number) {
  for (let i = 0; i < 64 && fixture.count(method) < expected; i++) await Promise.resolve();
  assert.equal(fixture.count(method), expected, `${String(method)} issued ${String(expected)} times`);
}
const refusal = (code: string) => Object.assign(Error(code), { code });
/** A detached copy with one or more dotted paths replaced; arrays take numeric segments. Keeps fixtures plain data. */
function edit<T>(value: T, ...changes: readonly (readonly [path: string, next: unknown])[]): T {
  const copy = structuredClone(value);
  for (const [path, next] of changes) {
    const segments = path.split('.'); const last = segments.pop();
    let cursor: unknown = copy;
    for (const segment of segments) cursor = (cursor as Record<string, unknown>)[segment];
    if (last === undefined || cursor === null || typeof cursor !== 'object') throw Error(`Fixture path ${path} is unreachable`);
    if (next === undefined) delete (cursor as Record<string, unknown>)[last]; else (cursor as Record<string, unknown>)[last] = next;
  }
  return copy;
}

/* ---------- Scenario fixtures (price-scenario calculator shape) ---------- */
const PIN = { scenarioId: 'scenario_fixture', revisionId: 'scenario_revision_a' };
const BASE_OUTCOME = { minor: HUGE_INTEGER, display: 'Synthetic baseline outcome' };
const ALT_OUTCOME = { minor: `${HUGE_INTEGER}7`, display: 'Synthetic alternative outcome' };
type AlternativeStatus = 'ready' | 'pending' | 'stale' | 'running';
/** An embedded receipt as calculator.ts issues it for a price scenario: four figures in order
 * (measured baseline, scenario outcome, change, assumed points) and the canonical integer assumption. */
function scenarioReceipt(id: string, bps: string, outcome: { minor: string; display: string }, cut = AT) {
  const base = receipt('price_scenario'), points = String(BigInt(bps));
  return {
    ...base, id, asOf: cut,
    figures: [
      { key: 'baseline', label: 'Measured baseline', minor: HUGE_INTEGER, display: 'Synthetic measured baseline display', unit: 'money', currency: 'INR' },
      { key: 'scenario', label: 'Scenario revenue', minor: outcome.minor, display: outcome.display, unit: 'money', currency: 'INR' },
      { key: 'change', label: 'Scenario change', minor: points === '0' ? '0' : '13579', display: points === '0' ? 'Synthetic zero change display' : 'Synthetic change display', unit: 'money', currency: 'INR' },
      { key: 'priceChangeBps', label: 'Assumed price change', minor: points, display: `${points} bps`, unit: 'basis-points' },
    ],
    valueMinor: outcome.minor, totalMinor: outcome.minor, allowedNumbers: [HUGE_INTEGER, outcome.minor, points, '13579'],
    assumptions: { priceChangeBps: points, volume: 'Held constant', rounding: 'Truncate fractional minor units toward zero', status: 'Scenario only. Source facts are unchanged.' },
  };
}
/**
 * An embedded receipt as calculator.ts issues it for the published `aging` operation (ontology.ts
 * publishes id `aging`, type `aging`, parameters period/asOf/branch/customerId/onDate): the five
 * bucket figures, outstanding and unallocated, in that order, and the exact issued `assumptions.onDate`
 * (`request.onDate ?? asOf.slice(0, 10)` over the UTC-normalised cut). Every amount is a supplied
 * synthetic value; nothing is aged or summed here.
 */
function agingReceipt(id: string, cut: string, onDate: string) {
  const money = (key: string, label: string, minor: string) => ({ key, label, minor, display: `Synthetic ${key} display`, unit: 'money', currency: 'INR' });
  return {
    ...receipt('aging'), id, asOf: cut,
    figures: [
      money('notDue', 'Not yet due', HUGE_INTEGER), money('days1to30', 'Overdue one to thirty days', '0'), money('days31to60', 'Overdue thirty-one to sixty days', '0'),
      money('days61to90', 'Overdue sixty-one to ninety days', '0'), money('over90', 'Overdue more than ninety days', '0'),
      money('outstanding', 'Outstanding receivables', HUGE_INTEGER), money('unallocated', 'Unallocated receipts or credits', '0'),
    ],
    valueMinor: HUGE_INTEGER, totalMinor: HUGE_INTEGER, allowedNumbers: [HUGE_INTEGER, '0'],
    assumptions: { onDate },
  };
}
/**
 * `cut` is the retained knowledge cut every analysis shares (scenario-service.ts addAnalysis). `aging`
 * appends one non-root aging analysis to the baseline branch exactly as addAnalysis does: the same
 * baseline period/source/object scope and cut, `usesBranchAssumptions: false`, no price assumption in
 * either the authored or the pinned request, its own ready state, run, result and receipt; the
 * resulting revision is a graph change with a parent. Its receipt declares `onDate`, which the two
 * price-scenario root receipts never do.
 */
function scenarioView(options: { alternative?: AlternativeStatus; headRevisionId?: string; comparison?: boolean; reuse?: boolean; altBps?: string; cut?: string; aging?: boolean; agingOnDate?: string } = {}) {
  const alternative = options.alternative ?? 'ready', altBps = options.altBps ?? '500', cut = options.cut ?? AT;
  const period = { from: '2026-10-01', to: '2026-10-31' };
  const request = (bps: string) => ({ operation: 'price_scenario', period, asOf: cut, assumptions: { priceChangeBps: bps } });
  const job = (id: string, branchId: string, label: string, bps: string) => ({ id, branchId, label, dependsOn: [], usesBranchAssumptions: true, request: request(bps), authoredRequest: { operation: 'price_scenario', period, assumptions: { priceChangeBps: bps } }, authoredRequestDigest: hex('1'), requestDigest: hex('2'), inputDigest: hex('3') });
  const agingJob = { id: 'scenario_job_aging', branchId: 'scenario_branch_base', label: 'Receivable aging, your books', dependsOn: [], usesBranchAssumptions: false, request: { operation: 'aging', period, asOf: cut }, authoredRequest: { operation: 'aging', period }, authoredRequestDigest: hex('c'), requestDigest: hex('d'), inputDigest: hex('3') };
  const branches = [
    { id: 'scenario_branch_base', label: 'Your books', role: 'baseline', assumptionRevisionId: 'scenario_assumption_base', priceChangeBps: '0', rootJobId: 'scenario_job_base' },
    { id: 'scenario_branch_alt', label: 'Price up five percent', role: 'alternative', assumptionRevisionId: 'scenario_assumption_alt', priceChangeBps: altBps, rootJobId: 'scenario_job_alt' },
  ];
  const parent = options.reuse || options.aging ? 'scenario_revision_parent' : null, mode = options.reuse ? 'assumption-change' : options.aging ? 'graph-change' : 'initial';
  const jobs = [job('scenario_job_base', 'scenario_branch_base', 'Earned, your books', '0'), job('scenario_job_alt', 'scenario_branch_alt', 'Earned, with the change', altBps), ...(options.aging ? [agingJob] : [])];
  const revision = { id: PIN.revisionId, scenarioId: PIN.scenarioId, parentRevisionId: parent, mode, createdAt: AT, evidenceId: 'scenario_evidence_fixture', evidenceDigest: hex('4'), branches, jobs, digest: hex('5') };
  const altState = alternative === 'ready' ? { jobId: 'scenario_job_alt', status: 'ready', runId: 'scenario_run_alt', ...(options.reuse ? { reusedFromRevisionId: 'scenario_revision_parent' } : {}) }
    : alternative === 'pending' ? { jobId: 'scenario_job_alt', status: 'pending' }
    : alternative === 'stale' ? { jobId: 'scenario_job_alt', status: 'stale', retainedRunId: 'scenario_run_alt' }
    : { jobId: 'scenario_job_alt', status: 'running', activeRunId: 'scenario_run_alt_next', retainedRunId: 'scenario_run_alt' };
  const baseResult = { runId: 'scenario_run_base', runDigest: hex('6'), receipt: scenarioReceipt('receipt_scenario_base', '0', BASE_OUTCOME, cut), receiptDigest: hex('7'), digest: hex('8') };
  const altResult = { runId: 'scenario_run_alt', runDigest: hex('9'), receipt: scenarioReceipt('receipt_scenario_alt', altBps, ALT_OUTCOME, cut), receiptDigest: hex('a'), digest: hex('b') };
  const agingResult = { runId: 'scenario_run_aging', runDigest: hex('e'), receipt: agingReceipt('receipt_scenario_aging', cut, options.agingOnDate ?? new Date(Date.parse(cut)).toISOString().slice(0, 10)), receiptDigest: hex('f'), digest: hex('0') };
  const agingStates = options.aging ? [{ jobId: 'scenario_job_aging', status: 'ready', runId: 'scenario_run_aging' }] : [];
  const results = [...(alternative === 'pending' ? [baseResult] : [baseResult, altResult]), ...(options.aging ? [agingResult] : [])];
  const comparisons = options.comparison && alternative === 'ready' ? [{
    id: 'scenario_comparison_fixture', scenarioId: PIN.scenarioId, revisionId: PIN.revisionId, revisionDigest: hex('5'), evidenceId: 'scenario_evidence_fixture', evidenceDigest: hex('4'), createdAt: AT,
    requiredJobs: [
      { jobId: 'scenario_job_base', branchId: 'scenario_branch_base', requestDigest: hex('2'), inputDigest: hex('3'), runId: 'scenario_run_base', runRevisionId: PIN.revisionId, receiptId: 'receipt_scenario_base', receiptDigest: hex('7'), reusedFromRevisionId: null },
      // A reused run keeps its original issuing revision, which may predate the immediate parent it was reused from.
      options.reuse
        ? { jobId: 'scenario_job_alt', branchId: 'scenario_branch_alt', requestDigest: hex('2'), inputDigest: hex('3'), runId: 'scenario_run_alt', runRevisionId: 'scenario_revision_origin', receiptId: 'receipt_scenario_alt', receiptDigest: hex('a'), reusedFromRevisionId: 'scenario_revision_parent' }
        : { jobId: 'scenario_job_alt', branchId: 'scenario_branch_alt', requestDigest: hex('2'), inputDigest: hex('3'), runId: 'scenario_run_alt', runRevisionId: PIN.revisionId, receiptId: 'receipt_scenario_alt', receiptDigest: hex('a'), reusedFromRevisionId: null },
    ],
    noAction: true, limitations: ['Only published calculator analyses are supported.', 'This comparison grants no action authority.'], digest: hex('c'),
  }] : [];
  return { scenarioId: PIN.scenarioId, headRevisionId: options.headRevisionId ?? PIN.revisionId, mode: 'retained-revision', revision, jobs: [{ jobId: 'scenario_job_base', status: 'ready', runId: 'scenario_run_base' }, altState, ...agingStates], status: alternative === 'ready' ? 'complete' : 'partial', results, comparisons, noAction: true };
}
const scenarioReply = (view: unknown): Reply => method => method === 'scenarios.reopen' ? view : undefined;

/* ---------- Lesson fixtures (released evidence and candidate shape) ---------- */
const member = { memberId: 'member_fixture', role: 'owner', epoch: 1 };
const SOURCES = ['source_costs', 'source_orders'];
const MARKINGS = [{ sourceId: 'source_costs', marking: 'internal' }, { sourceId: 'source_orders', marking: 'internal' }];
function evaluationSummary(set: 'open' | 'hidden', candidate: { id: string; revision: number; digest: string }, status = 'complete', overrides: Record<string, unknown> = {}) {
  return {
    reference: { id: `evaluation_${set}_fixture`, revision: '1', digest: hex(set === 'open' ? 'd' : 'e') }, set, candidate, authorityId: 'synthetic_evaluator_fixture', qualification: 'synthetic-protocol',
    suite: { id: `suite_${set}`, revision: '1', digest: hex('f') }, harness: { id: 'harness_fixture', revision: '1', digest: hex('0') }, build: { id: 'build_fixture', revision: '1', digest: hex('1') }, configuration: { id: 'configuration_fixture', revision: '1', digest: hex('2') },
    comparisonId: 'comparison_fixture', completedAt: AT, status, baseline: { guidance: 'off', digest: hex('3') }, treatment: { guidance: 'on', candidate },
    metrics: status === 'complete' ? [{ name: 'synthetic_metric', direction: 'higher-is-better', before: 1, after: 1 }] : [], sourceTainted: false, sourceIds: SOURCES, ...overrides,
  };
}
interface LessonOptions {
  id?: string; digest?: string; status?: LessonStatus; evaluation?: boolean; review?: boolean; hiddenStatus?: string;
  reviewer?: typeof member; owner?: typeof member; title?: string; workspaceId?: string; reviewId?: string; reviewDigest?: string;
  qualification?: string; targetRevision?: string; markings?: { sourceId: string; marking: string }[]; supersedes?: boolean;
  open?: Record<string, unknown>; hidden?: Record<string, unknown>; evaluationDigest?: string;
}
/** One released view. The candidate owner, proposer, target owner and default reviewer all name the same pinned actor,
 * as lessons.ts `proposal` records them; `owner` replaces that actor at every position coherently. */
function lessonView(options: LessonOptions = {}) {
  const id = options.id ?? 'lesson_fixture', digest = options.digest ?? hex('a'), owner = options.owner ?? member, pin = { id, revision: 1, digest };
  const evaluationDigest = options.evaluationDigest ?? hex('d');
  const candidate = {
    kind: 'candidate-lesson', workspaceId: options.workspaceId ?? 'workspace_fixture', id, revision: 1, digest, owner, proposedBy: owner, proposedAt: AT, episodeIds: ['lesson_episode_fixture'],
    title: options.title ?? 'Synthetic lesson: remind me on Fridays', rationale: 'Synthetic rationale, written by the source.',
    evidence: [{ pin: { kind: 'calculation', id: 'receipt_fixture', revision: '1', digest: hex('b'), sourceIds: SOURCES, branchIds: ['branch_fixture'] }, available: true, sourceTainted: false, sourceMarkings: options.markings ?? MARKINGS, summary: 'Synthetic evidence summary.' }],
    change: { kind: 'reminder-timing', targetId: 'reminder_fixture', before: options.supersedes ? 'tuesday' : 'monday', after: 'friday' },
    applicability: { memberId: owner.memberId, branchIds: ['branch_fixture'], sourceIds: SOURCES, conditions: { ritual: 'friday' } },
    counterexamples: [{ conditions: { ritual: 'monday' }, reason: 'Monday has its own brief.' }],
    ...(options.supersedes ? { supersedes: { id: 'lesson_predecessor', revision: 2, digest: hex('9') } } : {}),
    target: { kind: 'reminder-timing', id: 'reminder_fixture', revision: options.targetRevision ?? '1', digest: hex('c'), owner, value: 'monday' },
  };
  const qualification = options.qualification === undefined ? {} : { qualification: options.qualification };
  const evaluation = options.evaluation === false ? undefined : {
    candidate: pin, open: evaluationSummary('open', pin, 'complete', { ...qualification, ...options.open }),
    hidden: evaluationSummary('hidden', pin, options.hiddenStatus ?? 'complete', { ...qualification, ...options.hidden }), digest: evaluationDigest,
  };
  const review = options.review === false || evaluation === undefined ? undefined : { id: options.reviewId ?? 'lesson_review_fixture', candidate: pin, evaluationDigest, reviewer: options.reviewer ?? member, at: AT, digest: options.reviewDigest ?? hex('e') };
  return { candidate, status: options.status ?? 'review-ready', ...(evaluation ? { evaluation } : {}), ...(review ? { review } : {}) };
}
/** The released list exactly as the controller consumes it: bound to the exact trusted workspace and actor. */
const released = (raw: unknown, trusted: UiContext = uiContext()) => validateLessonReviewList(raw, trusted);
const lessonReply = (lessons: () => unknown, decide?: (payload: unknown) => unknown): Reply => (method, payload) => {
  if (method === 'memory.lessons') return lessons();
  if (method === 'memory.decideLesson') { if (!decide) throw Error('No decision expected'); return decide(payload); }
  return undefined;
};
/** What a press on the displayed review names. */
function intent(view: ReturnType<typeof lessonView> = lessonView(), decision: 'approve' | 'defer' = 'approve'): LessonDecisionIntent {
  if (view.review === undefined || view.evaluation === undefined) throw Error('Fixture must be review-bound');
  return { candidate: { id: view.candidate.id, revision: 1, digest: view.candidate.digest }, reviewId: view.review.id, reviewDigest: view.review.digest, evaluationDigest: view.evaluation.digest, decision };
}
const approved = (status: 'approved' | 'deferred' = 'approved') => ({ ...lessonView({ status, review: false }), review: lessonView().review });

/* ---------- Scenario controller ---------- */
test('S1 an exact trusted pin dispatches exactly scenarios.reopen and nothing is listed, saved, persisted or read from receipts.get', async () => {
  const fixture = await ready(scenarioReply(scenarioView()));
  const receiptsBefore = fixture.count('receipts.get');
  assert.deepEqual(fixture.host.retained.snapshot().scenario, { kind: 'idle' });
  const result = await fixture.host.retained.openScenario(PIN);
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fixture.calls.filter(call => call.method === 'scenarios.reopen').map(call => call.payload), [PIN]);
  assert.equal(fixture.count('receipts.get'), receiptsBefore);
  assert.deepEqual(fixture.forbidden(), []);
  const scenario = fixture.host.retained.snapshot().scenario;
  assert.equal(scenario.kind, 'ready');
  if (scenario.kind !== 'ready') return;
  assert.equal(scenario.historical, false); assert.equal(scenario.checking, false);
  assert.equal(scenario.view.results[0]?.receipt.figures[0]?.minor, HUGE_INTEGER);
  assert.equal(scenario.view.noAction, true);
  // Arbitrary or decorated identities are refused before any dispatch.
  const before = fixture.calls.length;
  assert.deepEqual(await fixture.host.retained.openScenario({ ...PIN, label: 'chosen by label' }), { ok: false, code: 'SELECTION_INVALID' });
  assert.deepEqual(await fixture.host.retained.openScenario({ scenarioId: '../scenario', revisionId: PIN.revisionId }), { ok: false, code: 'SELECTION_INVALID' });
  assert.equal(fixture.calls.length, before);
  assert.throws(() => validateScenarioSelection(['scenario_fixture', 'scenario_revision_a']));
  fixture.host.dispose();
});
test('S2 a reply for another scenario, revision or revision owner is refused without releasing any receipt', async () => {
  for (const view of [edit(scenarioView(), ['scenarioId', 'scenario_other']), edit(scenarioView(), ['revision.id', 'scenario_revision_b']), edit(scenarioView(), ['revision.scenarioId', 'scenario_other'])]) {
    const fixture = await ready(scenarioReply(view));
    assert.deepEqual(await fixture.host.retained.openScenario(PIN), { ok: false, code: 'INVALID_REPLY' });
    assert.deepEqual(fixture.host.retained.snapshot().scenario, { kind: 'unavailable', selection: PIN, code: 'INVALID_REPLY' });
    fixture.host.dispose();
  }
});
test('S3 a historical revision keeps both identities and its original dates and is never relabelled current or recomputed', async () => {
  const fixture = await ready(scenarioReply(scenarioView({ headRevisionId: 'scenario_revision_head' })));
  await fixture.host.retained.openScenario(PIN);
  const scenario = fixture.host.retained.snapshot().scenario;
  assert.equal(scenario.kind, 'ready');
  if (scenario.kind !== 'ready') return;
  assert.equal(scenario.historical, true);
  assert.equal(scenario.view.revision.id, PIN.revisionId);
  assert.equal(scenario.view.headRevisionId, 'scenario_revision_head');
  assert.equal(scenario.view.revision.createdAt, AT);
  assert.equal(fixture.methods().includes('scenarios.recompute'), false);
  assert.deepEqual(fixture.forbidden(), []);
  fixture.host.dispose();
});
test('S4 the proof of a figure is the exact embedded receipt of its run with the issued scenario outcome; no global receipt read, no arithmetic', async () => {
  const fixture = await ready(scenarioReply(scenarioView({ comparison: true })));
  const receiptsBefore = fixture.count('receipts.get');
  await fixture.host.retained.openScenario(PIN);
  const scenario = fixture.host.retained.snapshot().scenario;
  if (scenario.kind !== 'ready') assert.fail('expected ready');
  const proof = scenarioProof(scenario.view, 'scenario_run_alt');
  assert.ok(proof);
  assert.equal(proof.result.receipt.id, 'receipt_scenario_alt');
  assert.equal(proof.result.receiptDigest, hex('a'));
  assert.deepEqual(proof.result.receipt.figures.map(figure => figure.key), ['baseline', 'scenario', 'change', 'priceChangeBps']);
  assert.equal(proof.result.receipt.figures[1]?.display, ALT_OUTCOME.display);
  assert.equal(proof.result.receipt.figures[1]?.minor, ALT_OUTCOME.minor);
  assert.equal(proof.result.receipt.figures[0]?.minor, HUGE_INTEGER);
  assert.equal(proof.branch.priceChangeBps, '500'); assert.equal(proof.baseline.priceChangeBps, '0');
  assert.deepEqual(proof.result.receipt.coverage.gaps, ['Contribution includes imported costs only.']);
  assert.equal(scenarioProof(scenario.view, 'scenario_run_absent'), null);
  assert.equal(fixture.count('receipts.get'), receiptsBefore);
  assert.equal(scenario.view.comparisons[0]?.limitations.length, 2);
  fixture.host.dispose();
});
test('S5 pending, stale and running jobs never show a retained old result as current; broken ready bindings are refused', () => {
  for (const alternative of ['pending', 'stale', 'running'] as const) {
    const view = validateRetainedScenarioView(scenarioView({ alternative }), PIN);
    assert.equal(view.status, 'partial');
    const columns = scenarioColumns(view);
    assert.equal(columns[0]?.branch.role, 'baseline');
    assert.equal(columns[0]?.entries[0]?.result?.receipt.id, 'receipt_scenario_base');
    assert.equal(columns[1]?.entries[0]?.result, null);
    assert.equal(columns[1]?.entries[0]?.state.status, alternative);
    if (alternative !== 'pending') assert.equal(columns[1]?.entries[0]?.state.retainedRunId, 'scenario_run_alt');
    assert.equal(scenarioProof(view, 'scenario_run_alt'), null);
    assert.equal(columns[1] === undefined ? null : scenarioOutcomeFigure(columns[1].entries[0]!), null);
  }
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView(), ['results', scenarioView().results.slice(0, 1)]), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView(), ['jobs.1', { jobId: 'scenario_job_alt', status: 'ready' }]), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ alternative: 'pending' }), ['status', 'complete']), PIN));
  const stray = scenarioView({ alternative: 'pending' });
  assert.throws(() => validateRetainedScenarioView(edit(stray, ['results', [...stray.results, { runId: 'scenario_run_stray', runDigest: hex('9'), receipt: scenarioReceipt('receipt_stray', '0', BASE_OUTCOME), receiptDigest: hex('a'), digest: hex('b') }]]), PIN));
});
test('S6 a comparison is released only when every pin names this exact revision vector and noAction stays true', () => {
  const valid = validateRetainedScenarioView(scenarioView({ comparison: true }), PIN);
  assert.equal(valid.comparisons.length, 1); assert.equal(valid.comparisons[0]?.noAction, true);
  const mutations: (readonly [string, unknown])[] = [
    ['comparisons.0.noAction', false], ['comparisons.0.requiredJobs.1.receiptDigest', hex('0')], ['comparisons.0.requiredJobs.1.runId', 'scenario_run_other'],
    ['comparisons.0.revisionDigest', hex('0')], ['comparisons.0.evidenceId', 'scenario_evidence_other'], ['comparisons.0.requiredJobs', scenarioView({ comparison: true }).comparisons[0]!.requiredJobs.slice(0, 1)],
    ['noAction', false], ['comparisons.0.requiredJobs.1.reusedFromRevisionId', 'scenario_revision_parent'],
  ];
  for (const mutation of mutations) assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ comparison: true }), mutation), PIN), mutation[0]);
});
test('S7 every domain refusal replaces the ready view with a bounded unavailable state and nothing else', async () => {
  const codes = ['SCENARIO_UNAVAILABLE', 'SCENARIO_REVISION_UNAVAILABLE', 'SCENARIO_EVIDENCE_UNAVAILABLE', 'SCENARIO_FORBIDDEN', 'SCENARIO_AUTHORITY_CHANGED', 'SCENARIO_ARTIFACT_CHANGED', 'SCENARIO_RETENTION_EXPIRED', 'SCENARIO_HOST_REQUIRED', 'SCENARIO_CUSTODY_INVALID', 'SCENARIO_WORKSPACE_CHANGED', 'SCENARIO_RUN_UNAVAILABLE'] as const;
  for (const code of codes) {
    let refuse = false;
    const fixture = await ready(method => { if (method === 'scenarios.reopen') { if (refuse) throw refusal(code); return scenarioView(); } return undefined; });
    await fixture.host.retained.openScenario(PIN);
    assert.equal(fixture.host.retained.snapshot().scenario.kind, 'ready');
    refuse = true;
    assert.deepEqual(await fixture.host.retained.openScenario(PIN), { ok: false, code });
    assert.deepEqual(fixture.host.retained.snapshot().scenario, { kind: 'unavailable', selection: PIN, code });
    assert.equal(fixture.host.snapshot().phase, 'ready');
    fixture.host.dispose();
  }
  // An explicit method refusal is a local transport-unavailable state, not an error beside cached charts.
  const native = await ready(method => { if (method === 'scenarios.reopen') throw refusal('INVALID_REQUEST'); return undefined; });
  assert.deepEqual(await native.host.retained.openScenario(PIN), { ok: false, code: 'UNSUPPORTED_TRANSPORT' });
  assert.equal(native.host.snapshot().phase, 'ready'); native.host.dispose();
  // Unknown codes stay bounded; vault/access denials invalidate the whole host as before.
  assert.equal(retainedFailureCode(refusal('SOMETHING_NEW')), 'REQUEST_FAILED');
  assert.equal(retainedFailureCode(refusal('FORBIDDEN')), 'ACCESS_DENIED');
  const revoked = await ready(method => { if (method === 'scenarios.reopen') throw refusal('ACCESS_REVOKED'); return undefined; });
  assert.deepEqual(await revoked.host.retained.openScenario(PIN), { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(revoked.host.snapshot().phase, 'unavailable'); assert.deepEqual(revoked.host.retained.snapshot().scenario, { kind: 'idle' }); revoked.host.dispose();
});
test('S8 a late reply cannot restore data after a newer view, a context change, a route change, a lock or disposal', async () => {
  const waiting = deferred<unknown>(); let hold = true;
  const fixture = await ready(method => method === 'scenarios.reopen' ? (hold ? waiting.promise : scenarioView({ headRevisionId: 'scenario_revision_head' })) : undefined);
  const first = fixture.host.retained.openScenario(PIN); await issued(fixture, 'scenarios.reopen', 1); hold = false;
  await fixture.host.retained.openScenario(PIN);
  const newer = fixture.host.retained.snapshot().scenario;
  assert.equal(newer.kind === 'ready' && newer.historical, true);
  waiting.resolve(scenarioView()); assert.deepEqual(await first, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.host.retained.snapshot().scenario, newer);
  // A late refusal cannot overwrite the newer successful view either.
  const refusing = deferred<unknown>(); hold = true;
  const port2 = transport(method => method === 'scenarios.reopen' ? (hold ? refusing.promise : scenarioView()) : undefined);
  const host2 = createHostController(port2.port, { now: clock }); await host2.refresh();
  const slow = host2.retained.openScenario(PIN); await issued(port2, 'scenarios.reopen', 1); hold = false; await host2.retained.openScenario(PIN);
  refusing.reject(refusal('SCENARIO_RETENTION_EXPIRED')); assert.deepEqual(await slow, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(host2.retained.snapshot().scenario.kind, 'ready'); host2.dispose();
  for (const interrupt of ['route', 'lock', 'context', 'dispose', 'refresh'] as const) {
    const held = deferred<unknown>(); let key = 'a'.repeat(64);
    const port3 = transport(method => method === 'ui.context' ? context(key) : method === 'scenarios.reopen' ? held.promise : undefined);
    const host3 = createHostController(port3.port, { now: clock }); await host3.refresh();
    const pending = host3.retained.openScenario(PIN); await issued(port3, 'scenarios.reopen', 1);
    if (interrupt === 'route') host3.selectRoute('route_fixture');
    else if (interrupt === 'lock') await host3.lock();
    else if (interrupt === 'context') key = 'b'.repeat(64);
    else if (interrupt === 'dispose') host3.dispose();
    else { const refresh = host3.refresh(); held.resolve(scenarioView()); await refresh; }
    held.resolve(scenarioView()); await pending;
    assert.deepEqual(host3.retained.snapshot().scenario, { kind: 'idle' }, interrupt);
    if (interrupt === 'context') assert.equal(host3.snapshot().phase, 'unavailable');
    host3.dispose();
  }
  fixture.host.dispose();
});
test('S9 two jobs cannot own one embedded run; every run identity belongs to exactly one job slot', () => {
  assert.doesNotThrow(() => validateRetainedScenarioView(scenarioView(), PIN));
  // Valid control: a two-analysis vector whose alternative is explicitly authored at zero points, so both analyses
  // carry one request scope, cut and assumption meaning while owning distinct runs, results and receipts.
  const equal = scenarioView({ altBps: '0' });
  const checked = validateRetainedScenarioView(equal, PIN);
  assert.equal(checked.revision.branches[1]?.priceChangeBps, '0');
  assert.deepEqual(checked.jobs.map(state => state.runId), ['scenario_run_base', 'scenario_run_alt']);
  assert.equal(scenarioColumns(checked)[1]?.entries[0]?.result?.receipt.id, 'receipt_scenario_alt');
  // Now only ownership changes: the alternative claims the baseline run, the second result is omitted, and every
  // scope and assumption check the control just passed still passes. Only the ownership rule can refuse it.
  const shared = edit(equal, ['jobs.1.runId', 'scenario_run_base'], ['results', equal.results.slice(0, 1)]);
  assert.throws(() => validateRetainedScenarioView(shared, PIN));
  // A stale job's retained run, or a running job's active run, cannot be another job's current run either.
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ alternative: 'stale', altBps: '0' }), ['jobs.1.retainedRunId', 'scenario_run_base'], ['results', equal.results.slice(0, 1)]), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ alternative: 'running', altBps: '0' }), ['jobs.1.activeRunId', 'scenario_run_base'], ['results', equal.results.slice(0, 1)]), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ alternative: 'running' }), ['jobs.1.activeRunId', 'scenario_run_alt']), PIN));
});
test('S10 an embedded receipt must carry the exact declared request scope, cut, source selection and assumption meaning of its own job', () => {
  const base = scenarioView();
  const scope: (readonly [string, unknown])[] = [
    ['results.1.receipt.period', { from: '2026-09-01', to: '2026-09-30' }],
    ['results.1.receipt.comparePeriod', { from: '2026-09-01', to: '2026-09-30' }],
    ['results.1.receipt.branch', 'branch_other'],
    ['results.1.receipt.asOf', '2026-10-02T09:00:00.000Z'],
    ['results.1.receipt.operation', 'margin'],
    ['results.1.receipt.requestedSourceIds', SOURCES],
    ['results.1.receipt.assumptions', { priceChangeBps: '600', volume: 'Held constant' }],
    ['results.1.receipt.assumptions', { volume: 'Held constant' }],
    ['results.1.receipt.assumptions', { priceChangeBps: 500 }],
  ];
  for (const change of scope) assert.throws(() => validateRetainedScenarioView(edit(base, change), PIN), change[0]);
  // A declared explicit source selection is derived for every analysis from the one baseline scope (scenario-service.ts
  // create/addAnalysis), so it is authored and captured on both jobs and must be retained exactly, in order, by both receipts.
  const selectedJobs = edit(base,
    ['revision.jobs.0.request.sourceIds', SOURCES], ['revision.jobs.0.authoredRequest.sourceIds', SOURCES],
    ['revision.jobs.1.request.sourceIds', SOURCES], ['revision.jobs.1.authoredRequest.sourceIds', SOURCES]);
  assert.throws(() => validateRetainedScenarioView(selectedJobs, PIN));
  assert.throws(() => validateRetainedScenarioView(edit(selectedJobs, ['results.1.receipt.requestedSourceIds', SOURCES]), PIN));
  const selected = edit(selectedJobs, ['results.0.receipt.requestedSourceIds', SOURCES], ['results.1.receipt.requestedSourceIds', SOURCES]);
  assert.doesNotThrow(() => validateRetainedScenarioView(selected, PIN));
  assert.deepEqual(validateRetainedScenarioView(selected, PIN).results.map(item => item.receipt.requestedSourceIds), [SOURCES, SOURCES]);
  assert.throws(() => validateRetainedScenarioView(edit(selected, ['results.1.receipt.requestedSourceIds', [...SOURCES].reverse()]), PIN));
  // Omitted and explicit-empty selections stay distinct from each other and from an explicit list.
  assert.throws(() => validateRetainedScenarioView(edit(base, ['revision.jobs.1.request.sourceIds', []], ['revision.jobs.1.authoredRequest.sourceIds', []]), PIN));
  // The authored assumption text is kept as written; only its integer meaning must match the canonical receipt text.
  const authored = edit(base, ['revision.branches.1.priceChangeBps', '0500'], ['revision.jobs.1.request.assumptions.priceChangeBps', '0500'], ['revision.jobs.1.authoredRequest.assumptions.priceChangeBps', '0500']);
  const checked = validateRetainedScenarioView(authored, PIN);
  assert.equal(checked.revision.branches[1]?.priceChangeBps, '0500');
  assert.equal(checked.results[1]?.receipt.assumptions['priceChangeBps'], '500');
  assert.throws(() => validateRetainedScenarioView(edit(authored, ['results.1.receipt.assumptions.priceChangeBps', '501']), PIN));
  // A knowledge cut written without milliseconds is the same instant; a different instant is refused.
  assert.doesNotThrow(() => validateRetainedScenarioView(edit(base, ['revision.jobs.1.request.asOf', '2026-10-01T09:00:00Z']), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(base, ['revision.jobs.1.request.asOf', undefined]), PIN));
  // Counted sources may be a strict subset of the requested selection; they are never equated.
  const countedRows = base.results[1]!.receipt.rows.filter(row => row.sourceId === 'source_orders');
  assert.doesNotThrow(() => validateRetainedScenarioView(edit(selected, ['results.1.receipt.sourceIds', ['source_orders']], ['results.1.receipt.rows', countedRows], ['results.1.receipt.rowIds', countedRows.map(row => row.factId)], ['results.1.receipt.coverage.countedRows', countedRows.length]), PIN));
});
test('S11 a required run without reuse originates in the selected revision; a reused original run revision is an opaque pin', () => {
  const reused = validateRetainedScenarioView(scenarioView({ comparison: true, reuse: true }), PIN);
  assert.equal(reused.comparisons[0]?.requiredJobs[1]?.runRevisionId, 'scenario_revision_origin');
  assert.equal(reused.comparisons[0]?.requiredJobs[1]?.reusedFromRevisionId, 'scenario_revision_parent');
  assert.equal(reused.jobs[1]?.reusedFromRevisionId, 'scenario_revision_parent');
  // The original pin may also equal the parent or the selected revision; none of these is required.
  assert.doesNotThrow(() => validateRetainedScenarioView(edit(scenarioView({ comparison: true, reuse: true }), ['comparisons.0.requiredJobs.1.runRevisionId', 'scenario_revision_parent']), PIN));
  assert.doesNotThrow(() => validateRetainedScenarioView(edit(scenarioView({ comparison: true, reuse: true }), ['comparisons.0.requiredJobs.1.runRevisionId', PIN.revisionId]), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ comparison: true }), ['comparisons.0.requiredJobs.1.runRevisionId', 'scenario_revision_other']), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ comparison: true, reuse: true }), ['jobs.1.reusedFromRevisionId', undefined]), PIN));
});
test('S12 the chart figure is the issued scenario outcome of each root analysis, never the copied measured baseline nor an unsupported operation', () => {
  const columns = scenarioColumns(validateRetainedScenarioView(scenarioView(), PIN));
  const baseline = scenarioOutcomeFigure(columns[0]!.entries[0]!), alternative = scenarioOutcomeFigure(columns[1]!.entries[0]!);
  assert.deepEqual(baseline, { key: 'scenario', label: 'Scenario revenue', minor: BASE_OUTCOME.minor, display: BASE_OUTCOME.display, unit: 'money', currency: 'INR' });
  assert.deepEqual(alternative, { key: 'scenario', label: 'Scenario revenue', minor: ALT_OUTCOME.minor, display: ALT_OUTCOME.display, unit: 'money', currency: 'INR' });
  assert.notEqual(alternative?.minor, columns[1]!.entries[0]!.result?.receipt.figures[0]?.minor);
  assert.notEqual(alternative?.display, columns[1]!.entries[0]!.result?.receipt.figures[0]?.display);
  // An analysis that does not use the branch assumption has no scenario outcome, even when ready.
  const margin = edit(scenarioView(), ['revision.jobs.1.usesBranchAssumptions', false], ['revision.jobs.1.request', { operation: 'margin', period: { from: '2026-10-01', to: '2026-10-31' }, asOf: AT }],
    ['revision.jobs.1.authoredRequest', { operation: 'margin', period: { from: '2026-10-01', to: '2026-10-31' } }], ['results.1.receipt', { ...receipt('margin'), id: 'receipt_scenario_alt', asOf: AT }]);
  const other = scenarioColumns(validateRetainedScenarioView(margin, PIN));
  assert.equal(scenarioOutcomeFigure(other[1]!.entries[0]!), null);
  // A ready receipt without the issued outcome key has none either; nothing is inferred from another key.
  const missingKey = edit(scenarioView(), ['results.1.receipt.figures', scenarioView().results[1]!.receipt.figures.filter(figure => figure.key !== 'scenario')]);
  assert.equal(scenarioOutcomeFigure(scenarioColumns(validateRetainedScenarioView(missingKey, PIN))[1]!.entries[0]!), null);
});
test('S13 a proof opens only after a fresh reopen still equals the displayed view; a changed or refused re-read clears it and never reads receipts.get', async () => {
  let reply: unknown = scenarioView(), refuse: string | null = null;
  const fixture = await ready(method => { if (method === 'scenarios.reopen') { if (refuse !== null) throw refusal(refuse); return reply; } return undefined; });
  const open = async () => { assert.deepEqual(await fixture.host.retained.openScenario(PIN), { ok: true }); const shown = fixture.host.retained.snapshot().scenario; if (shown.kind !== 'ready') assert.fail('expected ready'); return shown; };
  let shown = await open();
  const receiptsBefore = fixture.count('receipts.get'), reopens = fixture.count('scenarios.reopen');
  assert.deepEqual(await fixture.host.retained.confirmScenario(shown.selection, shown.view), { ok: true });
  assert.equal(fixture.count('scenarios.reopen'), reopens + 1);
  const confirmed = fixture.host.retained.snapshot().scenario;
  assert.equal(confirmed.kind === 'ready' && confirmed.view === shown.view && !confirmed.checking, true);
  // Only the exact displayed view object can be confirmed; a copy or another pin is refused without a read.
  assert.deepEqual(await fixture.host.retained.confirmScenario(shown.selection, { ...shown.view }), { ok: false, code: 'SELECTION_INVALID' });
  assert.deepEqual(await fixture.host.retained.confirmScenario({ ...PIN, revisionId: 'scenario_revision_b' }, shown.view), { ok: false, code: 'SELECTION_INVALID' });
  assert.equal(fixture.count('scenarios.reopen'), reopens + 1);
  // Unchanged ui.context, but the result binding moved on (coherently, without a finalized comparison to contradict):
  // the old press is refused and the stale figures cleared.
  reply = edit(scenarioView(), ['results.1.receiptDigest', hex('0')]);
  assert.deepEqual(await fixture.host.retained.confirmScenario(shown.selection, shown.view), { ok: false, code: 'SCENARIO_VIEW_CHANGED' });
  assert.deepEqual(fixture.host.retained.snapshot().scenario, { kind: 'unavailable', selection: PIN, code: 'SCENARIO_VIEW_CHANGED' });
  assert.deepEqual(await fixture.host.retained.confirmScenario(shown.selection, shown.view), { ok: false, code: 'SELECTION_INVALID' });
  // A revision or head change is a changed binding too.
  reply = scenarioView(); shown = await open(); reply = scenarioView({ headRevisionId: 'scenario_revision_head' });
  assert.deepEqual(await fixture.host.retained.confirmScenario(shown.selection, shown.view), { ok: false, code: 'SCENARIO_VIEW_CHANGED' });
  assert.equal(fixture.host.retained.snapshot().scenario.kind, 'unavailable');
  // A re-read whose result digest changed under an unchanged comparison pin is not a changed view but a malformed one.
  reply = scenarioView({ comparison: true }); shown = await open(); reply = edit(scenarioView({ comparison: true }), ['results.1.receiptDigest', hex('0')]);
  assert.deepEqual(await fixture.host.retained.confirmScenario(shown.selection, shown.view), { ok: false, code: 'INVALID_REPLY' });
  assert.deepEqual(fixture.host.retained.snapshot().scenario, { kind: 'unavailable', selection: PIN, code: 'INVALID_REPLY' });
  // A current source or custody refusal replaces the view with that refusal.
  reply = scenarioView(); shown = await open(); refuse = 'SCENARIO_EVIDENCE_UNAVAILABLE';
  assert.deepEqual(await fixture.host.retained.confirmScenario(shown.selection, shown.view), { ok: false, code: 'SCENARIO_EVIDENCE_UNAVAILABLE' });
  assert.deepEqual(fixture.host.retained.snapshot().scenario, { kind: 'unavailable', selection: PIN, code: 'SCENARIO_EVIDENCE_UNAVAILABLE' });
  assert.equal(fixture.count('receipts.get'), receiptsBefore);
  assert.equal(fixture.host.snapshot().phase, 'ready');
  assert.deepEqual(fixture.forbidden(), []);
  fixture.host.dispose();
  // A lifecycle boundary during the confirming read fences it: the view stays, nothing opens, the late reply is dropped.
  const held = deferred<unknown>(); let hold = false;
  const paused = await ready(method => method === 'scenarios.reopen' ? (hold ? held.promise : scenarioView()) : undefined);
  await paused.host.retained.openScenario(PIN);
  const ready0 = paused.host.retained.snapshot().scenario; if (ready0.kind !== 'ready') assert.fail('expected ready');
  hold = true; const confirming = paused.host.retained.confirmScenario(ready0.selection, ready0.view); await issued(paused, 'scenarios.reopen', 2);
  const during = paused.host.retained.snapshot().scenario;
  assert.equal(during.kind === 'ready' && during.checking, true);
  paused.host.retained.cancelPending();
  held.resolve(edit(scenarioView(), ['headRevisionId', 'scenario_revision_head']));
  assert.deepEqual(await confirming, { ok: false, code: 'READ_INVALIDATED' });
  const after = paused.host.retained.snapshot().scenario;
  assert.equal(after.kind === 'ready' && after.view === ready0.view && !after.checking, true);
  paused.host.dispose();
});
test('S14 two distinct results never share an embedded receipt identity, so a mark names exactly one run; transitive reuse stays accepted', () => {
  const valid = validateRetainedScenarioView(scenarioView(), PIN);
  assert.deepEqual(valid.results.map(item => item.receipt.id), ['receipt_scenario_base', 'receipt_scenario_alt']);
  assert.equal(scenarioProof(valid, 'scenario_run_alt')?.result.receipt.id, 'receipt_scenario_alt');
  // Only the alternative's embedded receipt id is copied from the baseline; runs, requests, assumptions and digests stay distinct.
  const alias = edit(scenarioView(), ['results.1.receipt.id', 'receipt_scenario_base']);
  assert.notEqual(alias.results[1]!.runId, alias.results[0]!.runId);
  assert.throws(() => validateRetainedScenarioView(alias, PIN));
  // Under a finalized comparison the alias contradicts the required receipt pin as well; made consistent there, the identity rule still refuses it.
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ comparison: true }), ['results.1.receipt.id', 'receipt_scenario_base']), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ comparison: true }), ['results.1.receipt.id', 'receipt_scenario_base'], ['comparisons.0.requiredJobs.1.receiptId', 'receipt_scenario_base']), PIN));
  // A legitimately reused run keeps its own distinct receipt and its original issuing revision.
  const reused = validateRetainedScenarioView(scenarioView({ comparison: true, reuse: true }), PIN);
  assert.deepEqual(reused.results.map(item => item.receipt.id), ['receipt_scenario_base', 'receipt_scenario_alt']);
  assert.equal(reused.comparisons[0]?.requiredJobs[1]?.runRevisionId, 'scenario_revision_origin');
});
test('S15 an appended aging analysis binds its issued onDate to the request or to the UTC-normalised cut default; a price-scenario receipt ignores a request onDate', () => {
  // Non-aging control: the price-scenario root receipt declares no onDate; a request onDate the calculator ignored is not held against it.
  const base = scenarioView();
  const ignored = validateRetainedScenarioView(edit(base, ['revision.jobs.1.request.onDate', '2026-09-01'], ['revision.jobs.1.authoredRequest.onDate', '2026-09-01']), PIN);
  assert.equal(ignored.revision.jobs[1]?.request.onDate, '2026-09-01');
  assert.equal(Object.hasOwn(ignored.results[1]!.receipt.assumptions, 'onDate'), false);
  // Valid aging control: the appended non-root analysis is accepted whole, as a graph-change revision with a parent, with both
  // price-scenario roots preserved and the aging receipt's issued default equal to the cut's UTC date.
  const aging = validateRetainedScenarioView(scenarioView({ aging: true }), PIN);
  assert.equal(aging.revision.mode, 'graph-change'); assert.equal(aging.revision.parentRevisionId, 'scenario_revision_parent');
  assert.deepEqual(aging.revision.jobs.map(item => [item.id, item.request.operation, item.usesBranchAssumptions]), [['scenario_job_base', 'price_scenario', true], ['scenario_job_alt', 'price_scenario', true], ['scenario_job_aging', 'aging', false]]);
  assert.equal(aging.revision.jobs[2]?.request.assumptions, undefined); assert.equal(aging.revision.jobs[2]?.request.asOf, AT);
  assert.deepEqual(aging.results.map(item => item.receipt.id), ['receipt_scenario_base', 'receipt_scenario_alt', 'receipt_scenario_aging']);
  assert.deepEqual(aging.results[2]?.receipt.figures.map(figure => figure.key), ['notDue', 'days1to30', 'days31to60', 'days61to90', 'over90', 'outstanding', 'unallocated']);
  assert.equal(aging.results[2]?.receipt.assumptions['onDate'], '2026-10-01');
  assert.equal(Object.hasOwn(aging.results[0]!.receipt.assumptions, 'onDate'), false);
  // The aging analysis uses no branch assumption: it has no scenario outcome and never enters the chart.
  assert.equal(scenarioOutcomeFigure(scenarioColumns(aging)[0]!.entries[1]!), null);
  // Issued default: only the issued date is changed from the control; another date or a non-string is refused.
  assert.throws(() => validateRetainedScenarioView(scenarioView({ aging: true, agingOnDate: '2026-09-30' }), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ aging: true }), ['results.2.receipt.assumptions.onDate', 20261001]), PIN));
  // Explicit request: the pinned and authored requests name the date and the issued date must be that exact value, neither another date nor the default.
  const explicit = (onDate: string, issued: string) => edit(scenarioView({ aging: true, agingOnDate: issued }), ['revision.jobs.2.request.onDate', onDate], ['revision.jobs.2.authoredRequest.onDate', onDate]);
  assert.equal(validateRetainedScenarioView(explicit('2026-09-01', '2026-09-01'), PIN).results[2]?.receipt.assumptions['onDate'], '2026-09-01');
  assert.throws(() => validateRetainedScenarioView(explicit('2026-09-01', '2026-09-30'), PIN));
  assert.throws(() => validateRetainedScenarioView(explicit('2026-09-01', '2026-10-01'), PIN));
  // Equivalent-offset default: the shared cut is 2026-10-01T00:00:00Z; the aging receipt spells that same instant with a
  // -02:00 offset, so its first ten bytes read 2026-09-30 while the calculator's UTC-normalised default is 2026-10-01.
  const cut = '2026-10-01T00:00:00.000Z', offset = '2026-09-30T22:00:00-02:00';
  assert.equal(Date.parse(offset), Date.parse(cut));
  const crossing = (issued: string) => edit(scenarioView({ aging: true, cut, agingOnDate: issued }), ['results.2.receipt.asOf', offset]);
  const normalised = validateRetainedScenarioView(crossing('2026-10-01'), PIN);
  assert.equal(normalised.results[2]?.receipt.asOf, offset); assert.equal(normalised.results[2]?.receipt.assumptions['onDate'], '2026-10-01');
  assert.equal(normalised.revision.jobs[2]?.request.asOf, cut);
  assert.throws(() => validateRetainedScenarioView(crossing('2026-09-30'), PIN));
  // An explicit request date still binds exactly under the offset spelling.
  assert.doesNotThrow(() => validateRetainedScenarioView(edit(crossing('2026-09-01'), ['revision.jobs.2.request.onDate', '2026-09-01'], ['revision.jobs.2.authoredRequest.onDate', '2026-09-01']), PIN));
});
test('S16 a surface fence read at every awaited boundary drops a held scenario read or confirmation whose surface was left; a live fence changes nothing', async () => {
  let onSurface = true, gate: ReturnType<typeof deferred<unknown>> | null = null;
  const fixture = await ready(method => method === 'scenarios.reopen' ? (gate !== null ? gate.promise : scenarioView()) : undefined);
  assert.deepEqual(await fixture.host.retained.openScenario(PIN, () => onSurface), { ok: true });
  // A held read released after the surface was left publishes nothing: the loading read ends idle.
  gate = deferred<unknown>(); const reading = fixture.host.retained.openScenario(PIN, () => onSurface);
  await issued(fixture, 'scenarios.reopen', 2);
  assert.equal(fixture.host.retained.snapshot().scenario.kind, 'loading');
  onSurface = false; const held = gate; gate = null; held.resolve(scenarioView({ headRevisionId: 'scenario_revision_head' }));
  assert.deepEqual(await reading, { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(fixture.host.retained.snapshot().scenario, { kind: 'idle' });
  // Back on the surface a fresh read is genuine again; a held confirmation whose surface is left keeps the view and opens nothing.
  onSurface = true;
  assert.deepEqual(await fixture.host.retained.openScenario(PIN, () => onSurface), { ok: true });
  const shown = fixture.host.retained.snapshot().scenario; if (shown.kind !== 'ready') assert.fail('expected ready');
  gate = deferred<unknown>(); const confirming = fixture.host.retained.confirmScenario(shown.selection, shown.view, () => onSurface);
  await issued(fixture, 'scenarios.reopen', 4);
  onSurface = false; const heldConfirm = gate; gate = null; heldConfirm.resolve(scenarioView());
  assert.deepEqual(await confirming, { ok: false, code: 'READ_INVALIDATED' });
  const after = fixture.host.retained.snapshot().scenario;
  assert.equal(after.kind === 'ready' && after.view === shown.view && !after.checking, true);
  // A press whose surface is already gone issues nothing and changes nothing.
  const calls = fixture.calls.length;
  assert.deepEqual(await fixture.host.retained.confirmScenario(shown.selection, shown.view, () => onSurface), { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(await fixture.host.retained.openScenario(PIN, () => onSurface), { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.calls.length, calls);
  assert.equal(fixture.host.retained.snapshot().scenario, after);
  fixture.host.dispose();
});

/* ---------- Lesson controller ---------- */
test('L1 the Friday hook dispatches exactly memory.lessons({}) and an empty list is only an empty current list', async () => {
  const fixture = await ready(lessonReply(() => []));
  assert.deepEqual(await fixture.host.retained.readLessons(), { ok: true });
  assert.deepEqual(fixture.calls.filter(call => call.method === 'memory.lessons').map(call => call.payload), [{}]);
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'ready', lessons: [], selectedId: null, notice: null, page: 0 });
  assert.equal(fixture.count('memory.decideLesson'), 0);
  assert.deepEqual(fixture.forbidden(), []);
  fixture.host.dispose();
});
test('L2 every incomplete, blocked, unreviewed, foreign or read-only lesson leaves both decisions unavailable without minting anything', async () => {
  const other = { memberId: 'member_other', role: 'owner', epoch: 1 };
  const cases: { view: unknown; block: string; foreign?: boolean }[] = [
    { view: lessonView({ status: 'proposed', evaluation: false }), block: 'status' },
    { view: lessonView({ status: 'evaluation-blocked', hiddenStatus: 'incomplete', review: false }), block: 'status' },
    { view: lessonView({ status: 'evaluation-blocked', hiddenStatus: 'declined', review: false }), block: 'status' },
    { view: lessonView({ status: 'deferred' }), block: 'status' },
    { view: lessonView({ status: 'approved' }), block: 'status' },
    { view: lessonView({ review: false }), block: 'review' },
    { view: lessonView({ reviewer: other }), block: 'reviewer' },
    { view: lessonView({ owner: other, reviewer: other }), block: 'reviewer', foreign: true },
  ];
  for (const item of cases) {
    // A row of another owner never enters a released list at all (L10); its availability is checked on the row alone.
    const view = item.foreign ? validateLessonReviewView(item.view) : released([item.view])[0];
    assert.ok(view);
    assert.deepEqual(lessonDecisionAvailability(view, uiContext()), { ok: false, block: item.block });
  }
  // A review-ready view whose hidden run is not complete cannot be decided even if its status word says ready.
  assert.deepEqual(lessonDecisionAvailability(released([lessonView({ hiddenStatus: 'incomplete' })])[0]!, uiContext()), { ok: false, block: 'evaluation' });
  assert.deepEqual(lessonDecisionAvailability(released([lessonView({ hidden: { sourceTainted: true } })])[0]!, uiContext()), { ok: false, block: 'evaluation' });
  assert.deepEqual(lessonDecisionAvailability(released([lessonView()])[0]!, uiContext('viewer')), { ok: false, block: 'role' });
  assert.deepEqual(lessonDecisionAvailability(released([lessonView()])[0]!, uiContext('accountant')), { ok: false, block: 'role' });
  assert.deepEqual(lessonDecisionAvailability(released([lessonView()])[0]!, uiContext()), { ok: true });
  // The qualification word is retained exactly; nothing upgrades a synthetic protocol run.
  assert.equal(released([lessonView()])[0]!.evaluation?.hidden.qualification, 'synthetic-protocol');
  const fixture = await ready(lessonReply(() => [lessonView({ review: false })]));
  await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
  assert.deepEqual(await fixture.host.retained.decideLesson({ ...intent(), reviewId: 'lesson_review_fixture' }, 'a human reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
  assert.equal(fixture.count('memory.decideLesson'), 0);
  fixture.host.dispose();
});
test('L3 one human press re-reads the current views and sends exactly one exact decision tuple; the reply keeps the submitted review', async () => {
  for (const [decision, status] of [['approve', 'approved'], ['defer', 'deferred']] as const) {
    const fixture = await ready(lessonReply(() => [lessonView()], () => approved(status)));
    await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
    const before = fixture.count('memory.lessons');
    assert.deepEqual(await fixture.host.retained.decideLesson(intent(lessonView(), decision), '  Because the Friday brief is when I plan.  '), { ok: true });
    assert.equal(fixture.count('memory.lessons'), before + 1);
    const decisions = fixture.calls.filter(call => call.method === 'memory.decideLesson');
    assert.equal(decisions.length, 1);
    assert.deepEqual(decisions[0]?.payload, { candidate: { id: 'lesson_fixture', revision: 1, digest: hex('a') }, reviewId: 'lesson_review_fixture', reviewDigest: hex('e'), decision, reason: '  Because the Friday brief is when I plan.  ' });
    assert.deepEqual(Object.keys(decisions[0]?.payload as object).sort(), ['candidate', 'decision', 'reason', 'reviewDigest', 'reviewId']);
    const lessons = fixture.host.retained.snapshot().lessons;
    assert.equal(lessons.kind, 'ready');
    if (lessons.kind === 'ready') {
      assert.equal(lessons.lessons[0]?.status, status); assert.equal(lessons.selectedId, null); assert.equal(lessons.notice, null); assert.equal(lessons.page, 0);
      assert.equal(lessons.lessons[0]?.review?.id, 'lesson_review_fixture'); assert.equal(lessons.lessons[0]?.review?.digest, hex('e'));
      assert.equal(lessons.lessons[0]?.evaluation?.digest, hex('d')); assert.equal(lessons.lessons[0]?.candidate.title, 'Synthetic lesson: remind me on Fridays');
    }
    // No preference write, memory edit, reminder, model, schedule or sharing method was ever dispatched.
    assert.deepEqual(fixture.forbidden(), []);
    fixture.host.dispose();
  }
  // A blank, whitespace, overlong or control-character reason is never autofilled and dispatches nothing.
  const blank = await ready(lessonReply(() => [lessonView()]));
  await blank.host.retained.readLessons(); blank.host.retained.selectLesson('lesson_fixture');
  const calls = blank.calls.length;
  for (const reason of ['   ', 'x'.repeat(4001), 'reason\u0007']) assert.deepEqual(await blank.host.retained.decideLesson(intent(), reason), { ok: false, code: 'REASON_REQUIRED' });
  assert.equal(blank.calls.length, calls);
  // A press naming a different candidate pin than the selection is refused before any dispatch.
  assert.deepEqual(await blank.host.retained.decideLesson({ ...intent(), candidate: { id: 'lesson_fixture', revision: 1, digest: hex('f') } }, 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
  assert.equal(blank.calls.length, calls);
  blank.host.dispose();
});
test('L4 a consistently changed candidate, review, evaluation, target or evidence in the preflight re-read clears the selection and sends nothing', async () => {
  const changes: (readonly [string, () => unknown])[] = [
    ['candidate pin', () => lessonView({ digest: hex('f') })],
    ['review id', () => lessonView({ reviewId: 'lesson_review_other' })],
    ['review digest', () => lessonView({ reviewDigest: hex('0') })],
    ['qualification', () => lessonView({ qualification: 'owner-qualified' })],
    ['target revision', () => lessonView({ targetRevision: '2' })],
    ['source marking', () => lessonView({ markings: [{ sourceId: 'source_costs', marking: 'confidential' }, { sourceId: 'source_orders', marking: 'internal' }] })],
    ['evaluation digest', () => lessonView({ evaluationDigest: hex('f') })],
    ['status', () => lessonView({ status: 'deferred' })],
    ['missing', () => null],
  ];
  for (const [name, change] of changes) {
    let first = true;
    const fixture = await ready(lessonReply(() => { if (first) { first = false; return [lessonView()]; } const changed = change(); return changed === null ? [] : [changed]; }));
    await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
    assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'LESSON_REVIEW_CHANGED' }, name);
    assert.equal(fixture.count('memory.decideLesson'), 0, name);
    const lessons = fixture.host.retained.snapshot().lessons;
    assert.equal(lessons.kind, 'ready', name);
    if (lessons.kind === 'ready') { assert.equal(lessons.selectedId, null); assert.equal(lessons.notice, 'LESSON_REVIEW_CHANGED'); assert.equal(lessons.page, 0); }
    fixture.host.dispose();
  }
  // A malformed re-read (a candidate pin changed without its evaluation and review bindings) is refused as invalid, not accepted as a new review.
  let first = true;
  const malformed = await ready(lessonReply(() => { if (first) { first = false; return [lessonView()]; } return [edit(lessonView(), ['candidate.digest', hex('f')])]; }));
  await malformed.host.retained.readLessons(); malformed.host.retained.selectLesson('lesson_fixture');
  assert.deepEqual(await malformed.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'INVALID_REPLY' });
  assert.deepEqual(malformed.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'INVALID_REPLY', afterDispatch: false });
  assert.equal(malformed.count('memory.decideLesson'), 0);
  malformed.host.dispose();
});
test('L5 a double press sends at most one decision; an uncertain post-dispatch failure is never replayed', async () => {
  const held = deferred<unknown>(); let hold = true;
  const fixture = await ready(lessonReply(() => (hold ? held.promise : [lessonView()]), () => approved()));
  await (async () => { hold = false; await fixture.host.retained.readLessons(); hold = true; })();
  fixture.host.retained.selectLesson('lesson_fixture');
  const first = fixture.host.retained.decideLesson(intent(), 'reason'); await issued(fixture, 'memory.lessons', 2);
  assert.equal(fixture.host.retained.snapshot().lessons.kind, 'deciding');
  assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'DECISION_IN_FLIGHT' });
  assert.deepEqual(await fixture.host.retained.readLessons(), { ok: false, code: 'DECISION_IN_FLIGHT' });
  held.resolve([lessonView()]); assert.deepEqual(await first, { ok: true });
  assert.equal(fixture.count('memory.decideLesson'), 1);
  fixture.host.dispose();
  const failing = await ready(lessonReply(() => [lessonView()], () => { throw refusal('LESSON_REVIEW_CHANGED'); }));
  await failing.host.retained.readLessons(); failing.host.retained.selectLesson('lesson_fixture');
  assert.deepEqual(await failing.host.retained.decideLesson(intent(lessonView(), 'defer'), 'reason'), { ok: false, code: 'LESSON_REVIEW_CHANGED' });
  assert.deepEqual(failing.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'LESSON_REVIEW_CHANGED', afterDispatch: true });
  assert.deepEqual(await failing.host.retained.decideLesson(intent(lessonView(), 'defer'), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
  assert.equal(failing.count('memory.decideLesson'), 1);
  failing.host.dispose();
  // Every authority or domain refusal of a fresh read replaces a cached, selected released list whole: no row, selection or private prose survives.
  for (const code of ['LESSON_AUTHORITY_REQUIRED', 'LESSON_EVALUATION_BLOCKED', 'EVALUATION_AUTHORITY_REQUIRED', 'EVALUATION_CHANGED', 'LESSON_EVIDENCE_UNAVAILABLE', 'LESSON_EVIDENCE_CHANGED', 'LESSON_TARGET_CHANGED', 'LESSON_OWNER_REQUIRED', 'APP_LESSON_REVIEW_REQUIRED', 'INVALID_REQUEST'] as const) {
    let refuse = false;
    const refusing = await ready(method => { if (method === 'memory.lessons') { if (refuse) throw refusal(code); return [lessonView()]; } return undefined; });
    assert.deepEqual(await refusing.host.retained.readLessons(), { ok: true });
    refusing.host.retained.selectLesson('lesson_fixture');
    assert.deepEqual(refusing.host.retained.snapshot().lessons, { kind: 'ready', lessons: released([lessonView()]), selectedId: 'lesson_fixture', notice: null, page: 0 });
    refuse = true;
    const expected = code === 'INVALID_REQUEST' ? 'UNSUPPORTED_TRANSPORT' : code;
    assert.deepEqual(await refusing.host.retained.readLessons(), { ok: false, code: expected });
    assert.deepEqual(refusing.host.retained.snapshot().lessons, { kind: 'unavailable', code: expected, afterDispatch: false });
    assert.equal(JSON.stringify(refusing.host.retained.snapshot()).includes('Synthetic'), false, code);
    assert.deepEqual(await refusing.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
    assert.equal(refusing.count('memory.decideLesson'), 0);
    assert.equal(refusing.host.snapshot().phase, 'ready');
    refusing.host.dispose();
  }
});
test('L6 a decision reply for another candidate or a contradictory status is discarded; a context change during a held decision clears everything', async () => {
  for (const reply of [
    () => ({ ...lessonView({ id: 'lesson_other', status: 'approved', review: false }), review: { ...lessonView({ id: 'lesson_other' }).review } }),
    () => approved('deferred'),
    () => lessonView(),
  ]) {
    const fixture = await ready(lessonReply(() => [lessonView()], reply));
    await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
    assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'INVALID_REPLY' });
    assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'INVALID_REPLY', afterDispatch: true });
    assert.equal(fixture.count('memory.decideLesson'), 1);
    fixture.host.dispose();
  }
  const held = deferred<unknown>(); let key = 'a'.repeat(64);
  const fixture = transport(method => method === 'ui.context' ? context(key) : method === 'memory.lessons' ? [lessonView()] : method === 'memory.decideLesson' ? held.promise : undefined);
  const host = createHostController(fixture.port, { now: clock }); await host.refresh();
  await host.retained.readLessons(); host.retained.selectLesson('lesson_fixture');
  const deciding = host.retained.decideLesson(intent(), 'reason'); await issued(fixture, 'memory.decideLesson', 1);
  key = 'b'.repeat(64); held.resolve(approved());
  assert.deepEqual(await deciding, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(host.snapshot().phase, 'unavailable'); assert.deepEqual(host.retained.snapshot().lessons, { kind: 'idle' });
  assert.equal(fixture.count('memory.decideLesson'), 1);
  host.dispose();
});
test('L7 refresh, route, lock, invalidate and dispose clear lesson review state and late lists cannot reopen it', async () => {
  for (const interrupt of ['refresh', 'route', 'lock', 'invalidate', 'dispose'] as const) {
    const held = deferred<unknown>(); let hold = false;
    const fixture = await ready(method => method === 'memory.lessons' ? (hold ? held.promise : [lessonView()]) : undefined);
    await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
    hold = true; const pending = fixture.host.retained.readLessons();
    // readLessons from the selected state is allowed and clears the old selection first; the held list call is proven issued.
    assert.equal(fixture.host.retained.snapshot().lessons.kind, 'loading');
    await issued(fixture, 'memory.lessons', 2);
    if (interrupt === 'refresh') { const refresh = fixture.host.refresh(); held.resolve([lessonView()]); await refresh; }
    else if (interrupt === 'route') fixture.host.selectRoute('route_fixture');
    else if (interrupt === 'lock') await fixture.host.lock();
    else if (interrupt === 'invalidate') fixture.host.invalidate();
    else fixture.host.dispose();
    held.resolve([lessonView(), lessonView({ id: 'lesson_second' })]); await pending;
    assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'idle' }, interrupt);
    fixture.host.dispose();
  }
  // Separately, a cancellation before the held transport call is issued: the read ends idle at once, and because the
  // operation's guard travels to the host's raw boundary, the cancelled list read is never issued at all.
  const quick = await ready(method => method === 'memory.lessons' ? [lessonView()] : undefined);
  await quick.host.retained.readLessons();
  const pending = quick.host.retained.readLessons();
  assert.equal(quick.count('memory.lessons'), 1);
  quick.host.retained.cancelPending();
  assert.deepEqual(quick.host.retained.snapshot().lessons, { kind: 'idle' });
  assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' });
  await settle();
  assert.equal(quick.count('memory.lessons'), 1);
  assert.deepEqual(quick.host.retained.snapshot().lessons, { kind: 'idle' });
  quick.host.dispose();
});
test('L8 an open/hidden pair with mismatched build or configuration pins, or a metric contradicting its supplied direction, keeps decisions unavailable', async () => {
  const pairs: (readonly [string, Record<string, unknown>])[] = [
    ['build id', { build: { id: 'build_other', revision: '1', digest: hex('1') } }],
    ['build revision', { build: { id: 'build_fixture', revision: '2', digest: hex('1') } }],
    ['build digest', { build: { id: 'build_fixture', revision: '1', digest: hex('8') } }],
    ['configuration id', { configuration: { id: 'configuration_other', revision: '1', digest: hex('2') } }],
    ['configuration revision', { configuration: { id: 'configuration_fixture', revision: '2', digest: hex('2') } }],
    ['configuration digest', { configuration: { id: 'configuration_fixture', revision: '1', digest: hex('8') } }],
    ['comparison', { comparisonId: 'comparison_other' }],
    ['baseline digest', { baseline: { guidance: 'off', digest: hex('4') } }],
    ['higher-is-better regression', { metrics: [{ name: 'synthetic_metric', direction: 'higher-is-better', before: 10, after: 9 }] }],
    ['lower-is-better regression', { metrics: [{ name: 'synthetic_metric', direction: 'lower-is-better', before: 10, after: 11 }] }],
  ];
  for (const [name, hidden] of pairs) {
    const raw = lessonView({ hidden });
    const [view] = released([raw]);
    assert.deepEqual(lessonDecisionAvailability(view!, uiContext()), { ok: false, block: 'evaluation' }, name);
    const fixture = await ready(lessonReply(() => [raw]));
    await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
    assert.deepEqual(await fixture.host.retained.decideLesson(intent(raw), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' }, name);
    assert.equal(fixture.count('memory.decideLesson'), 0, name);
    fixture.host.dispose();
  }
  // The open run is held to the same guard; a nonregressing pair in either direction stays decidable. Nothing is scored.
  assert.deepEqual(lessonDecisionAvailability(released([lessonView({ open: { metrics: [{ name: 'm', direction: 'lower-is-better', before: 10, after: 11 }] } })])[0]!, uiContext()), { ok: false, block: 'evaluation' });
  assert.deepEqual(lessonDecisionAvailability(released([lessonView({ hidden: { metrics: [{ name: 'm', direction: 'lower-is-better', before: 10, after: 9 }] }, open: { metrics: [{ name: 'm', direction: 'higher-is-better', before: 10, after: 10 }] } })])[0]!, uiContext()), { ok: true });
  assert.equal(released([lessonView()])[0]!.evaluation?.open.qualification, 'synthetic-protocol');
});
test('L9 released evidence, scopes, episodes, counterexamples and conditions follow the producer rules; legitimate supersession is kept', async () => {
  const marking = (sourceId: string, marking = 'internal') => ({ sourceId, marking });
  const invalidEvidence: (readonly [string, unknown])[] = [
    ['candidate.evidence.0.available', false], ['candidate.evidence.0.sourceTainted', true],
    ['candidate.evidence.0.sourceMarkings', [marking('source_costs')]], ['candidate.evidence.0.sourceMarkings', [marking('source_costs'), marking('source_other')]],
    ['candidate.evidence.0.sourceMarkings', [marking('source_costs'), marking('source_costs')]], ['candidate.evidence.0.sourceMarkings', [marking('source_orders'), marking('source_costs')]],
    ['candidate.evidence.0.sourceMarkings', [marking('source_costs'), marking('source_orders', '  ')]], ['candidate.evidence.0.sourceMarkings', [marking('source_costs'), marking('source_orders', 'x'.repeat(2001))]],
    ['candidate.evidence.0.pin.sourceIds', []], ['candidate.evidence.0.pin.sourceIds', ['source_orders', 'source_costs']], ['candidate.evidence.0.pin.sourceIds', ['source_costs', 'source_costs']],
    ['candidate.evidence.0.pin.branchIds', []], ['candidate.evidence.0.pin.branchIds', ['branch_b', 'branch_a']],
    ['candidate.evidence.0.summary', ' '], ['candidate.evidence.0.summary', 'x'.repeat(20001)],
    ['candidate.evidence', []], ['candidate.episodeIds', []], ['candidate.episodeIds', ['lesson_episode_fixture', 'lesson_episode_second']],
    ['candidate.counterexamples', []], ['candidate.counterexamples.0.conditions', {}], ['candidate.applicability.conditions', {}],
    ['candidate.applicability.sourceIds', ['source_costs']], ['candidate.applicability.sourceIds', ['source_orders', 'source_costs']], ['candidate.applicability.branchIds', ['*']], ['candidate.applicability.branchIds', ['branch_other']],
    ['candidate.applicability.memberId', 'member_other'], ['candidate.change.after', 'monday'], ['candidate.change.before', 'tuesday'],
  ];
  for (const change of invalidEvidence) assert.throws(() => released([edit(lessonView(), change)]), change[0]);
  // Per-pin bound: a coherent single pin of exactly 256 ordered sources, with its 256 markings and the matching
  // applicability union, is accepted; the same coherent pin at 257 names is refused by the per-pin limit alone.
  const names = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(3, '0')}`);
  const pinned = (id: string, sourceIds: readonly string[], branchIds: readonly string[]) => ({
    pin: { kind: 'calculation', id, revision: '1', digest: hex('b'), sourceIds, branchIds }, available: true, sourceTainted: false,
    sourceMarkings: sourceIds.map(sourceId => marking(sourceId)), summary: 'Synthetic evidence summary.',
  });
  const single = (count: number) => { const ids = names('source_', count); return edit(lessonView(), ['candidate.evidence', [pinned('receipt_fixture', ids, ['branch_fixture'])]], ['candidate.applicability.sourceIds', ids]); };
  const [wide] = released([single(256)]);
  assert.equal(wide!.candidate.evidence[0]!.pin.sourceIds.length, 256); assert.equal(wide!.candidate.evidence[0]!.sourceMarkings.length, 256);
  assert.equal(wide!.candidate.applicability.sourceIds.length, 256);
  assert.throws(() => released([single(257)]));
  // Aggregate: two distinct pins of 128 and 129 sources, each within its bound, one episode each, exact ordered markings,
  // and an applicability naming their exact 257-source union and both named branches. The union is kept whole.
  const a = names('source_a', 128), b = names('source_b', 129), union = [...a, ...b].sort();
  const aggregate = edit(lessonView(),
    ['candidate.evidence', [pinned('receipt_a', a, ['branch_a']), pinned('receipt_b', b, ['branch_b'])]],
    ['candidate.episodeIds', ['lesson_episode_a', 'lesson_episode_b']],
    ['candidate.applicability.sourceIds', union], ['candidate.applicability.branchIds', ['branch_a', 'branch_b']]);
  const [joined] = released([aggregate]);
  assert.deepEqual(joined!.candidate.applicability.sourceIds, union); assert.equal(joined!.candidate.applicability.sourceIds.length, 257);
  assert.deepEqual(joined!.candidate.applicability.branchIds, ['branch_a', 'branch_b']);
  assert.deepEqual(joined!.candidate.evidence.map(item => item.pin.sourceIds.length), [128, 129]);
  assert.deepEqual(joined!.candidate.evidence.map(item => item.sourceMarkings.length), [128, 129]);
  assert.deepEqual(lessonDecisionAvailability(joined!, uiContext()), { ok: true });
  // The aggregate still refuses a pin over its own bound, a union missing a name, a name from no pin, or an unnamed branch.
  const a257 = names('source_a', 257);
  assert.throws(() => released([edit(aggregate, ['candidate.evidence.0', pinned('receipt_a', a257, ['branch_a'])], ['candidate.applicability.sourceIds', [...a257, ...b].sort()])]));
  assert.throws(() => released([edit(aggregate, ['candidate.applicability.sourceIds', union.slice(1)])]));
  assert.throws(() => released([edit(aggregate, ['candidate.applicability.sourceIds', [...union, 'source_z'].sort()])]));
  assert.throws(() => released([edit(aggregate, ['candidate.applicability.branchIds', ['branch_a', 'branch_c']])]));
  // Valid released bytes are retained untouched, markings in their issued order.
  const [valid] = released([lessonView()]);
  assert.deepEqual(valid!.candidate.evidence[0]!.sourceMarkings, MARKINGS);
  assert.equal(valid!.candidate.evidence[0]!.summary, 'Synthetic evidence summary.');
  // A supersession keeps the predecessor's after as before, which need not equal the configured target value.
  const [superseding] = released([lessonView({ supersedes: true })]);
  assert.deepEqual(superseding!.candidate.supersedes, { id: 'lesson_predecessor', revision: 2, digest: hex('9') });
  assert.equal(superseding!.candidate.change.before, 'tuesday'); assert.equal(superseding!.candidate.target.value, 'monday');
  assert.deepEqual(lessonDecisionAvailability(superseding!, uiContext()), { ok: true });
  // Through the controller a malformed released list is refused whole: no selection, no decision.
  const fixture = await ready(lessonReply(() => [edit(lessonView(), ['candidate.evidence.0.available', false])]));
  assert.deepEqual(await fixture.host.retained.readLessons(), { ok: false, code: 'INVALID_REPLY' });
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'INVALID_REPLY', afterDispatch: false });
  assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
  assert.equal(fixture.count('memory.decideLesson'), 0);
  fixture.host.dispose();
});
test('L10 a lesson of another workspace, or one owned by another member, role or epoch, is never published as a released row and never exposes a decision', async () => {
  const other = { memberId: 'member_other', role: 'owner', epoch: 1 };
  // Valid control first: the current owner's row is released and decidable.
  assert.deepEqual(lessonDecisionAvailability(released([lessonView()])[0]!, uiContext()), { ok: true });
  // Structurally, the target owner must be the candidate owner in every component. The fixture shares one actor object
  // across every position, so the target owner is replaced by a fresh object that differs in exactly one component.
  for (const [name, owner] of [['memberId', { ...member, memberId: 'member_other' }], ['role', { ...member, role: 'cofounder' }], ['epoch', { ...member, epoch: 2 }]] as const) {
    assert.throws(() => validateLessonReviewView(edit(lessonView(), ['candidate.target.owner', owner])), name);
  }
  // Availability on a structurally coherent foreign row stays blocked; a current cofounder cannot decide an owner-pinned candidate.
  assert.deepEqual(lessonDecisionAvailability(validateLessonReviewView(lessonView({ workspaceId: 'workspace_other' })), uiContext()), { ok: false, block: 'workspace' });
  assert.deepEqual(lessonDecisionAvailability(released([lessonView()])[0]!, uiContext('owner', 'workspace_other')), { ok: false, block: 'workspace' });
  assert.deepEqual(lessonDecisionAvailability(validateLessonReviewView(lessonView({ owner: other, reviewer: other })), uiContext()), { ok: false, block: 'reviewer' });
  assert.deepEqual(lessonDecisionAvailability(released([lessonView()])[0]!, uiContext('cofounder')), { ok: false, block: 'reviewer' });
  // The released list is bound to the exact trusted workspace and actor (lessons.ts access/owner): a coherent row released
  // for another workspace, member, role or epoch is not a releasable list, so none of its private prose is published.
  const foreign: (readonly [string, (id?: string) => ReturnType<typeof lessonView>])[] = [
    ['workspace', id => lessonView({ ...(id === undefined ? {} : { id }), workspaceId: 'workspace_other' })],
    ['member', id => lessonView({ ...(id === undefined ? {} : { id }), owner: other, reviewer: other })],
    ['epoch', id => lessonView({ ...(id === undefined ? {} : { id }), owner: { ...member, epoch: 2 }, reviewer: { ...member, epoch: 2 } })],
    ['role', id => lessonView({ ...(id === undefined ? {} : { id }), owner: { ...member, role: 'cofounder' }, reviewer: { ...member, role: 'cofounder' } })],
  ];
  for (const [name, make] of foreign) {
    assert.doesNotThrow(() => validateLessonReviewView(make()), name);
    assert.throws(() => released([make()]), name);
    assert.throws(() => released([lessonView(), make('lesson_second')]), name);
    // Initial read: an earlier ready current list is cleared, no title or evidence is published, nothing is decided.
    let foreignNow = false;
    const fixture = await ready(lessonReply(() => (foreignNow ? [lessonView(), make('lesson_second')] : [lessonView()])));
    assert.deepEqual(await fixture.host.retained.readLessons(), { ok: true });
    foreignNow = true;
    assert.deepEqual(await fixture.host.retained.readLessons(), { ok: false, code: 'INVALID_REPLY' }, name);
    assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'INVALID_REPLY', afterDispatch: false }, name);
    assert.equal(JSON.stringify(fixture.host.retained.snapshot()).includes('Synthetic'), false, name);
    assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' }, name);
    assert.equal(fixture.count('memory.decideLesson'), 0, name);
    fixture.host.dispose();
    // Decision preflight: a current list, then a foreign fresh list before dispatch. Refused and cleared, not republished.
    let preflightForeign = false;
    const preflight = await ready(lessonReply(() => (preflightForeign ? [make()] : [lessonView()])));
    await preflight.host.retained.readLessons(); preflight.host.retained.selectLesson('lesson_fixture');
    preflightForeign = true;
    assert.deepEqual(await preflight.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'INVALID_REPLY' }, name);
    assert.deepEqual(preflight.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'INVALID_REPLY', afterDispatch: false }, name);
    assert.equal(preflight.count('memory.decideLesson'), 0, name);
    preflight.host.dispose();
  }
});
test('L11 a decision reply without the exact submitted review, candidate body or evaluation is an uncertain reply, never the accepted row', async () => {
  const replies: (readonly [string, () => unknown])[] = [
    ['missing review', () => lessonView({ status: 'approved', review: false })],
    ['replaced review id', () => ({ ...lessonView({ status: 'approved', review: false }), review: { ...lessonView().review, id: 'lesson_review_other' } })],
    ['replaced review digest', () => ({ ...lessonView({ status: 'approved', review: false }), review: { ...lessonView().review, digest: hex('0') } })],
    ['changed candidate body', () => edit(approved(), ['candidate.title', 'Synthetic lesson: a different title'])],
    ['changed evaluation', () => ({ ...lessonView({ status: 'approved', review: false, evaluationDigest: hex('f') }), review: { ...lessonView().review, evaluationDigest: hex('f') } })],
  ];
  for (const [name, reply] of replies) {
    const fixture = await ready(lessonReply(() => [lessonView()], reply));
    await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
    assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'INVALID_REPLY' }, name);
    assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'INVALID_REPLY', afterDispatch: true }, name);
    // Uncertain means uncertain: a second press cannot replay, and only an explicit new read continues.
    assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' }, name);
    assert.equal(fixture.count('memory.decideLesson'), 1, name);
    fixture.host.dispose();
  }
});
test('L12 an authority-written completedAt admits any finite timestamp including a date-only string, retained byte for byte; clock-written instants stay strict', () => {
  const [dated] = released([lessonView({ hidden: { completedAt: '2026-10-01' }, open: { completedAt: '2026-10-01T09:00:00+05:30' } })]);
  assert.equal(dated!.evaluation?.hidden.completedAt, '2026-10-01');
  assert.equal(dated!.evaluation?.open.completedAt, '2026-10-01T09:00:00+05:30');
  assert.deepEqual(lessonDecisionAvailability(dated!, uiContext()), { ok: true });
  for (const completedAt of ['not a date', '2026-13-45', '', ' ', 12345]) assert.throws(() => released([lessonView({ hidden: { completedAt } })]), String(completedAt));
  assert.throws(() => released([edit(lessonView(), ['review.at', '2026-10-01'])]));
  assert.throws(() => released([edit(lessonView(), ['candidate.proposedAt', '2026-10-01'])]));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView(), ['revision.createdAt', '2026-10-01']), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView({ comparison: true }), ['comparisons.0.createdAt', '2026-10-01']), PIN));
});
test('L13 a press carrying a stale review or evaluation binding is refused before the preflight read, with zero dispatch', async () => {
  const fixture = await ready(lessonReply(() => [lessonView()]));
  await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
  const before = fixture.calls.length;
  for (const stale of [{ ...intent(), reviewId: 'lesson_review_other' }, { ...intent(), reviewDigest: hex('0') }, { ...intent(), evaluationDigest: hex('f') }]) {
    assert.deepEqual(await fixture.host.retained.decideLesson(stale, 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
  }
  assert.equal(fixture.calls.length, before);
  assert.equal(fixture.host.retained.snapshot().lessons.kind, 'ready');
  fixture.host.dispose();
});
test('L14 a lifecycle cancellation fences a held preflight without sending, and leaves a dispatched decision uncertain without replay', async () => {
  const held = deferred<unknown>(); let hold = false;
  const fixture = await ready(lessonReply(() => (hold ? held.promise : [lessonView()]), () => approved()));
  await fixture.host.retained.readLessons(); fixture.host.retained.selectLesson('lesson_fixture');
  hold = true; const pending = fixture.host.retained.decideLesson(intent(), 'reason'); await issued(fixture, 'memory.lessons', 2);
  assert.equal(fixture.host.retained.snapshot().lessons.kind, 'deciding');
  fixture.host.retained.cancelPending();
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'ready', lessons: released([lessonView()]), selectedId: null, notice: 'READ_INVALIDATED', page: 0 });
  held.resolve([lessonView()]); assert.deepEqual(await pending, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.count('memory.decideLesson'), 0);
  // A cancelled, unselected list cannot be decided by the old press; a fresh selection is explicit.
  assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
  fixture.host.dispose();
  const slow = deferred<unknown>();
  const dispatched = await ready(lessonReply(() => [lessonView()], () => slow.promise));
  await dispatched.host.retained.readLessons(); dispatched.host.retained.selectLesson('lesson_fixture');
  const deciding = dispatched.host.retained.decideLesson(intent(), 'reason'); await issued(dispatched, 'memory.decideLesson', 1);
  dispatched.host.retained.cancelPending();
  assert.deepEqual(dispatched.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'READ_INVALIDATED', afterDispatch: true });
  slow.resolve(approved()); assert.deepEqual(await deciding, { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(dispatched.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'READ_INVALIDATED', afterDispatch: true });
  assert.deepEqual(await dispatched.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
  assert.equal(dispatched.count('memory.decideLesson'), 1);
  // Cancelling with nothing pending keeps ready views exactly.
  const calm = await ready(lessonReply(() => [lessonView()]));
  await calm.host.retained.readLessons(); const before = calm.host.retained.snapshot();
  calm.host.retained.cancelPending(); assert.equal(calm.host.retained.snapshot(), before);
  calm.host.dispose(); dispatched.host.dispose();
});
test('L15 a surface fence read at every awaited boundary stops a held list read from publishing and a held preflight from dispatching; a live fence proceeds and a left surface issues nothing', async () => {
  let onSurface = true, gate: ReturnType<typeof deferred<unknown>> | null = null, decideReply: () => unknown = () => approved();
  const fixture = await ready(lessonReply(() => (gate !== null ? gate.promise : [lessonView()]), () => decideReply()));
  // A live fence changes nothing about a genuine read.
  assert.deepEqual(await fixture.host.retained.readLessons(() => onSurface), { ok: true });
  assert.equal(fixture.host.retained.snapshot().lessons.kind, 'ready');
  // A held list read whose surface is left after its transport call was issued publishes no row and ends idle.
  gate = deferred<unknown>(); const reading = fixture.host.retained.readLessons(() => onSurface);
  await issued(fixture, 'memory.lessons', 2);
  onSurface = false; const heldList = gate; gate = null; heldList.resolve([lessonView(), lessonView({ id: 'lesson_second' })]);
  assert.deepEqual(await reading, { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'idle' });
  // Back on the surface the read is genuine again and a row can be selected.
  onSurface = true;
  assert.deepEqual(await fixture.host.retained.readLessons(() => onSurface), { ok: true });
  fixture.host.retained.selectLesson('lesson_fixture');
  // A held preflight whose surface is left before it resolves never dispatches; the press ends cancelled, not sent.
  gate = deferred<unknown>(); const deciding = fixture.host.retained.decideLesson(intent(), 'reason', () => onSurface);
  await issued(fixture, 'memory.lessons', 4);
  assert.equal(fixture.host.retained.snapshot().lessons.kind, 'deciding');
  onSurface = false; const heldPreflight = gate; gate = null; heldPreflight.resolve([lessonView()]);
  assert.deepEqual(await deciding, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.count('memory.decideLesson'), 0);
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'ready', lessons: released([lessonView()]), selectedId: null, notice: 'READ_INVALIDATED', page: 0 });
  // A press or read whose surface is already gone issues nothing and changes nothing.
  fixture.host.retained.selectLesson('lesson_fixture');
  const calls = fixture.calls.length, before = fixture.host.retained.snapshot();
  assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason', () => onSurface), { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(await fixture.host.retained.readLessons(() => onSurface), { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.calls.length, calls); assert.equal(fixture.host.retained.snapshot(), before);
  // A decision already dispatched when the surface is left stays uncertain: its reply is dropped and it is never replayed.
  onSurface = true; const slow = deferred<unknown>(); decideReply = () => slow.promise;
  const late = fixture.host.retained.decideLesson(intent(), 'reason', () => onSurface);
  await issued(fixture, 'memory.decideLesson', 1);
  onSurface = false; slow.resolve(approved());
  assert.deepEqual(await late, { ok: false, code: 'READ_INVALIDATED' });
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'unavailable', code: 'READ_INVALIDATED', afterDispatch: true });
  assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason'), { ok: false, code: 'DECISION_UNAVAILABLE' });
  assert.equal(fixture.count('memory.decideLesson'), 1);
  assert.deepEqual(fixture.forbidden(), []);
  fixture.host.dispose();
});
test('L16 the at-rest page names its exact list and stays within it; selection moves the page; a fresh read starts at the first page', async () => {
  const six = Array.from({ length: 6 }, (_, index) => lessonView({ id: `lesson_${String(index + 1)}` }));
  // The accepted reply is the exact same row's candidate, evaluation and review, in the status the decision produces.
  const fixture = await ready(lessonReply(() => six, payload => lessonView({ id: (payload as { candidate: { id: string } }).candidate.id, status: 'approved' })));
  assert.deepEqual(await fixture.host.retained.readLessons(), { ok: true });
  const first = fixture.host.retained.snapshot().lessons; if (first.kind !== 'ready') assert.fail('expected ready');
  assert.equal(first.lessons.length, 6); assert.equal(first.page, 0);
  // Another list object, an out-of-range page, a non-integer page or a control drawn on another page moves nothing.
  fixture.host.retained.pageLessons([...first.lessons], 0, 1); fixture.host.retained.pageLessons(first.lessons, 0, 2); fixture.host.retained.pageLessons(first.lessons, 0, -1); fixture.host.retained.pageLessons(first.lessons, 0, 0.5);
  fixture.host.retained.pageLessons(first.lessons, 1, 0);
  assert.equal(fixture.host.retained.snapshot().lessons, first);
  fixture.host.retained.pageLessons(first.lessons, 0, 1);
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { ...first, page: 1 });
  // Once the window has moved, the first page's Later control is obsolete even though it names the same list and a valid target.
  fixture.host.retained.pageLessons(first.lessons, 0, 1);
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { ...first, page: 1 });
  // Selecting the sixth row keeps its page; selecting the first row moves back; dropping the selection keeps the page.
  fixture.host.retained.selectLesson('lesson_6');
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { ...first, selectedId: 'lesson_6', page: 1 });
  fixture.host.retained.selectLesson('lesson_1');
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { ...first, selectedId: 'lesson_1', page: 0 });
  fixture.host.retained.pageLessons(first.lessons, 0, 1); fixture.host.retained.selectLesson(null);
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { ...first, selectedId: null, page: 1 });
  // The sixth row is decided on its own page, once, and the reply keeps the page that holds it.
  fixture.host.retained.selectLesson('lesson_6');
  assert.deepEqual(await fixture.host.retained.decideLesson(intent(six[5]!), 'reason'), { ok: true });
  assert.equal(fixture.count('memory.decideLesson'), 1);
  assert.deepEqual(fixture.calls.find(call => call.method === 'memory.decideLesson')?.payload, { candidate: { id: 'lesson_6', revision: 1, digest: hex('a') }, reviewId: 'lesson_review_fixture', reviewDigest: hex('e'), decision: 'approve', reason: 'reason' });
  const decided = fixture.host.retained.snapshot().lessons; if (decided.kind !== 'ready') assert.fail('expected ready');
  assert.equal(decided.page, 1); assert.equal(decided.lessons[5]?.status, 'approved'); assert.equal(decided.selectedId, null);
  assert.deepEqual(decided.lessons.map(item => item.candidate.id), six.map(item => item.candidate.id));
  // An obsolete page control from the earlier list moves nothing; a fresh read starts at the first page.
  fixture.host.retained.pageLessons(first.lessons, 1, 0);
  assert.equal(fixture.host.retained.snapshot().lessons, decided);
  assert.deepEqual(await fixture.host.retained.readLessons(), { ok: true });
  const reread = fixture.host.retained.snapshot().lessons;
  assert.equal(reread.kind === 'ready' && reread.page === 0 && reread.lessons.length === 6, true);
  fixture.host.dispose();
});
test('L17 the host seam rereads the operation guard after its own inner context read and before the raw effect: a departure during that read issues no decision and is a cancellation, never an uncertainty', async () => {
  let onSurface = true, stage: 'idle' | 'armed' | 'preflight' | 'trailing' | 'held' | 'released' = 'idle';
  const inner = deferred<unknown>(), reached = deferred<void>();
  const fixture = await ready(method => {
    if (method === 'memory.lessons') { if (stage === 'armed') stage = 'preflight'; return [lessonView()]; }
    if (method === 'memory.decideLesson') return approved();
    if (method !== 'ui.context') return undefined;
    // The preflight's trailing context read passes; the next context read is the host's own BEFORE read for memory.decideLesson.
    if (stage === 'preflight') { stage = 'trailing'; return undefined; }
    if (stage === 'trailing') { stage = 'held'; reached.resolve(); return inner.promise; }
    return undefined;
  });
  assert.deepEqual(await fixture.host.retained.readLessons(() => onSurface), { ok: true });
  fixture.host.retained.selectLesson('lesson_fixture');
  stage = 'armed';
  const deciding = fixture.host.retained.decideLesson(intent(), 'reason', () => onSurface);
  await reached.promise;
  // The memory.lessons preflight passed completely; the decision's inner authority read is held; no decision has been issued.
  assert.equal(stage, 'held'); assert.equal(fixture.count('memory.lessons'), 2); assert.equal(fixture.count('memory.decideLesson'), 0);
  assert.equal(fixture.host.retained.snapshot().lessons.kind, 'deciding');
  // The surface is left while that inner read is held; the unchanged authorized context is then released.
  onSurface = false; stage = 'released'; inner.resolve(context());
  assert.deepEqual(await deciding, { ok: false, code: 'READ_INVALIDATED' });
  assert.equal(fixture.count('memory.decideLesson'), 0);
  // Nothing was issued, so nothing is uncertain: the press is a cancellation and the ready rows are kept.
  assert.deepEqual(fixture.host.retained.snapshot().lessons, { kind: 'ready', lessons: released([lessonView()]), selectedId: null, notice: 'READ_INVALIDATED', page: 0 });
  // Back on the surface a genuine current press issues exactly one decision.
  onSurface = true; fixture.host.retained.selectLesson('lesson_fixture');
  assert.deepEqual(await fixture.host.retained.decideLesson(intent(), 'reason', () => onSurface), { ok: true });
  assert.equal(fixture.count('memory.decideLesson'), 1);
  assert.deepEqual(fixture.forbidden(), []);
  fixture.host.dispose();
});
test('V1 malformed lesson and scenario replies are refused without touching accessors or releasing partial data', () => {
  let accessed = false;
  const trapped = lessonView() as Record<string, unknown>;
  Object.defineProperty(trapped, 'status', { enumerable: true, get() { accessed = true; return 'review-ready'; } });
  assert.throws(() => released([trapped])); assert.equal(accessed, false);
  assert.throws(() => released([{ ...lessonView(), extra: true }]));
  assert.throws(() => released([lessonView(), lessonView()]));
  assert.throws(() => released([lessonView({ status: 'review-ready', evaluation: false })]));
  assert.throws(() => released([{ ...lessonView(), status: 'retired-and-approved' }]));
  assert.throws(() => released([lessonView({ open: { metrics: [{ name: 'm', direction: 'higher-is-better', before: Number.NaN, after: 1 }] } })]));
  assert.throws(() => released([lessonView({ open: { metrics: [] } })]));
  assert.throws(() => released([lessonView({ open: { sourceIds: [] } })]));
  assert.throws(() => released([edit(lessonView(), ['review.evaluationDigest', hex('0')])]));
  assert.throws(() => released([edit(lessonView(), ['evaluation.hidden.candidate', { id: 'lesson_other', revision: 1, digest: hex('a') }])]));
  assert.throws(() => released([edit(lessonView(), ['candidate.change.kind', 'published-calculation'], ['candidate.target.kind', 'published-calculation'])]));
  const sparse = [lessonView()]; sparse.length = 2;
  assert.throws(() => released(sparse));
  const symbolic = [lessonView()] as unknown[] & Record<symbol, unknown>; symbolic[Symbol('hidden')] = 1;
  assert.throws(() => released(symbolic));
  assert.throws(() => released([{ ...lessonView(), candidate: { ...lessonView().candidate, title: () => 'function' } }]));
  // Host-only scenario evidence state and undeclared keys never enter the browser projection.
  assert.throws(() => validateRetainedScenarioView({ ...scenarioView(), evidence: [{ state: {} }] }, PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView(), ['revision.state', { facts: [] }]), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView(), ['revision.branches.1.priceChangeBps', 500]), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView(), ['revision.branches.1.role', 'baseline'], ['revision.branches.1.priceChangeBps', '0']), PIN));
  assert.throws(() => validateRetainedScenarioView(edit(scenarioView(), ['revision.branches.0.priceChangeBps', '100'], ['revision.jobs.0.request.assumptions.priceChangeBps', '100']), PIN));
  assert.doesNotThrow(() => validateRetainedScenarioView(scenarioView(), PIN));
  const frozen: RetainedScenarioView = validateRetainedScenarioView(scenarioView(), PIN);
  assert.equal(Object.isFrozen(frozen.results[0]?.receipt.figures), true);
});

async function copiedRetainedDesktop(
  reply: (method: string, payload: unknown) => unknown | Promise<unknown>,
) {
  const { readFile } = await import('node:fs/promises');
  const path = new URL('../../desktop/preload.cjs', import.meta.url);
  const source = await readFile(path, 'utf8');
  const calls: { method: string; payload: unknown }[] = [];
  const { api } = loadElectronPreloadFixture<{
    requestEnvelope(method: string, payload?: unknown): Promise<unknown>;
  }>({
    source, filename: path.pathname,
    async invoke(channel, envelope) {
      assert.equal(channel, 'chausar:request');
      const call = envelope as { method: string; payload: unknown };
      calls.push(structuredClone(call));
      if (call.method === 'ui.context') return { ok: true, result: context() };
      if (call.method === 'dashboard.get') return { ok: true, result: dashboard() };
      if (call.method === 'receipts.get') return { ok: true, result: receipt((call.payload as { id: string }).id.slice('receipt_'.length)) };
      if (call.method === 'models.list') return { ok: true, result: [route] };
      return reply(call.method, call.payload);
    },
  });
  const host = createHostController(createDesktopRequestPort(api), { now: clock });
  await host.refresh();
  assert.equal(host.snapshot().phase, 'ready');
  return { host, calls };
}

const copiedRetainedRefusal = (code: string) => ({
  ok: false,
  error: { code, message: 'Synthetic private engine detail must not cross the preload.' },
});

test('copied desktop SCENARIO_HEAD_CHANGED clears a displayed proof and never retries its press', async t => {
  let deny = false;
  const h = await copiedRetainedDesktop(method => {
    assert.equal(method, 'scenarios.reopen');
    return deny ? copiedRetainedRefusal('SCENARIO_HEAD_CHANGED')
      : { ok: true, result: scenarioView() };
  });
  t.after(() => h.host.dispose());
  assert.deepEqual(await h.host.retained.openScenario(PIN), { ok: true });
  const shown = h.host.retained.snapshot().scenario;
  assert.equal(shown.kind, 'ready');
  if (shown.kind !== 'ready') assert.fail('The checked fixture must first display its private proof.');
  assert.equal(JSON.stringify(shown).includes(HUGE_INTEGER), true);
  deny = true;
  h.calls.length = 0; // Scope the witness to the press after proving initial display.
  assert.deepEqual(await h.host.retained.confirmScenario(shown.selection, shown.view), {
    ok: false, code: 'SCENARIO_HEAD_CHANGED',
  });
  assert.deepEqual(h.host.retained.snapshot().scenario, {
    kind: 'unavailable', selection: PIN, code: 'SCENARIO_HEAD_CHANGED',
  });
  assert.equal(JSON.stringify(h.host.retained.snapshot()).includes(HUGE_INTEGER), false);
  assert.equal(JSON.stringify(h.host.retained.snapshot()).includes('private engine detail'), false);
  assert.equal(h.host.snapshot().phase, 'ready', 'A record refusal is not fabricated workspace revocation.');
  await settle();
  assert.deepEqual(h.calls, [
    { method: 'ui.context', payload: {} },
    { method: 'scenarios.reopen', payload: PIN },
  ]);
  const callsBeforeOldPress = h.calls.length;
  assert.deepEqual(await h.host.retained.confirmScenario(shown.selection, shown.view), {
    ok: false, code: 'SELECTION_INVALID',
  });
  assert.equal(h.calls.length, callsBeforeOldPress, 'The discarded proof cannot issue another request.');
});

test('copied desktop lesson authority, stale and unknown refusals clear the released selection without a decision', async t => {
  for (const [engineCode, expected] of [
    ['LESSON_AUTHORITY_REQUIRED', 'LESSON_AUTHORITY_REQUIRED'],
    ['LESSON_EVIDENCE_CHANGED', 'LESSON_EVIDENCE_CHANGED'],
    ['EVALUATION_CHANGED', 'EVALUATION_CHANGED'],
    ['SYNTHETIC_RETAINED_UNKNOWN', 'REQUEST_FAILED'],
  ] as const) {
    await t.test(engineCode, async child => {
      let deny = false;
      const raw = lessonView();
      const h = await copiedRetainedDesktop(method => {
        assert.equal(method, 'memory.lessons');
        return deny ? copiedRetainedRefusal(engineCode) : { ok: true, result: [raw] };
      });
      child.after(() => h.host.dispose());
      assert.deepEqual(await h.host.retained.readLessons(), { ok: true });
      h.host.retained.selectLesson(raw.candidate.id);
      const shown = h.host.retained.snapshot().lessons;
      assert.equal(shown.kind, 'ready');
      if (shown.kind !== 'ready') assert.fail('The checked released list must first be displayed.');
      assert.equal(shown.selectedId, raw.candidate.id);
      assert.equal(JSON.stringify(shown).includes(raw.candidate.title), true);
      deny = true;
      h.calls.length = 0;
      assert.deepEqual(await h.host.retained.readLessons(), { ok: false, code: expected });
      assert.deepEqual(h.host.retained.snapshot().lessons, {
        kind: 'unavailable', code: expected, afterDispatch: false,
      });
      assert.equal(JSON.stringify(h.host.retained.snapshot()).includes(raw.candidate.title), false);
      assert.equal(JSON.stringify(h.host.retained.snapshot()).includes('private engine detail'), false);
      await settle();
      assert.deepEqual(h.calls, [
        { method: 'ui.context', payload: {} },
        { method: 'memory.lessons', payload: {} },
      ]);
      const callsBeforeOldPress = h.calls.length;
      assert.deepEqual(await h.host.retained.decideLesson(intent(raw), 'A human review reason.'), {
        ok: false, code: 'DECISION_UNAVAILABLE',
      });
      assert.equal(h.calls.length, callsBeforeOldPress, 'No discarded selection, decision, model or retry dispatch survives.');
    });
  }
});

test('copied desktop refusal after an issued lesson decision preserves uncertainty and never replays', async t => {
  for (const code of ['LESSON_AUTHORITY_REQUIRED', 'LESSON_REVIEW_CHANGED'] as const) {
    await t.test(code, async child => {
      const raw = lessonView();
      const h = await copiedRetainedDesktop((method, payload) => {
        if (method === 'memory.lessons') return { ok: true, result: [raw] };
        assert.equal(method, 'memory.decideLesson');
        const press = intent(raw, 'defer');
        assert.deepEqual(payload, {
          candidate: press.candidate, reviewId: press.reviewId, reviewDigest: press.reviewDigest,
          decision: 'defer', reason: 'A human review reason.',
        });
        return copiedRetainedRefusal(code);
      });
      child.after(() => h.host.dispose());
      assert.deepEqual(await h.host.retained.readLessons(), { ok: true });
      h.host.retained.selectLesson(raw.candidate.id);
      const press = intent(raw, 'defer');
      h.calls.length = 0;
      assert.deepEqual(await h.host.retained.decideLesson(press, 'A human review reason.'), {
        ok: false, code,
      });
      assert.deepEqual(h.host.retained.snapshot().lessons, {
        kind: 'unavailable', code, afterDispatch: true,
      });
      assert.equal(JSON.stringify(h.host.retained.snapshot()).includes(raw.candidate.title), false);
      assert.equal(JSON.stringify(h.host.retained.snapshot()).includes('private engine detail'), false);
      await settle();
      assert.deepEqual(h.calls.map(call => call.method), [
        'ui.context', 'memory.lessons', 'ui.context',
        'ui.context', 'memory.decideLesson',
      ]);
      const callsBeforeOldPress = h.calls.length;
      assert.deepEqual(await h.host.retained.decideLesson(press, 'A human review reason.'), {
        ok: false, code: 'DECISION_UNAVAILABLE',
      });
      assert.equal(h.calls.length, callsBeforeOldPress);
      assert.equal(h.calls.filter(call => call.method === 'memory.decideLesson').length, 1);
    });
  }
});
