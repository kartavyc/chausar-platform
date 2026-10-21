// Chausar judge: the run's trace as a list of citable events. A judge vote must cite ids from this list, and code
// checks each id is really here, so a vote can only point at what the run actually did or received.
import type { HarnessState } from '../../contracts.ts';

/** One thing that happened in a run, or one thing it held (a file, a table, a receipt, the draft). */
export type TraceEvent = { id: string; kind: string; summary: string };
export type JudgeTrace = { events: TraceEvent[] };

const SUMMARY_CHARS = 300;

function short(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  return text.length <= SUMMARY_CHARS ? text : `${text.slice(0, SUMMARY_CHARS)}...`;
}

/**
 * Events for a delivery run's agent loop: each turn (turn.1), each tool call by its own id (t1.2), each hand-off
 * (handoff.1), each file the run may read, each table and receipt it made. Extra events (the client's message, the
 * draft) go last. An id appears once; the first event with it wins.
 */
export function traceFromHarness(
  state: HarnessState | null | undefined,
  options: { receipts?: readonly { id: string; explanation?: string }[]; extra?: readonly TraceEvent[] } = {},
): JudgeTrace {
  const events: TraceEvent[] = [];
  const seen = new Set<string>();
  const add = (event: TraceEvent) => { if (!seen.has(event.id)) { seen.add(event.id); events.push(event); } };
  if (state) {
    for (const turn of state.turns) add({ id: `turn.${turn.turn}`, kind: 'turn', summary: short(`${turn.step === 'act' ? 'Agent turn' : 'Write step'}: ${turn.note}`) });
    for (const call of state.toolCalls) {
      const result = call.envelope.ok ? short(call.envelope.result) : short(call.envelope.error.message);
      add({ id: call.id, kind: 'tool', summary: short(`${call.tool} ${call.outcome}: ${result}`) });
    }
    state.handoffs.forEach((handoff, index) => add({
      id: `handoff.${index + 1}`, kind: 'handoff', summary: short(`Asked the ${handoff.to}: ${handoff.question} Answer: ${handoff.answer ?? 'none yet'}`),
    }));
    for (const id of state.uploadIds) add({ id, kind: 'file', summary: 'A file the client sent.' });
    for (const id of state.tableIds) add({ id, kind: 'table', summary: 'A table a tool made in this run.' });
    for (const id of state.workReceiptIds) {
      const receipt = options.receipts?.find(item => item.id === id);
      add({ id, kind: 'receipt', summary: short(receipt?.explanation ? `Calculator receipt: ${receipt.explanation}` : 'A calculator receipt from this run.') });
    }
  }
  for (const event of options.extra ?? []) add({ id: event.id, kind: event.kind, summary: short(event.summary) });
  return { events };
}

/** Every id a vote may cite. */
export function traceIds(trace: JudgeTrace): Set<string> {
  return new Set(trace.events.map(event => event.id));
}
