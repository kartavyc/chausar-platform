// Chausar venture launcher, views (P1-A): runs. venture.runs.list and venture.runs.get.
// A run is a delivery run (one draft reply for an order, with the agent loop's turns when the order has files) or a
// rehearsal with practice clients. Steps are the playbook's, named by their purpose; tool calls fold under the step
// they serve, named by what they did, never by the raw tool name. Times are the engine's: a run waiting on the owner
// stops its clock at the moment it began to wait.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, findRecord, identifier, listRecords } from '../records.ts';
import type {
  DeliveryReason, DeliveryRunRecord, PlaybookStep, RunDetail, RunState, RunStep, RunSummary, SimulationRunRecord, StepKind, ToolCallRecord,
  VentureDeps, VentureRecord,
} from '../contracts.ts';
import { runView } from '../delivery/runs.ts';
import { openDelegation } from '../delivery/harness/loop.ts';
import { DELEGATE_LABELS } from '../delivery/harness/delegate.ts';
import { currentPlaybook, playbookSteps } from '../delivery/playbook.ts';
import { scenariosFor } from '../delivery/scenarios.ts';
import { acceptedBlueprintOrNull, serviceTypeOf } from '../delivery/shared.ts';
import { questionRowId, runError } from './queue.ts';
import { agentName, businessOf, clientNameFor, elapsedText, lastEventAt, plain, short } from './shared.ts';

/** What each tool did, in the owner's words. */
const TOOL_PURPOSE: Readonly<Record<string, string>> = {
  'files.list': "Looked at the client's files", 'files.read': 'Read a client file',
  'dictionary.browse': 'Looked up your business terms', 'dictionary.resolve': 'Checked what a term means',
  'calc.sum': 'Added up amounts with the calculator', 'calc.totals': 'Worked out totals with the calculator',
  'books.reconcile': 'Matched the bank statement to the bills', 'bills.pick': 'Picked bill amounts from PDFs',
  'sandbox.transform': 'Reshaped a table in the sandbox', 'sandbox.python': 'Ran a small program in a container',
  'handoff.client': 'Asked a question for the client', 'handoff.owner': 'Asked you a question',
  'outbox.propose': 'Proposed an outside action, held for you', 'agent.delegate': 'Asked for heavy work by your own tool',
};
/** The playbook step kind each tool serves. The agent loop moves between these three in any order. */
const TOOL_KIND: Readonly<Record<string, StepKind>> = {
  'files.list': 'gather', 'files.read': 'gather', 'dictionary.browse': 'gather', 'dictionary.resolve': 'gather',
  'handoff.client': 'question', 'handoff.owner': 'question', 'outbox.propose': 'operator',
};
const LOOP_KINDS: readonly StepKind[] = ['gather', 'question', 'work'];
const REASON_WORDS: Readonly<Record<DeliveryReason, string>> = {
  'wrong-fact': 'a wrong fact', 'missing-fact': 'a missing fact', 'missing-section': 'a missing section', 'off-brief': 'off the brief', tone: 'the tone',
  format: 'the format', 'too-long': 'too long', 'too-short': 'too short', 'wrong-number': 'a wrong number', late: 'late',
  'claims-work-not-done': 'it claimed work that was not done', other: 'another reason',
};

const toolKind = (tool: string): StepKind => TOOL_KIND[tool] ?? 'work';
function toolLine(call: ToolCallRecord): string {
  if (call.envelope.ok) return 'Done.';
  if (call.outcome === 'timedOut') return 'Timed out.';
  return short(call.envelope.error.message || 'It did not work.', 200);
}

/** The steps a delivery run follows: its own playbook's, else the business's current one, else the accepted plan's. */
function stepsFor(state: State, venture: VentureRecord, run: DeliveryRunRecord): PlaybookStep[] {
  const own = findRecord(state, 'venture-playbook', run.playbookId);
  if (own && own.ventureId === venture.id) return own.steps;
  const current = currentPlaybook(state, venture);
  if (current) return current.steps;
  const plan = acceptedBlueprintOrNull(state, venture);
  try { return plan ? playbookSteps(plan) : []; } catch { return []; }
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
    case 'waiting-for-you': return { kind: loopKind(), state: 'waiting' };
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

function resultOf(run: ReturnType<typeof runView>): string | undefined {
  switch (run.status) {
    case 'accepted': return 'Draft accepted. You send it to the client.';
    case 'edited': return 'You edited the draft. You send your version.';
    case 'rejected': return run.verdict?.reason ? `Draft rejected: ${REASON_WORDS[run.verdict.reason]}.` : 'Draft rejected.';
    case 'ready-for-review': return run.awaitingYou ? undefined : short(run.acceptBlocked ?? 'Practice draft. Not for clients.');
    default: return undefined;
  }
}

type Built = { summary: RunSummary; detail: RunDetail };

function deliveryRun(deps: VentureDeps, state: State, venture: VentureRecord, record: DeliveryRunRecord, times: Map<string, string>, business: { id: string }): Built {
  const now = deps.clock();
  const run = runView(record, venture, now.getTime());
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
  const error = run.status === 'failed' ? runError(state, record) : undefined;
  const order = listRecords(state, 'venture-order', venture.id).find(item => item.id === run.orderId);

  const built: RunStep[] = steps.map((step, index) => {
    let stepState: RunStep['state'];
    if (inLoop) {
      const used = calls.some(call => toolKind(call.tool) === step.kind);
      stepState = step.kind === position.kind ? position.state : LOOP_KINDS.includes(step.kind) && used ? 'done' : 'pending';
    } else {
      stepState = index < at ? 'done' : index === at ? position.state : 'pending';
    }
    const tools = calls.filter(call => toolKind(call.tool) === step.kind).map(call => ({ name: TOOL_PURPOSE[call.tool] ?? 'Used a tool', line: toolLine(call) }));
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
        if (receipt) evidence.push({ kind: 'work-receipt', id, label: short(receipt.explanation || 'Work receipt', 120) });
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
    if (step.kind === 'write' && run.deliverable) evidence.push({ kind: 'draft', id: run.id, label: short(run.deliverable.title, 120) });
    if (step.kind === 'verify') for (const result of run.checks) evidence.push({ kind: 'check', id: result.check, label: short(`${result.passed ? 'Passed' : 'Failed'}: ${result.detail}`, 160) });
    return plain({
      id: step.id, purpose: step.title, state: stepState,
      ...(tools.length ? { tools } : {}), ...(evidence.length ? { evidence } : {}), ...(stepState === 'failed' && error ? { error } : {}),
    });
  });

  const end = runState === 'active' ? now.toISOString() : times.get(run.id) ?? run.at;
  const done = built.filter(step => step.state === 'done').length;
  const client = clientNameFor(state, venture.id, run.orderId);
  const result = resultOf(run);
  const receiptId = runState === 'done' ? harness?.workReceiptIds.at(-1) : undefined;
  const summary: RunSummary = plain({
    runId: run.id, businessId: business.id, agent: agentName(state, venture), purpose: run.practiceNow && run.status !== 'accepted' ? `Practice draft for ${client}` : `Draft a reply for ${client}`,
    state: runState, startedAt: run.at, elapsed: elapsedText(run.at, end),
    ...(runState === 'active' || runState === 'waiting' ? { progress: built.length ? { done, total: built.length } : 'indeterminate' as const } : {}),
    ...(result ? { result } : {}), ...(receiptId ? { receiptId } : {}),
  });
  const open = run.status === 'needs-answer' && harness ? [...harness.handoffs].reverse().find(handoff => handoff.answer === null) : undefined;
  const detail: RunDetail = plain({
    ...summary, steps: built,
    ...(open && harness ? { question: { id: questionRowId(run.id, harness), text: open.question } } : {}),
    ...(error ? { error } : {}),
  });
  return { summary, detail };
}

function rehearsalRun(state: State, venture: VentureRecord, record: SimulationRunRecord, business: { id: string }): Built {
  const scenarios = scenariosFor(serviceTypeOf(state, venture));
  const { scenarios: total, passed } = record.summary;
  const summary: RunSummary = {
    runId: record.id, businessId: business.id, agent: agentName(state, venture), purpose: 'Rehearse with practice clients', state: 'done',
    startedAt: record.startedAt, elapsed: elapsedText(record.startedAt, record.finishedAt),
    result: `${passed} of ${total} practice ${total === 1 ? 'client' : 'clients'} passed.`,
  };
  const steps: RunStep[] = record.episodes.map((episode, index) => plain({
    id: `episode-${index + 1}`, purpose: scenarios.find(item => item.id === episode.scenarioId)?.title ?? 'Practice client',
    state: episode.passed ? 'done' as const : 'failed' as const,
    ...(episode.checks.some(result => !result.passed) ? { evidence: episode.checks.filter(result => !result.passed).map(result => ({ kind: 'check', id: result.check, label: short(`Failed: ${result.detail}`, 160) })) } : {}),
    ...(episode.passed ? {} : { error: short(episode.firstFailure ?? 'This practice client did not pass.', 300) }),
  }));
  return { summary, detail: { ...summary, steps } };
}

/** The delivery runs as the screens read them, newest first, with their steps. The team view reads what each agent is doing from these. */
export function deliveryRunDetails(deps: VentureDeps, state: State, venture: VentureRecord): RunDetail[] {
  const business = businessOf(deps, state);
  const times = lastEventAt(state, venture.id);
  // Reversed first, so runs started at the same moment keep the later one first.
  return listRecords(state, 'venture-delivery-run', venture.id).reverse().map(record => deliveryRun(deps, state, venture, record, times, business).detail)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function allRuns(deps: VentureDeps, ctx: Context): { state: State; venture: VentureRecord | null; runs: Map<string, () => Built> } {
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  const runs = new Map<string, () => Built>();
  if (!venture) return { state, venture, runs };
  const business = businessOf(deps, state);
  const times = lastEventAt(state, venture.id);
  for (const record of listRecords(state, 'venture-delivery-run', venture.id)) runs.set(record.id, () => deliveryRun(deps, state, venture, record, times, business));
  for (const record of listRecords(state, 'venture-simulation-run', venture.id)) runs.set(record.id, () => rehearsalRun(state, venture, record, business));
  return { state, venture, runs };
}

/** venture.runs.list { state? } (read): runs newest first. 'active' keeps the working and waiting ones, 'done' the rest. */
export async function runsListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ runs: RunSummary[] }> {
  const body = exactPayload(payload, ['state']);
  check(body.state === undefined || body.state === 'active' || body.state === 'done' || body.state === 'all', 'INVALID_VENTURE_REQUEST', 'Choose active, done or all runs.');
  const want = (body.state as 'active' | 'done' | 'all' | undefined) ?? 'all';
  const { runs } = allRuns(deps, ctx);
  const summaries = [...runs.values()].map(build => build().summary)
    .filter(run => want === 'all' || (want === 'active') === (run.state === 'active' || run.state === 'waiting'));
  return { runs: summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
}

/** venture.runs.get { runId } (read): one run with its steps, tool lines, evidence, question and error. */
export async function runsGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunDetail> {
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Run');
  const build = allRuns(deps, ctx).runs.get(runId);
  check(build, 'RUN_NOT_FOUND', 'That run was not found.');
  return build().detail;
}
