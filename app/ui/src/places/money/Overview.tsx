/**
 * Money at a glance: what clients owe, what came in this month, and what AI and tools cost. The engine sends the
 * three lines (venture.money.overview) with their words and figures; each figure sits beside what explains it: the
 * open invoices, a receipt, or the list of paid calls. With the owner's own rupee rate, the AI spend line also comes in
 * rupees, with that rate, beside the dollars. Nothing is added up here.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { Receipt } from '../../parts/Receipt';
import type { MoneyOverviewLine, VentureRunEvent } from '../../engine/types';
import { Failed, Figure, Rupees } from './parts';
import { onMoney, onRuns } from './words';
import s from './Money.module.css';

/** The overview moves when money does (an invoice issued, a payment recorded) and when a paid call settles. */
const onOverview = (event: VentureRunEvent) => onMoney(event) || onRuns(event);

export function Overview() {
  const t = useT();
  const overview = useResource('venture.money.overview', {}, { refreshOn: onOverview });

  return (
    <section aria-label={t('money.sub.overview')}>
      {overview.error && <Failed error={overview.error} />}
      {overview.data && (
        <ul className={s.lines}>
          {overview.data.lines.map((line) => <OverviewLine key={line.id} line={line} />)}
        </ul>
      )}
    </section>
  );
}

/**
 * One line: the engine's label and figure, then its reference. A receipted figure opens its receipt; a figure a model
 * wrote says so and has none. What clients owe leads to the open invoices; what was spent leads to each call.
 */
function OverviewLine({ line }: { line: MoneyOverviewLine }) {
  const t = useT();
  // Spend counts calls not settled yet at their estimate, and the engine says so in the figure ("includes
  // estimates"): that is a cost estimate, not a number a model wrote, so it leads to each call instead.
  const modelWrote = line.estimate === true && line.id !== 'spent';
  return (
    <li className={s.line} data-row="" data-row-id={`overview-${line.id}`} tabIndex={-1}>
      <span className={s.label}>{line.label}</span>
      <span className={s.value}>
        <Figure>{line.value}</Figure><Rupees text={line.rupees} />
        {modelWrote ? <ModelEstimate /> : line.receiptId && !line.estimate && <Receipt id={line.receiptId} />}
        {line.id === 'owed' && <a className={s.more} href="#/money/invoices" data-ref="">{t('money.owedAll')}</a>}
        {line.id === 'spent' && <a className={s.more} href="#/money/spend" data-ref="">{t('money.spentEach')}</a>}
      </span>
    </li>
  );
}
