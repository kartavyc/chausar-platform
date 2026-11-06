// C7 task 19: Forget reaches trackers. A row whose person cell is the forgotten person goes; a text or estimate cell
// that names them is erased, as a routine's prompt is (agents/routines.ts eraseRoutinesNaming). A row about someone else
// stays. Everything else of a tracker leaves with its business.
import type { VentureTx } from '../records.ts';
import { removeRecords } from '../network/people.ts';
import type { TrackerRowRecord } from './trackers.ts';

export const ERASED_CELL = '[removed when this person was forgotten]';

export function eraseTrackerNaming(tx: VentureTx, personIds: ReadonlySet<string>, mentionsName: (text: unknown) => boolean): void {
  const trackers = new Map(tx.list('venture-tracker').map(tracker => [tracker.id, tracker]));
  const gone = new Set<string>();
  for (const row of tx.list('venture-tracker-row')) {
    const columns = trackers.get(row.trackerId)?.columns ?? [];
    if (columns.some(column => column.kind === 'person' && typeof row.cells[column.id] === 'string' && personIds.has(row.cells[column.id] as string))) { gone.add(row.id); continue; }
    const named = columns.filter(column => (column.kind === 'text' || column.kind === 'estimate') && mentionsName(row.cells[column.id]));
    if (named.length) tx.replace<TrackerRowRecord>({ ...row, cells: { ...row.cells, ...Object.fromEntries(named.map(column => [column.id, ERASED_CELL])) } });
  }
  if (gone.size) removeRecords(tx, record => record.kind === 'venture-tracker-row' && gone.has(record.id as string));
  // A tracker's own name or a column named for them is the owner's words about them too.
  for (const tracker of trackers.values()) if (mentionsName(tracker.name)) tx.replace({ ...tracker, name: 'Tracker' });
}
