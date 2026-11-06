import { useResource } from '../engine/context';
import type { VentureRunEvent } from '../engine/types';

const QUEUE_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'run.waiting' || event.type === 'run.failed';

/**
 * W4 4J19 review: the open business as the engine lists its own work. A row's and a run's businessId is the workspace
 * the engine has open (views/shared.ts businessOf), never venture.get's venture id (a venture_ record id), so the two are
 * never compared. The open business's rows are venture.queue.list { scope: 'current' }; its id is theirs. With no row
 * waiting the id is unknown (undefined), and a caller that needs it falls back to what the engine lists for the open
 * business alone (venture.runs.list lists only its runs).
 */
export function useOpenBusiness(): { rowIds: ReadonlySet<string> | undefined; businessId: string | undefined } {
  const current = useResource('venture.queue.list', { scope: 'current' }, { refreshOn: QUEUE_EVENTS });
  const rows = current.data?.rows.filter((row) => row.kind !== 'locked');
  return { rowIds: rows ? new Set(rows.map((row) => row.id)) : undefined, businessId: rows?.[0]?.businessId };
}
