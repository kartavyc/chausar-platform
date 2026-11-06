import { useId, useState } from 'react';
import { useT } from '../text';
import { Button } from './Button';
import type { QueueRow } from '../engine/types';
import s from './RunNeeds.module.css';

/**
 * The run sheet's banner when a run waits on the owner for more than one thing (W4 4G4, O11): "3 things need you (1 of
 * 3)", the title of the one in view, Previous and Next to move between them, and "Decide this one", which opens it on
 * the approval page, where it is decided exactly as on Today. One thing or none needs no banner: the sheet already
 * shows its question.
 */
export function RunNeeds({ rows }: { rows: readonly QueueRow[] }) {
  const t = useT();
  const headingId = useId();
  const [index, setIndex] = useState(0);
  if (rows.length < 2) return null;
  const at = Math.min(index, rows.length - 1);
  const row = rows[at]!;
  return (
    <section className={s.needs} aria-labelledby={headingId} data-run-needs="">
      <h3 id={headingId} className={s.head}>{t('approve.run.banner', { count: rows.length, index: at + 1 })}</h3>
      <p className={s.title} aria-live="polite">{row.title}</p>
      <div className={s.jumps}>
        <Button size="sm" disabled={at === 0} onClick={() => setIndex(at - 1)}>{t('approve.run.previous')}</Button>
        <Button size="sm" disabled={at === rows.length - 1} onClick={() => setIndex(at + 1)}>{t('approve.run.next')}</Button>
        <a className={s.decide} href={`#/approve/${row.id}`}>{t('approve.run.decide')}</a>
      </div>
    </section>
  );
}
