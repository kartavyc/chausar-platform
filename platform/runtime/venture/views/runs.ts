// Chausar venture launcher, views (P1-A): runs. venture.runs.list and venture.runs.get.
// A run is a delivery run (one draft reply for an order, with the agent loop's turns when the order has files) or a
// rehearsal with practice clients. Steps are the playbook's, named by their purpose; tool calls fold under the step
// they serve, named by what they did, never by the raw tool name. Times are the engine's: a run waiting on the owner
// stops its clock at the moment it began to wait, and a step's time is its tool calls' own (the harness stamps each).
// The auditor (delivery/judge/auditor.ts) decides what counts: a loop step is audited only when the auditor passed its
// work, and only audited steps count as progress. Runs made before the round ledger show no audit either way.
// An improvement run (delivery/improve.ts) is a run too, one step per round.
// Ink v2 wave 4 (4F1): a stopped run waits for the owner's Resume and never reads as done; a stop on its way reads as
// stopping; the run sheet carries the scope frozen at start, the owner's notes, the round gate, the turn in flight's
// calls, each call's state and measured time, and "Usually 3 to 5 min" once three runs of the same steps finished.
// 4J14: check words come from one table (delivery/verdicts.ts); the run sheet adds coverage on the read step and on work
// receipts, the checks that could not run, the outcome of what went outside, and the draft's three-column report.
import { playbookForRun } from '../delivery/workflow.ts';
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { VOICE_PLAYBOOK } from '../playbooks/voice-match.ts';
import { currentVenture, exactPayload, findRecord, formatMicros, identifier, listRecords } from '../records.ts';
import type {
  CheckResult, DeliveryReason, DeliveryRunRecord, ImprovementRunRecord, PlaybookCheckResult, PlaybookStep, RunDetail, RunState, RunStep, RunSummary, SimulationRunRecord, StepKind,
  ToolCallRecord, VentureDeps, VentureRecord,
  Posture, RunToolLine, RunScopeView,
} from '../contracts.ts';
// 4F3: the scope's cap in rupees at the owner's rate.
import { rupeeFigure, rupeeRateWords, rupeesOf } from '../money/spend.ts';
import { STOPPED_BY_YOU, stopAsked } from '../delivery/harness/controls.ts';
import { usualDuration } from '../delivery/estimates.ts';
import { auditedSteps, type StepAudit } from '../delivery/judge/auditor.ts';
import { runView } from '../delivery/runs.ts';
import { openDelegation } from '../delivery/harness/loop.ts';
import { DELEGATE_LABELS } from '../delivery/harness/delegate.ts';
import { currentPlaybook, deliveryFlagship, playbookSteps } from '../delivery/playbook.ts';
import { businessScenarios } from '../delivery/scenarios.ts';
import { agentWordsLabeller } from './agent-words.ts';
import { acceptedBlueprintOrNull, serviceTypeOf } from '../delivery/shared.ts';
import { caSignoffBlock } from '../playbooks/ca-firm/signoff-gate.ts';
import { questionRowId, runError } from './queue.ts';
import { screenSummary } from '../policy/untrusted.ts';
import { agentName, businessOf, clientNameFor, elapsedText, lastEventAt, plain, short } from './shared.ts';
// What each tool did, in the owner's words: a leaf module now, so the breaker can read it too (4F2).
import { TOOL_PURPOSE } from '../delivery/harness/tool-purpose.ts';
import { runFailure } from '../delivery/failure-words.ts';
import { breakerStopped } from '../delivery/harness/breaker.ts';
// 4J3 (A17): the Delivered card of an accepted run.
import { deliveredOf } from '../delivery/delivered.ts';
import { posterView, youtubeRun } from '../delivery/poster.ts';
// 4J14 (Q6, Q7, Q8): one vocabulary of verdict words, coverage, and the outcome and report of a run.
import { checkLine, checkWord, outcomeOfCheck, outcomeOfPlaybookCheck } from '../delivery/verdicts.ts';
import { coverageView, readCoverage, workReceiptCoverage, type ReadCoverage } from '../delivery/coverage.ts';
import { actOutcome, deliverableReport, runOutcome, type JudgeStanding } from '../delivery/outcomes.ts';
import type { FileLike } from '../delivery/harness/files.ts';
import type { WorkReceiptRecord } from '../contracts.ts';

/** The playbook step kind each tool serves. The agent loop moves between these three in any order. */
const TOOL_KIND: Readonly<Record<string, StepKind>> = {
  'files.list': 'gather', 'files.read': 'gather', 'dictionary.browse': 'gather', 'dictionary.resolve': 'gather',
  'handoff.client': 'question', 'handoff.owner': 'question', 'outbox.propose': 'operator',
  'youtube.retention': 'gather', 'social.report': 'gather', 'evidence.record': 'gather',
};
const LOOP_KINDS: readonly StepKind[] = ['gather', 'question', 'work'];
const REASON_WORDS: Readonly<Record<DeliveryReason, string>> = {
  'wrong-fact': 'a wrong fact', 'missing-fact': 'a missing fact', 'missing-section': 'a missing section', 'off-brief': 'off the brief', tone: 'the tone',
  format: 'the format', 'too-long': 'too long', 'too-short': 'too short', 'wrong-number': 'a wrong number', late: 'late',
  'claims-work-not-done': 'it claimed work that was not done', other: 'another reason',
};

const toolKind = (tool: string): StepKind => TOOL_KIND[tool] ?? 'work';

/**
 * A check result in the owner's words, through the one table (delivery/verdicts.ts, 4J14). A rules-judge check no vote
 * settled with checked evidence was not checked, so it reads "Not checked", never "Failed"; a passed or failed check says so.
 */
export function checkLabel(result: CheckResult): string {
  return short(checkLine(outcomeOfCheck(result), result.detail), 160);
}
/**
 * A flagship playbook's check in the owner's words, through the same table: one that could not run reads "Not run",
 * never "Passed"; a value outside the table reads "Unknown". A detail's own outcome word is never said twice.
 */
export function playbookCheckLabel(result: PlaybookCheckResult): string {
  return short(checkLine(outcomeOfPlaybookCheck(result), result.detail), 160);
}
/**
 * Why a practice case that named the rules judge has no judge result: the judge is asked only after every code check
 * passed. A judge that was never asked did not run (4J14, the one table), so it reads "Not run".
 */
function judgeMissing(results: readonly CheckResult[]): { kind: string; id: string; label: string } {
  const why = results.every(result => result.passed) ? 'no judge connected.' : 'a code check failed first, so the judge was not asked.';
  return { kind: 'check', id: 'rules-judge', label: `${checkWord('not-run')}: ${why}` };
}
/** What a call did. With a round ledger, a call that ran but failed its audit says why it does not count. */
function toolLine(call: ToolCallRecord, audit: StepAudit | undefined): string {
  if (call.envelope.ok) return audit && !audit.audited ? short(`Done. Not counted: ${audit.reason}`, 240) : 'Done.';
  if (call.outcome === 'timedOut') return 'Timed out.';
  return short(call.envelope.error.message || 'It did not work.', 200);
}

/**
 * A call's state and measured time on its tool line (4F1, U7): the state where the call was stamped with times or
 * never ran (cancelled), and ms only where both its times were stamped. Calls stored before step times carry neither.
 */
function callMeasure(call: ToolCallRecord): Pick<RunToolLine, 'state' | 'ms'> {
  if (call.outcome === 'cancelled') return { state: 'cancelled' };
  if (!call.startedAt || !call.finishedAt) return {};
  return { state: call.outcome === 'succeeded' ? 'done' : 'error', ms: Math.max(0, Date.parse(call.finishedAt) - Date.parse(call.startedAt)) };
}

/** A step's time: from its first call's start to its last call's finish. Unknown (undefined) when no call has times. */
function stepElapsed(calls: readonly ToolCallRecord[], nowIso: string, running: boolean): string | undefined {
  const starts = calls.map(call => call.startedAt).filter((at): at is string => typeof at === 'string').sort();
  if (!starts.length) return undefined;
  const ends = calls.map(call => call.finishedAt).filter((at): at is string => typeof at === 'string').sort();
  return elapsedText(starts[0], running ? nowIso : ends.at(-1) ?? starts.at(-1)!);
}

/** True when the auditor passed every call that ran under a step; false when one ran and failed it; undefined without a ledger or calls. */
function stepAudited(calls: readonly ToolCallRecord[], audits: Map<string, StepAudit>, ledger: boolean): boolean | undefined {
  if (!ledger || !calls.length) return undefined;
  const ran = calls.filter(call => call.outcome === 'succeeded');
  return ran.length > 0 && ran.every(call => audits.get(call.id)?.audited === true);
}

/** The steps a delivery run follows: its own playbook's, else the business's current one, else the accepted plan's. */
function stepsFor(state: State, venture: VentureRecord, run: DeliveryRunRecord): PlaybookStep[] {
  const own = playbookForRun(state, run);
  if (own && own.ventureId === venture.id) return own.steps;
  const current = currentPlaybook(state, venture);
  if (current) return current.steps;
  const plan = acceptedBlueprintOrNull(state, venture);
  try { return plan ? playbookSteps(plan, deliveryFlagship(venture, plan)) : []; } catch { return []; }
}

type Position = { kind: StepKind; state: RunStep['state'] };

/** Where a run stands: the step kind it is at and that step's state. Once reviewed, only the owner's send is left. */
function positionOf(run: ReturnType<typeof runView>, nowMs: number): Position {
  const loopKind = (): StepKind => {
    const harness = run.harness;
    if (!harness || harness.phase !== 'act') return 'write';
    const last = [...harness.toolCalls].reverse().find(call => LOOP_KINDS.includes(toolKind(call.tool)));
    return last ? toolKind(last.tool) : 'gather';
  };
  switch (run.status) {
    // A stop asked while a turn is out (4F1): the run is still working until that step finishes.
    case 'waiting-for-you': return { kind: loopKind(), state: stopAsked(run.harness) ? 'current' : 'waiting' };
    // Stopped (4F1): it waits for the owner's Resume at the step it stopped on; a stopped run never reads as done.
    case 'stopped': return { kind: run.harness?.phase === 'needs-answer' ? 'question' : run.harness?.phase === 'brief' ? 'work' : loopKind(), state: 'waiting' };
    case 'needs-answer': return { kind: 'question', state: 'waiting' };
    case 'brief-waiting': {
      const open = run.harness ? openDelegation(run.harness) : null;
      const running = open?.status === 'running' && open.startedAt !== null && Date.parse(open.startedAt) + open.limits.minutes * 60_000 + 120_000 >= nowMs;
      return { kind: 'work', state: running ? 'current' : 'waiting' };
    }
    case 'ready-for-review': return { kind: 'approve', state: run.awaitingYou ? 'waiting' : 'pending' };
    case 'failed': return { kind: loopKind(), state: 'failed' };
    // Accepted, edited or rejected: Chausar sends nothing, so the send step stays the owner's.
    default: return { kind: 'operator', state: 'pending' };
  }
}

function runStateOf(run: ReturnType<typeof runView>, position: Position): RunState {
  if (run.status === 'failed') return 'failed';
  if (position.state === 'pending') return 'done';
  return position.state === 'current' ? 'active' : 'waiting';
}

/** unsigned: why a CA firm's regulated papers wait for the CA's sign-off (signoff-gate.ts), which an edit needs too. */
function resultOf(run: ReturnType<typeof runView>, unsigned: string | null = null): string | undefined {
  switch (run.status) {
    case 'accepted': return 'Draft accepted. You send it to the client.';
    case 'edited': return unsigned ? short(unsigned) : 'You edited the draft. You send your version.';
    case 'rejected': return run.verdict?.reason ? `Draft rejected: ${REASON_WORDS[run.verdict.reason]}.` : 'Draft rejected.';
    case 'ready-for-review': return run.awaitingYou ? undefined : short(run.acceptBlocked ?? 'Practice draft. Not for clients.');
    case 'stopped': return run.harness?.control?.line ?? STOPPED_BY_YOU;
    default: return undefined;
  }
}

type Built = { summary: RunSummary; detail: RunDetail };

/**
 * posters: the business's stills, read once per list (4J3). whole: the details carry the whole still (venture.runs.get);
 * a list of details for the other views names it by id only.
 */
function deliveryRun(
  deps: VentureDeps, state: State, venture: VentureRecord, record: DeliveryRunRecord, times: Map<string, string>, business: { id: string }, posters: PosterIndex, whole: boolean,
): Built {
  const now = deps.clock();
  const run = runView(record, venture, now.getTime(), state);
  const harness = run.harness ?? null;
  // Runs without the agent loop never read files, asked or worked with tools: their loop steps are left out.
  const steps = stepsFor(state, venture, record).filter(step => harness || !LOOP_KINDS.includes(step.kind));
  const position = positionOf(run, now.getTime());
  const runState = runStateOf(run, position);
  // In the loop the agent moves between reading, asking and working in any order: each of those steps is done once
  // it was used, and every later step waits. After the loop the steps run in order.
  const inLoop = !!harness && LOOP_KINDS.includes(position.kind);
  const found = steps.findIndex(step => step.kind === position.kind);
  const at = found < 0 ? steps.length : found;
  const calls = harness?.toolCalls ?? [];
  const audits = new Map(auditedSteps(harness).map(audit => [audit.stepId, audit]));
  const ledger = !!harness?.rounds;
  const error = run.status === 'failed' ? runError(state, record) : undefined;
  const failed = runFailure(state, record, venture.country?.dateOrder ?? 'year-month-day');
  const order =listRecords(state, 'venture-order', venture.id).find(item => item.id === run.orderId);
  const agentWords = agentWordsLabeller(state, venture, record);
  // 4J14: the run's files and what it read of them, on its own sheet only.
  const quality = whole ? runQuality(state, venture, record) : null;

  const built: RunStep[] = steps.map((step, index) => {
    let stepState: RunStep['state'];
    if (inLoop) {
      const used = calls.some(call => toolKind(call.tool) === step.kind);
      stepState = step.kind === position.kind ? position.state : LOOP_KINDS.includes(step.kind) && used ? 'done' : 'pending';
    } else {
      stepState = index < at ? 'done' : index === at ? position.state : 'pending';
    }
    const stepCalls = calls.filter(call => toolKind(call.tool) === step.kind);
    const tools = stepCalls.map(call => ({ name: TOOL_PURPOSE[call.tool] ?? 'Used a tool', line: toolLine(call, ledger ? audits.get(call.id) : undefined), ...callMeasure(call) }));
    const audited = stepAudited(stepCalls, audits, ledger);
    const elapsed = stepElapsed(stepCalls, now.toISOString(), stepState === 'current');
    const evidence: { kind: string; id: string; label: string }[] = [];
    if (step.kind === 'gather' && harness) {
      for (const id of harness.uploadIds) {
        const upload = listRecords(state, 'venture-upload', venture.id).find(item => item.id === id);
        if (upload) evidence.push({ kind: 'file', id, label: upload.name });
      }
    }
    if (step.kind === 'work' && harness) {
      for (const id of harness.workReceiptIds) {
        const receipt = listRecords(state, 'venture-work-receipt', venture.id).find(item => item.id === id);
        if (receipt) evidence.push({ kind: 'work-receipt', id, label: receiptLabel(state, quality, receipt) });
      }
      for (const id of harness.tableIds) {
        const table = listRecords(state, 'venture-work-table', venture.id).find(item => item.id === id);
        if (table) evidence.push({ kind: 'work-table', id, label: table.name });
      }
      for (const delegated of listRecords(state, 'venture-delegate-run', venture.id).filter(item => item.runId === run.id)) {
        evidence.push({ kind: 'delegate-run', id: delegated.id, label: `What ${DELEGATE_LABELS[delegated.cli]} left` });
      }
    }
    if (step.kind === 'compute' && order) evidence.push({ kind: 'price-receipt', id: order.priceReceiptId, label: 'Price receipt' });
    if (step.kind === 'write' && run.deliverable) evidence.push({ kind: 'draft', id: run.id, label: short(agentWords(run.deliverable.title), 120) });
    if (step.kind === 'verify') {
      for (const result of run.checks) evidence.push({ kind: 'check', id: result.check, label: checkLabel(result) });
      // A flagship playbook's own checks follow the harness checks, by playbook and check id.
      for (const result of run.playbookChecks ?? []) evidence.push({ kind: 'check', id: `${result.playbook}:${result.check}`, label: playbookCheckLabel(result) });
    }
    // 4J14 (Q6): the read step leads with coverage; the check step lists what could not run.
    const coverage = step.kind === 'gather' ? quality?.read?.coverage : undefined;
    const notRun = step.kind === 'verify' && quality ? notRunLines(record) : [];
    return plain({
      id: step.id, purpose: step.title, state: stepState, ...(elapsed !== undefined ? { elapsed } : {}),
      ...(tools.length ? { tools } : {}), ...(evidence.length ? { evidence } : {}), ...(stepState === 'failed' && error ? { error } : {}),
      ...(audited !== undefined ? { audited } : {}),
      ...(coverage ? { coverage } : {}), ...(notRun.length ? { notRun } : {}),
    });
  });

  const end = runState === 'active' ? now.toISOString() : times.get(run.id) ?? run.at;
  // Only audited steps count as progress: a done step whose work failed its audit is not.
  const done = built.filter(step => step.state === 'done' && step.audited !== false).length;
  const client = clientNameFor(state, venture.id, run.orderId);
  const result = resultOf(run, run.status === 'edited' ? caSignoffBlock(state, venture, record) : null);
  const receiptId = runState === 'done' ? harness?.workReceiptIds.at(-1) : undefined;
  const summary: RunSummary = plain({
    runId: run.id, businessId: business.id, agent: agentName(state, venture), purpose: run.practiceNow && run.status !== 'accepted' ? `Practice draft for ${client}` : `Draft a reply for ${client}`,
    state: runState, startedAt: run.at, elapsed: elapsedText(run.at, end),
    ...(runState === 'active' || runState === 'waiting' ? { progress: built.length ? { done, total: built.length } : 'indeterminate' as const } : {}),
    ...(result ? { result } : {}), ...(receiptId ? { receiptId } : {}),
    ...controlSummary(state, venture, record, runState),
    // 4J3: the frame on a YouTube run's tile, the still kept from its order's cut, or null.
    ...posterTile(posters, record),
    // 4H2 (U17): who wrote the draft, from the run's own call record (models/written-by.ts), as the draft list says it.
    ...(run.writtenBy ? { writtenBy: run.writtenBy } : {}),
  });
  const open = run.status === 'needs-answer' && harness ? [...harness.handoffs].reverse().find(handoff => handoff.answer === null) : undefined;
  // What the untrusted screen noted in the run's outside content: tool results and relayed answers. Never the words.
  const screened = harness ? screenSummary([...harness.toolCalls, ...harness.handoffs].flatMap(item => item.screen ? [item.screen] : [])) : null;
  const detail: RunDetail = plain({
    ...summary, steps: built,
    // 4J17 (A14): the question card, whole, when the agent asked one (checked when asked, agents/questions.ts).
    ...(open && harness ? { question: { id: questionRowId(run.id, harness), text: agentWords(open.question), ...(open.to === 'owner' && open.card ? { card: structuredClone(open.card) } : {}) } } : {}),
    ...(error ? { error } : {}),
    ...(screened ? { screen: screened } : {}),
    ...controlDetail(state, venture, record),
    // 4F2 (O14): "How to fix it", only on a failed or breaker-stopped run the owner must act on (failure-words.ts).
    ...failed,
    // 4J3 (A17): what an accepted run handed over, and apart, what changed on the order while it went on.
    ...deliveredField(state, venture, record),
    // 4J13 (H34, H30): what a crash cut and each step's state, and what background jobs reported into the run.
    ...leaseFields(record),
    // 4J3: a run's own details carry its order's whole still; a list of details names it by id only.
    ...posterOf(posters, record, whole ? 'whole' : 'id'),
    // 4J14 (Q7, Q8): what went outside from it and the draft's report, on its own sheet only.
    ...(quality ? { ...outcomeField(state, venture, record), ...reportField(state, venture, record, quality) } : {}),
  });
  return { summary, detail };
}

/** 4J13: the interruption a crash left on the run (H34) and the reports background jobs delivered into it (H30). */
function leaseFields(record: DeliveryRunRecord): Pick<RunDetail, 'interrupted' | 'reports'> {
  return {
    ...(record.interrupted ? { interrupted: { at: record.interrupted.at, line: record.interrupted.line, steps: record.interrupted.steps.map(step => ({ ...step })) } } : {}),
    ...(record.reports?.length ? { reports: record.reports.map(report => ({ at: report.at, from: report.from, line: report.line, sources: [...report.sources], warning: report.warning })) } : {}),
  };
}

/** The Delivered card (4J3), only on a delivery run whose draft was handed over. */
function deliveredField(state: State, venture: VentureRecord, record: DeliveryRunRecord): Pick<RunDetail, 'delivered'> {
  const delivered = deliveredOf(state, venture, record);
  return delivered ? { delivered } : {};
}

/**
 * The business's stills for one list of runs (4J3): which runs are YouTube runs, the newest of them per order, and each
 * order's poster, each looked up once.
 */
type PosterIndex = { youtube: Set<string>; newest: Map<string, string>; views: Map<string, { uploadId: string; src: string } | null> };
function posterIndex(state: State, venture: VentureRecord): PosterIndex {
  const index: PosterIndex = { youtube: new Set(), newest: new Map(), views: new Map() };
  const newestAt = new Map<string, string>();
  for (const run of listRecords(state, 'venture-delivery-run', venture.id)) {
    if (!youtubeRun(state, venture, run)) continue;
    index.youtube.add(run.id);
    const at = newestAt.get(run.orderId);
    if (at === undefined || run.at >= at) { newestAt.set(run.orderId, run.at); index.newest.set(run.orderId, run.id); }
    if (!index.views.has(run.orderId)) index.views.set(run.orderId, posterView(state, venture.id, run.orderId));
  }
  return index;
}

/** A YouTube run's still: whole, or named by id with no image; null when none is kept; nothing on other runs. */
function posterOf(posters: PosterIndex, record: DeliveryRunRecord, form: 'whole' | 'id'): Pick<RunSummary, 'poster'> {
  if (!posters.youtube.has(record.id)) return {};
  const view = posters.views.get(record.orderId) ?? null;
  return { poster: view && form === 'id' ? { uploadId: view.uploadId, src: null } : view };
}

/** A run tile's still (4J3): the whole image once per order, on its newest YouTube run, so a list carries each still once. */
function posterTile(posters: PosterIndex, record: DeliveryRunRecord): Pick<RunSummary, 'poster'> {
  return posterOf(posters, record, posters.newest.get(record.orderId) === record.id ? 'whole' : 'id');
}

// ---------------------------------------------------------------------------
// Ink v2 wave 4 (4F1): the run controls on the run sheet
// ---------------------------------------------------------------------------

const POSTURE_WORDS: Readonly<Record<Posture, string>> = Object.freeze({
  rehearsal: 'in rehearsal', shadow: 'in shadow', 'approve-each': 'at approve each', 'auto-spot-check': 'at auto with spot checks',
});
const ACTION_WORDS: Readonly<Partial<Record<string, string>>> = Object.freeze({
  'outbox.propose': 'Propose an outside action, which waits for your approval',
  'agent.delegate': 'Ask your own command-line tool for heavy work, after you approve the brief',
});
const plural = (count: number, one: string, many: string) => (count === 1 ? `1 ${one}` : `${count} ${many}`);

/** How long runs of these steps usually take (U6), on a run still going; a stop on its way or done (O1). */
function controlSummary(state: State, venture: VentureRecord, record: DeliveryRunRecord, runState: RunState): Pick<RunSummary, 'usually' | 'stop'> {
  const usually = runState === 'active' || runState === 'waiting' ? usualDuration(state, venture.id, record.playbookHash) : null;
  // 4F2: a breaker stop names its rule as a code too, for the screen's own words.
  const trigger = record.status === 'stopped' && breakerStopped(record.harness) ? record.harness!.breaker!.trigger : null;
  // 4J13: a run a crash cut reads Interrupted (delivery/leases.ts), never "Stopped by you".
  const stop = record.status === 'stopped' ? { state: 'stopped' as const, line: record.harness?.control?.line ?? record.interrupted?.line ?? STOPPED_BY_YOU, ...(trigger ? { trigger } : {}) }
    : record.status === 'waiting-for-you' && stopAsked(record.harness) ? { state: 'stopping' as const, line: 'Stopping: the step in progress finishes first.' }
      : null;
  return { ...(usually ? { usually } : {}), ...(stop ? { stop } : {}) };
}

/** 4F3: a run's cap in rupees at the owner's rate, with the rate in words; nothing without a rate. */
function scopeRupees(state: State, venture: VentureRecord, capMicros: string): Pick<RunScopeView, 'capRupees' | 'capRate'> {
  const rupees = rupeesOf(state, venture);
  return rupees ? { capRupees: rupeeFigure(capMicros, rupees), capRate: rupeeRateWords(rupees) } : {};
}

/** The scope frozen when the run started (O21), the owner's notes (O3), the round gate (O2) and the turn in flight (U7). */
function controlDetail(state: State, venture: VentureRecord, record: DeliveryRunRecord): Pick<RunDetail, 'scope' | 'steer' | 'gate' | 'live'> {
  const harness = record.harness ?? null;
  const scope = record.scope;
  const view: Pick<RunDetail, 'scope' | 'steer' | 'gate' | 'live'> = {};
  if (scope) {
    const tools = scope.tools.map(tool => TOOL_PURPOSE[tool] ?? 'Used a tool');
    const actions = scope.actions.map(tool => ACTION_WORDS[tool] ?? TOOL_PURPOSE[tool] ?? 'An outside action, for your approval');
    const cap = formatMicros(scope.capMicros);
    view.scope = {
      tools, actions, cap, posture: scope.posture,
      // 4F3: the cap's receipt, worked out again from the run's frozen scope (views/row-receipts.ts scopeCap), and the
      // cap in rupees at the owner's own rate when one is set.
      capReceiptId: `fig:scope:${record.id}`,
      ...scopeRupees(state, venture, scope.capMicros),
      line: `Set when it started: ${plural(tools.length, 'tool', 'tools')}, ${plural(actions.length, 'outside action', 'outside actions')} it may propose for your approval, a spend cap of ${cap}, ${POSTURE_WORDS[scope.posture]}.`,
    };
  }
  if (harness?.steer?.length) {
    view.steer = harness.steer.map(note => ({
      text: note.text, at: note.at,
      line: note.pickedUpTurn === null ? 'Sent. Waiting for the agent to pick it up.' : `Picked up in turn ${note.pickedUpTurn}`,
    }));
  }
  if (harness?.gate) view.gate = { on: harness.gate.on, every: harness.gate.every, waiting: harness.gate.waiting };
  // The calls of the turn out now, from their run.call events: ids and states only, the newest state per call. They are
  // matched by the turn's own model call, so a cut turn's calls never show as a later turn's.
  if (harness && record.status === 'waiting-for-you' && record.callId) {
    const latest = new Map<string, 'start' | 'done' | 'error'>();
    for (const event of listRecords(state, 'venture-event', venture.id).filter(item => item.name === 'run.call').sort((a, b) => a.seq - b.seq)) {
      const data = event.data as { runId?: unknown; callId?: unknown; state?: unknown; modelCallId?: unknown } | null;
      if (data?.runId !== record.id || data.modelCallId !== record.callId || typeof data.callId !== 'string') continue;
      if (data.state === 'start' || data.state === 'done' || data.state === 'error') latest.set(data.callId, data.state);
    }
    if (latest.size) view.live = [...latest].map(([callId, callState]) => ({ callId, state: callState }));
  }
  return view;
}

// ---------------------------------------------------------------------------
// Ink v2 wave 4 (4J14): coverage, unrun checks, the outcome of outside acts and the draft's report, on the run's own
// sheet (venture.runs.get) only, so the lists other views read stay light.
// ---------------------------------------------------------------------------

/** What a run sheet adds for 4J14: the run's client files and what its files.read calls marked read. */
type Quality = { files: FileLike[]; read: ReadCoverage | null };
function runQuality(state: State, venture: VentureRecord, record: DeliveryRunRecord): Quality {
  const harness = record.harness ?? null;
  if (!harness) return { files: [], read: null };
  // A file the run read that is gone (forgotten) is left out, never guessed: its rows simply do not count.
  const files: FileLike[] = harness.uploadIds.flatMap(id => {
    const upload = findRecord(state, 'venture-upload', id);
    return upload && upload.ventureId === venture.id ? [upload] : [];
  });
  const read = files.length === harness.uploadIds.length ? readCoverage(files, harness.toolCalls)
    : { coverage: coverageView(null, null, 'items', 'read'), files: [] };
  return { files, read };
}

/** A work receipt's evidence line, fraction first where code can count it ("120 of 130 rows used. Money out ..."). */
function receiptLabel(state: State, quality: Quality | null, receipt: WorkReceiptRecord): string {
  const coverage = quality ? workReceiptCoverage(state, quality.files, receipt) : null;
  const words = receipt.explanation || 'Work receipt';
  return short(coverage ? `${coverage.line}. ${words}` : words, coverage ? 180 : 120);
}

/** The checks that could not run, by id (playbook:check) for the screen's own words, and each line in English. */
function notRunLines(record: DeliveryRunRecord): { id: string; line: string }[] {
  return (record.playbookChecks ?? []).filter(result => outcomeOfPlaybookCheck(result) === 'not-run')
    .map(result => ({ id: `${result.playbook}:${result.check}`, line: playbookCheckLabel(result) }));
}

/**
 * The outcome of what went outside from this run (Q8): connector posts made from its draft, and journal entries it
 * proposed (never the send to the owner's own AI, never a shadow entry). A failed run that had an outside action in
 * hand is Failed. No outside act: no outcome.
 */
function outcomeField(state: State, venture: VentureRecord, record: DeliveryRunRecord): Pick<RunDetail, 'outcome'> {
  const posts = listRecords(state, 'venture-connector-post', venture.id).filter(post => post.draftId === record.id);
  const entries = listRecords(state, 'venture-journal-entry', venture.id)
    .filter(entry => entry.subject.startsWith(`${record.id}:`) && entry.action !== 'delivery.send' && !entry.shadow);
  const all = [...posts, ...entries];
  const acts = all.flatMap(act => { const seen = actOutcome(act); return seen ? [seen] : []; });
  const proposed = (record.harness?.mocks.length ?? 0) > 0 || all.length > 0;
  // A failed run whose own model call failed is the provider's failure ("the run failed"), else the agent gave up.
  const call = record.callId ? state.conversations.find((item: { id?: unknown } | null) => item?.id === record.callId) as { kind?: unknown; status?: unknown } | undefined : undefined;
  const failed = record.status !== 'failed' ? null : call?.kind === 'venture-model-call' && call.status === 'failed' ? 'provider' as const : 'agent' as const;
  const outcome = runOutcome({ failed, proposed, acts });
  return outcome ? { outcome } : {};
}

/** When the draft last changed after it was made: the owner's edit at review, or an edit on Today not undone. */
function draftChangedAt(state: State, venture: VentureRecord, record: DeliveryRunRecord): string | null {
  const times = listRecords(state, 'venture-draft-edit', venture.id).filter(edit => edit.runId === record.id && !edit.undoneAt).map(edit => edit.at);
  if (record.verdict?.choice === 'edited') times.push(record.verdict.at);
  return times.length ? times.sort().at(-1)! : null;
}

/**
 * The flagship playbook a run's own checks came from, or null: the owner's voice (4J17) and a signed contract (4J12)
 * add results to every run's checks, but neither is a playbook.
 */
export function runReportPlaybook(record: Pick<DeliveryRunRecord, 'playbookChecks'>): string | null {
  return (record.playbookChecks ?? []).find(result => result.playbook !== VOICE_PLAYBOOK && result.playbook !== 'contract')?.playbook ?? null;
}

/** The draft's report (Q7, Q8), on a run with a draft. Its checks ran when the draft was kept, the judge's when it answered. */
function reportField(state: State, venture: VentureRecord, record: DeliveryRunRecord, quality: Quality): Pick<RunDetail, 'report'> {
  if (!record.deliverable) return {};
  const judged = record.judge?.status === 'done' ? record.judge.at : null;
  const made = record.readyAt ?? record.at;
  const report = deliverableReport({
    playbook: runReportPlaybook(record), checks: record.checks, playbookChecks: record.playbookChecks ?? [], judge: judgeStanding(record),
    coverage: quality.read?.coverage ?? null, generatedAt: judged && judged > made ? judged : made, draftAt: draftChangedAt(state, venture, record),
  });
  return { report };
}

/** Where the judge stands on a run's draft, from its record: done (with each rule kept), waiting, due, failed or none. */
function judgeStanding(record: DeliveryRunRecord): JudgeStanding {
  const judge = record.judge;
  if (judge?.status === 'done') return { state: 'done', rules: judge.rules ?? null, line: null };
  // 4J13 (H30): a judge waiting to go on its own ("Waiting: ..." with why) says so; one waiting for the owner's send has no line.
  if (judge?.status === 'waiting') return { state: 'waiting', rules: null, line: judge.deferred ? judge.line ?? null : null };
  if (record.judgePending) return { state: 'pending', rules: null, line: null };
  if (judge?.status === 'failed') return { state: 'failed', rules: null, line: judge.line ?? null };
  return { state: 'none', rules: null, line: null };
}

function rehearsalRun(state: State, venture: VentureRecord, record: SimulationRunRecord, business: { id: string }): Built {
  const scenarios = businessScenarios(state, venture.id, serviceTypeOf(state, venture));
  const { scenarios: total, passed } = record.summary;
  const summary: RunSummary = {
    runId: record.id, businessId: business.id, agent: agentName(state, venture), purpose: 'Rehearse with practice clients', state: 'done',
    startedAt: record.startedAt, elapsed: elapsedText(record.startedAt, record.finishedAt),
    result: `${passed} of ${total} practice ${total === 1 ? 'client' : 'clients'} passed.`,
  };
  const steps: RunStep[] = record.episodes.map((episode, index) => {
    const scenario = scenarios.find(item => item.id === episode.scenarioId);
    const evidence: { kind: string; id: string; label: string }[] = [
      ...episode.checks.filter(result => !result.passed).map(result => ({ kind: 'check', id: result.check, label: checkLabel(result) })),
      ...(episode.playbookChecks ?? []).filter(result => result.outcome === 'fail').map(result => ({ kind: 'check', id: `${result.playbook}:${result.check}`, label: playbookCheckLabel(result) })),
    ];
    if (scenario?.checks.includes('rules-judge') && !episode.checks.some(result => result.check === 'rules-judge')) evidence.push(judgeMissing(episode.checks));
    return plain({
      id: `episode-${index + 1}`, purpose: scenario?.title ?? 'Practice client',
      state: episode.passed ? 'done' as const : 'failed' as const,
      ...(evidence.length ? { evidence } : {}),
      ...(episode.passed ? {} : { error: short(episode.firstFailure ?? 'This practice client did not pass.', 300) }),
    });
  });
  return { summary, detail: { ...summary, steps } };
}

const IMPROVEMENT_RESULT: Readonly<Record<Exclude<ImprovementRunRecord['status'], 'incomplete'>, string>> = {
  'kept-candidate': 'A better playbook is ready for you to adopt.',
  'kept-parent': 'Kept your current playbook: the change did not do better.',
};
/** What a round tried to fix: an owner's reason in words, else the check that failed. */
function fixWords(reason: string): string {
  return (REASON_WORDS as Readonly<Record<string, string>>)[reason] ?? `the ${reason.replace(/-/g, ' ')} check`;
}

/** An improvement run: one step per round, each with what was compared or why nothing was tried. It runs to its end in one go. */
function improvementRun(state: State, venture: VentureRecord, record: ImprovementRunRecord, business: { id: string }): Built {
  const startedAt = record.startedAt ?? record.at;
  const summary: RunSummary = {
    runId: record.id, businessId: business.id, agent: agentName(state, venture), purpose: 'Improve the playbook from your feedback', state: 'done',
    startedAt, elapsed: elapsedText(startedAt, record.at),
    result: record.status === 'incomplete' ? short(`Stopped: ${record.incompleteReason ?? 'no change could be tried.'}`, 300) : IMPROVEMENT_RESULT[record.status],
  };
  const steps: RunStep[] = record.rounds.map(round => plain({
    id: `round-${round.round}`, state: 'done' as const,
    purpose: round.diagnosis.chosen ? `Try a change for ${fixWords(round.diagnosis.chosen.reason)}` : 'Look for another change to try',
    ...(round.gate ? { tools: [{ name: 'Compared with your current playbook', line: short(round.gate.reason, 240) }] }
      : round.refused ? { tools: [{ name: round.diagnosis.chosen ? 'Proposed a change' : 'Looked for a change', line: short(round.refused, 240) }] } : {}),
  }));
  return { summary, detail: { ...summary, steps } };
}

/** The delivery runs as the screens read them, newest first, with their steps. The team view reads what each agent is doing from these. */
export function deliveryRunDetails(deps: VentureDeps, state: State, venture: VentureRecord): RunDetail[] {
  const business = businessOf(deps, state);
  const times = lastEventAt(state, venture.id);
  // Reversed first, so runs started at the same moment keep the later one first.
  const posters = posterIndex(state, venture);
  return listRecords(state, 'venture-delivery-run', venture.id).reverse().map(record => deliveryRun(deps, state, venture, record, times, business, posters, false).detail)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** whole: a run's own sheet (venture.runs.get) builds coverage and the report (4J14); the list never does. */
function allRuns(deps: VentureDeps, ctx: Context, whole: boolean): { state: State; venture: VentureRecord | null; runs: Map<string, () => Built> } {
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  const runs = new Map<string, () => Built>();
  if (!venture) return { state, venture, runs };
  const business = businessOf(deps, state);
  const times = lastEventAt(state, venture.id);
  const posters = posterIndex(state, venture);
  for (const record of listRecords(state, 'venture-delivery-run', venture.id)) runs.set(record.id, () => deliveryRun(deps, state, venture, record, times, business, posters, whole));
  for (const record of listRecords(state, 'venture-simulation-run', venture.id)) runs.set(record.id, () => rehearsalRun(state, venture, record, business));
  for (const record of listRecords(state, 'venture-improvement-run', venture.id)) runs.set(record.id, () => improvementRun(state, venture, record, business));
  return { state, venture, runs };
}

/** venture.runs.list { state? } (read): runs newest first. 'active' keeps the working and waiting ones, 'done' the rest. */
export async function runsListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ runs: RunSummary[] }> {
  const body = exactPayload(payload, ['state']);
  check(body.state === undefined || body.state === 'active' || body.state === 'done' || body.state === 'all', 'INVALID_VENTURE_REQUEST', 'Choose active, done or all runs.');
  const want = (body.state as 'active' | 'done' | 'all' | undefined) ?? 'all';
  const { runs } = allRuns(deps, ctx, false);
  const summaries = [...runs.values()].map(build => build().summary)
    .filter(run => want === 'all' || (want === 'active') === (run.state === 'active' || run.state === 'waiting'));
  return { runs: summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
}

/** venture.runs.get { runId } (read): one run with its steps, tool lines, evidence, question and error. */
export async function runsGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunDetail> {
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Run');
  const build = allRuns(deps, ctx, true).runs.get(runId);
  check(build, 'RUN_NOT_FOUND', 'That run was not found.');
  return build().detail;
}
