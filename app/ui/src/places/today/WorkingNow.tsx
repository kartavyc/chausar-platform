import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import type { VentureRunEvent } from '../../engine/types';
import s from './Today.module.css';

const RUN_EVENTS = (event: VentureRunEvent) => event.type.startsWith('run.') || event.type === 'queue.changed';

/** Put focus on a row of the page by its id, and bring it into view. */
export function focusRow(id: string): void {
  const row = [...document.querySelectorAll<HTMLElement>('[data-row-id]')].find((el) => el.getAttribute('data-row-id') === id);
  if (!row) return;
  row.focus();
  row.scrollIntoView({ block: 'nearest' });
}

/**
 * "Working now": one line per active run, agent, purpose and the elapsed time the engine gives. A run paused on the
 * owner says "Waiting on you" in place of its timer, which stops, and those words take you to the row that answers
 * it. The purpose opens the run sheet. Nothing running, nothing shown.
 */
export function WorkingNow({ rowForRun }: { rowForRun: (runId: string) => string | undefined }) {
  const t = useT();
  const headingId = useId();
  const runs = useResource('venture.runs.list', { state: 'active' }, { refreshOn: RUN_EVENTS });
  const active = runs.data?.runs ?? [];
  if (active.length === 0) return null;

  return (
    <section className={s.working} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.heading}>{t('jobs.active')}</h2>
      <ul className={s.list}>
        {active.map((run) => {
          const waiting = run.state === 'waiting';
          const rowId = waiting ? rowForRun(run.runId) : undefined;
          return (
            <li key={run.runId} className={s.work} data-row="" data-row-id={`run-${run.runId}`} tabIndex={-1}>
              <span className={s.agent}>{run.agent}</span>
              <button type="button" className={s.purpose} data-open="" onClick={(event) => openSheet('run', run.runId, event.currentTarget)}>
                {run.purpose}
              </button>
              {!waiting && <span className={`${s.elapsed} mono`}>{run.elapsed}</span>}
              {waiting && (rowId ? (
                <button type="button" className={s.wait} onClick={() => focusRow(rowId)}>
                  {t('run.waiting')}
                  <span className="sr-only">{t('today.toRow')}</span>
                </button>
              ) : <span className={s.wait}>{t('run.waiting')}</span>)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
