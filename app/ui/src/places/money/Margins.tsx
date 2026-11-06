/**
 * Margins per client (W4 4J4, M8; venture.money.margins): for the month chosen above the page, what each client was
 * invoiced before tax, the AI and tool spend of their orders, and what that leaves, each figure with its receipt. The
 * spend is tagged by code (a call to its run, the run to its order, the order to its client), and the margin is in one
 * currency only: the spend in rupees at the owner's own rate, said beside it, or "Not counted" with the engine's reason
 * when no rate is set. What the total left out is said in the engine's words.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { EmptyState } from '../../parts/EmptyState';
import { Figure } from '../../parts/Figure';
import { SectionHead, Tile } from '../../parts/Tile';
import type { KindedFigure } from '../../engine/types';
import { EngineWords, Failed } from './parts';
import { onMoney, onRuns, useMonthWords } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

const onMargins = (event: Parameters<typeof onMoney>[0]) => onMoney(event) || onRuns(event);

export function Margins({ month }: { month: string }) {
  const t = useT();
  const id = useId();
  const monthWords = useMonthWords();
  const margins = useResource('venture.money.margins', { month }, { refreshOn: onMargins });
  const view = margins.data;
  return (
    <section className={s.section} aria-labelledby={id}>
      <SectionHead id={id} title={t('money.margins.title', { month: monthWords(month) })} />
      {margins.error && <Failed error={margins.error} />}
      {view && view.rows.length === 0 && <Tile><EmptyState title={t('money.margins.none')} /></Tile>}
      {view && view.rows.length > 0 && (
        <Tile pad="none" className={s.tableTile}>
          <table className={v.table} role="table">
            <caption className="sr-only">{t('money.margins.caption', { month: monthWords(month) })}</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">{t('money.table.client')}</th>
                <th scope="col" role="columnheader">{t('money.margins.invoiced')}</th>
                <th scope="col" role="columnheader">{t('money.margins.spend')}</th>
                <th scope="col" role="columnheader">{t('money.margins.margin')}</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {view.rows.map((row) => (
                <tr key={row.clientId} role="row">
                  <th scope="row" role="rowheader" className={v.client}>{row.client}</th>
                  <td role="cell" data-label={t('money.margins.invoiced')}><Kinded figure={row.invoiced} /></td>
                  <td role="cell" data-label={t('money.margins.spend')}>{row.spend ? <Kinded figure={row.spend} /> : <span className={v.quiet}>{t('money.margins.notCounted')}</span>}</td>
                  <td role="cell" data-label={t('money.margins.margin')}>{row.margin ? <Kinded figure={row.margin} /> : <span className={v.quiet}>{t('money.margins.notCounted')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tile>
      )}
      {view && (
        <div className={v.basis}>
          {/* The engine's sentence: the month, before tax, and the rate the spend was counted at (or why it was not). */}
          <p><EngineWords>{view.line}</EngineWords></p>
          {view.basis.notCounted && <p>{view.basis.notCounted.line}</p>}
        </div>
      )}
    </section>
  );
}

/** A margin figure with its receipt. */
function Kinded({ figure }: { figure: KindedFigure }) {
  return <Figure value={figure.display} receiptId={figure.receiptId} />;
}
