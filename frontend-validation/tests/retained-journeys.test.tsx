import { readFileSync } from 'node:fs';
import { parse, type Root, type Rule } from 'postcss';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import type { HostRpcPort } from '../../app/ui/src/host/contracts';
import { missingHindiKeys } from '../../app/ui/src/app/text';
import { fullCalculationReceiptFixture, HUGE_INTEGER } from '../../app/ui/tests/fixtures';
import en from '../../app/ui/src/text/en.json';
import hi from '../../app/ui/src/text/hi.json';
import scenarioStyles from '../../app/ui/src/screens/ask/RetainedScenario.module.css';

// Actual React host composition with in-memory synthetic replies: no browser, pixels, font
// loading, Engine, provider, HTTP, native vault, keychain, model or hidden evaluation. Every
// scenario and lesson fixture is synthetic and every evaluation is `synthetic-protocol`; nothing
// here qualifies native transport, installed authorities, real evaluation or native Hindi reading.
// jsdom computes no layout; the CSS checks below read the stylesheet policy, not geometry.
const hex = (character: string) => character.repeat(64);
const AT = '2026-10-01T09:00:00.000Z';
const PIN = { scenarioId: 'scenario_fixture', revisionId: 'scenario_revision_a' };
const ALT_OUTCOME = { minor: `${HUGE_INTEGER}7`, display: 'Synthetic alternative outcome' };
const BASE_OUTCOME = { minor: HUGE_INTEGER, display: 'Synthetic baseline outcome' };
const member = { memberId: 'member_fixture', role: 'owner', epoch: 1 };
const SOURCES = ['source_costs', 'source_orders'];
const LIMITATION = 'Only published calculator analyses are supported.';
const REASON = 'Because Fridays are when I plan.';
const LESSON_SHEET_HASH = '#/reports/weekahead?sheet=lesson';
const title = (id: string) => `Synthetic lesson ${id}: remind me on Fridays`;
const disposals: (() => void)[] = [];
const englishMessages: Readonly<Record<string, string>> = en;
const hindiMessages: Readonly<Record<string, string>> = hi;
const key = (value: string, modifiers: { ctrlKey?: boolean; altKey?: boolean } = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: value, ...modifiers, bubbles: true, cancelable: true }));
const sheet = () => {
  const element = document.querySelector('[data-region="sheet"]');
  if (!(element instanceof HTMLElement)) throw Error('Synthetic host sheet missing');
  return within(element);
};
const sheetElement = () => document.querySelector('[data-region="sheet"]');
const page = () => within(screen.getByRole('main'));
/** Sheet chrome exactly as the catalogue writes it (the separator is a middle dot). */
const CLOSE = englishMessages['SHEET.close']!;
const position = (index: number, total: number) => englishMessages['SHEET.position']!.replace('{kind}', 'Proposed lesson').replace('{index}', String(index)).replace('{total}', String(total));
type Scope = Pick<typeof screen, 'getByRole'>;
/** A native button, so its own `disabled` state is asserted without any matcher extension. */
function button(name: string | RegExp, scope: Scope = screen): HTMLButtonElement {
  const element = scope.getByRole('button', { name });
  if (!(element instanceof HTMLButtonElement)) throw Error('Expected a native button');
  return element;
}
const rowIds = () => page().getAllByRole('button', { name: /remind me on Fridays/ }).map(row => row.closest('li')?.dataset['rowId']);
const settle = async () => { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); };
const css = (path: string): Root => parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
function baseValue(source: Root, selector: string, property: string): string | undefined {
  let value: string | undefined;
  source.walkRules((rule: Rule) => {
    if (rule.parent?.type !== 'root' || !rule.selectors.includes(selector)) return;
    rule.walkDecls(property, declaration => { value = declaration.value; });
  });
  return value;
}
function edit<T>(value: T, ...changes: readonly (readonly [path: string, next: unknown])[]): T {
  const copy = structuredClone(value);
  for (const [path, next] of changes) {
    const segments = path.split('.'); const last = segments.pop();
    let cursor: unknown = copy;
    for (const segment of segments) cursor = (cursor as Record<string, unknown>)[segment];
    if (last === undefined || cursor === null || typeof cursor !== 'object') throw Error(`Fixture path ${path} is unreachable`);
    (cursor as Record<string, unknown>)[last] = next;
  }
  return copy;
}

/* ---------- Producer-shaped synthetic fixtures ---------- */
function receipt(operation: string) {
  const base = fullCalculationReceiptFixture();
  const common = { ...base, id: `receipt_${operation}`, operation, period: { from: '2026-10-01', to: '2026-10-31' }, rows: base.rows.map(row => ({ ...row, validFrom: '2026-10-01' })) };
  return operation === 'margin' ? common : { ...common, figures: [{ key: 'total', label: 'Synthetic total', minor: '100', display: 'INR1.00', unit: 'money', currency: 'INR' }], valueMinor: '100', totalMinor: '100', allowedNumbers: ['100'] };
}
/** `operation` is the identifier the synthetic request names; `price_scenario` is synthetic, `scenario` is the Engine's published default id. */
function scenarioReceipt(id: string, bps: string, outcome: { minor: string; display: string }, operation = 'price_scenario') {
  const points = String(BigInt(bps));
  return {
    ...receipt(operation), id, asOf: AT,
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
/** The reopen view for the exact pin; `headRevisionId` names a newer head so the same pin reads as a coherently changed, historical view.
 * `operation` names the same identifier in each root request, authored request and embedded receipt. */
function scenarioView(options: { headRevisionId?: string; operation?: string } = {}) {
  const period = { from: '2026-10-01', to: '2026-10-31' }, operation = options.operation ?? 'price_scenario';
  const job = (id: string, branchId: string, label: string, bps: string) => ({ id, branchId, label, dependsOn: [], usesBranchAssumptions: true, request: { operation, period, asOf: AT, assumptions: { priceChangeBps: bps } }, authoredRequest: { operation, period, assumptions: { priceChangeBps: bps } }, authoredRequestDigest: hex('1'), requestDigest: hex('2'), inputDigest: hex('3') });
  const branches = [
    { id: 'scenario_branch_base', label: 'Your books', role: 'baseline', assumptionRevisionId: 'scenario_assumption_base', priceChangeBps: '0', rootJobId: 'scenario_job_base' },
    { id: 'scenario_branch_alt', label: 'Price up five percent', role: 'alternative', assumptionRevisionId: 'scenario_assumption_alt', priceChangeBps: '500', rootJobId: 'scenario_job_alt' },
  ];
  return {
    scenarioId: PIN.scenarioId, headRevisionId: options.headRevisionId ?? PIN.revisionId, mode: 'retained-revision',
    revision: { id: PIN.revisionId, scenarioId: PIN.scenarioId, parentRevisionId: null, mode: 'initial', createdAt: AT, evidenceId: 'scenario_evidence_fixture', evidenceDigest: hex('4'), branches, jobs: [job('scenario_job_base', 'scenario_branch_base', 'Earned, your books', '0'), job('scenario_job_alt', 'scenario_branch_alt', 'Earned, with the change', '500')], digest: hex('5') },
    jobs: [{ jobId: 'scenario_job_base', status: 'ready', runId: 'scenario_run_base' }, { jobId: 'scenario_job_alt', status: 'ready', runId: 'scenario_run_alt' }], status: 'complete',
    results: [
      { runId: 'scenario_run_base', runDigest: hex('6'), receipt: scenarioReceipt('receipt_scenario_base', '0', BASE_OUTCOME, operation), receiptDigest: hex('7'), digest: hex('8') },
      { runId: 'scenario_run_alt', runDigest: hex('9'), receipt: scenarioReceipt('receipt_scenario_alt', '500', ALT_OUTCOME, operation), receiptDigest: hex('a'), digest: hex('b') },
    ],
    comparisons: [{
      id: 'scenario_comparison_fixture', scenarioId: PIN.scenarioId, revisionId: PIN.revisionId, revisionDigest: hex('5'), evidenceId: 'scenario_evidence_fixture', evidenceDigest: hex('4'), createdAt: AT,
      requiredJobs: [
        { jobId: 'scenario_job_base', branchId: 'scenario_branch_base', requestDigest: hex('2'), inputDigest: hex('3'), runId: 'scenario_run_base', runRevisionId: PIN.revisionId, receiptId: 'receipt_scenario_base', receiptDigest: hex('7'), reusedFromRevisionId: null },
        { jobId: 'scenario_job_alt', branchId: 'scenario_branch_alt', requestDigest: hex('2'), inputDigest: hex('3'), runId: 'scenario_run_alt', runRevisionId: PIN.revisionId, receiptId: 'receipt_scenario_alt', receiptDigest: hex('a'), reusedFromRevisionId: null },
      ],
      noAction: true, limitations: [LIMITATION, 'This comparison grants no action authority.'], digest: hex('c'),
    }],
    noAction: true,
  };
}
/**
 * A synthetic readback of the producer's explicit recompute of a two-root what-if before it is re-evaluated
 * (scenario-service.ts recompute/#append): the same roots, assumptions and published `scenario` operation at a
 * new knowledge cut and evidence, mode `current-state-recompute` with its parent; both previously ready roots
 * are stale with their own earlier runs retained and their earlier results still embedded at the earlier cut;
 * no finalized comparison; this revision is the head. No recompute is executed here.
 */
function recomputedScenarioView() {
  const initial = scenarioView({ operation: 'scenario' }), cut = '2026-10-02T09:00:00.000Z';
  return {
    ...initial,
    revision: {
      ...initial.revision, parentRevisionId: 'scenario_revision_initial', mode: 'current-state-recompute', createdAt: cut,
      evidenceId: 'scenario_evidence_recompute', evidenceDigest: hex('d'), digest: hex('e'),
      jobs: initial.revision.jobs.map(job => ({ ...job, request: { ...job.request, asOf: cut }, inputDigest: hex('f') })),
    },
    jobs: [{ jobId: 'scenario_job_base', status: 'stale', retainedRunId: 'scenario_run_base' }, { jobId: 'scenario_job_alt', status: 'stale', retainedRunId: 'scenario_run_alt' }],
    status: 'partial', comparisons: [],
  };
}
function evaluationSummary(set: 'open' | 'hidden', candidate: { id: string; revision: number; digest: string }) {
  return {
    reference: { id: `evaluation_${set}_fixture`, revision: '1', digest: hex(set === 'open' ? 'd' : 'e') }, set, candidate, authorityId: 'synthetic_evaluator_fixture', qualification: 'synthetic-protocol',
    suite: { id: `suite_${set}`, revision: '1', digest: hex('f') }, harness: { id: 'harness_fixture', revision: '1', digest: hex('0') }, build: { id: 'build_fixture', revision: '1', digest: hex('1') }, configuration: { id: 'configuration_fixture', revision: '1', digest: hex('2') },
    comparisonId: 'comparison_fixture', completedAt: AT, status: 'complete', baseline: { guidance: 'off', digest: hex('3') }, treatment: { guidance: 'on', candidate },
    metrics: [{ name: 'synthetic_metric', direction: 'higher-is-better', before: 1, after: 1 }], sourceTainted: false, sourceIds: SOURCES,
  };
}
/** One released view; `target` names the configured guidance it would change, so approved rows can sit on distinct valid targets. */
function lessonView(options: { id?: string; status?: string; review?: boolean; reviewId?: string; title?: string; target?: string } = {}) {
  const id = options.id ?? 'lesson_1', target = options.target ?? 'reminder_fixture', pin = { id, revision: 1, digest: hex('a') };
  const candidate = {
    kind: 'candidate-lesson', workspaceId: 'workspace_fixture', id, revision: 1, digest: hex('a'), owner: member, proposedBy: member, proposedAt: AT, episodeIds: ['lesson_episode_fixture'],
    title: options.title ?? title(id), rationale: 'Synthetic rationale, written by the source.',
    evidence: [{ pin: { kind: 'calculation', id: 'receipt_fixture', revision: '1', digest: hex('b'), sourceIds: SOURCES, branchIds: ['branch_fixture'] }, available: true, sourceTainted: false, sourceMarkings: [{ sourceId: 'source_costs', marking: 'internal' }, { sourceId: 'source_orders', marking: 'internal' }], summary: 'Synthetic evidence summary.' }],
    change: { kind: 'reminder-timing', targetId: target, before: 'monday', after: 'friday' },
    applicability: { memberId: member.memberId, branchIds: ['branch_fixture'], sourceIds: SOURCES, conditions: { ritual: 'friday' } },
    counterexamples: [{ conditions: { ritual: 'monday' }, reason: 'Monday has its own brief.' }],
    target: { kind: 'reminder-timing', id: target, revision: '1', digest: hex('c'), owner: member, value: 'monday' },
  };
  const evaluation = { candidate: pin, open: evaluationSummary('open', pin), hidden: evaluationSummary('hidden', pin), digest: hex('d') };
  const review = options.review === false ? undefined : { id: options.reviewId ?? 'lesson_review_fixture', candidate: pin, evaluationDigest: hex('d'), reviewer: member, at: AT, digest: hex('e') };
  return { candidate, status: options.status ?? 'review-ready', evaluation, ...(review ? { review } : {}) };
}
const lessons = (count: number) => Array.from({ length: count }, (_, index) => lessonView({ id: `lesson_${String(index + 1)}` }));
/** Five already-approved rows on distinct configured targets, then a sixth genuinely review-ready row, in Engine order. */
const fiveApprovedThenReady = () => [...[1, 2, 3, 4, 5].map(index => lessonView({ id: `lesson_${String(index)}`, status: 'approved', target: `reminder_lesson_${String(index)}` })), lessonView({ id: 'lesson_6' })];
const decisionPayload = (id: string, decision: 'approve' | 'defer') => ({ candidate: { id, revision: 1, digest: hex('a') }, reviewId: 'lesson_review_fixture', reviewDigest: hex('e'), decision, reason: REASON });

type Gate = { promise: Promise<void>; release: () => void };
function gate(): Gate { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
type InnerStage = 'armed' | 'preflight' | 'trailing' | 'held' | 'released';
type InnerHold = { stage: InnerStage; gate: Gate; reached: Gate };
const trustedContext = () => ({ workspace: { id: 'workspace_fixture', name: 'Synthetic retained fixture', demo: true }, member: { id: 'member_fixture', name: 'Fixture owner', role: 'owner', epoch: 1, branches: ['*'] }, contextKey: 'a'.repeat(64) });

function transport() {
  const route = { id: 'route_fixture', kind: 'openai-compatible', model: 'synthetic-model', enabled: true, installationVerified: false, label: 'Synthetic route' };
  const receipts = ['billed', 'received', 'earned', 'margin'].map(receipt);
  const calls: { method: string; payload: unknown }[] = [];
  const behavior = {
    context: trustedContext(),
    scenario: (): unknown => scenarioView(), lessons: (): unknown => [lessonView()],
    /** The Engine releases the same reviewed row in the status the decision produces. */
    decide: (payload: unknown): unknown => { const request = payload as { candidate: { id: string }; decision: string }; return lessonView({ id: request.candidate.id, status: request.decision === 'defer' ? 'deferred' : 'approved' }); },
    refuse: null as string | null, holds: {} as Partial<Record<string, Gate>>, inner: null as InnerHold | null,
  };
  const port: HostRpcPort = { async request(method, payload) {
    calls.push({ method: String(method), payload: structuredClone(payload) });
    const held = behavior.holds[method]; if (held) { delete behavior.holds[method]; await held.promise; }
    const inner = behavior.inner;
    if (inner !== null) {
      // The decision's memory.lessons preflight passes completely (raw list call, then its trailing context read); the
      // context read after that is the host's own BEFORE read inside guardedRequest('memory.decideLesson'), held here.
      if (method === 'memory.lessons' && inner.stage === 'armed') inner.stage = 'preflight';
      else if (method === 'ui.context' && inner.stage === 'preflight') inner.stage = 'trailing';
      else if (method === 'ui.context' && inner.stage === 'trailing') { inner.stage = 'held'; inner.reached.release(); await inner.gate.promise; inner.stage = 'released'; }
    }
    switch (method) {
      case 'ui.context': return behavior.context;
      case 'models.list': return [route];
      case 'dashboard.get': return { workspace: { ...behavior.context.workspace, currency: 'INR', createdAt: AT }, calculations: receipts, factCount: 3, sources: 2, decisions: [], waitingActions: [], jobs: [], policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false }, dictionary: null, lastActivity: [] };
      case 'receipts.get': return receipts.find(item => item.id === (payload as { id: string }).id);
      case 'workspace.lock': return { locked: true };
      case 'scenarios.reopen': if (behavior.refuse !== null) throw Object.assign(Error(behavior.refuse), { code: behavior.refuse }); return behavior.scenario();
      case 'memory.lessons': return behavior.lessons();
      case 'memory.decideLesson': return behavior.decide(payload);
      default: throw Error(`Unexpected synthetic retained method ${String(method)}`);
    }
  } };
  const count = (method: string) => calls.filter(call => call.method === method).length;
  const methods = (from = 0) => calls.slice(from).map(call => call.method);
  const retainedOrDomain = (from = 0) => methods(from).filter(method => !['ui.context', 'dashboard.get', 'receipts.get', 'models.list', 'workspace.lock'].includes(method));
  /** Holds the next raw call of `method` after it was issued (it is counted first). */
  const hold = (method: string) => { const held = gate(); behavior.holds[method] = held; return () => { held.release(); }; };
  /** Holds the host's inner before-dispatch ui.context read of the next memory.decideLesson, after its memory.lessons preflight has completely passed. */
  const holdInnerDecisionContext = () => {
    const inner: InnerHold = { stage: 'armed', gate: gate(), reached: gate() }; behavior.inner = inner;
    return { reached: inner.reached.promise, release: () => { inner.gate.release(); }, stage: () => inner.stage };
  };
  return { port, calls, count, methods, retainedOrDomain, hold, holdInnerDecisionContext, behavior };
}

async function mounted(language: 'en' | 'hi' = 'en', scenarioSelection: typeof PIN | null = PIN) {
  const fixture = transport();
  const controller = createHostController(fixture.port, { now: () => Date.parse('2026-10-03T12:00:00.000Z'), timeZone: 'UTC' });
  const container = document.createElement('div'); document.body.append(container);
  await act(async () => {
    const host = mountHost(container, controller, { language, ...(scenarioSelection === null ? {} : { scenarioSelection }) }); disposals.push(host.dispose);
  });
  await waitFor(() => expect(controller.snapshot().phase).toBe('ready'));
  // Today's own global receipt reads happen at mount; retained journeys must add none.
  const globalReads = fixture.count('receipts.get');
  return { ...fixture, controller, user: userEvent.setup(), globalReads };
}
type Mounted = Awaited<ReturnType<typeof mounted>>;
const go = (hash: string) => { act(() => { window.location.hash = hash; }); };
/** An explicit issued-call barrier: the raw synthetic call was counted, whether or not it is being held. */
const issued = (fixture: Mounted, method: string, expected: number) => waitFor(() => expect(fixture.count(method)).toBe(expected));
async function help() { act(() => { key('/', { ctrlKey: true }); }); await screen.findByRole('heading', { name: 'Keyboard shortcuts' }); }
async function closeHelp() { act(() => { key('Escape'); }); await waitFor(() => expect(sheetElement()).toBeNull()); }
async function openedScenario(fixture: Mounted) {
  go('#/ask/saved'); const table = await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 1);
  return table;
}
async function openedLessons(fixture: Mounted, hash = '#/reports/weekahead', heading = 'The week ahead') {
  go(hash); await screen.findByRole('heading', { name: heading });
  await issued(fixture, 'memory.lessons', 1);
  return button(new RegExp(title('lesson_1')), page());
}
async function openedLessonSheet(fixture: Mounted, options: { reason?: string; hash?: string; heading?: string; id?: string } = {}) {
  const row = await openedLessons(fixture, options.hash, options.heading);
  const id = options.id ?? 'lesson_1';
  await fixture.user.click(id === 'lesson_1' ? row : button(new RegExp(title(id)), page()));
  await screen.findByRole('heading', { name: title(id) });
  const approve = button('Approve', sheet());
  expect(approve.disabled).toBe(true);
  await fixture.user.type(sheet().getByRole('textbox', { name: 'Your reason' }), options.reason ?? REASON);
  await waitFor(() => expect(approve.disabled).toBe(false));
  return approve;
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('No network in synthetic retained DOM regressions'));
  vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true }));
});
afterEach(async () => {
  await act(async () => { for (const dispose of disposals.splice(0)) dispose(); });
  document.body.replaceChildren(); window.location.hash = '';
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

/* ---------- Saved what-if: table, chart, sheet ---------- */
test('one native header cell per option sits over its own body cell; exact provenance is in the sheet, not at rest', async () => {
  const fixture = await mounted();
  const table = await openedScenario(fixture);
  const headers = within(table).getAllByRole('columnheader'), cells = within(table).getAllByRole('cell');
  expect(headers).toHaveLength(2); expect(cells).toHaveLength(2);
  expect(headers[0]?.textContent).toContain('Your books'); expect(headers[1]?.textContent).toContain('Price up five percent');
  expect(headers[1]?.textContent).toContain('Price change: 0 to 500 basis points');
  const headClass = scenarioStyles.head, columnClass = scenarioStyles.column;
  if (headClass === undefined || columnClass === undefined) throw Error('Scenario CSS module must expose its header styles');
  for (const header of headers) {
    expect(header.tagName).toBe('TH'); expect(header.classList.contains(headClass)).toBe(true); expect(header.classList.contains(columnClass)).toBe(false);
    expect(header.querySelector(`.${columnClass}`)).not.toBeNull();
  }
  const stylesheet = css('../../app/ui/src/screens/ask/RetainedScenario.module.css');
  expect(baseValue(stylesheet, '.head', 'display')).toBeUndefined();
  expect(baseValue(stylesheet, '.column', 'display')).toBe('grid');
  expect(baseValue(stylesheet, '.table', 'border-collapse')).toBe('collapse');
  // Compact cues at rest; exact revision digest, comparison identity, dates and limitations only in the sheet.
  expect(page().getByText('This is the current revision.')).toBeTruthy();
  expect(page().getByText('Every analysis is ready. Coverage gaps stay in each receipt.')).toBeTruthy();
  expect(page().getByText('Finalized comparison retained; dates and limitations are in Exact provenance.')).toBeTruthy();
  expect(page().getByText(/^Revision scenario_revision_a, created /)).toBeTruthy();
  expect(screen.queryByText(hex('5'))).toBeNull(); expect(screen.queryByText(/scenario_comparison_fixture/)).toBeNull(); expect(screen.queryByText(LIMITATION)).toBeNull();
  expect(screen.queryByText(/This revision is the current head/)).toBeNull();
  expect(screen.getByRole('main').querySelector('details')).toBeNull();
  const provenance = button('Exact provenance', page());
  await fixture.user.click(provenance);
  await screen.findByRole('heading', { name: PIN.revisionId });
  expect(fixture.count('scenarios.reopen')).toBe(2);
  expect(sheet().getByText(/^Scenario scenario_fixture\. Revision scenario_revision_a, created /)).toBeTruthy();
  expect(sheet().getByText('This revision is the current head. Reading it recomputed nothing.')).toBeTruthy();
  expect(sheet().getByText(hex('5'))).toBeTruthy(); expect(sheet().getByText(LIMITATION)).toBeTruthy();
  expect(sheet().getByText(/^Comparison scenario_comparison_fixture, finalized /)).toBeTruthy();
  expect(sheet().getAllByText('scenario_run_alt').length).toBeGreaterThan(0);
  expect(window.location.hash).toBe('#/ask/saved?sheet=what-if-provenance');
  act(() => { key('Escape'); });
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(document.activeElement).toBe(provenance);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
});

test('a stale analysis keeps a short cue at rest and its exact retained run only in the provenance sheet; nothing is drawn for it', async () => {
  const fixture = await mounted();
  fixture.behavior.scenario = () => edit(scenarioView(), ['jobs.1', { jobId: 'scenario_job_alt', status: 'stale', retainedRunId: 'scenario_run_alt' }], ['status', 'partial'], ['comparisons', []]);
  await openedScenario(fixture);
  expect(page().getByText('Earlier results, not current.')).toBeTruthy();
  expect(page().getByText('Some analyses are not ready. Missing figures are never zero.')).toBeTruthy();
  expect(page().queryByText(/retained under run/)).toBeNull(); expect(page().queryByText('scenario_run_alt')).toBeNull();
  expect(page().queryByText(ALT_OUTCOME.display)).toBeNull();
  expect(page().getByRole('button', { name: /^Scenario revenue: Synthetic baseline outcome\./ })).toBeTruthy();
  await fixture.user.click(button('Exact provenance', page()));
  await screen.findByRole('heading', { name: PIN.revisionId });
  expect(sheet().getByText('An earlier result is retained under run scenario_run_alt. It is not current and is not shown as a figure.')).toBeTruthy();
  expect(sheet().getAllByText('scenario_run_alt').length).toBeGreaterThan(0);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
});

test('two roots recomputed at a new cut and not yet re-evaluated: one shared cue at rest, both stale states in words, no earlier outcome drawn or charted, both exact retained runs only in the provenance sheet', async () => {
  const fixture = await mounted();
  fixture.behavior.scenario = recomputedScenarioView;
  const table = await openedScenario(fixture);
  // The explanatory cue appears once for the view, not once per retained run; each job's issued state stays visible in its column.
  expect(page().getAllByText('Earlier results, not current.')).toHaveLength(1);
  expect(within(table).getAllByText('stale, needs a fresh run')).toHaveLength(2);
  expect(within(table).getAllByRole('columnheader')).toHaveLength(2); expect(within(table).getAllByRole('cell')).toHaveLength(2);
  expect(page().getByText('This is the current revision.')).toBeTruthy();
  expect(page().getByText('Some analyses are not ready. Missing figures are never zero.')).toBeTruthy();
  expect(page().getByText('No finalized comparison is retained.')).toBeTruthy();
  // No root is ready: no chart, in words; neither retained earlier outcome is drawn as a current figure or chart value.
  expect(page().getByText('No chart; no comparable figure.')).toBeTruthy();
  expect(screen.queryByRole('group', { name: /for each option/ })).toBeNull();
  expect(page().queryByText(BASE_OUTCOME.display)).toBeNull(); expect(page().queryByText(ALT_OUTCOME.display)).toBeNull();
  expect(page().queryByRole('button', { name: /^Scenario revenue/ })).toBeNull(); expect(page().queryByRole('button', { name: /^Measured baseline/ })).toBeNull();
  expect(page().queryByText(/retained under run/)).toBeNull(); expect(page().queryByText(/Reused unchanged/)).toBeNull();
  expect(page().queryByText('scenario_run_base')).toBeNull(); expect(page().queryByText('scenario_run_alt')).toBeNull();
  expect(page().queryByText('current-state-recompute')).toBeNull();
  // The sheet names the recompute revision, its parent, each job's state, the published operation id unchanged, and each distinct exact retained run with its explanation.
  await fixture.user.click(button('Exact provenance', page()));
  await screen.findByRole('heading', { name: PIN.revisionId });
  expect(fixture.count('scenarios.reopen')).toBe(2);
  expect(sheet().getByText('This revision is the current head. Reading it recomputed nothing.')).toBeTruthy();
  expect(sheet().getByText('current-state-recompute')).toBeTruthy(); expect(sheet().getByText('scenario_revision_initial')).toBeTruthy();
  expect(sheet().getAllByText('stale, needs a fresh run')).toHaveLength(2);
  expect(sheet().getAllByText('scenario')).toHaveLength(2);
  expect(sheet().getByText('scenario_run_base')).toBeTruthy(); expect(sheet().getByText('scenario_run_alt')).toBeTruthy();
  expect(sheet().getByText('An earlier result is retained under run scenario_run_base. It is not current and is not shown as a figure.')).toBeTruthy();
  expect(sheet().getByText('An earlier result is retained under run scenario_run_alt. It is not current and is not shown as a figure.')).toBeTruthy();
  expect(sheet().queryByText(BASE_OUTCOME.display)).toBeNull(); expect(sheet().queryByText(ALT_OUTCOME.display)).toBeNull();
  expect(window.location.hash).toBe('#/ask/saved?sheet=what-if-provenance');
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  expect(fixture.retainedOrDomain().filter(method => method !== 'scenarios.reopen')).toEqual([]);
});

test('the chart draws the issued scenario outcome of each option with its receipt display, and a mark opens the embedded receipt after a fresh confirming read', async () => {
  const fixture = await mounted();
  await openedScenario(fixture);
  const chart = screen.getByRole('group', { name: 'Scenario revenue for each option, as the embedded receipts state it.' });
  const base = screen.getByRole('button', { name: 'Open the receipt for Your books, Synthetic baseline outcome' });
  const alternative = screen.getByRole('button', { name: 'Open the receipt for Price up five percent, Synthetic alternative outcome' });
  expect(chart.contains(base)).toBe(true); expect(chart.contains(alternative)).toBe(true);
  expect(alternative.querySelector('title')?.textContent).toBe('Price up five percent: Synthetic alternative outcome');
  expect(screen.queryByRole('button', { name: 'Open the receipt for Price up five percent, Synthetic measured baseline display' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Open the receipt for Your books, Synthetic measured baseline display' })).toBeNull();
  // The table still lists every issued figure with its own display string, unchanged.
  for (const control of page().getAllByRole('button', { name: /^Measured baseline: Synthetic measured baseline display\./ })) expect(control.textContent).toBe('Synthetic measured baseline display');
  expect(page().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }).textContent).toBe(ALT_OUTCOME.display);
  await fixture.user.click(alternative);
  await screen.findByRole('heading', { name: 'receipt_scenario_alt' });
  expect(fixture.count('scenarios.reopen')).toBe(2); expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  expect(sheet().getAllByText('what if').length).toBeGreaterThan(0);
  expect(sheet().getByText('Price change: 0 to 500 basis points')).toBeTruthy();
  expect(sheet().getByText(ALT_OUTCOME.display)).toBeTruthy(); expect(sheet().getAllByText(hex('a')).length).toBeGreaterThan(0);
  expect(window.location.hash).toBe('#/ask/saved?sheet=what-if-proof');
  // Without a comparable issued outcome there is no chart, in words; nothing is inferred from another key.
  fixture.behavior.scenario = () => edit(scenarioView(), ['results.1.receipt.figures', scenarioView().results[1]!.receipt.figures.filter(figure => figure.key !== 'scenario')], ['comparisons', []]);
  act(() => { key('Escape'); }); await waitFor(() => expect(sheetElement()).toBeNull());
  await fixture.user.click(button('Read again', page()));
  await screen.findByText('No chart; no comparable figure.');
  expect(screen.queryByRole('group', { name: /for each option/ })).toBeNull();
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
});

test('a proof press is refused when the fresh re-read is denied, coherently changed or malformed; stale figures clear and receipts.get is never read', async () => {
  const fixture = await mounted();
  await openedScenario(fixture);
  fixture.behavior.refuse = 'SCENARIO_EVIDENCE_UNAVAILABLE';
  await fixture.user.click(screen.getByRole('button', { name: 'Open the receipt for Price up five percent, Synthetic alternative outcome' }));
  await screen.findByText('This saved what-if is unavailable. Nothing from an earlier read is kept.');
  expect(screen.getByText('Code SCENARIO_EVIDENCE_UNAVAILABLE')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull(); expect(sheetElement()).toBeNull();
  expect(screen.queryByText(ALT_OUTCOME.display)).toBeNull();
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads); expect(window.location.hash).toBe('#/ask/saved');
  // A coherently changed view under the same ui.context (the head moved on for the same pin) refuses the old press rather than substituting newer results.
  fixture.behavior.refuse = null;
  await fixture.user.click(button('Read again', page()));
  await screen.findByRole('table');
  fixture.behavior.scenario = () => scenarioView({ headRevisionId: 'scenario_revision_head' });
  await fixture.user.click(page().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }));
  await screen.findByText('This saved what-if changed since it was shown. Nothing from the earlier read is kept.');
  expect(screen.getByText('Code SCENARIO_VIEW_CHANGED')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull(); expect(sheetElement()).toBeNull();
  expect(screen.queryByText(ALT_OUTCOME.display)).toBeNull();
  // A deliberately malformed projection (one result digest changed under the unchanged finalized comparison pin) is an invalid reply, not a changed view.
  fixture.behavior.scenario = () => scenarioView();
  await fixture.user.click(button('Read again', page()));
  await screen.findByRole('table');
  fixture.behavior.scenario = () => edit(scenarioView(), ['results.1.receiptDigest', hex('0')]);
  await fixture.user.click(page().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }));
  await screen.findByText('This saved what-if is unavailable. Nothing from an earlier read is kept.');
  expect(screen.getByText('Code INVALID_REPLY')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull(); expect(sheetElement()).toBeNull();
  expect(screen.queryByText(ALT_OUTCOME.display)).toBeNull(); expect(screen.queryByText(hex('0'))).toBeNull();
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  expect(fixture.retainedOrDomain().filter(method => method !== 'scenarios.reopen')).toEqual([]);
});

test('still-connected old figure and provenance controls pressed during a same-address pending replacement confirm nothing; the fresh controls of the newer view do', async () => {
  const fixture = await mounted();
  await openedScenario(fixture);
  const figure = button(/^Scenario revenue: Synthetic alternative outcome\./, page()), provenance = button('Exact provenance', page()), read = button('Read again', page());
  fixture.behavior.scenario = () => scenarioView({ headRevisionId: 'scenario_revision_head' });
  const before = fixture.calls.length;
  // The next raw reopen (the one Read again issues) is counted, then held: the replacement stays pending.
  const release = fixture.hold('scenarios.reopen');
  // One synchronous batch: genuine Read again publishes loading at once; before React commits anything the original
  // controls are still connected and are pressed against that pending replacement.
  act(() => {
    read.click();
    expect(fixture.controller.retained.snapshot().scenario.kind).toBe('loading');
    expect(figure.isConnected).toBe(true); expect(provenance.isConnected).toBe(true);
    figure.click(); provenance.click();
  });
  expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/ask/saved');
  // Mounted timing limit: once loading commits the original table is gone, so an original control connected beside a
  // newer ready view before commit is not reachable through these real controls. Source statically binds each press to
  // the exact rendered view object (bootstrap openScenarioSheet and controller confirmScenario); that guard is not re-proved here.
  expect(figure.isConnected).toBe(false); expect(provenance.isConnected).toBe(false);
  // The pending Read again reopen is actually issued (observed raw call) and still held; it is the only new scenario call.
  await issued(fixture, 'scenarios.reopen', 2);
  expect(fixture.retainedOrDomain(before)).toEqual(['scenarios.reopen']);
  expect(fixture.controller.retained.snapshot().scenario.kind).toBe('loading');
  expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/ask/saved');
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  // Release the coherent newer-head reply: the same pin now reads as a historical view with fresh controls.
  await act(async () => { release(); });
  await screen.findByText('An earlier revision; the head moved on. Nothing was recomputed.');
  await settle();
  expect(fixture.count('scenarios.reopen')).toBe(2);
  expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/ask/saved');
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  // The fresh figure confirms with exactly one read and opens its exact embedded receipt; its own Close returns to rest.
  await fixture.user.click(page().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }));
  await screen.findByRole('heading', { name: 'receipt_scenario_alt' });
  expect(fixture.count('scenarios.reopen')).toBe(3);
  expect(sheet().getByText(ALT_OUTCOME.display)).toBeTruthy(); expect(sheet().getAllByText(hex('a')).length).toBeGreaterThan(0);
  expect(window.location.hash).toBe('#/ask/saved?sheet=what-if-proof');
  await fixture.user.click(button(CLOSE, sheet()));
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/saved'); expect(fixture.count('scenarios.reopen')).toBe(3);
  // The fresh provenance confirms with exactly one more read and names the newer head.
  await fixture.user.click(button('Exact provenance', page()));
  await screen.findByRole('heading', { name: PIN.revisionId });
  expect(fixture.count('scenarios.reopen')).toBe(4);
  expect(sheet().getByText('This is an earlier revision. The current head is scenario_revision_head. Nothing was recomputed; the figures are those issued for this revision.')).toBeTruthy();
  expect(sheet().getByText(/^Comparison scenario_comparison_fixture, finalized /)).toBeTruthy();
  expect(window.location.hash).toBe('#/ask/saved?sheet=what-if-provenance');
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  expect(fixture.retainedOrDomain(before)).toEqual(['scenarios.reopen', 'scenarios.reopen', 'scenarios.reopen']);
});

test('an obsolete Read again control dispatches nothing after same-batch Help, route change or lock; returning needs a fresh read', async () => {
  const fixture = await mounted();
  await openedScenario(fixture);
  const read = button('Read again', page());
  act(() => { key('/', { ctrlKey: true }); expect(read.isConnected).toBe(true); read.click(); });
  await screen.findByRole('heading', { name: 'Keyboard shortcuts' });
  expect(fixture.count('scenarios.reopen')).toBe(1);
  await closeHelp();
  expect(screen.getByRole('table')).toBeTruthy(); expect(fixture.count('scenarios.reopen')).toBe(1);
  const again = button('Read again', page());
  act(() => { key('1', { ctrlKey: true }); expect(again.isConnected).toBe(true); again.click(); });
  await waitFor(() => expect(window.location.hash).toBe('#/today'));
  await waitFor(() => expect(fixture.controller.retained.snapshot().scenario).toEqual({ kind: 'idle' }));
  await waitFor(() => expect(screen.queryByRole('table')).toBeNull());
  expect(fixture.count('scenarios.reopen')).toBe(1);
  // Returning to the surface reads afresh instead of reusing the former private graph.
  go('#/ask/saved'); await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 2);
  const third = button('Read again', page());
  act(() => { void fixture.controller.lock(); expect(third.isConnected).toBe(true); third.click(); });
  await screen.findByText('Private workspace data is hidden. Open the previous interface to unlock.');
  expect(fixture.count('scenarios.reopen')).toBe(2);
  expect(screen.queryByRole('table')).toBeNull();
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
});

test('a held automatic read released after Help revives nothing; the surface reads afresh only when back at rest', async () => {
  const fixture = await mounted();
  const release = fixture.hold('scenarios.reopen');
  go('#/ask/saved');
  await screen.findByText('Reading this saved what-if with your current workspace access.');
  // The raw reopen call was issued and is being held; only then is Help opened over it.
  await issued(fixture, 'scenarios.reopen', 1);
  await help();
  await act(async () => { release(); }); await settle();
  expect(screen.queryByRole('table')).toBeNull();
  expect(fixture.controller.retained.snapshot().scenario).toEqual({ kind: 'idle' });
  expect(fixture.count('scenarios.reopen')).toBe(1);
  await closeHelp();
  await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 2);
});

test('without a trusted pin Saved says plainly that what-ifs cannot be listed here, and a transport refusal is a local unavailable state', async () => {
  const none = await mounted('en', null);
  go('#/ask/saved');
  await screen.findByText('Saved what-ifs cannot be listed or opened here yet.');
  expect(none.count('scenarios.reopen')).toBe(0);
  expect(screen.queryByRole('table')).toBeNull();
  await act(async () => { for (const dispose of disposals.splice(0)) dispose(); });
  document.body.replaceChildren();
  const native = await mounted();
  native.behavior.refuse = 'INVALID_REQUEST';
  go('#/ask/saved');
  await screen.findByText('Saved what-ifs are not available in this interface yet. Nothing was read.');
  expect(screen.getByText('Code UNSUPPORTED_TRANSPORT')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
});

/* ---------- Proposed lessons: rows, paging, sheet, one decision ---------- */
test('five approved rows then a sixth review-ready row: at most five at rest, the sixth is reached by paging and by the sheet, decided once in Engine order', async () => {
  const fixture = await mounted();
  fixture.behavior.lessons = fiveApprovedThenReady;
  await openedLessons(fixture);
  expect(rowIds()).toEqual(['lesson_1', 'lesson_2', 'lesson_3', 'lesson_4', 'lesson_5']);
  expect(page().getByText('Lessons 1 to 5 of 6, in the order they were released.')).toBeTruthy();
  expect(page().getByText('Released lessons, five at a time in the order they were released, each with its current standing. Approving records personal guidance only. It changes no meaning, recipe or calculation, and sends nothing anywhere.')).toBeTruthy();
  for (const index of [1, 2, 3, 4, 5]) expect(page().getByText(`approved. Would change reminder timing reminder_lesson_${String(index)}. Evidence: 1 item.`)).toBeTruthy();
  expect(page().queryByText(/ready for your review\./)).toBeNull();
  expect(button('Previous five', page()).disabled).toBe(true); expect(button('Next five', page()).disabled).toBe(false);
  // Paging reaches the sixth exact row, and back; the window moves, the list does not.
  await fixture.user.click(button('Next five', page()));
  await screen.findByText('Lessons 6 to 6 of 6, in the order they were released.');
  expect(rowIds()).toEqual(['lesson_6']);
  expect(page().getByText('ready for your review. Would change reminder timing reminder_fixture. Evidence: 1 item.')).toBeTruthy();
  expect(button('Next five', page()).disabled).toBe(true);
  await fixture.user.click(button('Previous five', page()));
  await screen.findByText('Lessons 1 to 5 of 6, in the order they were released.');
  expect(fixture.count('memory.lessons')).toBe(1);
  // An approved row opens without decision controls; the sheet's own adjacent control walks on to the sixth row and the window follows.
  await fixture.user.click(button(new RegExp(title('lesson_5')), page()));
  await screen.findByRole('heading', { name: title('lesson_5') });
  expect(sheet().getByText(position(5, 6))).toBeTruthy();
  expect(sheet().queryByRole('button', { name: 'Approve' })).toBeNull(); expect(sheet().queryByRole('button', { name: 'Not now' })).toBeNull();
  expect(sheet().getByText('Only a lesson ready for review can be decided.')).toBeTruthy();
  act(() => { key('ArrowDown', { altKey: true }); });
  await screen.findByRole('heading', { name: title('lesson_6') });
  expect(sheet().getByText(position(6, 6))).toBeTruthy();
  await screen.findByText('Lessons 6 to 6 of 6, in the order they were released.');
  expect(rowIds()).toEqual(['lesson_6']);
  expect(sheet().getAllByText('Synthetic protocol: lifecycle verification only, not a real hidden-suite result.')).toHaveLength(2);
  expect(sheet().queryByRole('button', { name: 'Reject' })).toBeNull();
  const approve = button('Approve', sheet());
  expect(approve.disabled).toBe(true);
  await fixture.user.type(sheet().getByRole('textbox', { name: 'Your reason' }), REASON);
  await waitFor(() => expect(approve.disabled).toBe(false));
  await fixture.user.click(approve);
  await issued(fixture, 'memory.decideLesson', 1);
  expect(fixture.calls.find(call => call.method === 'memory.decideLesson')?.payload).toEqual(decisionPayload('lesson_6', 'approve'));
  await waitFor(() => expect(sheetElement()).toBeNull());
  await screen.findByText('approved. Would change reminder timing reminder_fixture. Evidence: 1 item.');
  expect(window.location.hash).toBe('#/reports/weekahead');
  expect(fixture.count('memory.lessons')).toBe(2); expect(fixture.count('memory.decideLesson')).toBe(1);
  // Engine order is kept across the window; nothing else was dispatched and no global receipt was read.
  await fixture.user.click(button('Previous five', page()));
  await screen.findByText('Lessons 1 to 5 of 6, in the order they were released.');
  expect(rowIds()).toEqual(['lesson_1', 'lesson_2', 'lesson_3', 'lesson_4', 'lesson_5']);
  expect(fixture.retainedOrDomain().filter(method => method !== 'memory.lessons' && method !== 'memory.decideLesson')).toEqual([]);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
});

test('on Work, Approvals a Not now press sends exactly one defer decision for the exact tuple and reason, and the row shows its new standing', async () => {
  const fixture = await mounted();
  const before = fixture.calls.length;
  await openedLessonSheet(fixture, { hash: '#/work/approvals', heading: 'Approvals' });
  expect(page().getByText('Work')).toBeTruthy();
  const notNow = button('Not now', sheet());
  expect(notNow.disabled).toBe(false);
  await fixture.user.click(notNow);
  await issued(fixture, 'memory.decideLesson', 1);
  expect(fixture.calls.find(call => call.method === 'memory.decideLesson')?.payload).toEqual(decisionPayload('lesson_1', 'defer'));
  await waitFor(() => expect(sheetElement()).toBeNull());
  await screen.findByText('not now. Would change reminder timing reminder_fixture. Evidence: 1 item.');
  expect(window.location.hash).toBe('#/work/approvals');
  expect(fixture.retainedOrDomain(before)).toEqual(['memory.lessons', 'memory.lessons', 'memory.decideLesson']);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  await settle();
  expect(fixture.count('memory.decideLesson')).toBe(1);
});

test('a still-connected Approve pressed in the same batch as Help sends nothing and the sheet does not come back', async () => {
  const fixture = await mounted();
  const approve = await openedLessonSheet(fixture);
  const reads = fixture.count('memory.lessons');
  act(() => { key('/', { ctrlKey: true }); expect(approve.isConnected).toBe(true); approve.click(); });
  await screen.findByRole('heading', { name: 'Keyboard shortcuts' });
  await settle();
  expect(fixture.count('memory.decideLesson')).toBe(0); expect(fixture.count('memory.lessons')).toBe(reads);
  await closeHelp();
  expect(screen.queryByRole('heading', { name: title('lesson_1') })).toBeNull();
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', selectedId: null });
});

test('a still-connected Approve pressed with a lock, or after the owner epoch was replaced, issues no lesson read and no decision; private rows are cleared', async () => {
  const locking = await mounted();
  const approve = await openedLessonSheet(locking);
  const reads = locking.count('memory.lessons');
  act(() => { void locking.controller.lock(); expect(approve.isConnected).toBe(true); approve.click(); });
  await screen.findByText('Private workspace data is hidden. Open the previous interface to unlock.');
  await settle();
  expect(locking.count('memory.decideLesson')).toBe(0); expect(locking.count('memory.lessons')).toBe(reads);
  expect(locking.controller.retained.snapshot().lessons).toEqual({ kind: 'idle' });
  expect(screen.queryByText(title('lesson_1'))).toBeNull();
  await act(async () => { for (const dispose of disposals.splice(0)) dispose(); });
  document.body.replaceChildren();
  // A replaced owner epoch and context key is discovered by the host's own metadata read at the press: that read is the
  // only call issued, the lesson preflight and decision never follow, and the workspace is replaced whole.
  const replaced = await mounted();
  const press = await openedLessonSheet(replaced);
  const before = replaced.calls.length;
  replaced.behavior.context = { ...trustedContext(), member: { ...trustedContext().member, epoch: 2 }, contextKey: 'b'.repeat(64) };
  await replaced.user.click(press);
  await screen.findByText('This workspace is unavailable. Open the previous interface to continue.');
  expect(screen.getByText('Code ACCESS_DENIED.')).toBeTruthy();
  await settle();
  expect(replaced.methods(before)).toEqual(['ui.context']);
  expect(replaced.controller.retained.snapshot().lessons).toEqual({ kind: 'idle' });
  expect(screen.queryByText(title('lesson_1'))).toBeNull(); expect(screen.queryByText('Synthetic rationale, written by the source.')).toBeNull();
});

test('closing the sheet during a held preflight cancels the decision without sending; the late list cannot revive it', async () => {
  const fixture = await mounted();
  const approve = await openedLessonSheet(fixture);
  const reads = fixture.count('memory.lessons');
  const release = fixture.hold('memory.lessons');
  await fixture.user.click(approve);
  await screen.findAllByText('Sending your decision once.');
  // The raw preflight list call was issued and is being held before the sheet is closed over it.
  await issued(fixture, 'memory.lessons', reads + 1);
  expect(fixture.count('memory.decideLesson')).toBe(0);
  act(() => { key('Escape'); });
  await screen.findByText('Nothing was sent. Open the lesson again to decide.');
  await act(async () => { release(); }); await settle();
  expect(fixture.count('memory.decideLesson')).toBe(0);
  expect(sheetElement()).toBeNull();
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', selectedId: null, notice: 'READ_INVALIDATED' });
});

test('a review replaced before the press sends nothing, closes the sheet and clears the typed reason on reopening', async () => {
  const fixture = await mounted();
  const approve = await openedLessonSheet(fixture);
  fixture.behavior.lessons = () => [lessonView({ reviewId: 'lesson_review_other' })];
  await fixture.user.click(approve);
  await screen.findByText('This lesson changed before your decision was sent. Nothing was sent. Review it again.');
  expect(fixture.count('memory.decideLesson')).toBe(0);
  await waitFor(() => expect(sheetElement()).toBeNull());
  await fixture.user.click(button(new RegExp(title('lesson_1')), page()));
  await screen.findByRole('heading', { name: title('lesson_1') });
  const field = sheet().getByRole('textbox', { name: 'Your reason' });
  expect((field as HTMLInputElement).value).toBe('');
  expect(button('Approve', sheet()).disabled).toBe(true);
  expect(sheet().getByText('lesson_review_other')).toBeTruthy();
});

test('a malformed decision reply is shown as uncertain, is never sent again, and offers only a new read', async () => {
  const fixture = await mounted();
  fixture.behavior.decide = () => lessonView({ status: 'approved', review: false });
  const approve = await openedLessonSheet(fixture);
  await fixture.user.click(approve);
  await screen.findByText('Your decision may or may not have been recorded. It was not sent again. Read again before deciding.');
  expect(fixture.count('memory.decideLesson')).toBe(1);
  expect(sheetElement()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  expect(button('Read again', page())).toBeTruthy();
  await settle();
  expect(fixture.count('memory.decideLesson')).toBe(1);
});

test('an actual hash departure while the host holds its inner before-dispatch context read issues no decision, revives nothing and is never pulled back', async () => {
  const fixture = await mounted();
  const approve = await openedLessonSheet(fixture);
  const reads = fixture.count('memory.lessons');
  const held = fixture.holdInnerDecisionContext();
  await fixture.user.click(approve);
  // The memory.lessons preflight has completely passed; the host's own ui.context read inside guardedRequest('memory.decideLesson')
  // has entered and is held; no raw decision has been issued.
  await held.reached;
  expect(held.stage()).toBe('held');
  expect(fixture.count('memory.lessons')).toBe(reads + 1); expect(fixture.count('memory.decideLesson')).toBe(0);
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'deciding', selectedId: 'lesson_1' });
  // The actual hash leaves the lesson sheet. Its old DOM is still connected: React has not committed the departure.
  window.location.hash = '#/today';
  expect(approve.isConnected).toBe(true); expect(sheetElement()).not.toBeNull();
  await act(async () => {
    held.release();
    for (let i = 0; i < 48; i++) await Promise.resolve();
    // Only microtasks have run: no timer, hashchange task, layout commit or explicit cancellation. The released
    // unchanged context reached the raw boundary and the operation's guard refused it there.
    expect(held.stage()).toBe('released');
    expect(fixture.count('memory.decideLesson')).toBe(0);
    expect(window.location.hash).toBe('#/today');
  });
  expect(fixture.count('memory.decideLesson')).toBe(0);
  // The departure commits: the old reason and selection do not revive, and nothing navigates back to the sheet or its surface.
  await waitFor(() => expect(screen.queryByRole('heading', { name: title('lesson_1') })).toBeNull());
  await waitFor(() => expect(fixture.controller.retained.snapshot().lessons).toEqual({ kind: 'idle' }));
  expect(window.location.hash).toBe('#/today');
  expect(sheetElement()).toBeNull();
  expect(fixture.count('memory.decideLesson')).toBe(0); expect(fixture.count('memory.lessons')).toBe(reads + 1);
  await settle();
  expect(fixture.count('memory.decideLesson')).toBe(0); expect(window.location.hash).toBe('#/today');
  // Returning requires an explicit fresh read and an explicit current review; the earlier reason is gone.
  go('#/reports/weekahead');
  const row = await screen.findByRole('button', { name: new RegExp(title('lesson_1')) });
  await issued(fixture, 'memory.lessons', reads + 2);
  expect(sheetElement()).toBeNull();
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', selectedId: null });
  await fixture.user.click(row);
  await screen.findByRole('heading', { name: title('lesson_1') });
  expect((sheet().getByRole('textbox', { name: 'Your reason' }) as HTMLInputElement).value).toBe('');
  expect(button('Approve', sheet()).disabled).toBe(true);
  expect(fixture.count('memory.decideLesson')).toBe(0);
});

test('a background row rendered beside an open sheet is bound to that selection: after a genuine switch at the same sheet address an old row does nothing, and fresh rows still switch', async () => {
  const fixture = await mounted();
  fixture.behavior.lessons = () => lessons(3);
  await openedLessons(fixture);
  await fixture.user.click(button(new RegExp(title('lesson_3')), page()));
  await screen.findByRole('heading', { name: title('lesson_3') });
  expect(window.location.hash).toBe(LESSON_SHEET_HASH);
  const reads = fixture.count('memory.lessons');
  // Rows A and B were rendered beside the open sheet C. B is pressed genuinely, then old A before React commits.
  const rowA = button(new RegExp(title('lesson_1')), page()), rowB = button(new RegExp(title('lesson_2')), page());
  act(() => { rowB.click(); expect(rowA.isConnected).toBe(true); rowA.click(); });
  await screen.findByRole('heading', { name: title('lesson_2') });
  expect(sheet().getByText(position(2, 3))).toBeTruthy();
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', selectedId: 'lesson_2' });
  expect(window.location.hash).toBe(LESSON_SHEET_HASH);
  await settle();
  expect(screen.queryByRole('heading', { name: title('lesson_1') })).toBeNull();
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ selectedId: 'lesson_2' });
  // A fresh row beside the newer sheet switches as before, locally, without another read.
  await fixture.user.click(button(new RegExp(title('lesson_1')), page()));
  await screen.findByRole('heading', { name: title('lesson_1') });
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ selectedId: 'lesson_1' });
  expect(fixture.count('memory.lessons')).toBe(reads); expect(fixture.count('memory.decideLesson')).toBe(0);
});

test('page controls are bound to the page they were drawn on: after a fresh Next, an old Previous of the earlier page does nothing', async () => {
  const fixture = await mounted();
  fixture.behavior.lessons = () => lessons(11);
  await openedLessons(fixture);
  expect(page().getByText('Lessons 1 to 5 of 11, in the order they were released.')).toBeTruthy();
  await fixture.user.click(button('Next five', page()));
  await screen.findByText('Lessons 6 to 10 of 11, in the order they were released.');
  expect(rowIds()).toEqual(['lesson_6', 'lesson_7', 'lesson_8', 'lesson_9', 'lesson_10']);
  // Both controls were drawn on page 1. Next is pressed genuinely (to page 2); old Previous (to page 0) follows before React commits.
  const previous = button('Previous five', page()), next = button('Next five', page());
  expect(previous.disabled).toBe(false);
  act(() => { next.click(); expect(previous.isConnected).toBe(true); previous.click(); });
  await screen.findByText('Lessons 11 to 11 of 11, in the order they were released.');
  expect(rowIds()).toEqual(['lesson_11']);
  await settle();
  expect(page().getByText('Lessons 11 to 11 of 11, in the order they were released.')).toBeTruthy();
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', page: 2, selectedId: null });
  // The fresh Previous of page 2 still moves back.
  await fixture.user.click(button('Previous five', page()));
  await screen.findByText('Lessons 6 to 10 of 11, in the order they were released.');
  expect(fixture.count('memory.lessons')).toBe(1);
});

test('a row drawn on the first page cannot open after the window moved to the next page before React commits', async () => {
  const fixture = await mounted();
  fixture.behavior.lessons = () => lessons(6);
  await openedLessons(fixture);
  const row = button(new RegExp(title('lesson_1')), page()), next = button('Next five', page());
  act(() => { next.click(); expect(row.isConnected).toBe(true); row.click(); });
  await screen.findByText('Lessons 6 to 6 of 6, in the order they were released.');
  await settle();
  expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/reports/weekahead');
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', page: 1, selectedId: null });
  expect(rowIds()).toEqual(['lesson_6']);
  // The row of the current page opens as before.
  await fixture.user.click(button(new RegExp(title('lesson_6')), page()));
  await screen.findByRole('heading', { name: title('lesson_6') });
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ selectedId: 'lesson_6', page: 1 });
  expect(fixture.count('memory.lessons')).toBe(1);
});

test('an old Close is bound to its sheet, list and live address: after an actual hash departure it cannot pull the user back, and after a genuine switch it cannot close the newer sheet', async () => {
  const fixture = await mounted();
  fixture.behavior.lessons = () => lessons(3);
  await openedLessons(fixture);
  await fixture.user.click(button(new RegExp(title('lesson_1')), page()));
  await screen.findByRole('heading', { name: title('lesson_1') });
  const reads = fixture.count('memory.lessons');
  // Departure: the actual hash leaves the sheet; the old Close is still connected and is pressed before React commits.
  const close = button(CLOSE, sheet());
  window.location.hash = '#/today';
  act(() => { expect(close.isConnected).toBe(true); close.click(); });
  expect(window.location.hash).toBe('#/today');
  await waitFor(() => expect(screen.queryByRole('heading', { name: title('lesson_1') })).toBeNull());
  await waitFor(() => expect(fixture.controller.retained.snapshot().lessons).toEqual({ kind: 'idle' }));
  await settle();
  expect(window.location.hash).toBe('#/today'); expect(sheetElement()).toBeNull();
  expect(fixture.count('memory.lessons')).toBe(reads); expect(fixture.count('memory.decideLesson')).toBe(0);
  // Back on the surface with a fresh read: a genuine switch to C, then the old Close of A and the old adjacent control of A, before React commits.
  go('#/reports/weekahead');
  await screen.findByRole('button', { name: new RegExp(title('lesson_1')) });
  await issued(fixture, 'memory.lessons', reads + 1);
  await fixture.user.click(button(new RegExp(title('lesson_1')), page()));
  await screen.findByRole('heading', { name: title('lesson_1') });
  const closeA = button(CLOSE, sheet()), rowC = button(new RegExp(title('lesson_3')), page());
  act(() => { rowC.click(); expect(closeA.isConnected).toBe(true); closeA.click(); key('ArrowDown', { altKey: true }); });
  await screen.findByRole('heading', { name: title('lesson_3') });
  await settle();
  expect(sheet().getByText(position(3, 3))).toBeTruthy();
  expect(window.location.hash).toBe(LESSON_SHEET_HASH);
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', selectedId: 'lesson_3' });
  // The fresh Close of the newer sheet still closes it and returns to the surface at rest.
  await fixture.user.click(button(CLOSE, sheet()));
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/reports/weekahead');
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', selectedId: null });
  expect(fixture.count('memory.lessons')).toBe(reads + 1); expect(fixture.count('memory.decideLesson')).toBe(0);
});

/* ---------- Localization ---------- */
test('Hindi rows and sheet read the status, role and guidance words in Devanagari while source text and pins stay verbatim', async () => {
  const fixture = await mounted('hi');
  go('#/reports/weekahead');
  const row = await screen.findByRole('button', { name: new RegExp(title('lesson_1')) });
  expect(page().getByText('आपकी समीक्षा के लिए तैयार। अनुस्मारक का समय reminder_fixture बदलेगी। साक्ष्य: 1 मद।')).toBeTruthy();
  await fixture.user.click(row);
  await screen.findByRole('heading', { name: title('lesson_1') });
  expect(sheet().getAllByText('member_fixture, मालिक (owner), युग 1').length).toBeGreaterThan(0);
  expect(sheet().getByText('Synthetic rationale, written by the source.')).toBeTruthy();
  expect(button(hindiMessages['BTN.approve']!, sheet()).disabled).toBe(true);
  expect(sheet().getByRole('textbox', { name: 'आपका कारण' })).toBeTruthy();
  expect(sheet().getAllByText('कृत्रिम प्रोटोकॉल: केवल जीवनचक्र की जाँच, किसी असली छिपे सूट का नतीजा नहीं।')).toHaveLength(2);
});

test('every retained text key exists in both catalogues and each Hindi sentence is written in Devanagari', () => {
  expect(missingHindiKeys()).toEqual([]);
  expect(Object.keys(hindiMessages).filter(item => !(item in englishMessages))).toEqual([]);
  const retained = Object.keys(englishMessages).filter(item => item.startsWith('RETAINED.'));
  expect(retained.length).toBeGreaterThan(80);
  for (const item of retained) {
    const english = englishMessages[item]!, hindi = hindiMessages[item]!;
    expect(typeof hindi).toBe('string');
    if (/[A-Za-z]/.test(english.replace(/\{[^}]*\}/g, ''))) {
      expect(hindi, item).toMatch(/[ऀ-ॿ]/);
      expect(hindi, item).not.toMatch(/[?�]/);
    }
    for (const placeholder of english.match(/\{[A-Za-z]+/g) ?? []) expect(hindi, item).toContain(placeholder);
  }
  for (const item of ['noDiscovery', 'transport', 'unavailable']) expect(englishMessages[`RETAINED.scenario.${item}`]).not.toMatch(/Engine|interface keeps|receipt store/);
  expect(englishMessages['RETAINED.proof.note']).not.toMatch(/receipt store/);
  // The at-rest stale cue is short; the exact retained run and its explanation belong to the provenance sheet.
  expect(englishMessages['RETAINED.scenario.job.retainedRun']).not.toContain('{run}');
  expect(englishMessages['RETAINED.scenario.retainedRunDetail']).toContain('{run}');
  expect(hindiMessages['RETAINED.scenario.retainedRunDetail']).toContain('{run}');
});
