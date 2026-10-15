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
import type { Mark } from '../../app/presentation.ts';
import type { TodayScreenProps } from './shared';
import { ClosingRow, attentionRows, useWorth, TodayReviewLink, TodayConsumerLedger, TodayProducerSections, TodayState } from './shared';
import { CLOSE_STEP_ORDER, type CloseStep, type CloseStepState } from './TodayData.ts';
import { allowsTodayMutation, todayIntentsForState } from './permissions.ts';
import { ClosingSwitch } from './ClosingSwitch';
import s from './Today.module.css';

const MAIN = '[data-queue-main]';

/** The square each close state shows beside its words. */
const CLOSE_MARK: Readonly<Record<CloseStepState, Mark>> = {
  done: 'cha',
  'in-progress': 'busy',
  'not-started': 'off',
  'needs-you': 'you',
  'not-applicable': 'off',
  'not-loaded-yet': 'off',
  'not-sure': 'unsure',
  failed: 'unsure',
};

/** The close as its four fixed rows, in order, when the steps name them: a fixed step the
 *  engine did not send is "not loaded yet", never left out. Steps outside the four keep
 *  their place after them. Without step kinds the steps show as supplied. */
export function closeRows(steps: ReadonlyArray<CloseStep>): ReadonlyArray<CloseStep> {
  if (!steps.some((st) => st.step !== undefined)) return steps;
  const fixed = CLOSE_STEP_ORDER.map((kind): CloseStep => steps.find((st) => st.step === kind) ?? { id: `close:${kind}`, mark: 'off', step: kind, state: 'not-loaded-yet' });
  return [...fixed, ...steps.filter((st) => st.step === undefined)];
}
const RECEIPT = '[data-queue-receipt] button';

export function TodayBooks({ data, intents: offeredIntents, sheetId, onNavigate }: TodayScreenProps) {
  const intents = todayIntentsForState(data.state, offeredIntents);
  const canMutate = allowsTodayMutation(data.state);
  const t = useT();
  const titleId = useId();
  const closeId = useId();
  const worthId = useId();
  const worthSource = useWorth(data, intents, 'books', onNavigate);
  const worthCut = attentionRows(data, [], worthSource.rows, worthSource.showAll);
  /* With a checked reply the worth rows are a table here; legacy rows stay in the ledger. */
  const worthRows = data.worth ? worthCut.worth : [];
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
      <div className={s.lead}>
      <PageHeader where={data.date} title={t('TD-01.title')} titleId={titleId} count={data.review.count} aside={<TodayReviewLink data={data} intents={intents} />} />
      <TodayState state={data.state} />
      <TodayConsumerLedger data={data} intents={intents} />
      </div>
      {data.queueMissing !== undefined && <p className={s.missing}>{t('TODAY_ENGINE.queueMissing')}</p>}
      <ClosingRow data={data} />
      <ClosingSwitch data={data} intents={intents} />

      {/* A table is drawn only with rows in it: column headers over no cells say nothing (axe th-has-data-cells). */}
      {queue.length === 0 ? (
        data.state.kind === 'ready' && <State state={{ kind: 'empty' }} emptyKey="ST.empty.review" />
      ) : (
        <div className={s.tableBox} tabIndex={0} role="group" aria-labelledby={titleId}>
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
        </div>
      )}

      {data.waiting !== undefined && <p className={s.quiet}>{t('TD-03.waiting', { holder: data.waiting.holder, what: data.waiting.what })}</p>}

      {data.worth !== undefined && (
        <section className={s.section} aria-labelledby={worthId}>
          <h2 id={worthId} className={s.label}>
            {t('TD-01.worth')}
          </h2>
          {worthSource.missing !== undefined ? (
            <p className={s.missing}>
              <MissingWords missing={worthSource.missing} />
            </p>
          ) : (
            worthRows.length > 0 && (
              <div className={s.tableBox} tabIndex={0} role="group" aria-labelledby={worthId}>
              <table className={s.table} aria-labelledby={worthId}>
                <thead>
                  <tr>
                    <th scope="col" className={s.thMark}>
                      <span className="sr">{t('TD-03.col.state')}</span>
                    </th>
                    <th scope="col">{t('TD-03.col.what')}</th>
                    <th scope="col">{t('TD-03.col.asWritten')}</th>
                    <th scope="col" className={s.num}>
                      {t('TD-03.col.amount')}
                    </th>
                    <th scope="col" className={s.end}>
                      {t('TD-01.worth.col.when')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {worthRows.map((w) => (
                    <tr key={w.id}>
                      <td className={s.tdMark}>
                        <Square mark={w.mark} wordsKey={w.markWordsKey} />
                      </td>
                      <th scope="row">
                        {worthSource.opens(w) ? (
                          <button type="button" className={s.queueMain} onClick={(e) => worthSource.onOpen(w.id, e.currentTarget)}>
                            {w.what}
                          </button>
                        ) : (
                          w.what
                        )}
                      </th>
                      <td className={[s.asWritten, 'fig'].join(' ')}>{w.asWritten}</td>
                      <td className={s.num}>{w.figure !== undefined && <Figure value={w.figure} onReceipt={intents.onReceipt} tabStop />}</td>
                      <td className={[s.end, s.since].join(' ')}>{w.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )
          )}
          {(worthCut.hidden > 0 || worthSource.showAll) && worthSource.missing === undefined && (
            <Button variant="link" onClick={worthSource.toggle}>
              {worthSource.showAll ? t('TD-01.worth.fewer') : t('TD-01.worth.seeAll', { count: String(worthCut.offered) })}
            </Button>
          )}
        </section>
      )}

      {data.close && (
        <section className={s.section} aria-labelledby={closeId}>
          <h2 id={closeId} className={s.label}>
            {t('TD-03.close', { month: data.close.month })}
          </h2>
          <ul className={s.close}>
            {closeRows(data.close.steps).map((st) => (
              <li key={st.id} className={s.closeRow} data-close-step={st.step}>
                <Square mark={st.state !== undefined ? CLOSE_MARK[st.state] : st.mark} wordsKey={st.state !== undefined ? `TD-03.close.state.${st.state}` : undefined} />
                <span className={s.closeName}>{st.step !== undefined ? t(`TD-03.close.step.${st.step}`) : st.name}</span>
                <span className={[s.closeStatus, st.statusMono ? 'fig' : ''].join(' ')}>
                  {/* The square's own words are read; this is the same state, shown. */}
                  {st.state !== undefined && <span aria-hidden="true">{t(`TD-03.close.state.${st.state}`)}</span>}
                  {st.state === 'not-applicable' && st.notApplicable !== undefined && <span className={s.closeReason}>{t(`TD-03.close.na.${st.notApplicable}`)}</span>}
                  {st.status !== undefined && st.status.length > 0 && <span className={st.state !== undefined ? s.closeReason : undefined}>{st.status}</span>}
                </span>
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
      {data.closeMissing !== undefined && <p className={s.missing}>{t('TODAY_ENGINE.closeMissing')}</p>}
      <p className={s.keys}>{t('TD-03.keys')}</p>
      <TodayProducerSections data={data} intents={intents} />
    </div>
  );
}
