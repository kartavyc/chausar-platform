/**
 * Money at a glance (D-Money, row by row): what was invoiced, what came in and what AI cost; who owes you, by age; in
 * and out by month; cash over the next 13 weeks and what is due in or out in the next three. Every figure is the
 * engine's own text with its receipt, or the "model estimate" label when a model wrote it; a figure that comes with no
 * receipt is left out, never shown bare. Nothing is added up here.
 *
 * Reads: venture.money.overview (owed, received, spent, each with its receipt); venture.books.summary for the month
 * chosen above the page (?month=2026-09; this month when none), with last month beside it (4J4 `previous`);
 * venture.goals.get for that month's goal and its bar (W4 4I2); and the money views (views.ts: the spend split by
 * department, owed by age, in and out by month and cash ahead, W4 4A2 and 4J4). Owed and cash are as of today whatever
 * month is chosen; the chosen month moves Invoiced and Received. A view the engine does not have yet is left out, and
 * no sentence promises it.
 */

import { useId, type ReactNode } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { useRoute } from '../../shell/navigation';
import { BarChart } from '../../parts/charts/BarChart';
import { CashLine } from '../../parts/charts/CashLine';
import { GoalBar } from '../../parts/charts/GoalBar';
import { SplitBar } from '../../parts/charts/SplitBar';
import { Bento, Tile, TileHead, type TileSpan } from '../../parts/Tile';
import type { BooksFigureLite, BooksSummaryLite, FlowView, MoneyOverviewLine, VentureRunEvent } from '../../engine/types';
import { CashAhead } from './CashAhead';
import { DueNext } from './DueNext';
import { NextWeeks } from './NextWeeks';
import { OwedTile } from './OwedTile';
import { splitFigure } from '../../parts/Figure';
import { Failed, MoneyTile, ProvedFigure, isPhrase, lineProof, spendShown } from './parts';
import { useMoneyViews, type FlowData, type MoneyViews } from './views';
import { byDue, onMoney, onRuns, useChosenMonth, useMonthWords } from './words';
import { GOAL_EVENTS, goalFromView } from '../today/goal';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

/** The overview moves when money does (an invoice issued, a payment recorded) and when a paid call settles. */
const onOverview = (event: VentureRunEvent) => onMoney(event) || onRuns(event);

/** A closed fold under the headline tiles: its title is all it shows until the owner opens it. */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className={v.moreFold}>
      <summary className={v.moreSummary}>{title}</summary>
      {children}
    </details>
  );
}

/** `views`: the chart data, given by a test or a specimen; left out, the views the engine sends. */
export function Overview({ views: given }: { views?: MoneyViews | undefined }) {
  const t = useT();
  const route = useRoute();
  const { month, thisMonth } = useChosenMonth(route.query);
  const sent = useMoneyViews();
  const views = given ?? sent;
  const overview = useResource('venture.money.overview', {}, { refreshOn: onOverview });
  const books = useResource('venture.books.summary', { period: month === thisMonth ? 'this-month' : month }, { refreshOn: onMoney });
  const line = (id: MoneyOverviewLine['id']) => overview.data?.lines.find((item) => item.id === id);
  const billed = books.data?.figures.find((figure) => figure.operation === 'billed');
  const open = books.data ? byDue(books.data.openInvoices) : undefined;
  const { flow, cash } = views;
  const cashView = views.engine?.cash;
  const ahead = cash !== undefined || cashView !== undefined;

  // Due next is the three weeks ahead once the engine sends them (4J4), else the open invoices due from today on.
  const next = (span: TileSpan) => (cashView
    ? <NextWeeks cash={cashView} span={span} />
    : <DueNext line={line('owed')} open={open} today={books.data?.today} span={span} />);

  return (
    <section className={`${s.overview} ${v.page}`} aria-label={t('money.sub.overview')}>
      {overview.error && <Failed error={overview.error} />}
      {books.error && <Failed error={books.error} />}
      {views.failed && <Failed error={views.failed} />}
      <Bento className={`${s.glance} ${v.glanceRow}`}>
        <InvoicedTile billed={billed} goal={views.goal} month={month === thisMonth ? null : month} />
        <ReceivedTile line={month === thisMonth ? line('received') : undefined} books={books.data} chosen={month === thisMonth ? null : month} />
        <SpendTile line={line('spent')} split={views.split} />
      </Bento>
      {/* Simple first (4J20): the headline tiles; owed with what the late ones owe, and cash ahead beside it. */}
      <Bento className={v.pairRow}>
        <OwedTile line={line('owed')} open={open} aging={views.aging} agingView={views.engine?.aging} span={5} />
        {ahead ? <CashAhead cash={cash} view={cashView} span={7} /> : next(7)}
      </Bento>
      {/* One step away, closed: in and out by month, and what is due in the next three weeks. */}
      {(flow || ahead) && (
        <div className={v.more}>
          {flow && <Fold title={t('money.fold.flow')}><Bento><InOutTile flow={flow} notes={views.engine?.flow} span={12} /></Bento></Fold>}
          {ahead && <Fold title={cashView ? t('money.fold.weeks') : t('money.next.title')}><Bento>{next(12)}</Bento></Fold>}
        </div>
      )}
    </section>
  );
}

/**
 * What was invoiced in the month (W4 4I2, venture.goals.get): the goals view's invoiced figure, before tax, with its
 * receipt. With a goal: "of" the goal, the engine's percent, the bar, days left in the header pill and the foot (ready
 * to issue, ahead or behind pace, past the goal by) where the engine sends those figures, each with its receipt.
 * Without the goals view (an engine without goals), the books' billed figure under the books' own label, never passed
 * off as the goal's; with neither, nothing. `month`: another month chosen above the page; null for this one.
 */
function InvoicedTile({ billed, goal, month }: { billed: BooksFigureLite | undefined; goal: MoneyViews['goal']; month: string | null }) {
  const t = useT();
  const monthWords = useMonthWords();
  const goals = useResource('venture.goals.get', month ? { month } : {}, { refreshOn: GOAL_EVENTS });
  const view = goals.data;
  const data = view ? goalFromView(view, { month: '', lastMonth: '' }, t) : null;
  const target = data?.state === 'set' ? data : null;
  const books = !view && goals.error ? billed : undefined;
  const bar = target?.bar ?? goal;
  const ready = view && view.ready.receiptId ? { value: view.ready.display, receiptId: view.ready.receiptId } : null;
  const pace = view?.paceBy && view.pace ? view.paceBy : null;
  const pastBy = view?.past && view.pastBy ? view.pastBy : null;
  return (
    <MoneyTile
      label={month ? t('money.tile.invoicedIn', { month: monthWords(month) }) : t('money.tile.invoiced')} icon="target" span={5}
      aside={target && !month ? <span className={s.tilePill} data-pill="">{target.daysLeft}</span> : undefined}
    >
      {data?.invoiced && (
        <div className={s.tileValue}>
          <ProvedFigure value={data.invoiced.value} proof={{ receiptId: data.invoiced.receiptId! }} size="stat" />
        </div>
      )}
      {books && (
        <>
          <div className={s.tileValue}>
            <ProvedFigure value={books.display} proof={{ receiptId: books.receiptId }} size="stat" />
          </div>
          <p className={s.tileSub}>
            <span data-books-label="">{books.label}</span>
            {books.stale && <> <span className={s.stale}>{t('money.changed')}</span></>}
          </p>
        </>
      )}
      {target && (
        <p className={s.goalOf}>
          {t('today.goal.of')}
          <ProvedFigure value={target.goal.value} proof={{ receiptId: target.goal.receiptId! }} />
          <span className={s.goalPercent}>{target.percent}</span>
        </p>
      )}
      {bar && <div className={s.tileChart}><GoalBar data={bar} tone="light" /></div>}
      {target && !month && (ready || pace || pastBy) && (
        <p className={s.goalFoot} data-goal-foot="">
          {ready && <span className={s.goalFootItem}><ProvedFigure value={ready.value} proof={{ receiptId: ready.receiptId }} />{t('money.goal.ready')}</span>}
          {pace && <span className={s.goalFootItem}><ProvedFigure value={pace.display} proof={{ receiptId: pace.receiptId }} />{t(view?.pace === 'ahead' ? 'money.goal.ahead' : 'money.goal.behind')}</span>}
          {pastBy && <span className={s.goalFootItem}>{t('today.goal.foot.past')}<ProvedFigure value={pastBy.display} proof={{ receiptId: pastBy.receiptId }} /></span>}
        </p>
      )}
    </MoneyTile>
  );
}

/**
 * What came in: this month's overview line, or the books' received figure for another month chosen above the page;
 * and under it, what came in the month before, from the books (4J4 `previous`), each with its own receipt.
 */
function ReceivedTile({ line, books, chosen }: { line: MoneyOverviewLine | undefined; books: BooksSummaryLite | undefined; chosen: string | null }) {
  const t = useT();
  const monthWords = useMonthWords();
  const proof = lineProof(line);
  const received = chosen ? books?.figures.find((figure) => figure.operation === 'received') : undefined;
  const before = books?.previous?.figures.find((figure) => figure.operation === 'received');
  return (
    <MoneyTile label={t('money.tile.received')} icon="wallet" span={3}>
      {line && proof && (
        <div className={s.tileValue}>
          <ProvedFigure value={line.value} proof={proof} size="stat" />
        </div>
      )}
      {received && (
        <div className={s.tileValue}>
          <ProvedFigure value={received.display} proof={{ receiptId: received.receiptId }} size="stat" />
        </div>
      )}
      <p className={s.tileSub}>{chosen ? monthWords(chosen) : t('money.tile.thisMonth')}</p>
      {before && books?.previous && (
        <p className={v.before} data-previous="">
          <span>{monthWords(books.previous.month)}</span>
          <ProvedFigure value={before.display} proof={{ receiptId: before.receiptId }} />
        </p>
      )}
    </MoneyTile>
  );
}

/**
 * What AI and tools cost this month, in rupees too at the owner's own rate; each call is one step away, on Spend. When
 * the engine writes only words ("No price"), the figure is set smaller, in the body face,
 * and wraps inside the tile (`data-phrase`), so words never run in a typewriter face past the tile's edge.
 */
function SpendTile({ line, split }: { line: MoneyOverviewLine | undefined; split: MoneyViews['split'] }) {
  const t = useT();
  const proof = lineProof(line);
  // 4Z3: the figure as the engine says it leads (rupees or dollars first), the other currency beneath it.
  const shown = line && spendShown(line.lead, line.value, line.rupees);
  // Words after an amount are the Figure's own (splitFigure); only words with no amount at all are a phrase.
  const phrase = shown !== undefined && isPhrase(splitFigure(shown.value).amount);
  return (
    <MoneyTile label={t('money.tile.spent')} icon="bot" span={4}>
      {line && proof && (
        <div className={s.tileValue} data-phrase={phrase ? '' : undefined}>
          <ProvedFigure value={shown!.value} proof={proof} size={phrase ? 'tile' : 'stat'} rupees={shown!.rupees} />
        </div>
      )}
      {/* The split by department (W4 4A2) only under the very figure it splits: the same receipt, whose sum its parts make. */}
      {split && line?.receiptId && split.proof.receiptId === line.receiptId && <div className={s.tileChart}><SplitBar data={split} /></div>}
      <p className={s.tileFoot}>
        <a className={s.more} href="#/money/spend">{t('money.spentEach')}</a>
      </p>
    </MoneyTile>
  );
}

/**
 * In and out by month (W4 4J4): the engine's months as paired bars, its values over them and what was left under each,
 * every figure with its own receipt in the chart's table; and the engine's words for what it left out ("AI spend not
 * counted: no rupee rate set"), never a zero in its place.
 */
function InOutTile({ flow, notes, span }: { flow: FlowData; notes: FlowView | undefined; span: TileSpan }) {
  const t = useT();
  const id = useId();
  const monthWords = useMonthWords('short');
  const months = notes?.months ?? [];
  const first = months[0]?.month;
  const last = months[months.length - 1]?.month;
  const left = notes?.basis.notCounted?.line ?? [...new Set(months.map((row) => row.note).filter((note): note is string => Boolean(note)))].join(' ');
  return (
    <Tile as="section" labelledBy={id} span={span}>
      <TileHead id={id} title={t('money.flow.title')} meta={first && last ? t('money.flow.meta', { from: monthWords(first), to: monthWords(last) }) : undefined} />
      <div className={s.tileChart}>
        <BarChart kind="money" proof={flow.proof} series={flow.series} label={flow.label} noteLabel={flow.noteLabel} ticks={flow.ticks} current={flow.current} />
      </div>
      {left && <p className={v.quiet}>{left}</p>}
    </Tile>
  );
}
