/**
 * Today, Books view (TD-03): the queue as a table (what, party or account, as written in
 * the source, amount, since, then) and the month's close as a checklist with its state
 * and an action. Statuses come written from the engine.
 *
 * Each row has two separate controls: the button on its name opens the row, and the
 * amount's own button opens its receipt. Neither is inside the other, and the row itself
 * is not a control.
 *   Up / Down   move between the rows' buttons (roving tabindex)
 *   Enter       open the row: the button's own press, once
 *   Right       the row's amount; Left returns to the row
 * With no way to open a row, its name is plain text and the amount is a tab stop.
 */

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../../app/text';
import { PageHeader } from '../../app/PageHeader';
import { Square } from '../../parts/Square';
import { Figure, MissingWords } from '../../parts/Figure';
import { Button } from '../../parts/Button';
import { Chart } from '../../parts/charts/Chart';
import { State } from '../../patterns/States';
import type { TodayScreenProps } from './shared';
import { allowsTodayMutation, todayIntentsForState } from './permissions.ts';
import s from './Today.module.css';

const MAIN = '[data-queue-main]';
const RECEIPT = '[data-queue-receipt] button';

export function TodayBooks({ data, intents: offeredIntents, sheetId }: TodayScreenProps) {
  const intents = todayIntentsForState(data.state, offeredIntents);
  const canMutate = allowsTodayMutation(data.state);
  const t = useT();
  const titleId = useId();
  const closeId = useId();
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const queue = data.queue ?? [];
  const onOpenQueueRow = intents.onOpenQueueRow;
  const tabId = queue.some((q) => q.id === focusId) ? focusId : queue[0]?.id;

  const focusMain = (from: HTMLButtonElement, step: -1 | 1) => {
    const mains = Array.from(bodyRef.current?.querySelectorAll<HTMLButtonElement>(MAIN) ?? []);
    const el = mains[mains.indexOf(from) + step];
    if (!el) return;
    setFocusId(el.dataset['queueMain']);
    el.focus();
  };

  const onMainKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusMain(e.currentTarget, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusMain(e.currentTarget, -1);
    } else if (e.key === 'ArrowRight') {
      const receipt = e.currentTarget.closest('tr')?.querySelector<HTMLButtonElement>(RECEIPT);
      if (receipt) {
        e.preventDefault();
        receipt.focus();
      }
    }
  };

  /* Left from an amount returns to its row. Nothing else is handled at the table. */
  const onReceiptKey = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.key !== 'ArrowLeft' || !(e.target instanceof HTMLElement) || !e.target.matches(RECEIPT)) return;
    const main = e.target.closest('tr')?.querySelector<HTMLButtonElement>(MAIN);
    if (main) {
      e.preventDefault();
      main.focus();
    }
  };

  return (
    <div className={s.today}>
      <PageHeader where={data.date} title={t('TD-01.title')} titleId={titleId} count={data.review.count} />
      <State state={data.state} />

      {queue.length === 0 && data.state.kind === 'ready' ? (
        <State state={{ kind: 'empty' }} emptyKey="ST.empty.review" />
      ) : (
        <table className={s.table} aria-labelledby={titleId}>
          <thead>
            <tr>
              <th scope="col" className={s.thMark}>
                <span className="sr">{t('TD-03.col.state')}</span>
              </th>
              <th scope="col">{t('TD-03.col.what')}</th>
              <th scope="col">{t('TD-03.col.party')}</th>
              <th scope="col">{t('TD-03.col.asWritten')}</th>
              <th scope="col" className={s.num}>
                {t('TD-03.col.amount')}
              </th>
              <th scope="col">{t('TD-03.col.since')}</th>
              <th scope="col" className={s.end}>
                {t('TD-03.col.then')}
              </th>
            </tr>
          </thead>
          <tbody ref={bodyRef} onKeyDown={onReceiptKey}>
            {queue.map((q) => (
              <tr key={q.id} aria-current={q.id === sheetId ? 'true' : undefined} className={q.id === sheetId ? s.selected : ''}>
                <td className={s.tdMark}>
                  <Square mark={q.mark} wordsKey={q.markWordsKey} />
                </td>
                <th scope="row">
                  {onOpenQueueRow ? (
                    <button
                      type="button"
                      className={s.queueMain}
                      data-queue-main={q.id}
                      tabIndex={q.id === tabId ? 0 : -1}
                      onKeyDown={onMainKey}
                      onClick={(e) => onOpenQueueRow(q.id, e.currentTarget)}
                    >
                      {q.what}
                    </button>
                  ) : (
                    q.what
                  )}
                </th>
                <td>{q.party !== undefined ? q.party : q.partyMissing !== undefined ? <MissingWords missing={q.partyMissing} /> : null}</td>
                <td className={[s.asWritten, 'fig'].join(' ')}>{q.asWritten}</td>
                <td className={s.num} data-queue-receipt="">
                  {q.amount !== undefined && <Figure value={q.amount} onReceipt={intents.onReceipt} tabStop={onOpenQueueRow === undefined} />}
                </td>
                <td className={s.since}>{q.since}</td>
                <td className={[s.end, s.then].join(' ')}>{t(`TD-03.then.${q.then}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.close && (
        <section className={s.section} aria-labelledby={closeId}>
          <h2 id={closeId} className={s.label}>
            {t('TD-03.close', { month: data.close.month })}
          </h2>
          <ul className={s.close}>
            {data.close.steps.map((st) => (
              <li key={st.id} className={s.closeRow}>
                <Square mark={st.mark} />
                <span className={s.closeName}>{st.name}</span>
                <span className={[s.closeStatus, st.statusMono ? 'fig' : ''].join(' ')}>{st.status}</span>
                <span className={s.closeEnd}>
                  {st.chart ? (
                    <Chart chart={st.chart} onReceipt={intents.onReceipt} />
                  ) : canMutate && st.action ? (
                    <Button variant="link" onClick={st.action.onPress}>
                      {st.action.label}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
