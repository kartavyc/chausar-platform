// Chausar venture launcher, views (Ink v2 wave 4, package 4J2 review; catalogue O9 with W1 H21): which exact version of
// a Today row the owner opened inside the app. venture.queue.view leaves a mark { rowId, rowDigest, at } when the owner
// opens it on the desktop or the web app (its payload says opened: true, 4J19; a card drawing its preview does not); a set approval (views/queue-actions.ts) takes an item that must be read first
// only when the owner opened that very version. A read from the phone or an agent leaves none.
import type { Context, State } from '../../contracts.ts';
import type { QueueRow, QueueViewMarkRecord, VentureDeps } from '../contracts.ts';
import { isAppChannel, listRecords, ventureAction } from '../records.ts';

/** Leaves a mark for each row read now, inside the app; one per row id and digest. Never throws. */
export async function markViewed(deps: VentureDeps, ctx: Context, rows: readonly Pick<QueueRow, 'id' | 'digest'>[]): Promise<void> {
  if (!isAppChannel(ctx) || !rows.length) return;
  try {
    await ventureAction(deps, ctx, 'read', 'queue.view', tx => {
      const marks = tx.list('venture-queue-view');
      for (const row of rows) {
        if (marks.some(mark => mark.rowId === row.id && mark.rowDigest === row.digest)) continue;
        tx.put<QueueViewMarkRecord>({ ...tx.base('venture-queue-view'), rowId: row.id, rowDigest: row.digest });
      }
    });
  } catch {
    // A mark that could not be kept only means the set asks the owner to open it again.
  }
}

/** Whether the owner opened this exact version of the row inside the app. */
export function viewedExactly(state: State, ventureId: string, row: Pick<QueueRow, 'id' | 'digest'>): boolean {
  return listRecords(state, 'venture-queue-view', ventureId).some(mark => mark.rowId === row.id && mark.rowDigest === row.digest);
}
