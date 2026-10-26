import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useEngine, useResource } from '../../engine/context';
import type { DeliveryLite, DraftChangesView, VentureRunEvent } from '../../engine/types';

/**
 * W4 4J19 review: Today's draft replies, read once for the whole page and shared by every card (the engine that wrote a
 * draft, its text for Edit, its failed checks for a fix, and the paragraph changes of a revision). The list is read
 * again when Today's list changes or a run finishes or fails, never on every step; each draft waiting for review has its
 * changes read once per version of it.
 */
export interface TodayDrafts { runs: readonly DeliveryLite[] | undefined; changes: ReadonlyMap<string, DraftChangesView> }

const DraftsContext = createContext<TodayDrafts | null>(null);

const DRAFT_EVENTS = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'run.waiting' || event.type === 'run.done' || event.type === 'run.failed';

/** A version of a draft waiting for review: a new one (a revision landed, an edit, a fix) is read again. */
const versionOf = (run: DeliveryLite) => `${run.id}@${run.at}@${run.status}@${run.editedText ?? ''}@${run.renderedText?.length ?? 0}`;

export function DraftsProvider({ children }: { children: ReactNode }) {
  const client = useEngine();
  const drafts = useResource('venture.delivery.list', {}, { refreshOn: DRAFT_EVENTS });
  const [changes, setChanges] = useState<ReadonlyMap<string, DraftChangesView>>(new Map());
  const waiting = (drafts.data ?? []).filter((run) => run.status === 'ready-for-review');
  const key = waiting.map(versionOf).join(' ');
  useEffect(() => {
    let live = true;
    const read = async () => {
      const next = new Map<string, DraftChangesView>();
      for (const run of waiting) {
        try { next.set(run.id, await client.request('venture.delivery.changes', { runId: run.id })); } catch { /* no changes to show */ }
      }
      if (live) setChanges(next);
    };
    void read();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key]);
  return <DraftsContext.Provider value={{ runs: drafts.data, changes }}>{children}</DraftsContext.Provider>;
}

/**
 * The drafts Today shares. Outside Today (the approval page draws the same cards) there is no provider, so a card reads
 * the list itself once; `own` is false inside Today, where nothing extra is read.
 */
export function useTodayDrafts(wanted: boolean): TodayDrafts {
  const shared = useContext(DraftsContext);
  const own = useResource('venture.delivery.list', {}, { skip: shared !== null || !wanted, refreshOn: DRAFT_EVENTS });
  return shared ?? { runs: own.data, changes: new Map() };
}
