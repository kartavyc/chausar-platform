/**
 * Round-4 parts shared by the Work pages: live refresh through the host's `subscribe` (when it
 * has one), links to the Work pages other lanes add, a core action's practice, the route meters
 * and child tasks of a job. Display only: amounts are formatted, never computed.
 */
import { useEffect, useRef } from 'react';
import type { Language } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { laneSubPlaces } from '../../places/subplaces/index.ts';
import { laneWords } from '../../text/lanes/index.ts';
import { Label } from '../../parts/Label';
import { Steps } from '../../parts/Steps';
import { amountText, dayTime } from './kit/format.ts';
import { missingWord } from './kit/words.ts';
import { Actions, Button, Note, pageStyles } from './kit/Page';
import type { ChildTask, Children, PracticeR4, RouteMeter } from './contract-r4.ts';
import { stepItems } from './shared.tsx';
import { r4Words, sayR4, type R4Words } from './text-r4.ts';
import s from './work.module.css';

/**
 * Live refresh (core-sync-jobs): when the host gives places `subscribe(kinds, onEvent)`, a page
 * re-reads on a matching engine event. Without it nothing is subscribed and the page re-reads
 * after each change, as before. The call returns a function that stops the subscription.
 */
type Subscribe = (kinds: readonly string[], onEvent: (event: unknown) => void) => (() => void) | void;
export function useLive(p: PlaceRenderProps, kinds: readonly string[], onEvent: () => void): void {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  const subscribe = (p as PlaceRenderProps & { readonly subscribe?: Subscribe }).subscribe;
  const key = kinds.join(',');
  useEffect(() => {
    if (typeof subscribe !== 'function') return undefined;
    let stop: unknown;
    try { stop = subscribe(key.split(','), () => ref.current()); } catch { return undefined; }
    return () => { if (typeof stop === 'function') (stop as () => void)(); };
  }, [subscribe, key]);
}
/** The engine event kinds each Work page follows (WK-01 the queue, WK-04 one action, WK-07 the jobs). */
export const LIVE = { approvals: ['approvals', 'actions', 'jobs', 'writeback'], action: ['actions', 'writeback'], jobs: ['jobs'] } as const;

/** The Work sub-places the named lanes added (places/subplaces/<lane>.ts), each named in that lane's own words. */
export function otherLanePages(lanes: readonly string[], language: Language): { lane: string; id: string; name: string }[] {
  return lanes.flatMap(lane => (laneSubPlaces[lane] ?? []).filter(sp => sp.place === 'work').map(sp => {
    const key = `SH-01.sub.work.${sp.id}`;
    const catalogue = laneWords[lane];
    const name = catalogue?.[language]?.[key] ?? catalogue?.en?.[key] ?? sp.id;
    return { lane, id: sp.id, name };
  }));
}
/** Links to other lanes' Work pages; nothing is drawn when they have added none. */
export function LanePageLinks({ p, lanes, title }: { p: PlaceRenderProps; lanes: readonly string[]; title: string }) {
  const pages = otherLanePages(lanes, p.language);
  if (pages.length === 0) return null;
  return (
    <nav className={s.block} aria-label={title} data-lane-links={lanes.join(' ')}>
      <h3 className={s.h}>{title}</h3>
      <Actions>{pages.map(page => <Button key={`${page.lane}/${page.id}`} variant="link" onClick={() => p.navigate({ place: 'work', sub: page.id })}>{page.name}</Button>)}</Actions>
    </nav>
  );
}

/** WK-02: a core action's practice: the exact request, what doing it would do, the steps as practice. Nothing ran. */
export function CorePracticeBlock({ tried, language, r }: { tried: PracticeR4; language: Language; r: R4Words }) {
  const outcome = tried.outcome === 'refused' ? sayR4(r, 'practice.outcome.refused', { code: tried.code ?? 'REQUEST_FAILED' })
    : tried.outcome === 'would-create-local-draft' ? r['practice.outcome.would-create-local-draft'] : r['practice.outcome.checked-not-run'];
  return (
    <div className={s.block} data-part="core-practice">
      <p className={s.meta}><Label kind="practice" /> {r['practice.core.title']}</p>
      <Note>{r['practice.core.note']}</Note>
      <Note>{outcome}</Note>
      {tried.request !== undefined && Object.keys(tried.request).length > 0 && (
        <>
          <h4 className={s.h}>{r['practice.request']}</h4>
          <table className={pageStyles.table}><tbody>{Object.entries(tried.request).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td><code>{v}</code></td></tr>)}</tbody></table>
        </>
      )}
      {tried.wouldSend !== null && <pre className={s.asWritten}>{tried.wouldSend}</pre>}
      <Steps steps={stepItems(tried.steps, language)} />
    </div>
  );
}

/** WK-08: one line per model route: a local model at zero with its minutes, an estimate labelled, an untested route said apart. */
export function routeLine(m: RouteMeter, r: R4Words, language: Language): string {
  const cost = m.basis === 'zero' ? r['routes.zero'] : m.basis === 'estimate' ? sayR4(r, 'routes.estimate', { amount: amountText(m.spent, language) }) : amountText(m.spent, language);
  const minutes = m.minutes === null ? (m.basis === 'zero' ? r['routes.noMinutes'] : null) : sayR4(r, 'routes.minutes', { n: m.minutes });
  return [`${m.routeId}: ${cost}`, minutes, m.tested ? null : r['routes.untested']].filter((x): x is string => x !== null).join(' · ');
}
export function RouteMeters({ routes, untestedStop, language }: { routes: readonly RouteMeter[]; untestedStop: { at: string; reason: string } | null | undefined; language: Language }) {
  const r = r4Words(language);
  if (routes.length === 0 && !untestedStop) return null;
  return (
    <div className={s.block} data-part="routes">
      <h3 className={s.h}>{r['routes.title']}</h3>
      {untestedStop && <Note>{`${r['routes.untestedStop']} ${untestedStop.reason} (${dayTime(untestedStop.at, language)})`}</Note>}
      <ul className={s.list}>
        {routes.map(m => <li key={m.routeId} className={s.item} data-route={m.routeId} data-route-state={m.tested ? m.basis : 'untested'}><span className={s.fig}>{routeLine(m, r, language)}</span></li>)}
      </ul>
    </div>
  );
}

/** WK-08: child task results; a child with no result says so, never shown as zero. */
export function ChildTasks({ value, language, onReceipt }: { value: Children; language: Language; onReceipt: (id: string) => void }) {
  const r = r4Words(language);
  return (
    <div className={s.block} data-part="children">
      <h3 className={s.h}>{r['children.title']}</h3>
      {!value.available ? <Note>{r['children.notBuilt']}</Note> : value.items.length === 0 ? <Note>{r['children.none']}</Note> : (
        <ul className={s.list}>{value.items.map((c: ChildTask) => (
          <li key={c.id} className={s.item} data-child={c.id}>
            <div>
              <span>{c.title}</span>
              <p className={s.meta}>{c.result === null ? r['children.missing'] : sayR4(r, 'children.result', { done: c.result.done.length, open: c.result.open.length })}</p>
              {c.result !== null && c.result.receiptIds.length > 0 && <Actions>{c.result.receiptIds.map((id, i) => <Button key={id} variant="link" onClick={() => onReceipt(id)}>{`${r['children.receipts']} ${i + 1}`}</Button>)}</Actions>}
            </div>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

export { missingWord };
