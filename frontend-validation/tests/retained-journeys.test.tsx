import { readFileSync } from 'node:fs';
import { engine as frozenFirstRunEngine, nodeDigest } from '../../app/ui/tests/first-run/fixture';
import { parse, type Root, type Rule } from 'postcss';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mountHost } from '../../app/ui/src/host/bootstrap';
import { createHostController } from '../../app/ui/src/host/controller';
import type { HostRpcPort } from '../../app/ui/src/host/contracts';
import type { ConversationRequest } from '../../app/ui/src/bridge/conversation-contract';
import { missingHindiKeys } from '../../app/ui/src/app/text';
import { fullCalculationReceiptFixture, HUGE_INTEGER } from '../../app/ui/tests/fixtures';
import { approvalFixture, continuationFixture, groundedFixture, planningPreviewFixture, readbackFixture, synthesisPreviewFixture } from '../../app/ui/tests/conversation-fixtures';
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
const LESSON_SHEET_HASH = '#/reports/lessons?sheet=lesson';
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
/** The Saved ledger: a row's identity is both exact pins, so two revisions of one label never share a row. */
const savedRowId = (pin: { scenarioId: string; revisionId: string }) => JSON.stringify([pin.scenarioId, pin.revisionId]);
const savedRowIds = () => Array.from(document.querySelectorAll<HTMLLIElement>('li[data-row-id]')).map(item => item.dataset['rowId']);
function savedRow(pin: { scenarioId: string; revisionId: string }): HTMLButtonElement {
  const element = document.querySelector(`li[data-row-id='${savedRowId(pin)}'] [data-row-main]`);
  if (!(element instanceof HTMLButtonElement)) throw Error(`Saved row ${savedRowId(pin)} missing`);
  return element;
}
const askLine = () => {
  const element = document.querySelector('[data-region="ask"] input');
  if (!(element instanceof HTMLInputElement)) throw Error('Synthetic host ask input missing');
  return element;
};
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
/* ---------- Discovery fixtures (scenarios.discover page shape) ---------- */
const CURSOR = 'c'.repeat(64);
const HEAD_PIN = { scenarioId: PIN.scenarioId, revisionId: 'scenario_revision_head' };
const OTHER_PIN = { scenarioId: 'scenario_other', revisionId: 'scenario_other_revision' };
function discoveryRow(overrides: Record<string, unknown> = {}) {
  return { scenarioId: PIN.scenarioId, revisionId: PIN.revisionId, label: 'Price up five percent', createdAt: AT, revisionMode: 'initial', status: 'complete', isHead: false, noAction: true, ...overrides };
}
/** Newest first, as the Engine sorts: the fixture scenario's later head, its historical revision a (the same label), and
 * another scenario's partial head. The at-rest row words come from the catalogue and the dates formatter, never from here. */
const ROW_HEAD = discoveryRow({ revisionId: HEAD_PIN.revisionId, createdAt: '2026-10-02T09:00:00.000Z', revisionMode: 'assumption-change', isHead: true });
const ROW_A = discoveryRow();
const ROW_OTHER = discoveryRow({ scenarioId: OTHER_PIN.scenarioId, revisionId: OTHER_PIN.revisionId, label: 'Rent review what-if', createdAt: '2026-09-30T09:00:00.000Z', status: 'partial', isHead: true });
const laterRow = (index: number) => discoveryRow({ scenarioId: `scenario_later_${String(index)}`, revisionId: `scenario_later_revision_${String(index)}`, createdAt: `2026-09-${String(29 - index).padStart(2, '0')}T09:00:00.000Z`, isHead: true });
const laterPin = (index: number) => ({ scenarioId: `scenario_later_${String(index)}`, revisionId: `scenario_later_revision_${String(index)}` });
const discoveryPage = (items: readonly unknown[], nextCursor: string | null = null) => ({ mode: 'retained-revisions', items: [...items], nextCursor, noAction: true });
const THREE_ROWS = () => discoveryPage([ROW_HEAD, ROW_A, ROW_OTHER]);
const cursorOf = (payload: unknown) => (payload as { cursor?: string }).cursor;
/** Two issued pages of five: a full first page with its continuation, then the terminal page of two. */
const twoPages = (payload: unknown) => (cursorOf(payload) === undefined ? discoveryPage([ROW_HEAD, ROW_A, ROW_OTHER, laterRow(1), laterRow(2)], CURSOR) : discoveryPage([laterRow(3), laterRow(4)]));
/** The exact reopen view for a pin: revision a under its later head, that head itself, or the other scenario. */
function viewFor(payload: unknown): unknown {
  const pin = payload as { scenarioId: string; revisionId: string };
  if (pin.scenarioId === OTHER_PIN.scenarioId) return edit(scenarioView(), ['scenarioId', OTHER_PIN.scenarioId], ['revision.scenarioId', OTHER_PIN.scenarioId], ['revision.id', OTHER_PIN.revisionId], ['headRevisionId', OTHER_PIN.revisionId], ['comparisons', []]);
  if (pin.revisionId === HEAD_PIN.revisionId) return edit(scenarioView({ headRevisionId: HEAD_PIN.revisionId }), ['revision.id', HEAD_PIN.revisionId], ['comparisons', []]);
  return scenarioView({ headRevisionId: HEAD_PIN.revisionId });
}
/** The at-rest row words exactly as the catalogue and `format/dates` write them for the three rows. */
const NOTE_HEAD = 'Created 2 Oct 2026. Changed assumption, current head. Every analysis ready.';
const NOTE_A = 'Created 1 Oct 2026. First revision, earlier revision. Every analysis ready.';
const NOTE_OTHER = 'Created 30 Sep 2026. First revision, current head. Some analyses not ready.';
const SAVED_LOADING = 'Reading saved what-ifs with your current workspace access.';
const SAVED_UNAVAILABLE = 'Saved what-ifs are unavailable. Nothing from an earlier read is kept.';
const SAVED_NO_CAPABILITY = 'Saved what-ifs cannot be listed in this interface yet. Nothing was read.';
const HISTORICAL = 'An earlier revision; the head moved on. Nothing was recomputed.';
const CURRENT = 'This is the current revision.';
const PAGE_ONE = 'Saved what-ifs 1 to 5 read so far, newest first.';
const MORE_RELEASED = 'More are released. Next five reads them with your current access.';

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
type ContextHold = { stage: 'armed' | 'held' | 'released'; gate: Gate; reached: Gate };
const trustedContext = () => ({ workspace: { id: 'workspace_fixture', name: 'Synthetic retained fixture', demo: true }, member: { id: 'member_fixture', name: 'Fixture owner', role: 'owner', epoch: 1, branches: ['*'] }, contextKey: 'a'.repeat(64) });
const MODEL_METHODS = ['models.preview', 'models.approve', 'conversation.ask', 'conversation.get', 'conversation.synthesis.preview', 'conversation.synthesis.run'];

function transport() {
  const route = { id: 'route_fixture', kind: 'openai-compatible', model: 'synthetic-model', enabled: true, installationVerified: false, label: 'Synthetic route' };
  const receipts = ['billed', 'received', 'earned', 'margin'].map(receipt);
  const calls: { method: string; payload: unknown }[] = [];
  /** The exact issued Ask reply, retained under its own id for the host's checked post-dispatch readback. */
  let dispatchedReadback: ReturnType<typeof readbackFixture> | null = null;
  const behavior = {
    context: trustedContext(),
    scenario: (_payload: unknown): unknown => scenarioView(), lessons: (): unknown => [lessonView()],
    /** The released discovery page for a request; an empty page unless a journey supplies rows. */
    discover: (_payload: unknown): unknown => discoveryPage([]),
    /** The Engine releases the same reviewed row in the status the decision produces. */
    decide: (payload: unknown): unknown => { const request = payload as { candidate: { id: string }; decision: string }; return lessonView({ id: request.candidate.id, status: request.decision === 'defer' ? 'deferred' : 'approved' }); },
    refuse: null as string | null, refuseDiscover: null as string | null, refuseConversation: null as string | null, holds: {} as Partial<Record<string, Gate>>, inner: null as InnerHold | null, contextHold: null as ContextHold | null,
    /** The conversation route's synthetic planning preview, for the saved-answer coexistence witness. */
    preview: planningPreviewFixture(),
    /** The grounded answer the reviewed question produces; a journey may point its saved-answer reference at another checked readback. */
    ask: (modelReceiptId: string): unknown => groundedFixture(modelReceiptId),
    /** A readback by exact id that a journey supplies for a saved answer of another kind; undefined leaves the default readbacks. */
    readback: null as ((id: string) => unknown) | null,
    /** The final-writing preview for an exact grounded turn id, supplied by a journey that exercises Preview writing. */
    synthesis: null as ((id: string) => unknown) | null,
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
    const contextHold = behavior.contextHold;
    if (contextHold !== null && method === 'ui.context' && contextHold.stage === 'armed') {
      // The next context read after arming is the host's own BEFORE read inside guardedRequest for the next retained call.
      contextHold.stage = 'held'; contextHold.reached.release(); await contextHold.gate.promise; contextHold.stage = 'released'; behavior.contextHold = null;
    }
    switch (method) {
      case 'ui.context': return behavior.context;
      case 'ontology.get': {
        const frozen = await frozenFirstRunEngine(), current = frozen.compile(frozen.pack(0), 1, 'member_fixture', AT);
        return { current, history: [current] };
      }
      case 'models.list': return [route];
      case 'dashboard.get': return { workspace: { ...behavior.context.workspace, currency: 'INR', createdAt: AT }, calculations: receipts, factCount: 3, sources: 2, decisions: [], waitingActions: [], jobs: [], policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 90, sharing: false }, dictionary: null, lastActivity: [] };
      case 'receipts.get': { const id = (payload as { id: string }).id; return receipts.find(item => item.id === id) ?? (id === 'receipt_fixture' ? fullCalculationReceiptFixture() : undefined); }
      case 'workspace.lock': return { locked: true };
      case 'scenarios.discover': if (behavior.refuseDiscover !== null) throw Object.assign(Error(behavior.refuseDiscover), { code: behavior.refuseDiscover }); return behavior.discover(payload);
      case 'scenarios.reopen': if (behavior.refuse !== null) throw Object.assign(Error(behavior.refuse), { code: behavior.refuse }); return behavior.scenario(payload);
      case 'memory.lessons': return behavior.lessons();
      case 'memory.decideLesson': return behavior.decide(payload);
      case 'models.preview': behavior.preview = planningPreviewFixture(payload as ConversationRequest); return behavior.preview;
      case 'models.approve': return approvalFixture(behavior.preview);
      case 'conversation.ask': {
        const question = behavior.preview.naturalQuestion, answer = await behavior.ask(behavior.preview.id);
        dispatchedReadback = readbackFixture(structuredClone(answer), question);
        return answer;
      }
      /** Readback by exact id: a readback the journey supplied, the grounded answer the reviewed question produced (read back
       * after dispatch), or the saved calculation answer it references. Any other id, or a configured refusal, is refused by name. */
      case 'conversation.get': {
        if (behavior.refuseConversation !== null) throw Object.assign(Error(behavior.refuseConversation), { code: behavior.refuseConversation });
        const id = (payload as { id: string }).id;
        const supplied = behavior.readback?.(id);
        if (supplied !== undefined) return supplied;
        if (dispatchedReadback !== null && id === dispatchedReadback.id) return dispatchedReadback;
        if (id === 'message_calculation_fixture') return readbackFixture(fullCalculationReceiptFixture(), behavior.preview.naturalQuestion);
        throw Object.assign(Error('CONVERSATION_NOT_FOUND'), { code: 'CONVERSATION_NOT_FOUND' });
      }
      /** The exact saved clarification a human chose to answer, as the Engine would read it back. */
      case 'conversation.continuation': return continuationFixture((payload as { id: string }).id);
      case 'conversation.synthesis.preview': {
        const id = (payload as { id: string }).id, supplied = behavior.synthesis?.(id);
        if (supplied !== undefined) return supplied;
        throw Error(`Unexpected synthetic final-writing preview ${id}`);
      }
      default: throw Error(`Unexpected synthetic retained method ${String(method)}`);
    }
  } };
  const count = (method: string) => calls.filter(call => call.method === method).length;
  const methods = (from = 0) => calls.slice(from).map(call => call.method);
  const retainedOrDomain = (from = 0) => methods(from).filter(method => !method.startsWith('todayx.') && !['ui.context', 'ontology.get', 'dashboard.get', 'receipts.get', 'models.list', 'workspace.lock'].includes(method));
  const payloads = (method: string) => calls.filter(call => call.method === method).map(call => call.payload);
  /** Holds the next raw call of `method` after it was issued (it is counted first). */
  const hold = (method: string) => { const held = gate(); behavior.holds[method] = held; return () => { held.release(); }; };
  /** Holds the host's inner before-dispatch ui.context read of the next memory.decideLesson, after its memory.lessons preflight has completely passed. */
  const holdInnerDecisionContext = () => {
    const inner: InnerHold = { stage: 'armed', gate: gate(), reached: gate() }; behavior.inner = inner;
    return { reached: inner.reached.promise, release: () => { inner.gate.release(); }, stage: () => inner.stage };
  };
  /** Holds the host's own next before-dispatch ui.context read: the one inside guardedRequest for the next retained call. */
  const holdNextContext = () => {
    const held: ContextHold = { stage: 'armed', gate: gate(), reached: gate() }; behavior.contextHold = held;
    return { reached: held.reached.promise, release: () => { held.gate.release(); }, stage: () => held.stage };
  };
  return { port, calls, count, methods, retainedOrDomain, payloads, hold, holdInnerDecisionContext, holdNextContext, behavior };
}

async function mounted(language: 'en' | 'hi' = 'en', scenarioSelection: typeof PIN | null = PIN) {
  // Each independent synthetic host starts on Today; the real mount preserves incoming routes.
  // Replace the address before mounting so an earlier fixture's Saved route issues no new reads.
  window.history.replaceState(null, '', '#/today');
  const fixture = transport();
  const controller = createHostController(fixture.port, { now: () => Date.parse('2026-10-03T12:00:00.000Z'), timeZone: 'UTC',
    firstRun: { digest: nodeDigest },
    dashboard: { title: 'Today', date: '2026-10-03', request: { period: { from: '2026-10-01', to: '2026-10-31' } },
      selections: [{ operation: 'billed', figureKey: 'total' }, { operation: 'received', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }] } });
  const container = document.createElement('div'); document.body.append(container);
  await act(async () => {
    const host = mountHost(container, controller, { language, ...(scenarioSelection === null ? {} : { scenarioSelection }) }); disposals.push(host.dispose);
  });
  await waitFor(() => expect(controller.snapshot().phase).toBe('ready'));
  await waitFor(() => expect(controller.snapshot().today).not.toBeNull());
  // Today's own global receipt reads happen at mount; retained journeys must add none.
  const globalReads = fixture.count('receipts.get');
  // Synthetic inputs omit timer spacing; user-event keeps dispatch, pointer and disabled-control checks.
  // Awaited UI and transport barriers establish completion; these journeys do not measure typing time.
  return { ...fixture, controller, user: userEvent.setup({ delay: null }), globalReads };
}
type Mounted = Awaited<ReturnType<typeof mounted>>;
const go = (hash: string) => { act(() => { window.location.hash = hash; }); };
/** An explicit issued-call barrier: the raw synthetic call was counted, whether or not it is being held. */
const issued = (fixture: Mounted, method: string, expected: number) => waitFor(() => expect(fixture.count(method)).toBe(expected));
async function help() { act(() => { key('/', { ctrlKey: true }); }); await screen.findByRole('heading', { name: 'Keyboard shortcuts' }); }
async function closeHelp() { act(() => { key('Escape'); }); await waitFor(() => expect(sheetElement()).toBeNull()); }
async function openedScenario(fixture: Mounted) {
  go('#/ask/whatifs'); const table = await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 1);
  return table;
}
/** Saved without a trusted pin: the released rows are read at rest; nothing is reopened. */
async function listedScenarios(fixture: Mounted, expectedReads = 1) {
  go('#/ask/whatifs'); await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', expectedReads);
  expect(fixture.count('scenarios.reopen')).toBe(0);
}
/** Chooses the configured route through the real picker, so the Ask composition wraps Saved as in a conversation session. */
async function withRoute(fixture: Mounted) {
  act(() => { key('2', { ctrlKey: true }); });
  const picker = await screen.findByRole('combobox');
  await fixture.user.selectOptions(picker, 'route_fixture');
  await waitFor(() => expect(fixture.controller.snapshot().selectedRouteId).toBe('route_fixture'));
}
async function disposeMounted() {
  await act(async () => { for (const dispose of disposals.splice(0)) dispose(); });
  document.body.replaceChildren();
}
/** The existing reviewed Ask journey up to its grounded answer, with the saved answers it references disclosed. */
async function groundedAnswer(fixture: Mounted) {
  await fixture.user.type(askLine(), '  What was billed?  ');
  await fixture.user.keyboard('{Enter}');
  await screen.findByRole('heading', { name: 'Send your question to the AI model' });
  await fixture.user.click(sheet().getByRole('button', { name: 'Send once' }));
  // The grounded answer is read back after dispatch; its receipts and saved answers sit behind a native disclosure.
  await issued(fixture, 'conversation.get', 1);
  await fixture.user.click(await page().findByText('Receipts and saved answers'));
}
/** The existing reviewed Ask journey, then the explicit saved-answer selection that owns Saved: the grounded answer references a
 * saved answer (the calculation answer by default), which is read back by its own id on Saved. Returns the number of readbacks issued so far. */
async function savedAnswerSelected(fixture: Mounted, reference = 'message_calculation_fixture'): Promise<number> {
  await groundedAnswer(fixture);
  const selectedReference = await screen.findByRole('button', { name: reference });
  await fixture.user.click(selectedReference);
  await waitFor(() => expect(window.location.hash).toBe('#/ask/saved'));
  await issued(fixture, 'conversation.get', 2);
  // A selected grounded answer's own receipt button may use the same id: wait for the clicked old reference to leave
  // and for the exact selected answer to finish its checked readback, rather than mistaking that new receipt for it.
  await waitFor(() => {
    expect(selectedReference.isConnected).toBe(false);
    const selected = fixture.controller.conversation.snapshot();
    expect(selected.kind).toBe('answer');
    if (selected.kind === 'answer') expect(selected.saved.id).toBe(reference);
  });
  await screen.findByRole('heading', { name: 'What was billed?' });
  return 2;
}
const CLARIFICATION_ID = 'conversation_clarification_fixture';
const GROUNDED_SAVED_ID = 'conversation_tools_saved_fixture';
const NEXT_GROUNDED_SAVED_ID = 'conversation_tools_next_saved_fixture';
/** The grounded turn the reviewed question produces, its calculation result's saved answer named `answerId`: the human's one
 * explicit path to a saved answer of another kind, through the same checked reference. */
const groundedReferencing = (modelReceiptId: string, answerId: string) => edit(groundedFixture(modelReceiptId), ['receipt.resultRefs.0.answerId', answerId]);
/** A saved grounded turn read back by its own exact id: the same checked shape under the id the reference named. */
function savedGroundedTurn(modelReceiptId: string, id = GROUNDED_SAVED_ID, answerId = 'message_calculation_fixture') {
  const tools = groundedReferencing(modelReceiptId, answerId);
  return { ...tools, id, receipt: { ...tools.receipt, id } };
}
async function openedLessons(fixture: Mounted, hash = '#/reports/lessons', heading = 'Lessons') {
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
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if-provenance');
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
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if-provenance');
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
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if-proof');
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
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads); expect(window.location.hash).toBe('#/ask/whatifs');
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
  expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/ask/whatifs');
  // Mounted timing limit: once loading commits the original table is gone, so an original control connected beside a
  // newer ready view before commit is not reachable through these real controls. Source statically binds each press to
  // the exact rendered view object (bootstrap openScenarioSheet and controller confirmScenario); that guard is not re-proved here.
  expect(figure.isConnected).toBe(false); expect(provenance.isConnected).toBe(false);
  // The pending Read again reopen is actually issued (observed raw call) and still held; it is the only new scenario call.
  await issued(fixture, 'scenarios.reopen', 2);
  expect(fixture.retainedOrDomain(before)).toEqual(['scenarios.reopen']);
  expect(fixture.controller.retained.snapshot().scenario.kind).toBe('loading');
  expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/ask/whatifs');
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  // Release the coherent newer-head reply: the same pin now reads as a historical view with fresh controls.
  await act(async () => { release(); });
  await screen.findByText('An earlier revision; the head moved on. Nothing was recomputed.');
  await settle();
  expect(fixture.count('scenarios.reopen')).toBe(2);
  expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/ask/whatifs');
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  // The fresh figure confirms with exactly one read and opens its exact embedded receipt; its own Close returns to rest.
  await fixture.user.click(page().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }));
  await screen.findByRole('heading', { name: 'receipt_scenario_alt' });
  expect(fixture.count('scenarios.reopen')).toBe(3);
  expect(sheet().getByText(ALT_OUTCOME.display)).toBeTruthy(); expect(sheet().getAllByText(hex('a')).length).toBeGreaterThan(0);
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if-proof');
  await fixture.user.click(button(CLOSE, sheet()));
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/whatifs'); expect(fixture.count('scenarios.reopen')).toBe(3);
  // The fresh provenance confirms with exactly one more read and names the newer head.
  await fixture.user.click(button('Exact provenance', page()));
  await screen.findByRole('heading', { name: PIN.revisionId });
  expect(fixture.count('scenarios.reopen')).toBe(4);
  expect(sheet().getByText('This is an earlier revision. The current head is scenario_revision_head. Nothing was recomputed; the figures are those issued for this revision.')).toBeTruthy();
  expect(sheet().getByText(/^Comparison scenario_comparison_fixture, finalized /)).toBeTruthy();
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if-provenance');
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
  go('#/ask/whatifs'); await screen.findByRole('table');
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
  go('#/ask/whatifs');
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

test('without a trusted pin Saved lists the released what-ifs; an unsupported discovery transport is honest missing capability, not an empty list; a trusted pin still opens alone with its own transport refusal as a local unavailable state', async () => {
  const none = await mounted('en', null);
  none.behavior.discover = THREE_ROWS;
  await listedScenarios(none);
  expect(none.payloads('scenarios.discover')).toEqual([{ limit: 5 }]);
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByText(SAVED_NO_CAPABILITY)).toBeNull();
  await disposeMounted();
  // The desktop method refusal for discovery: no row, no empty list, no default scenario, no reopen.
  const unsupported = await mounted('en', null);
  unsupported.behavior.refuseDiscover = 'INVALID_REQUEST';
  go('#/ask/whatifs');
  await screen.findByText(SAVED_NO_CAPABILITY);
  expect(screen.getByText('Code UNSUPPORTED_TRANSPORT')).toBeTruthy();
  expect(screen.queryByText(/No saved what-ifs are released/)).toBeNull(); expect(screen.queryByRole('table')).toBeNull();
  expect(unsupported.count('scenarios.reopen')).toBe(0);
  await disposeMounted();
  // The preserved explicit-pin path: the trusted pin is reopened at rest exactly as before and no discovery is issued for it.
  const native = await mounted();
  native.behavior.refuse = 'INVALID_REQUEST';
  go('#/ask/whatifs');
  await screen.findByText('Saved what-ifs are not available in this interface yet. Nothing was read.');
  expect(screen.getByText('Code UNSUPPORTED_TRANSPORT')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(native.count('scenarios.reopen')).toBe(1); expect(native.count('scenarios.discover')).toBe(0);
  // The list is reachable from the pinned surface only by an explicit press.
  expect(button('Show saved what-ifs', page())).toBeTruthy();
});

/* ---------- Saved what-ifs: discovery ledger, choice, continuation, departure ---------- */
test('R1 Saved lists released what-ifs in Engine order with no automatic reopen; the chosen same-label historical row reopens exactly its tuple in the one right sheet beside the stationary list, its proof replaces that sheet with a way back to the detail, Esc and Back keep the rows and return focus to the row, and an empty or refused page says so honestly', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = THREE_ROWS;
  fixture.behavior.scenario = viewFor;
  await listedScenarios(fixture);
  expect(fixture.payloads('scenarios.discover')).toEqual([{ limit: 5 }]);
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN)]);
  // Only released metadata, in Engine order: labels as written (two rows share one), when, kind, head description, readiness.
  expect(page().getByText(NOTE_HEAD)).toBeTruthy(); expect(page().getByText(NOTE_A)).toBeTruthy(); expect(page().getByText(NOTE_OTHER)).toBeTruthy();
  expect(page().getAllByText('Price up five percent')).toHaveLength(2); expect(page().getByText('Rent review what-if')).toBeTruthy();
  expect(page().getByText('Released what-ifs you can open again, newest first, five at a time. Opening one reads its exact revision afresh; nothing is recomputed.')).toBeTruthy();
  // No total, hidden count, figure, receipt, stale mark or Rebuild is invented for a row; no table or figure is drawn before a choice.
  expect(page().queryByText(/See all/)).toBeNull(); expect(page().queryByText(/\bof \d+\b/)).toBeNull(); expect(page().queryByText(PAGE_ONE)).toBeNull();
  expect(page().queryByRole('button', { name: 'Next five' })).toBeNull(); expect(page().queryByText(/Rebuild/)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull(); expect(page().queryByText(ALT_OUTCOME.display)).toBeNull(); expect(page().queryByText(/scenario_revision_a/)).toBeNull();
  expect(fixture.count('scenarios.reopen')).toBe(0);
  // The historical row of the same label is chosen: exactly both identities reach the controller; the fresh checked graph opens
  // in the frame's one right sheet beside the stationary list, under the label as written, never beneath the rows.
  await fixture.user.click(savedRow(PIN));
  await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 1);
  expect(fixture.payloads('scenarios.reopen')).toEqual([PIN]);
  expect(Object.keys(fixture.payloads('scenarios.reopen')[0] as object).sort()).toEqual(['revisionId', 'scenarioId']);
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if');
  expect(sheet().getByRole('heading', { name: 'Price up five percent' })).toBeTruthy();
  expect(sheet().getByRole('table')).toBeTruthy(); expect(page().queryByRole('table')).toBeNull(); expect(page().queryByText(ALT_OUTCOME.display)).toBeNull();
  expect(sheet().getByText(HISTORICAL)).toBeTruthy(); expect(sheet().getByText(/^Revision scenario_revision_a, created /)).toBeTruthy();
  expect(sheet().queryByRole('heading', { name: /^What if$/ })).toBeNull();
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN)]);
  expect(savedRow(PIN).getAttribute('aria-current')).toBe('true'); expect(savedRow(HEAD_PIN).getAttribute('aria-current')).toBeNull();
  // The ordinary embedded-receipt journey from the detail: a figure confirms with one fresh reopen and the exact embedded receipt
  // replaces the same sheet (never a second sheet, never receipts.get), with a way back to the detail.
  await fixture.user.click(sheet().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }));
  await screen.findByRole('heading', { name: 'receipt_scenario_alt' });
  expect(fixture.count('scenarios.reopen')).toBe(2); expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if-proof');
  expect(sheet().getByText(ALT_OUTCOME.display)).toBeTruthy(); expect(document.querySelectorAll('[data-region="sheet"]')).toHaveLength(1);
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN)]);
  await fixture.user.click(button('Back to What if', sheet()));
  await screen.findByRole('heading', { name: 'Price up five percent' });
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if'); expect(sheet().getByRole('table')).toBeTruthy();
  expect(fixture.count('scenarios.reopen')).toBe(2); expect(savedRow(PIN).getAttribute('aria-current')).toBe('true');
  // Esc closes the detail: the view and the choice are dropped, the rows read so far stay, and focus returns to the row it came from; nothing is re-read.
  act(() => { key('Escape'); });
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/whatifs'); expect(screen.queryByRole('table')).toBeNull();
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN)]);
  expect(document.activeElement).toBe(savedRow(PIN)); expect(savedRow(PIN).getAttribute('aria-current')).toBeNull();
  expect(fixture.count('scenarios.discover')).toBe(1); expect(fixture.count('scenarios.reopen')).toBe(2);
  // The head row is its own exact tuple, never a substitute for the historical one.
  await fixture.user.click(savedRow(HEAD_PIN));
  await screen.findByText(CURRENT);
  expect(fixture.payloads('scenarios.reopen').at(-1)).toEqual(HEAD_PIN); expect(fixture.count('scenarios.reopen')).toBe(3);
  expect(sheet().getByText(/^Revision scenario_revision_head, created /)).toBeTruthy();
  // The other scenario's row, pressed beside the open sheet, opens its own tuple in the same one sheet.
  await fixture.user.click(savedRow(OTHER_PIN));
  await screen.findByText(/^Revision scenario_other_revision, created /);
  expect(fixture.payloads('scenarios.reopen').at(-1)).toEqual(OTHER_PIN); expect(fixture.count('scenarios.reopen')).toBe(4);
  expect(sheet().getByRole('heading', { name: 'Rent review what-if' })).toBeTruthy(); expect(document.querySelectorAll('[data-region="sheet"]')).toHaveLength(1);
  // Back to the list from the detail drops the view, keeps the rows and returns focus to the accepted row.
  await fixture.user.click(button('Back to the list', sheet()));
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/whatifs'); expect(document.activeElement).toBe(savedRow(OTHER_PIN));
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN)]); expect(fixture.count('scenarios.reopen')).toBe(4);
  // A second valid empty page is honest absence: no reopen follows.
  fixture.behavior.discover = () => discoveryPage([]);
  await fixture.user.click(button('Read the list again', page()));
  await screen.findByText('No saved what-ifs are released to you right now. This does not say whether any are retained.');
  expect(screen.queryByRole('table')).toBeNull(); expect(savedRowIds()).toEqual([]); expect(fixture.count('scenarios.reopen')).toBe(4);
  // A refused page is a bounded local failure, not absence; a missing host capability is honest missing capability.
  fixture.behavior.refuseDiscover = 'SCENARIO_RETENTION_EXPIRED';
  await fixture.user.click(button('Read the list again', page()));
  await screen.findByText(SAVED_UNAVAILABLE);
  expect(screen.getByText('Code SCENARIO_RETENTION_EXPIRED')).toBeTruthy(); expect(screen.queryByText(/No saved what-ifs are released/)).toBeNull();
  fixture.behavior.refuseDiscover = 'SCENARIO_HOST_REQUIRED';
  await fixture.user.click(button('Read the list again', page()));
  await screen.findByText(SAVED_NO_CAPABILITY);
  expect(screen.getByText('Code SCENARIO_HOST_REQUIRED')).toBeTruthy();
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  expect(fixture.retainedOrDomain().filter(method => method !== 'scenarios.discover' && method !== 'scenarios.reopen')).toEqual([]);
});

test('R2 still-connected rows and page controls cannot act after a synchronous replacement at the same address; fresh controls of the newer rows do; Next five carries only the exact issued cursor and the window moves locally over the rows read so far', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = twoPages;
  fixture.behavior.scenario = viewFor;
  await listedScenarios(fixture);
  expect(page().getByText(PAGE_ONE)).toBeTruthy(); expect(page().getByText(MORE_RELEASED)).toBeTruthy();
  expect(button('Previous five', page()).disabled).toBe(true); expect(button('Next five', page()).disabled).toBe(false);
  // (a) Read the list again replaces the rows; an old row pressed in the same batch, before React commits, reopens nothing.
  const oldRow = savedRow(PIN), readAgain = button('Read the list again', page());
  const release = fixture.hold('scenarios.discover');
  act(() => {
    readAgain.click();
    expect(fixture.controller.retained.snapshot().discovery.kind).toBe('loading');
    expect(oldRow.isConnected).toBe(true); oldRow.click();
  });
  await issued(fixture, 'scenarios.discover', 2);
  expect(fixture.count('scenarios.reopen')).toBe(0);
  await act(async () => { release(); });
  await screen.findByText(NOTE_A);
  expect(fixture.count('scenarios.reopen')).toBe(0);
  expect(fixture.controller.retained.snapshot().discovery).toMatchObject({ kind: 'ready', page: 0, selected: null });
  // (b) A genuine selection switch at the same address: row B, then old row A before React commits. B wins; A issues nothing.
  const rowA = savedRow(PIN), rowB = savedRow(HEAD_PIN);
  act(() => { rowB.click(); expect(rowA.isConnected).toBe(true); rowA.click(); });
  await screen.findByText(CURRENT);
  await settle();
  expect(fixture.payloads('scenarios.reopen')).toEqual([HEAD_PIN]);
  expect(fixture.controller.retained.snapshot().discovery).toMatchObject({ kind: 'ready', selected: HEAD_PIN });
  expect(savedRow(HEAD_PIN).getAttribute('aria-current')).toBe('true'); expect(savedRow(PIN).getAttribute('aria-current')).toBeNull();
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if'); expect(document.querySelectorAll('[data-region="sheet"]')).toHaveLength(1);
  // A fresh row beside the open sheet still switches, with exactly its own tuple, in the same one sheet.
  await fixture.user.click(savedRow(PIN));
  await screen.findByText(HISTORICAL);
  expect(fixture.payloads('scenarios.reopen')).toEqual([HEAD_PIN, PIN]);
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if'); expect(document.querySelectorAll('[data-region="sheet"]')).toHaveLength(1);
  // (c) Next five from the last window, beside the open sheet, reads the exact issued cursor once: a second old Next and an old
  // row pressed in the same batch issue nothing; the new page drops the chosen view, its sheet and the old window's rows.
  const next = button('Next five', page());
  const releaseMore = fixture.hold('scenarios.discover');
  act(() => {
    next.click();
    expect(fixture.controller.retained.snapshot().discovery.kind).toBe('loading');
    expect(next.isConnected).toBe(true); next.click();
    const row = savedRow(PIN); expect(row.isConnected).toBe(true); row.click();
  });
  await issued(fixture, 'scenarios.discover', 3);
  expect(fixture.payloads('scenarios.discover')).toEqual([{ limit: 5 }, { limit: 5 }, { limit: 5, cursor: CURSOR }]);
  await act(async () => { releaseMore(); });
  await screen.findByText('Saved what-ifs 6 to 7 read so far, newest first.');
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/whatifs');
  expect(savedRowIds()).toEqual([savedRowId(laterPin(3)), savedRowId(laterPin(4))]);
  expect(screen.queryByRole('table')).toBeNull(); expect(fixture.count('scenarios.reopen')).toBe(2); expect(fixture.count('scenarios.discover')).toBe(3);
  expect(button('Next five', page()).disabled).toBe(true); expect(page().queryByText(MORE_RELEASED)).toBeNull();
  expect(fixture.controller.retained.snapshot().discovery).toMatchObject({ kind: 'ready', page: 1, cursor: null, selected: null });
  // Previous five moves the window back locally over the rows read so far; the first window's rows open again.
  await fixture.user.click(button('Previous five', page()));
  await screen.findByText(PAGE_ONE);
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN), savedRowId(laterPin(1)), savedRowId(laterPin(2))]);
  expect(fixture.count('scenarios.discover')).toBe(3);
  await fixture.user.click(savedRow(PIN));
  await screen.findByRole('table');
  expect(fixture.payloads('scenarios.reopen')).toEqual([HEAD_PIN, PIN, PIN]);
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if');
  // (d) Window controls name the selection they were drawn beside: a Next drawn beside the chosen row, pressed in the same batch
  // after a newer row is chosen, moves nothing and leaves the newer choice; the fresh Next of the newer view moves the window
  // locally, supersedes that choice and closes its sheet without any read.
  const nextBesideChoice = button('Next five', page());
  act(() => { savedRow(HEAD_PIN).click(); expect(nextBesideChoice.isConnected).toBe(true); nextBesideChoice.click(); });
  await screen.findByText(CURRENT);
  await settle();
  expect(page().getByText(PAGE_ONE)).toBeTruthy();
  expect(fixture.controller.retained.snapshot().discovery).toMatchObject({ kind: 'ready', page: 0, selected: HEAD_PIN });
  expect(fixture.payloads('scenarios.reopen')).toEqual([HEAD_PIN, PIN, PIN, HEAD_PIN]);
  await fixture.user.click(button('Next five', page()));
  await screen.findByText('Saved what-ifs 6 to 7 read so far, newest first.');
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/whatifs'); expect(screen.queryByRole('table')).toBeNull();
  expect(fixture.controller.retained.snapshot()).toMatchObject({ discovery: { kind: 'ready', page: 1, selected: null }, scenario: { kind: 'idle' } });
  expect(fixture.count('scenarios.discover')).toBe(3); expect(fixture.count('scenarios.reopen')).toBe(4);
  // A continuation never states a total or a hidden count.
  expect(page().queryByText(/\bof \d+\b/)).toBeNull();
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  expect(fixture.retainedOrDomain().filter(method => method !== 'scenarios.discover' && method !== 'scenarios.reopen')).toEqual([]);
});

test('R3 a held discovery page released after Help revives nothing; hidden names in an over-shaped page never render; an actual hash departure during the host inner context read issues no reopen and is never pulled back; lock clears private rows, selection, view and cursor', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = () => discoveryPage([ROW_HEAD, ROW_A, ROW_OTHER], CURSOR);
  fixture.behavior.scenario = viewFor;
  const release = fixture.hold('scenarios.discover');
  go('#/ask/whatifs');
  await screen.findByText(SAVED_LOADING);
  // The raw discovery call was issued and is being held; only then is Help opened over it.
  await issued(fixture, 'scenarios.discover', 1);
  await help();
  await act(async () => { release(); }); await settle();
  expect(fixture.controller.retained.snapshot().discovery).toEqual({ kind: 'idle' });
  expect(screen.queryByText(NOTE_A)).toBeNull(); expect(fixture.count('scenarios.discover')).toBe(1);
  await closeHelp();
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 2);
  // Hidden names and counts never enter the page: an over-shaped page is refused whole, releasing no label of its own.
  fixture.behavior.discover = () => ({ ...discoveryPage([ROW_HEAD]), hiddenRows: 2, hiddenLabels: ['Secret what-if'] });
  await fixture.user.click(button('Read the list again', page()));
  await screen.findByText(SAVED_UNAVAILABLE);
  expect(screen.getByText('Code INVALID_REPLY')).toBeTruthy();
  expect(screen.queryByText(/Secret/)).toBeNull(); expect(screen.queryByText('Price up five percent')).toBeNull(); expect(savedRowIds()).toEqual([]);
  fixture.behavior.discover = () => discoveryPage([ROW_HEAD, ROW_A, ROW_OTHER], CURSOR);
  await fixture.user.click(button('Read the list again', page()));
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 4);
  // The actual hash leaves Saved while the host holds its own before-dispatch context read for the chosen row.
  const held = fixture.holdNextContext();
  const row = savedRow(PIN);
  await fixture.user.click(row);
  await held.reached;
  expect(held.stage()).toBe('held'); expect(fixture.count('scenarios.reopen')).toBe(0);
  expect(fixture.controller.retained.snapshot().scenario).toMatchObject({ kind: 'loading', selection: PIN });
  window.location.hash = '#/today';
  expect(row.isConnected).toBe(true);
  await act(async () => {
    held.release();
    for (let i = 0; i < 48; i++) await Promise.resolve();
    // Only microtasks have run: no hashchange task, layout commit or explicit cancellation. The released unchanged
    // context reached the raw boundary and the operation's own guard refused it there.
    expect(held.stage()).toBe('released');
    expect(fixture.count('scenarios.reopen')).toBe(0);
    expect(window.location.hash).toBe('#/today');
  });
  expect(fixture.count('scenarios.reopen')).toBe(0);
  // The departure commits: rows, selection and view do not revive, and nothing navigates back to Saved.
  await waitFor(() => expect(fixture.controller.retained.snapshot()).toEqual({ discovery: { kind: 'idle' }, scenario: { kind: 'idle' }, lessons: { kind: 'idle' } }));
  expect(window.location.hash).toBe('#/today'); expect(screen.queryByText(NOTE_A)).toBeNull();
  await settle();
  expect(fixture.count('scenarios.reopen')).toBe(0); expect(window.location.hash).toBe('#/today');
  // Returning requires a fresh authorized read; the earlier choice is not revived.
  go('#/ask/whatifs');
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 5);
  expect(screen.queryByRole('table')).toBeNull(); expect(fixture.count('scenarios.reopen')).toBe(0);
  // With ready rows, a chosen graph in the sheet and its proof replacing it, a lock clears every private label, figure, pin, selection and cursor.
  await fixture.user.click(savedRow(PIN));
  await screen.findByRole('table');
  await fixture.user.click(sheet().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }));
  await screen.findByRole('heading', { name: 'receipt_scenario_alt' });
  expect(JSON.stringify(fixture.controller.retained.snapshot()).includes(CURSOR)).toBe(true);
  act(() => { void fixture.controller.lock(); });
  await screen.findByText('Private workspace data is hidden. Open the previous interface to unlock.');
  expect(fixture.controller.retained.snapshot()).toEqual({ discovery: { kind: 'idle' }, scenario: { kind: 'idle' }, lessons: { kind: 'idle' } });
  expect(screen.queryByText('Price up five percent')).toBeNull(); expect(screen.queryByText('Rent review what-if')).toBeNull();
  expect(screen.queryByText(ALT_OUTCOME.display)).toBeNull(); expect(screen.queryByText(/scenario_revision_a/)).toBeNull(); expect(sheetElement()).toBeNull();
  expect(JSON.stringify(fixture.controller.retained.snapshot()).includes(CURSOR)).toBe(false);
  expect(fixture.count('scenarios.reopen')).toBe(2);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
});

test('a selected saved answer keeps precedence on Saved: no discovery is issued behind it, a receipt opened from it returns to the answer, leaving and returning keeps the answer, and the same route without a selected answer lists what-ifs with no model request', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = THREE_ROWS;
  await withRoute(fixture);
  // The existing reviewed Ask journey produces a grounded answer that references a saved calculation answer; the explicit
  // saved-answer selection owns Saved: the answer is read back by its own id; no discovery, no reopen.
  const readbacks = await savedAnswerSelected(fixture);
  expect(page().getByText('message_calculation_fixture')).toBeTruthy();
  expect(fixture.count('scenarios.discover')).toBe(0); expect(fixture.count('scenarios.reopen')).toBe(0);
  expect(screen.queryByText('Saved what-ifs')).toBeNull(); expect(screen.queryByText(NOTE_A)).toBeNull(); expect(screen.queryByText(SAVED_LOADING)).toBeNull();
  // A receipt opened from the saved answer is the global receipt read of that answer; closing it returns to the same answer.
  const globalReads = fixture.count('receipts.get');
  await fixture.user.click(screen.getByRole('button', { name: /^Earned: INR 9\.00\./ }));
  await screen.findByRole('heading', { name: 'receipt_fixture' });
  expect(window.location.hash).toBe('#/ask/saved?sheet=receipt'); expect(fixture.count('receipts.get')).toBe(globalReads + 1);
  expect(fixture.count('scenarios.discover')).toBe(0); expect(screen.queryByText(SAVED_LOADING)).toBeNull();
  act(() => { key('Escape'); });
  await waitFor(() => expect(sheetElement()).toBeNull());
  await issued(fixture, 'conversation.get', readbacks + 1);
  await screen.findByRole('heading', { name: 'What was billed?' });
  expect(window.location.hash).toBe('#/ask/saved');
  expect(fixture.count('scenarios.discover')).toBe(0); expect(screen.queryByText(NOTE_A)).toBeNull();
  // Leaving and returning keeps the selected answer, exactly as before; discovery still never runs behind it.
  go('#/today');
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'What was billed?' })).toBeNull());
  go('#/ask/saved');
  await issued(fixture, 'conversation.get', readbacks + 2);
  await screen.findByRole('heading', { name: 'What was billed?' });
  expect(fixture.count('scenarios.discover')).toBe(0); expect(fixture.count('scenarios.reopen')).toBe(0); expect(screen.queryByText(NOTE_A)).toBeNull();
  // The explicit overview control is offered beside the answer, but the default render never takes it: nothing was listed.
  expect(button('Show saved what-ifs', page())).toBeTruthy();
  expect(fixture.count('scenarios.discover')).toBe(0); expect(fixture.controller.conversation.snapshot().kind).toBe('answer');
  await disposeMounted();
  // The same configured route with no selected answer: Saved lists the released what-ifs and contacts no model for it.
  const listed = await mounted('en', null);
  listed.behavior.discover = THREE_ROWS;
  await withRoute(listed);
  await listedScenarios(listed);
  expect(listed.methods().filter(method => MODEL_METHODS.includes(method))).toEqual([]);
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN)]);
});

test('from a selected saved answer an explicit Show saved what-ifs switches the same mounted Saved to the overview and then to an exact chosen what-if: the answer operation is consumed before any await, a held answer success or refusal publishes nothing, still-connected answer references cannot open a receipt or re-establish the return, and fresh controls work', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = THREE_ROWS;
  fixture.behavior.scenario = viewFor;
  await withRoute(fixture);
  const readbacks = await savedAnswerSelected(fixture);
  const globalReads = fixture.count('receipts.get');
  // The answer owns Saved; its figure and the explicit overview control are both drawn beside this exact selection.
  const figure = button(/^Earned: INR 9\.00\./, page()), overview = button('Show saved what-ifs', page());
  expect(fixture.count('scenarios.discover')).toBe(0);
  const before = fixture.calls.length;
  // One synchronous batch: the overview is accepted, then the still-connected old figure control is pressed before React commits.
  act(() => {
    overview.click();
    expect(fixture.controller.conversation.snapshot().kind).not.toBe('answer');
    expect(fixture.controller.retained.snapshot().discovery.kind).toBe('loading');
    expect(figure.isConnected).toBe(true); figure.click();
  });
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 1);
  expect(fixture.payloads('scenarios.discover')).toEqual([{ limit: 5 }]);
  // The old reference opened nothing and re-established no return: no receipt read, no sheet, the ledger at rest.
  expect(fixture.count('receipts.get')).toBe(globalReads); expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/ask/saved');
  expect(screen.queryByRole('heading', { name: 'What was billed?' })).toBeNull(); expect(fixture.count('conversation.get')).toBe(readbacks);
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN)]);
  // The transition contacted no model and read no answer: only the fresh discovery was issued after the press.
  expect(fixture.methods(before).filter(method => MODEL_METHODS.includes(method))).toEqual([]);
  expect(fixture.retainedOrDomain(before)).toEqual(['scenarios.discover']);
  // The exact chosen what-if opens in the one right sheet beside the stationary list; the answer does not come back.
  await fixture.user.click(savedRow(PIN));
  await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 1);
  expect(fixture.payloads('scenarios.reopen')).toEqual([PIN]); expect(window.location.hash).toBe('#/ask/saved?sheet=what-if');
  expect(sheet().getByText(HISTORICAL)).toBeTruthy(); expect(screen.queryByRole('heading', { name: 'What was billed?' })).toBeNull();
  act(() => { key('Escape'); });
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/saved'); expect(document.activeElement).toBe(savedRow(PIN));
  expect(fixture.count('conversation.get')).toBe(readbacks); expect(screen.queryByRole('heading', { name: 'What was billed?' })).toBeNull();
  // A fresh Read the list again still reads afresh without a cursor; no model request was made for any of this.
  await fixture.user.click(button('Read the list again', page()));
  await issued(fixture, 'scenarios.discover', 2);
  expect(fixture.payloads('scenarios.discover')).toEqual([{ limit: 5 }, { limit: 5 }]);
  expect(fixture.count('receipts.get')).toBe(globalReads);
  await disposeMounted();
  // A held answer readback, success or refusal: the explicit overview consumes the answer operation before any await, so the
  // released reply publishes nothing over the ledger, and a still-connected overview control of that answer is then inert.
  for (const outcome of ['success', 'refusal'] as const) {
    const held = await mounted('en', null);
    held.behavior.discover = THREE_ROWS;
    await withRoute(held);
    const reads = await savedAnswerSelected(held);
    go('#/today');
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'What was billed?' })).toBeNull());
    const release = held.hold('conversation.get');
    if (outcome === 'refusal') held.behavior.refuseConversation = 'EVIDENCE_UNAVAILABLE';
    go('#/ask/saved');
    await issued(held, 'conversation.get', reads + 1);
    await screen.findByText('Working on this question.');
    expect(held.count('scenarios.discover')).toBe(0);
    const control = button('Show saved what-ifs', page());
    act(() => {
      control.click();
      expect(held.controller.conversation.snapshot().kind).not.toBe('busy');
      expect(held.controller.retained.snapshot().discovery.kind).toBe('loading');
      // The same control, pressed again before React commits, names a selection that no longer exists: it does nothing more.
      control.click();
    });
    await act(async () => { release(); }); await settle();
    await screen.findByText(NOTE_A);
    await issued(held, 'scenarios.discover', 1);
    expect(held.controller.conversation.snapshot().kind).not.toBe('answer');
    expect(screen.queryByRole('heading', { name: 'What was billed?' })).toBeNull(); expect(screen.queryByText(/This answer is unavailable/)).toBeNull();
    expect(held.count('conversation.get')).toBe(reads + 1); expect(held.count('scenarios.discover')).toBe(1); expect(held.count('scenarios.reopen')).toBe(0);
    expect(window.location.hash).toBe('#/ask/saved'); expect(sheetElement()).toBeNull();
    held.behavior.refuseConversation = null;
    await disposeMounted();
  }
});

test('from a grounded answer on Ask, New the saved-answer reference and its still-connected old figure pressed in one batch: the reference selects the saved answer and the actual address names Saved at once; the old figure neither opens a receipt, nor navigates, nor re-establishes the grounded answer as the return owner; the fresh Saved figure then opens its receipt and returns to the same saved answer', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = THREE_ROWS;
  await withRoute(fixture);
  await groundedAnswer(fixture);
  const reference = await screen.findByRole('button', { name: 'message_calculation_fixture' });
  const figure = button(/^Earned: INR 9\.00\./, page());
  const globalReads = fixture.count('receipts.get'), before = fixture.calls.length;
  expect(window.location.hash).toBe('#/ask/new');
  // One synchronous batch: the saved-answer reference is accepted and the actual hash already names Saved; the grounded answer's
  // own figure, still connected, is pressed before React commits that transition.
  act(() => {
    reference.click();
    expect(window.location.hash).toBe('#/ask/saved');
    expect(figure.isConnected).toBe(true); figure.click();
    expect(window.location.hash).toBe('#/ask/saved');
  });
  await issued(fixture, 'conversation.get', 2);
  expect(fixture.payloads('conversation.get').at(-1)).toEqual({ id: 'message_calculation_fixture' });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'message_calculation_fixture' })).toBeNull());
  await screen.findByRole('heading', { name: 'What was billed?' });
  expect(page().getByText('message_calculation_fixture')).toBeTruthy();
  // The old figure opened nothing: no receipt read, no sheet, no receipt address, no model request and no discovery after the press.
  expect(window.location.hash).toBe('#/ask/saved'); expect(sheetElement()).toBeNull();
  expect(fixture.count('receipts.get')).toBe(globalReads);
  expect(fixture.methods(before).filter(method => method !== 'ui.context')).toEqual(['conversation.get']);
  expect(fixture.count('scenarios.discover')).toBe(0);
  // The fresh figure of the selected saved answer opens its receipt at Saved; closing it returns to that same saved answer, not to the grounded one.
  await fixture.user.click(button(/^Earned: INR 9\.00\./, page()));
  await screen.findByRole('heading', { name: 'receipt_fixture' });
  expect(window.location.hash).toBe('#/ask/saved?sheet=receipt'); expect(fixture.count('receipts.get')).toBe(globalReads + 1);
  act(() => { key('Escape'); });
  await waitFor(() => expect(sheetElement()).toBeNull());
  await issued(fixture, 'conversation.get', 3);
  expect(fixture.payloads('conversation.get').at(-1)).toEqual({ id: 'message_calculation_fixture' });
  await screen.findByRole('heading', { name: 'What was billed?' });
  expect(window.location.hash).toBe('#/ask/saved'); expect(fixture.count('scenarios.discover')).toBe(0);
  expect(fixture.methods(before).filter(method => MODEL_METHODS.includes(method) && method !== 'conversation.get')).toEqual([]);
});

test('a saved clarification selected on Saved: its fresh Answer this selects exactly that continuation; after an explicit Show saved what-ifs the still-connected Answer this pressed in the same batch starts no continuation, changes no address and leaves the overview', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = THREE_ROWS;
  fixture.behavior.ask = modelReceiptId => groundedReferencing(modelReceiptId, CLARIFICATION_ID);
  fixture.behavior.readback = id => (id === CLARIFICATION_ID ? readbackFixture({ clarification: 'Which period should I use?', modelReceiptId: fixture.behavior.preview.id }, fixture.behavior.preview.naturalQuestion) : undefined);
  await withRoute(fixture);
  const reads = await savedAnswerSelected(fixture, CLARIFICATION_ID);
  expect(page().getByText('Which period should I use?')).toBeTruthy();
  // The fresh control: exactly this saved clarification's continuation is selected, at Saved.
  await fixture.user.click(button('Answer this', page()));
  await issued(fixture, 'conversation.continuation', 1);
  expect(fixture.payloads('conversation.continuation')).toEqual([{ id: CLARIFICATION_ID }]);
  await screen.findByText('Answer the clarification in the ask line.');
  expect(window.location.hash).toBe('#/ask/saved'); expect(fixture.controller.conversation.snapshot().kind).toBe('continuation');
  // Leaving and returning reads the selected clarification back afresh, with its controls.
  go('#/today');
  await waitFor(() => expect(screen.queryByText('Answer the clarification in the ask line.')).toBeNull());
  go('#/ask/saved');
  await issued(fixture, 'conversation.get', reads + 1);
  const answerIt = await screen.findByRole('button', { name: 'Answer this' });
  const overview = button('Show saved what-ifs', page());
  const before = fixture.calls.length;
  // One synchronous batch: the overview is accepted, then the still-connected Answer this of the answer it left.
  act(() => {
    overview.click();
    expect(fixture.controller.conversation.snapshot().kind).not.toBe('answer');
    expect(fixture.controller.retained.snapshot().discovery.kind).toBe('loading');
    expect(answerIt.isConnected).toBe(true); answerIt.click();
    expect(window.location.hash).toBe('#/ask/saved');
  });
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 1);
  expect(fixture.count('conversation.continuation')).toBe(1);
  expect(fixture.retainedOrDomain(before)).toEqual(['scenarios.discover']);
  expect(fixture.controller.conversation.snapshot().kind).not.toBe('continuation'); expect(fixture.controller.conversation.snapshot().kind).not.toBe('busy');
  expect(window.location.hash).toBe('#/ask/saved'); expect(sheetElement()).toBeNull();
  expect(screen.queryByText('Which period should I use?')).toBeNull(); expect(screen.queryByText('Answer the clarification in the ask line.')).toBeNull();
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
});

test('a saved grounded turn selected on Saved: fresh Preview writing opens its review without sending; selecting another Saved turn fences the still-connected old Preview and reference in the same batch, the fresh selected turn opens its receipt and returns; an explicit Show saved what-ifs then fences its still-connected Preview and leaves the overview', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = THREE_ROWS;
  fixture.behavior.ask = modelReceiptId => groundedReferencing(modelReceiptId, GROUNDED_SAVED_ID);
  const savedTurn = (id: string) => savedGroundedTurn(fixture.behavior.preview.id, id, id === GROUNDED_SAVED_ID ? NEXT_GROUNDED_SAVED_ID : 'message_calculation_fixture');
  fixture.behavior.readback = id => ([GROUNDED_SAVED_ID, NEXT_GROUNDED_SAVED_ID].includes(id) ? readbackFixture(savedTurn(id), fixture.behavior.preview.naturalQuestion) : undefined);
  fixture.behavior.synthesis = id => ([GROUNDED_SAVED_ID, NEXT_GROUNDED_SAVED_ID].includes(id) ? synthesisPreviewFixture(savedTurn(id)) : undefined);
  await withRoute(fixture);
  const reads = await savedAnswerSelected(fixture, GROUNDED_SAVED_ID);
  const sent = () => fixture.methods().filter(method => ['models.approve', 'conversation.synthesis.run', 'conversation.ask'].includes(method)).length;
  const dispatched = sent();
  // The fresh control: the review of what final writing would send opens at Saved for exactly this turn; nothing is approved or sent.
  await fixture.user.click(button('Preview writing', page()));
  await screen.findByRole('heading', { name: 'Send the results to be written up' });
  await issued(fixture, 'conversation.synthesis.preview', 1);
  expect(fixture.payloads('conversation.synthesis.preview')).toEqual([{ id: GROUNDED_SAVED_ID }]);
  expect(window.location.hash).toBe('#/ask/saved?sheet=model-consent'); expect(sent()).toBe(dispatched);
  act(() => { key('Escape'); });
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/saved');
  // Leaving and returning reads the selected grounded turn back afresh, with its controls.
  go('#/today');
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'What was billed?' })).toBeNull());
  go('#/ask/saved');
  await issued(fixture, 'conversation.get', reads + 1);
  const oldPreview = await screen.findByRole('button', { name: 'Preview writing' });
  await fixture.user.click(await page().findByText('Receipts and saved answers'));
  const nextReference = button(NEXT_GROUNDED_SAVED_ID, page());
  const replacing = fixture.calls.length;
  // A and B share the exact Saved address. The accepted reference must consume A synchronously, before React commits;
  // neither A's still-connected Preview nor its now-stale repeated reference may navigate, dispatch or cancel B's selection.
  act(() => {
    nextReference.click();
    const accepted = fixture.controller.conversation.snapshot();
    expect(accepted.kind).toBe('idle');
    expect(window.location.hash).toBe('#/ask/saved');
    expect(oldPreview.isConnected).toBe(true); oldPreview.click();
    expect(fixture.controller.conversation.snapshot()).toBe(accepted);
    expect(window.location.hash).toBe('#/ask/saved');
    expect(nextReference.isConnected).toBe(true); nextReference.click();
    expect(fixture.controller.conversation.snapshot()).toBe(accepted);
    expect(window.location.hash).toBe('#/ask/saved');
  });
  await issued(fixture, 'conversation.get', reads + 2);
  expect(fixture.payloads('conversation.get').at(-1)).toEqual({ id: NEXT_GROUNDED_SAVED_ID });
  await waitFor(() => {
    const selected = fixture.controller.conversation.snapshot();
    expect(selected.kind).toBe('answer');
    if (selected.kind === 'answer') expect(selected.saved.id).toBe(NEXT_GROUNDED_SAVED_ID);
  });
  expect(fixture.methods(replacing).filter(method => method !== 'ui.context')).toEqual(['conversation.get']);
  expect(fixture.count('conversation.synthesis.preview')).toBe(1); expect(sent()).toBe(dispatched);
  expect(window.location.hash).toBe('#/ask/saved'); expect(sheetElement()).toBeNull();
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads); expect(fixture.count('scenarios.discover')).toBe(0);
  // B's fresh figure opens the genuine calculation receipt. Closing it selects and reads B afresh, with no return to A.
  await fixture.user.click(button(/^Earned: INR 9\.00\./, page()));
  await screen.findByRole('heading', { name: 'receipt_fixture' });
  expect(window.location.hash).toBe('#/ask/saved?sheet=receipt'); expect(fixture.count('receipts.get')).toBe(fixture.globalReads + 1);
  act(() => { key('Escape'); });
  await waitFor(() => expect(sheetElement()).toBeNull());
  await issued(fixture, 'conversation.get', reads + 3);
  expect(fixture.payloads('conversation.get').at(-1)).toEqual({ id: NEXT_GROUNDED_SAVED_ID });
  const preview = await screen.findByRole('button', { name: 'Preview writing' });
  await waitFor(() => {
    const selected = fixture.controller.conversation.snapshot();
    expect(selected.kind).toBe('answer');
    if (selected.kind === 'answer') expect(selected.saved.id).toBe(NEXT_GROUNDED_SAVED_ID);
  });
  expect(window.location.hash).toBe('#/ask/saved'); expect(fixture.count('scenarios.discover')).toBe(0);
  const overview = button('Show saved what-ifs', page());
  const before = fixture.calls.length;
  // One synchronous batch: the overview is accepted, then the still-connected Preview writing of the answer it left.
  act(() => {
    overview.click();
    expect(fixture.controller.conversation.snapshot().kind).not.toBe('answer');
    expect(fixture.controller.retained.snapshot().discovery.kind).toBe('loading');
    expect(preview.isConnected).toBe(true); preview.click();
    expect(window.location.hash).toBe('#/ask/saved');
  });
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 1);
  expect(fixture.count('conversation.synthesis.preview')).toBe(1);
  expect(fixture.retainedOrDomain(before)).toEqual(['scenarios.discover']);
  expect(window.location.hash).toBe('#/ask/saved'); expect(sheetElement()).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Send the results to be written up' })).toBeNull();
  expect(fixture.controller.conversation.snapshot().kind).not.toBe('review'); expect(fixture.controller.conversation.snapshot().kind).not.toBe('busy');
  expect(sent()).toBe(dispatched); expect(fixture.count('receipts.get')).toBe(fixture.globalReads + 1);
});

test('R4 a refused chosen row is ephemeral in the mounted journey: an authority-changed reopen or proof refusal closes its sheet, clears the rows, cursor and pin, offers only an explicit fresh first page without a cursor and no Read again, and the fresh page chooses afresh', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = () => discoveryPage([ROW_HEAD, ROW_A, ROW_OTHER], CURSOR);
  fixture.behavior.scenario = viewFor;
  await listedScenarios(fixture);
  expect(JSON.stringify(fixture.controller.retained.snapshot()).includes(CURSOR)).toBe(true);
  // The chosen row's fresh reopen is refused as stale authority: no sheet opens, the rows and cursor go with the pin.
  fixture.behavior.refuse = 'SCENARIO_AUTHORITY_CHANGED';
  await fixture.user.click(savedRow(PIN));
  await screen.findByText('The saved what-ifs changed since this list was read. Nothing from the earlier read is kept; read the list again from the start.');
  expect(screen.getByText('Code SCENARIO_AUTHORITY_CHANGED')).toBeTruthy();
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/whatifs');
  expect(savedRowIds()).toEqual([]); expect(screen.queryByText('Price up five percent')).toBeNull(); expect(screen.queryByText(NOTE_A)).toBeNull();
  expect(fixture.controller.retained.snapshot()).toEqual({ discovery: { kind: 'idle' }, scenario: { kind: 'unavailable', selection: null, code: 'SCENARIO_AUTHORITY_CHANGED' }, lessons: { kind: 'idle' } });
  expect(JSON.stringify(fixture.controller.retained.snapshot()).includes(CURSOR)).toBe(false);
  // No invalid-pin re-read, no static-option rescue and no automatic retry: the only control is the fresh first page.
  expect(page().queryByRole('button', { name: 'Read again' })).toBeNull(); expect(page().queryByRole('button', { name: 'Show saved what-ifs' })).toBeNull();
  await settle();
  expect(fixture.count('scenarios.reopen')).toBe(1); expect(fixture.count('scenarios.discover')).toBe(1);
  fixture.behavior.refuse = null;
  await fixture.user.click(button('Read the list again', page()));
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 2);
  expect(fixture.payloads('scenarios.discover')).toEqual([{ limit: 5 }, { limit: 5 }]);
  expect(fixture.count('scenarios.reopen')).toBe(1); expect(screen.queryByText(/changed since this list was read/)).toBeNull();
  // The fresh page chooses afresh with a fresh reopen; a proof press on that chosen row refused the same way clears the same way.
  await fixture.user.click(savedRow(PIN));
  await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 2);
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if');
  fixture.behavior.refuse = 'SCENARIO_AUTHORITY_CHANGED';
  await fixture.user.click(sheet().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }));
  await screen.findByText('The saved what-ifs changed since this list was read. Nothing from the earlier read is kept; read the list again from the start.');
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(window.location.hash).toBe('#/ask/whatifs'); expect(screen.queryByRole('table')).toBeNull();
  expect(savedRowIds()).toEqual([]); expect(screen.queryByText(ALT_OUTCOME.display)).toBeNull(); expect(screen.queryByText(/scenario_revision_a/)).toBeNull();
  expect(fixture.controller.retained.snapshot()).toEqual({ discovery: { kind: 'idle' }, scenario: { kind: 'unavailable', selection: null, code: 'SCENARIO_AUTHORITY_CHANGED' }, lessons: { kind: 'idle' } });
  expect(page().queryByRole('button', { name: 'Read again' })).toBeNull();
  await settle();
  expect(fixture.count('scenarios.reopen')).toBe(3); expect(fixture.count('scenarios.discover')).toBe(2);
  // A coherently changed fresh view at the proof press is refused the same way for a chosen row: no re-read from the old pin.
  fixture.behavior.refuse = null;
  await fixture.user.click(button('Read the list again', page()));
  await screen.findByText(NOTE_A);
  await fixture.user.click(savedRow(PIN));
  await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 4);
  fixture.behavior.scenario = () => scenarioView({ headRevisionId: 'scenario_revision_moved' });
  await fixture.user.click(sheet().getByRole('button', { name: /^Scenario revenue: Synthetic alternative outcome\./ }));
  await screen.findByText('This saved what-if changed since it was shown. Nothing from the earlier read is kept.');
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(screen.getByText('Code SCENARIO_VIEW_CHANGED')).toBeTruthy(); expect(savedRowIds()).toEqual([]);
  expect(page().queryByRole('button', { name: 'Read again' })).toBeNull(); expect(button('Read the list again', page())).toBeTruthy();
  expect(fixture.count('scenarios.reopen')).toBe(5);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  expect(fixture.retainedOrDomain().filter(method => method !== 'scenarios.discover' && method !== 'scenarios.reopen')).toEqual([]);
});

test('R4 with a configured trusted mount pin: the explicit overview lists the rows beside no reopen, a chosen row refused as changed authority loses its ephemeral pin, rows and cursor with no rescue or retry from the static pin, the explicit fresh cursorless first page succeeds, and the trusted pin opens alone again only on a fresh arrival at rest', async () => {
  const fixture = await mounted();
  fixture.behavior.discover = () => discoveryPage([ROW_HEAD, ROW_A, ROW_OTHER], CURSOR);
  fixture.behavior.scenario = viewFor;
  // The separately trusted pin opens alone at rest, as before; no discovery is issued for it.
  await openedScenario(fixture);
  expect(fixture.payloads('scenarios.reopen')).toEqual([PIN]); expect(fixture.count('scenarios.discover')).toBe(0);
  // The explicit overview from the pinned surface: the released rows replace the pin's page view; nothing is reopened for them.
  await fixture.user.click(button('Show saved what-ifs', page()));
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 1);
  expect(fixture.payloads('scenarios.discover')).toEqual([{ limit: 5 }]);
  expect(screen.queryByRole('table')).toBeNull(); expect(fixture.count('scenarios.reopen')).toBe(1);
  expect(JSON.stringify(fixture.controller.retained.snapshot()).includes(CURSOR)).toBe(true);
  // The chosen row names the very pin the mount configured; its fresh reopen is refused as changed authority: the rows, cursor and ephemeral pin go.
  fixture.behavior.refuse = 'SCENARIO_AUTHORITY_CHANGED';
  await fixture.user.click(savedRow(PIN));
  await screen.findByText('The saved what-ifs changed since this list was read. Nothing from the earlier read is kept; read the list again from the start.');
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(fixture.controller.retained.snapshot()).toEqual({ discovery: { kind: 'idle' }, scenario: { kind: 'unavailable', selection: null, code: 'SCENARIO_AUTHORITY_CHANGED' }, lessons: { kind: 'idle' } });
  expect(savedRowIds()).toEqual([]); expect(JSON.stringify(fixture.controller.retained.snapshot()).includes(CURSOR)).toBe(false);
  // The configured static pin rescues nothing, the discarded pin is not retried and no Read again is offered: the only control is the fresh first page.
  await settle();
  expect(fixture.count('scenarios.reopen')).toBe(2); expect(fixture.count('scenarios.discover')).toBe(1);
  expect(page().queryByRole('button', { name: 'Read again' })).toBeNull(); expect(page().queryByRole('button', { name: 'Show saved what-ifs' })).toBeNull();
  expect(screen.queryByRole('table')).toBeNull(); expect(window.location.hash).toBe('#/ask/whatifs');
  fixture.behavior.refuse = null;
  await fixture.user.click(button('Read the list again', page()));
  await screen.findByText(NOTE_A);
  await issued(fixture, 'scenarios.discover', 2);
  expect(fixture.payloads('scenarios.discover')).toEqual([{ limit: 5 }, { limit: 5 }]);
  await settle();
  // The fresh list stands on its own: still no reopen of the configured pin behind or beneath it.
  expect(fixture.count('scenarios.reopen')).toBe(2); expect(screen.queryByRole('table')).toBeNull();
  expect(fixture.controller.retained.snapshot()).toMatchObject({ discovery: { kind: 'ready', page: 0, selected: null }, scenario: { kind: 'idle' } });
  // The separately trusted pin opens alone again only on a fresh arrival at rest after a departure, never as a rescue of the refused choice.
  go('#/today');
  await waitFor(() => expect(fixture.controller.retained.snapshot()).toEqual({ discovery: { kind: 'idle' }, scenario: { kind: 'idle' }, lessons: { kind: 'idle' } }));
  go('#/ask/whatifs');
  await screen.findByRole('table');
  await issued(fixture, 'scenarios.reopen', 3);
  expect(fixture.payloads('scenarios.reopen').at(-1)).toEqual(PIN); expect(fixture.count('scenarios.discover')).toBe(2);
  expect(page().getByText(HISTORICAL)).toBeTruthy(); expect(savedRowIds()).toEqual([]);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
  expect(fixture.retainedOrDomain().filter(method => method !== 'scenarios.discover' && method !== 'scenarios.reopen')).toEqual([]);
});

test('R5 focus and detail controls follow the accepted choice only: a rejected old row in the same batch never becomes the opener, old Back and Read again of the earlier choice change nothing after a newer choice while the fresh ones work, and after an actual hash departure an old Back neither pulls back nor moves focus', async () => {
  const fixture = await mounted('en', null);
  fixture.behavior.discover = THREE_ROWS;
  fixture.behavior.scenario = viewFor;
  await listedScenarios(fixture);
  // (a) Rows A and B were drawn beside no selection: A is accepted, the old B pressed in the same batch is refused; A is the opener.
  const rowA = savedRow(PIN), rowB = savedRow(HEAD_PIN);
  act(() => { rowA.click(); expect(rowB.isConnected).toBe(true); rowB.click(); });
  await screen.findByText(HISTORICAL);
  await settle();
  expect(fixture.payloads('scenarios.reopen')).toEqual([PIN]);
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if'); expect(document.querySelectorAll('[data-region="sheet"]')).toHaveLength(1);
  expect(savedRow(PIN).getAttribute('aria-current')).toBe('true'); expect(savedRow(HEAD_PIN).getAttribute('aria-current')).toBeNull();
  act(() => { key('Escape'); });
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(document.activeElement).toBe(savedRow(PIN)); expect(window.location.hash).toBe('#/ask/whatifs');
  // (b) A chosen and ready; B chosen with its reopen held; A's still-connected Back, Read again and Close are pressed before React commits.
  await fixture.user.click(savedRow(PIN));
  await screen.findByText(HISTORICAL);
  await issued(fixture, 'scenarios.reopen', 2);
  const back = button('Back to the list', sheet()), read = button('Read again', sheet()), close = button(CLOSE, sheet());
  const release = fixture.hold('scenarios.reopen');
  act(() => {
    savedRow(HEAD_PIN).click();
    expect(back.isConnected).toBe(true); back.click(); read.click(); close.click();
  });
  await issued(fixture, 'scenarios.reopen', 3);
  expect(fixture.payloads('scenarios.reopen')).toEqual([PIN, PIN, HEAD_PIN]);
  expect(fixture.controller.retained.snapshot()).toMatchObject({ scenario: { kind: 'loading', selection: HEAD_PIN }, discovery: { kind: 'ready', selected: HEAD_PIN } });
  expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if');
  await act(async () => { release(); });
  await screen.findByText(CURRENT);
  await settle();
  expect(fixture.count('scenarios.reopen')).toBe(3); expect(sheetElement()).not.toBeNull(); expect(window.location.hash).toBe('#/ask/whatifs?sheet=what-if');
  expect(sheet().getByRole('heading', { name: 'Price up five percent' })).toBeTruthy(); expect(sheet().getByText(/^Revision scenario_revision_head, created /)).toBeTruthy();
  // Fresh controls of B: Read again re-reads exactly B and keeps the choice; Back drops B and returns focus to B's row.
  await fixture.user.click(button('Read again', sheet()));
  await issued(fixture, 'scenarios.reopen', 4);
  expect(fixture.payloads('scenarios.reopen').at(-1)).toEqual(HEAD_PIN);
  await screen.findByText(CURRENT);
  expect(savedRow(HEAD_PIN).getAttribute('aria-current')).toBe('true');
  await fixture.user.click(button('Back to the list', sheet()));
  await waitFor(() => expect(sheetElement()).toBeNull());
  expect(document.activeElement).toBe(savedRow(HEAD_PIN)); expect(window.location.hash).toBe('#/ask/whatifs');
  expect(savedRowIds()).toEqual([savedRowId(HEAD_PIN), savedRowId(PIN), savedRowId(OTHER_PIN)]); expect(savedRow(HEAD_PIN).getAttribute('aria-current')).toBeNull();
  // (c) Departure: the actual hash leaves Saved while A's sheet is open; its old Back, Close and Esc, still connected, are pressed before React commits.
  await fixture.user.click(savedRow(PIN));
  await screen.findByText(HISTORICAL);
  await issued(fixture, 'scenarios.reopen', 5);
  const oldBack = button('Back to the list', sheet()), oldClose = button(CLOSE, sheet()), row = savedRow(PIN);
  window.location.hash = '#/today';
  act(() => { expect(oldBack.isConnected).toBe(true); oldBack.click(); oldClose.click(); key('Escape'); });
  expect(window.location.hash).toBe('#/today');
  await waitFor(() => expect(screen.queryByText(HISTORICAL)).toBeNull());
  await waitFor(() => expect(fixture.controller.retained.snapshot()).toEqual({ discovery: { kind: 'idle' }, scenario: { kind: 'idle' }, lessons: { kind: 'idle' } }));
  await settle();
  expect(window.location.hash).toBe('#/today'); expect(sheetElement()).toBeNull();
  expect(row.isConnected).toBe(false); expect(document.activeElement).not.toBe(row);
  expect(fixture.count('scenarios.reopen')).toBe(5); expect(fixture.count('scenarios.discover')).toBe(1);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
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
  expect(window.location.hash).toBe('#/reports/lessons');
  expect(fixture.count('memory.lessons')).toBe(2); expect(fixture.count('memory.decideLesson')).toBe(1);
  // Engine order is kept across the window; nothing else was dispatched and no global receipt was read.
  await fixture.user.click(button('Previous five', page()));
  await screen.findByText('Lessons 1 to 5 of 6, in the order they were released.');
  expect(rowIds()).toEqual(['lesson_1', 'lesson_2', 'lesson_3', 'lesson_4', 'lesson_5']);
  expect(fixture.retainedOrDomain().filter(method => method !== 'memory.lessons' && method !== 'memory.decideLesson')).toEqual([]);
  expect(fixture.count('receipts.get')).toBe(fixture.globalReads);
});

test('on Reports, Lessons a Not now press sends exactly one defer decision for the exact tuple and reason, and the row shows its new standing', async () => {
  const fixture = await mounted();
  const before = fixture.calls.length;
  await openedLessonSheet(fixture, { hash: '#/reports/lessons', heading: 'Lessons' });
  expect(page().getByText('Reports')).toBeTruthy();
  const notNow = button('Not now', sheet());
  expect(notNow.disabled).toBe(false);
  await fixture.user.click(notNow);
  await issued(fixture, 'memory.decideLesson', 1);
  expect(fixture.calls.find(call => call.method === 'memory.decideLesson')?.payload).toEqual(decisionPayload('lesson_1', 'defer'));
  await waitFor(() => expect(sheetElement()).toBeNull());
  await screen.findByText('not now. Would change reminder timing reminder_fixture. Evidence: 1 item.');
  expect(window.location.hash).toBe('#/reports/lessons');
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
  go('#/reports/lessons');
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
  expect(sheetElement()).toBeNull(); expect(window.location.hash).toBe('#/reports/lessons');
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
  go('#/reports/lessons');
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
  expect(window.location.hash).toBe('#/reports/lessons');
  expect(fixture.controller.retained.snapshot().lessons).toMatchObject({ kind: 'ready', selectedId: null });
  expect(fixture.count('memory.lessons')).toBe(reads + 1); expect(fixture.count('memory.decideLesson')).toBe(0);
});

/* ---------- Localization ---------- */
test('Hindi rows and sheet read the status, role and guidance words in Devanagari while source text and pins stay verbatim', async () => {
  const fixture = await mounted('hi');
  go('#/reports/lessons');
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
