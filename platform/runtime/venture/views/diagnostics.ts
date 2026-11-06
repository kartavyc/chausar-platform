// C5 task 28: Diagnostics in plain words. venture.diagnostics.today (read): where today's time went, summed by code from
// the business's own records and worded here: each tool call's start and finish, each owner's-AI job's working time, and
// the time runs waited for the owner (views/runs.ts waitSpans). Every sum carries the calls that went into it. Model calls
// are counted, not timed: their records keep no finish time.
import { check, type Context, type State } from '../../contracts.ts';
import { formatElapsed } from '../../owner-format.ts';
import type { DeliveryRunRecord, StepKind, ToolCallRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { localDayAt } from '../local-day.ts';
import { exactPayload, listRecords, readVenture } from '../records.ts';
import { diagnosticsLine, type DiagnosticsRow, type DiagnosticsTodayView } from './diagnostics-core.ts';
import { toolKind, waitSpans } from './runs.ts';

const KIND_WORDS: Readonly<Partial<Record<StepKind, string>>> = {
  gather: 'reading your files', question: 'asking questions', work: 'writing drafts', compute: 'working out figures', write: 'writing drafts', verify: 'checking drafts', operator: 'getting things ready to send',
};
const JOB_ENDS: ReadonlySet<string> = new Set(['run.done', 'run.failed', 'run.stopped']);

type Span = { from: number; to: number };
/** The first moment of the owner's today: the local day only moves forward, so a search over the last two days finds it. */
function startOfDay(venture: VentureRecord, nowMs: number, today: string): number {
  let low = nowMs - 2 * 86_400_000, high = nowMs;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDayAt(new Date(middle), venture.country) === today) high = middle; else low = middle;
  }
  return high;
}
/** The time two spans share. */
const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));

/** Which of the owner's own tools a job ran on, from what it wrote down when it started. */
function jobWords(run: DeliveryRunRecord): { key: string; label: string } {
  const route = `${run.agentJob?.route?.presetId ?? ''} ${run.agentJob?.route?.model ?? run.agentJob?.model ?? ''}`;
  if (/codex|gpt|openai/i.test(route)) return { key: 'job:codex', label: 'waiting for Codex' };
  if (/claude|anthropic|sonnet|opus|haiku/i.test(route)) return { key: 'job:claude', label: 'waiting for Claude Code' };
  return { key: 'job:other', label: 'waiting for your AI' };
}

export function diagnosticsToday(state: State, venture: VentureRecord, nowIso: string): DiagnosticsTodayView {
  const nowMs = Date.parse(nowIso), day = localDayAt(nowIso, venture.country);
  const today: Span = { from: startOfDay(venture, nowMs, day), to: nowMs };
  const sums = new Map<string, Pick<DiagnosticsRow, 'key' | 'label' | 'receipt'>>();
  const add = (key: string, label: string, source: DiagnosticsRow['receipt']['source'], id: string, ms: number) => {
    if (ms <= 0) return;
    const row = sums.get(key) ?? { key, label, receipt: { source, items: [], sumMs: 0 } };
    row.receipt.items.push({ id, ms });
    row.receipt.sumMs += ms;
    sums.set(key, row);
  };
  const runs = listRecords(state, 'venture-delivery-run', venture.id);
  const waits: (Span & { runId: string })[] = [];
  for (const run of runs) {
    const spans = waitSpans(state, venture.id, run.id, nowIso);
    waits.push(...spans.map(span => ({ ...span, runId: run.id })));
    const calls: ToolCallRecord[] = [...(run.harness?.toolCalls ?? []), ...(run.agentJob?.calculations ?? [])];
    for (const call of calls) {
      if (!call.startedAt || !call.finishedAt) continue;
      const kind = toolKind(call.tool);
      add(`tool:${KIND_WORDS[kind] ?? 'writing drafts'}`, KIND_WORDS[kind] ?? 'writing drafts', 'tool-calls', call.id, overlap({ from: Date.parse(call.startedAt), to: Date.parse(call.finishedAt) }, today));
    }
    if (run.agentJob) {
      const events = listRecords(state, 'venture-event', venture.id).filter(event => (event.data as { runId?: unknown } | null)?.runId === run.id);
      const ended = events.filter(event => JOB_ENDS.has(event.name)).map(event => Date.parse(event.at));
      const job: Span = { from: Date.parse(run.at), to: ended.length ? Math.max(...ended) : nowMs };
      const waited = spans.reduce((sum, span) => sum + overlap(span, { from: Math.max(job.from, today.from), to: Math.min(job.to, today.to) }), 0);
      const words = jobWords(run);
      add(words.key, words.label, 'agent-jobs', run.id, overlap(job, today) - waited);
    }
  }
  // Two runs waiting at once are one wait for the owner: each span counts only the time no earlier span covered.
  let covered = today.from;
  for (const wait of waits.sort((a, b) => a.from - b.from)) {
    const from = Math.max(wait.from, covered), to = Math.min(wait.to, today.to);
    if (to > from) { add('owner', 'waiting for you', 'run-events', wait.runId, to - from); covered = to; }
  }
  const rows: DiagnosticsRow[] = [...sums.values()]
    .map(row => ({ ...row, ms: row.receipt.sumMs, display: formatElapsed(row.receipt.sumMs) }))
    .filter(row => row.display !== '')
    .sort((a, b) => b.ms - a.ms || a.key.localeCompare(b.key));
  const modelCalls = listRecords(state, 'venture-model-call', venture.id).filter(call => call.status !== 'preview' && localDayAt(call.at, venture.country) === day).length;
  return { day, line: diagnosticsLine(rows, modelCalls), rows, modelCalls };
}

export async function diagnosticsTodayHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<DiagnosticsTodayView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  check(venture, 'VENTURE_NOT_FOUND', 'Start your business first.');
  return diagnosticsToday(state, venture, deps.clock().toISOString());
}
