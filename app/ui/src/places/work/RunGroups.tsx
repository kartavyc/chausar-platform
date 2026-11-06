import { Component, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { QueueRow, RunSummary } from '../../engine/types';
import { flipFrom, measureRows } from '../../parts/flip';
import { useArrivals } from '../../parts/useArrivals';
import { FINISHED_AT_REST, Finished, RunRow, useRunDetails } from './PreviousRuns';
import { RunTile, RunTiles } from './RunTiles';
import s from './Work.module.css';
import sLocal from './RunGroups.module.css';
import motion from '../../parts/Leave.module.css';

/** A run owns one list item. Only its host changes; React continues to own the portal's content. */
type Host = { element: HTMLUListElement; index: number };
type Focus = { id: string; element: HTMLElement } | null;

/** Read actual focus immediately before the DOM changes, never a remembered focus event. */
class RunFocus extends Component<{ root: RefObject<HTMLDivElement | null>; children: ReactNode }, object, Focus> {
  getSnapshotBeforeUpdate(): Focus {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || !this.props.root.current?.contains(element)) return null;
    const id = element.closest<HTMLElement>('[data-run-id]')?.dataset.runId;
    return id ? { id, element } : null;
  }
  componentDidUpdate(_props: unknown, _state: unknown, kept: Focus) {
    if (!kept || (document.activeElement && document.activeElement !== document.body)) return;
    const row = [...this.props.root.current!.querySelectorAll<HTMLElement>('[data-run-id]')].find(element => element.dataset.runId === kept.id);
    const target = row?.contains(kept.element) ? kept.element : row?.querySelector<HTMLElement>('[data-open]');
    target?.focus({ preventScroll: true });
  }
  render() { return <div ref={this.props.root} className={sLocal.runGroups}>{this.props.children}</div>; }
}

function MovingRun({ id, hosts, arriving, children }: {
  id: string; hosts: ReadonlyMap<string, Host>; arriving: boolean; children: ReactNode;
}) {
  const [row] = useState(() => {
    const element = document.createElement('li');
    element.dataset.runId = id;
    element.dataset.flipId = id;
    element.className = `${sLocal.runContainer} ${motion.arrive}`;
    return element;
  });
  useLayoutEffect(() => {
    if (arriving) row.dataset.arriving = '';
    else delete row.dataset.arriving;
    const host = hosts.get(id);
    if (host && host.element.children[host.index] !== row) host.element.insertBefore(row, host.element.children[host.index] ?? null);
    else if (!host) row.remove();
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
  const hosts = useRef(new Map<string, Host>());
  const before = useRef<Map<string, DOMRect> | null>(null);
  const finished = [...done].sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt)).slice(0, FINISHED_AT_REST);
  const runs = [...waiting, ...active, ...finished];
  const details = useRunDetails(runs);
  const arriving = useArrivals(runs.map(run => run.runId));
  const showAvatar = (run: RunSummary) => new Set(finished.filter(row => Boolean(row.practice) === Boolean(run.practice)).map(row => row.agent)).size > 1;
  const hostFor = (list: readonly RunSummary[]) => (node: HTMLUListElement | null) => {
    for (const [index, run] of list.entries()) {
      if (node) hosts.current.set(run.runId, { element: node, index });
      else hosts.current.delete(run.runId);
    }
  };
  useLayoutEffect(() => {
    if (!root.current) return;
    const after = measureRows(root.current);
    if (before.current) flipFrom(root.current, before.current);
    before.current = after;
  });
  const running = (list: RunSummary[]) => <RunTiles runs={list} names={names} queue={queue} onChanged={onChanged} primaryId={primaryId} listRef={hostFor(list)} renderRows={() => null} />;
  return (
    <RunFocus root={root}>
      {waiting.length > 0 && running(waiting)}
      {active.length > 0 && running(active)}
      {(failures || done.length > 0) && <div className={sLocal.pair}>
        {failures}
        {done.length > 0 && <Finished runs={done} moreHref={moreHref} onChanged={onChanged} renderRows={(list, label) => <ul ref={hostFor(list)} className={s.rows} aria-label={label} />} />}
      </div>}
      {runs.map(run => <MovingRun key={run.runId} id={run.runId} hosts={hosts.current} arriving={arriving.has(run.runId)}>
        {run.state === 'done'
          ? <RunRow as="div" run={run} detail={details[run.runId]} row={undefined} noRetry={false} showAvatar={showAvatar(run)} onChanged={onChanged} />
          : <RunTile as="article" run={run} detail={details[run.runId]} business={names.get(run.businessId)} queue={queue} onChanged={onChanged} primary={run.runId === primaryId} />}
      </MovingRun>)}
    </RunFocus>
  );
}
