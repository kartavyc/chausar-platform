/**
 * Money at a glance (D-Money, row by row): what was invoiced, what came in and what AI cost this month; who owes you;
 * what is due to you next. Every figure is the engine's own text with its receipt, or the "model estimate" label when a
 * model wrote it; a figure that comes with no receipt is left out, never shown bare. Nothing is added up here.
 *
 * Reads: venture.money.overview (owed, received, spent, each with its receipt) and venture.books.summary for this month
 * (the billed figure with its receipt, and the open invoices). The charts on the board (the goal bar, spend by
 * department, owed by age, in and out by month, the 13-week cash line) draw only from the views wave 4 sends
 * (`views.ts`); until then none is drawn and no sentence promises one.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { BarChart } from '../../parts/charts/BarChart';
import { CashLine } from '../../parts/charts/CashLine';
import { GoalBar } from '../../parts/charts/GoalBar';
import { SplitBar } from '../../parts/charts/SplitBar';
import { Bento, Tile, TileHead, type TileSpan } from '../../parts/Tile';
import type { BooksFigureLite, MoneyOverviewLine, VentureRunEvent } from '../../engine/types';
import { DueNext } from './DueNext';
import { OwedTile } from './OwedTile';
import { splitFigure } from '../../parts/Figure';
import { Failed, MoneyTile, ProvedFigure, isPhrase, lineProof } from './parts';
import { useMoneyViews, type FlowData, type MoneyViews } from './views';
import { byDue, onMoney, onRuns } from './words';
import s from './Money.module.css';

/** The overview moves when money does (an invoice issued, a payment recorded) and when a paid call settles. */
const onOverview = (event: VentureRunEvent) => onMoney(event) || onRuns(event);

/** `views`: the chart data, given by a test or a specimen; left out, the views the engine sends (none until W4). */
export function Overview({ views: given }: { views?: MoneyViews | undefined }) {
  const t = useT();
  const sent = useMoneyViews();
  const views = given ?? sent;
  const overview = useResource('venture.money.overview', {}, { refreshOn: onOverview });
  const books = useResource('venture.books.summary', { period: 'this-month' }, { refreshOn: onMoney });
  const line = (id: MoneyOverviewLine['id']) => overview.data?.lines.find((item) => item.id === id);
  const billed = books.data?.figures.find((figure) => figure.operation === 'billed');
  const open = books.data ? byDue(books.data.openInvoices) : undefined;
  const { flow, cash } = views;

  const dueSpan: TileSpan = flow ? (cash ? 4 : 12) : 7;
  const due = <DueNext line={line('owed')} open={open} today={books.data?.today} span={dueSpan} />;

  return (
    <section className={s.overview} aria-label={t('money.sub.overview')}>
      {overview.error && <Failed error={overview.error} />}
      {books.error && <Failed error={books.error} />}
      <Bento className={s.glance}>
        <InvoicedTile billed={billed} goal={views.goal} />
        <ReceivedTile line={line('received')} />
        <SpendTile line={line('spent')} split={views.split} />
      </Bento>
      <Bento>
        <OwedTile line={line('owed')} open={open} aging={views.aging} span={5} />
        {flow ? <InOutTile flow={flow} span={7} /> : due}
      </Bento>
      {(flow || cash) && (
        <Bento>
          {cash && <CashTile cash={cash} span={flow ? 8 : 12} />}
          {flow && due}
        </Bento>
      )}
    </section>
  );
}

/** What was invoiced this month: the books' billed figure with its receipt; the goal bar under it once W4 4I sends one. */
function InvoicedTile({ billed, goal }: { billed: BooksFigureLite | undefined; goal: MoneyViews['goal'] }) {
  const t = useT();
  return (
    <MoneyTile label={t('money.tile.invoiced')} icon="target" span={5}>
      {billed && (
        <div className={s.tileValue}>
          <ProvedFigure value={billed.display} proof={{ receiptId: billed.receiptId }} size="stat" />
        </div>
      )}
      {billed?.stale && <p className={s.tileSub}><span className={s.stale}>{t('money.changed')}</span></p>}
      {goal && <div className={s.tileChart}><GoalBar data={goal} tone="light" /></div>}
    </MoneyTile>
  );
}

function ReceivedTile({ line }: { line: MoneyOverviewLine | undefined }) {
  const t = useT();
  const proof = lineProof(line);
  return (
    <MoneyTile label={t('money.tile.received')} icon="wallet" span={3}>
      {line && proof && (
        <div className={s.tileValue}>
          <ProvedFigure value={line.value} proof={proof} size="stat" />
        </div>
      )}
      <p className={s.tileSub}>{t('money.tile.thisMonth')}</p>
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
  // Words after an amount are the Figure's own (splitFigure); only words with no amount at all are a phrase.
  const phrase = line !== undefined && isPhrase(splitFigure(line.value).amount);
  return (
    <MoneyTile label={t('money.tile.spent')} icon="bot" span={4}>
      {line && proof && (
        <div className={s.tileValue} data-phrase={phrase ? '' : undefined}>
          <ProvedFigure value={line.value} proof={proof} size={phrase ? 'tile' : 'stat'} rupees={line.rupees} />
        </div>
      )}
      {split && <div className={s.tileChart}><SplitBar data={split} /></div>}
      <p className={s.tileFoot}>
        <a className={s.more} href="#/money/spend">{t('money.spentEach')}</a>
      </p>
    </MoneyTile>
  );
}

/** In and out by month (W4 4J): only with the engine's own series and its receipt. */
function InOutTile({ flow, span }: { flow: FlowData; span: TileSpan }) {
  const t = useT();
  const id = useId();
  return (
    <Tile as="section" labelledBy={id} span={span}>
      <TileHead id={id} title={t('money.flow.title')} />
      <div className={s.tileChart}>
        <BarChart kind="money" proof={flow.proof} series={flow.series} label={flow.label} noteLabel={flow.noteLabel} ticks={flow.ticks} current={flow.current} />
      </div>
    </Tile>
  );
}

/** Cash in the bank, week by week, with the forecast said in words and its assumptions listed (W4 4J). */
function CashTile({ cash, span }: { cash: NonNullable<MoneyViews['cash']>; span: TileSpan }) {
  const t = useT();
  const id = useId();
  return (
    <Tile as="section" labelledBy={id} span={span}>
      <TileHead id={id} title={t('money.cash.title')} />
      <div className={s.tileChart}><CashLine data={cash} /></div>
    </Tile>
  );
}
