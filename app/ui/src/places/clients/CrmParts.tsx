/**
 * W6 6G3 (D44): the pieces the client, company and list sheets share. A fold (closed until opened, so a sheet at rest
 * says little); the field history, each row in the engine's words with the values marked as quoted (they are the owner's
 * or the client's words) and its day; and the timeline, newest first, each entry the engine's line with the owner's own
 * words for what they logged.
 */

import type { ReactNode } from 'react';
import { useT } from '../../text';
import { Icon } from '../../parts/Icon';
import type { FieldChangeView, TimelineEntryView } from '../../engine/types';
import { useDay } from '../money/words';
import s from './Crm.module.css';

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function Fold({ summary, open, onToggle, children }: { summary: string; open?: boolean; onToggle?: (open: boolean) => void; children: ReactNode }) {
  return (
    <details className={s.more} open={open} onToggle={(event) => onToggle?.(event.currentTarget.open)}>
      <summary className={s.moreSummary}><Icon name="chevron-right" size={16} />{summary}</summary>
      <div className={s.moreBody}>{children}</div>
    </details>
  );
}

/** The field history, newest first. */
export function HistoryList({ rows }: { rows: readonly FieldChangeView[] }) {
  const t = useT();
  const day = useDay();
  return (
    <ul className={s.items} data-history="">
      {rows.map((row) => (
        <li key={row.id} className={s.item}>
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
  const t = useT();
  const day = useDay();
  if (!entries.length) return <p className={s.quiet}>{t('crm.timeline.none')}</p>;
  return (
    <ul className={s.items} data-timeline="">
      {entries.map((entry) => (
        <li key={entry.id} className={s.item} data-kind={entry.kind}>
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
