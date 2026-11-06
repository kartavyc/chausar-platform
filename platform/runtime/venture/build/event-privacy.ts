// C7: Forget reaches event triggers. An event's facts about a forgotten client, and a trigger run's filled words that name
// them or carry their data, are erased; the event and the run stay as facts without them.
import type { VentureTx } from '../records.ts';
import type { RelayEventRecord } from './event-triggers.ts';
import type { RoutineRunRecord } from '../contracts.ts';

export const ERASED_EVENT = 'Removed when this person was forgotten.';

export function eraseEventsNaming(tx: VentureTx, clientIds: ReadonlySet<string>, mentionsName: (text: unknown) => boolean): void {
  for (const event of tx.list('venture-relay-event')) {
    if (event.facts && ((event.facts.clientId && clientIds.has(event.facts.clientId)) || mentionsName(event.facts.client) || mentionsName(event.facts.event))) {
      tx.replace<RelayEventRecord>({ ...event, facts: null, line: ERASED_EVENT, state: event.state === 'confirmed' ? 'missed' : event.state });
    }
  }
  for (const run of tx.list('venture-routine-run')) {
    if ((run.clientId && clientIds.has(run.clientId)) || (run.filled && mentionsName(run.filled)) || mentionsName(run.line)) {
      const { filled: _filled, clientId: _client, ...rest } = run;
      const open = run.state === 'needs-input' || run.state === 'queued';
      tx.replace<RoutineRunRecord>({ ...rest, line: ERASED_EVENT, ...(open ? { state: 'skipped' as const } : {}) });
    }
  }
}
