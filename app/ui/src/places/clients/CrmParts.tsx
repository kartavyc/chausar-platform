/**
 * W6 6G3 (D44): the pieces the client, company and list sheets share. A fold (closed until opened, so a sheet at rest
 * says little); the field history, each row in the engine's words with the values marked as quoted (they are the owner's
 * or the client's words) and its day; and the timeline, newest first, each entry the engine's line with the owner's own
 * words for what they logged.
 */

import type { ReactNode } from 'react';
import { useT } from '../../text';
import type { FieldChangeView, TimelineEntryView } from '../../engine/types';
import { useDay } from '../money/words';
import s from './Crm.module.css';
import { Fold } from '../../parts/Fold';
import { useArrivals } from '../../parts/useArrivals';
import { useFlip } from '../../parts/flip';
import motion from '../../parts/Leave.module.css';



export function CrmFold({ summary, open, onToggle, children }: { summary: string; open?: boolean; onToggle?: (open: boolean) => void; children: ReactNode }) {
  return (
    <Fold summary={summary} className={s.more} open={open} onToggle={(event) => onToggle?.(event.currentTarget.open)} summaryClassName={s.moreSummary}>
      <div className={s.moreBody}>{children}</div>
    </Fold>
  );
}

/** The field history, newest first. */
export function HistoryList({ rows }: { rows: readonly FieldChangeView[] }) {
  const arrivals = useArrivals(rows.map(row => row.id));
  const list = useFlip<HTMLUListElement>(rows.map(row => row.id).join(' '));
  const t = useT();
  const day = useDay();
  return (
    <ul ref={list} className={s.items} data-history="">
      {rows.map((row) => (
        <li key={row.id} className={`${s.item} ${motion.arrive}`} data-flip-id={row.id} data-arriving={arrivals.has(row.id) ? '' : undefined}>
          <span className={s.line}>
            {row.line}
            {row.after !== null && <>{': '}<span data-content="" className={s.words}>{row.after}</span></>}
            {row.before !== null && <>{' ('}{t('crm.history.was')}{' '}<span data-content="" className={s.words}>{row.before}</span>{')'}</>}
          </span>
          <span className={s.when}>{day(row.at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A timeline, newest first: the engine's line, and what the owner wrote for an entry they logged. */
export function TimelineList({ entries, names }: { entries: readonly TimelineEntryView[]; names?: ReadonlyMap<string, string> }) {
  const arrivals = useArrivals(entries.map(entry => entry.id));
  const list = useFlip<HTMLUListElement>(entries.map(entry => entry.id).join(' '));
  const t = useT();
  const day = useDay();
  if (!entries.length) return <p className={s.quiet}>{t('crm.timeline.none')}</p>;
  return (
    <ul ref={list} className={s.items} data-timeline="">
      {entries.map((entry) => (
        <li key={entry.id} className={`${s.item} ${motion.arrive}`} data-kind={entry.kind} data-flip-id={entry.id} data-arriving={arrivals.has(entry.id) ? '' : undefined}>
          <span className={s.line}>
            {names?.get(entry.clientId) && <span className={s.tag}>{names.get(entry.clientId)}{' '}</span>}
            {entry.line}
            {entry.text && <>{': '}<span data-content="" className={s.words}>{entry.text}</span></>}
          </span>
          <span className={s.when}>{day(entry.on)}</span>
        </li>
      ))}
    </ul>
  );
}
