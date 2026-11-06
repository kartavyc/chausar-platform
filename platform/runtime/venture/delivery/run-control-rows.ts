// Chausar venture launcher, delivery (Ink v2 wave 4, package 4F1): Today's run-control rows. A stopped run (the newest
// of an open order) offers Resume and Run again, with the line that says who stopped it and what was kept. A run the
// round gate holds asks "Round 2 of the draft for Asha is done: 3 tool calls, 1 failed. Continue or stop?", or at a
// limit "Allow 2 more turns?" (once), with Continue and Stop. 4F2 adds its breaker stops, write caps and per-agent spend
// caps here. Package 4-0 put the row source here; decisions on its rows go to views/queue-w4.ts, then run-controls.ts.
// Reads only.
import type { Context, State } from '../../contracts.ts';
import { listRecords } from '../records.ts';
import type { DeliveryRunRecord, QueueAction, VentureDeps, VentureRecord } from '../contracts.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { canAddTurns, gateWaits, STOPPED_BY_YOU } from './harness/controls.ts';
import { agentName, clientNameFor, lastEventAt } from '../views/shared.ts';
import { breakerStopped, triggerWords } from './harness/breaker.ts';
import { writeCapRows } from './harness/write-caps.ts';
import { spendRows } from '../money/spend.ts';

/** A breaker stop's line on Today when the owner has nothing to fix (4F2). */
const BREAKER_KEPT = 'Finished steps are kept. Resume tells the agent what was tried.';

const action = (id: QueueAction['id'], label: string, primary: boolean): QueueAction => ({ id, label, primary });

/** The gate's question for one held run, from its line: which round of whose draft, and what to do next. */
function gateTitle(run: DeliveryRunRecord, client: string): { title: string; continueLabel: string } {
  const waiting = run.harness!.gate!.waiting!;
  const whose = `the draft for ${client}`;
  if (waiting.reason === 'limit') {
    const more = canAddTurns(run.harness!);
    const what = waiting.line.replace(/^The (agent|run) /, '').replace(/\.$/, '');
    return { title: `The draft for ${client} ${what}. ${more ? 'Allow 2 more turns?' : 'Write up what was found?'}`, continueLabel: more ? 'Allow 2 more turns' : 'Write it up' };
  }
  const said = waiting.line.replace(`Round ${waiting.round} `, `Round ${waiting.round} of ${whose} `)
    .replace(`in round ${waiting.round} `, `in round ${waiting.round} of ${whose} `).replace(/\.$/, '');
  return { title: `${said}. Continue or stop?`, continueLabel: 'Continue' };
}

/**
 * The open business's run-control rows: stopped runs and runs the round gate holds; 4F2 adds the write caps agents
 * reached today (harness/write-caps.ts) and the spend notices (money/spend.ts spendRows).
 */
export function runControlRows(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  const runs = listRecords(state, 'venture-delivery-run', venture.id);
  const orders = new Map(listRecords(state, 'venture-order', venture.id).map(order => [order.id, order]));
  const newest = new Map<string, DeliveryRunRecord>();
  for (const run of runs) { const known = newest.get(run.orderId); if (!known || run.at >= known.at) newest.set(run.orderId, run); }
  const times = lastEventAt(state, venture.id);
  // Each stop is its own row version, even two in the same moment: a decided Resume never hides the next stop.
  const stops = new Map<string, number>();
  for (const event of listRecords(state, 'venture-event', venture.id)) {
    const runId = event.name === 'run.stopped' && event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data.runId : undefined;
    if (typeof runId === 'string') stops.set(runId, (stops.get(runId) ?? 0) + 1);
  }
  const agent = agentName(state, venture);
  const rows: W4RowItem[] = [];
  for (const run of runs) {
    if (orders.get(run.orderId)?.status === 'cancelled') continue;
    const client = clientNameFor(state, venture.id, run.orderId);
    const subject = `runctl:${run.id}`;
    const createdAt = times.get(run.id) ?? run.at;
    const viewRef = { kind: 'run' as const, id: run.id };
    if (run.status === 'stopped' && newest.get(run.orderId)?.id === run.id && orders.get(run.orderId)?.status === 'open') {
      // 4F2: a breaker stop names its trigger and gives "How to fix it" when the owner must act (harness/breaker.ts).
      const tripped = breakerStopped(run.harness) ? run.harness!.breaker! : null;
      rows.push({
        kind: 'draft', subject, version: `stopped-${stops.get(run.id) ?? 0}-${run.harness?.control?.stoppedAt ?? createdAt}`, createdAt, agent,
        title: tripped ? `${agent}'s run stopped: ${triggerWords(tripped)}` : `The draft for ${client} is stopped`,
        // 4J13: a run a crash cut says so (leases.ts), never "Stopped by you".
        line: tripped ? tripped.fix ?? BREAKER_KEPT : run.harness?.control?.line ?? run.interrupted?.line ?? STOPPED_BY_YOU, viewRef,
        actions: [action('run-again', 'Run again', false), action('resume', 'Resume', true)],
      });
    } else if (run.status === 'waiting-for-you' && run.harness && gateWaits(run.harness) && !run.preview) {
      const { title, continueLabel } = gateTitle(run, client);
      rows.push({
        kind: 'question', subject, version: `gate-${run.harness.gate!.waiting!.round}`, createdAt, agent, title, line: run.harness.gate!.waiting!.line, viewRef,
        actions: [action('stop', 'Stop', false), action('continue', continueLabel, true)],
      });
    }
  }
  const now = deps.clock().toISOString();
  return [...rows, ...writeCapRows(state, venture, now), ...spendRows(state, venture, now)];
}
