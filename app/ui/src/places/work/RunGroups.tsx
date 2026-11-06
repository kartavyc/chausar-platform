import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { QueueRow, RunSummary } from '../../engine/types';
import { flipFrom, measureRows } from '../../parts/flip';
import { useArrivals } from '../../parts/useArrivals';
import { FINISHED_AT_REST, Finished, RunRow, useRunDetails } from './PreviousRuns';
import { RunTile, RunTiles } from './RunTiles';
import s from './Work.module.css';
import motion from '../../parts/Leave.module.css';

/** A run owns one list item. Only its host changes; React continues to own the portal's content. */
function MovingRun({ id, hosts, arriving, children }: {
  id: string; hosts: ReadonlyMap<string, HTMLUListElement>; arriving: boolean; children: ReactNode;
}) {
  const [row] = useState(() => {
    const element = document.createElement('li');
    element.dataset.runId = id;
    element.dataset.flipId = id;
    element.className = `${s.runContainer} ${motion.arrive}`;
    return element;
  });
  useLayoutEffect(() => {
    if (arriving) row.dataset.arriving = '';
    else delete row.dataset.arriving;
    const host = hosts.get(id);
    if (host) host.appendChild(row);
    else row.remove();
  });
  useLayoutEffect(() => () => row.remove(), [row]);
  return createPortal(children, row, id);
}

/** The original Work regions and grids, with stable run items moving between their lists. */
export function RunGroups({ active, waiting, done, names, queue, onChanged, primaryId, moreHref, failures }: {
  active: RunSummary[]; waiting: RunSummary[]; done: RunSummary[]; names: ReadonlyMap<string, string>;
  queue: readonly QueueRow[] | undefined; onChanged: () => void; primaryId: string | undefined;
  moreHref: string; failures: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const hosts = useRef(new Map<string, HTMLUListElement>());
  const before = useRef<Map<string, DOMRect> | null>(null);
  const focus = useRef<{ id: string; element: HTMLElement } | null>(null);
  const finished = [...done].sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt)).slice(0, FINISHED_AT_REST);
  const runs = [...waiting, ...active, ...finished];
  const details = useRunDetails(runs);
  const arriving = useArrivals(runs.map(run => run.runId));
  const showAvatar = (run: RunSummary) => new Set(finished.filter(row => Boolean(row.practice) === Boolean(run.practice)).map(row => row.agent)).size > 1;
  const hostFor = (list: readonly RunSummary[]) => (node: HTMLUListElement | null) => {
    for (const run of list) {
      if (node) hosts.current.set(run.runId, node);
      else hosts.current.delete(run.runId);
    }
  };
  useLayoutEffect(() => {
    if (!root.current) return;
    const after = measureRows(root.current);
    if (before.current) flipFrom(root.current, before.current);
    before.current = after;
    const kept = focus.current;
    if (kept && document.activeElement !== kept.element) {
      const row = [...root.current.querySelectorAll<HTMLElement>('[data-run-id]')].find(element => element.dataset.runId === kept.id);
      const target = row?.contains(kept.element) ? kept.element : row?.querySelector<HTMLElement>('[data-open]');
      target?.focus({ preventScroll: true });
    }
  });
  const running = (list: RunSummary[]) => <RunTiles runs={list} names={names} queue={queue} onChanged={onChanged} primaryId={primaryId} listRef={hostFor(list)} renderRows={() => null} />;
  return (
    <div ref={root} className={s.runGroups} onFocusCapture={event => {
      const element = event.target as HTMLElement;
      const id = element.closest<HTMLElement>('[data-run-id]')?.dataset.runId;
      focus.current = id ? { id, element } : null;
    }} onBlurCapture={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) focus.current = null;
    }}>
      {waiting.length > 0 && running(waiting)}
      {active.length > 0 && running(active)}
      {(failures || done.length > 0) && <div className={s.pair}>
        {failures}
        {done.length > 0 && <Finished runs={done} moreHref={moreHref} onChanged={onChanged} renderRows={(list, label) => <ul ref={hostFor(list)} className={s.rows} aria-label={label} />} />}
      </div>}
      {runs.map(run => <MovingRun key={run.runId} id={run.runId} hosts={hosts.current} arriving={arriving.has(run.runId)}>
        {run.state === 'done'
          ? <RunRow as="div" run={run} detail={details[run.runId]} row={undefined} noRetry={false} showAvatar={showAvatar(run)} onChanged={onChanged} />
          : <RunTile as="article" run={run} detail={details[run.runId]} business={names.get(run.businessId)} queue={queue} onChanged={onChanged} primary={run.runId === primaryId} />}
      </MovingRun>)}
    </div>
  );
}
