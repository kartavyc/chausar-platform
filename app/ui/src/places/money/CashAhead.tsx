/**
 * Cash, next 13 weeks (D-Money `.cash`; W4 4J4 venture.money.cash): what is in the bank today, from the latest bank
 * statement (a reported figure, its file row named), then the weeks ahead if clients pay on time, drawn as the actual
 * point and the dashed forecast. Every figure ahead is a projection, and says so; the two lowest weeks (if clients pay
 * on time, and if the late ones never pay) each carry their own receipt; the assumptions the forecast takes are listed
 * under the chart in the engine's words. Without a bank statement there is no line and no figure, only a way to import
 * one. Nothing here is worked out: the engine sends every figure and every point.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { CashLine } from '../../parts/charts/CashLine';
import type { CashData } from '../../parts/charts/types';
import { Figure } from '../../parts/Figure';
import { Tile, TileHead, type TileSpan } from '../../parts/Tile';
import type { CashView, KindedFigure } from '../../engine/types';
import { useDay } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';
import vLocal from './CashAhead.module.css';

export function CashAhead({ cash, view, span }: { cash: CashData | undefined; view: CashView | undefined; span: TileSpan }) {
  const t = useT();
  const id = useId();
  const day = useDay('short');
  const late = view?.lowest.ifLateNeverPay;
  const issue = view?.ifIssued?.[0];
  return (
    <Tile as="section" labelledBy={id} span={span} className={v.cash}>
      <TileHead id={id} title={t('money.cash.title')} />
      {view && view.bank && (
        <dl className={v.stats}>
          {/* At rest: the figures and when; the statement day the balance comes from is in its receipt. */}
          <Stat label={t('money.cash.bank')} figure={view.bank} mark="today" />
          {view.lowest.onTime && <Stat label={t('money.cash.lowest')} figure={view.lowest.onTime} sub={day(view.lowest.onTime.week)} mark="line" />}
          {late && <Stat label={t('money.cash.ifLate')} figure={late} sub={day(late.week)} mark="dashed" />}
        </dl>
      )}
      {/* C4 T28: why a line with nothing due in or out stays flat, in the engine's words. */}
      {view?.flat && <p className={s.quietLine} data-flat="">{view.flat}</p>}
      {/* The line, and what the forecast assumes one step away (simple first, 4J20). */}
      {cash && <div className={s.tileChart}><CashLine data={{ ...cash, assumptions: [] }} tips={false}
        detailsLabel={t('money.cash.assumes')}
        details={cash.assumptions.length > 0 ? <ul className={vLocal.assumes}>{cash.assumptions.map(line => <li key={line}>{line}</li>)}</ul> : undefined}
      /></div>}
      {view && view.points.length === 0 && (
        <div className={vLocal.empty}>
          <p className={s.quietLine}>{t('money.cash.noStatement')}</p>
          <Button size="sm" onClick={(event) => openSheet('bank-import', 'statement', event.currentTarget)}>{t('money.cash.import')}</Button>
        </div>
      )}
      {/* 4J20: what issuing the first draft today brings in, and in which week, proved by its price receipt. */}
      {issue && (
        <p className={vLocal.issue} data-if-issued="">
          <span>{t('money.cash.issue', { client: issue.client })}</span>
          <Figure value={issue.amount.display} receiptId={issue.amount.receiptId} />
          <span>{t('money.cash.issueWeek', { date: day(issue.week) })}</span>
          <a className={`${s.more} ${vLocal.issueLink}`} href="#/today">{t('money.cash.onToday')}</a>
        </p>
      )}
    </Tile>
  );
}

/** One figure above the chart: its words, the figure with its receipt, and "Projected" when it is a forecast. */
function Stat({ label, figure, sub, mark }: { label: string; figure: KindedFigure; sub?: string | undefined; mark: 'today' | 'line' | 'dashed' }) {
  const t = useT();
  return (
    <div className={v.stat}>
      <dt className={v.statLabel}>
        <span className={vLocal.key} data-mark={mark} aria-hidden="true" />
        {label}
      </dt>
      <dd className={v.statValue}>
        <Figure value={figure.display} receiptId={figure.receiptId} size="tile" />
      </dd>
      {(sub || figure.projected) && (
        <dd className={v.statSub}>
          {sub}
          {figure.projected && <span className={v.projected} data-projected="">{t('money.projected')}</span>}
        </dd>
      )}
    </div>
  );
}
