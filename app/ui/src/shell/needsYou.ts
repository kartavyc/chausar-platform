import { useResource } from '../engine/context';
import type { QueueRow, UiRunEvent } from '../engine/types';

/**
 * One-shot B3: one "needs you" count. The rail, the phone tabs, Today's greeting and heading and Team read the same
 * entry of the read store (one request, one answer) and count by the engine's rule.
 */

/** Today's queue changes: a queue change, and a run that waits on the owner or failed. */
export const QUEUE_EVENTS = (event: UiRunEvent) => event.type === 'queue.changed' || event.type === 'run.waiting' || event.type === 'run.failed';

/**
 * The engine's rule (views/queue.ts summaryOf): every row needs the owner but a locked business's, which is only "open
 * it", and one already decided here (`decided`), which waits no more though the list may hold it a moment longer.
 */
export function needsYouOf(rows: readonly QueueRow[], decided: (id: string) => boolean = () => false): number {
  return rows.filter((row) => row.kind !== 'locked' && !decided(row.id)).length;
}

/**
 * What needs the owner, as the engine counts it: across every business on this computer (the rail, the phone tabs,
 * Today), or for the open business alone (`current`: Team, a page about that business).
 */
export function useNeedsYou(scope: 'all' | 'current' = 'all'): { count: number; loaded: boolean } {
  const queue = useResource('venture.queue.list', { scope }, { refreshOn: QUEUE_EVENTS });
  return { count: queue.data?.needsYou ?? 0, loaded: queue.data !== undefined };
}
