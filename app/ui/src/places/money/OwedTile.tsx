/**
 * Who owes you (D-Money `.owe`, `.ow-*`, `.ag-l`): what clients owe, as the engine's figure with its receipt; how many
 * invoices are open (a Count); and each open invoice, oldest due first, with its client, number, due date and balance.
 *
 * The owed receipt is the engine's sum of exactly these open balances, so it proves the balances listed under it (one
 * `data-figure-group`). Without that receipt no amount is shown here, only the invoices, each a step from its own
 * figures in the invoice sheet. Owed by age (five buckets, W4 4J) takes the list's place once the engine sends it.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { AgingBar } from '../../parts/charts/AgingBar';
import type { AgingData } from '../../parts/charts/types';
import { Figure } from '../../parts/Figure';
import { Tile, TileHead, type TileSpan } from '../../parts/Tile';
import type { MoneyOverviewLine } from '../../engine/types';
import { Counted, InvoiceRef, lineProof } from './parts';
import { useDay, type OpenInvoice } from './words';
import s from './Money.module.css';

export interface OwedTileProps {
  line: MoneyOverviewLine | undefined;
  /** The open invoices, oldest due first; undefined until the books answer. */
  open: OpenInvoice[] | undefined;
  aging?: AgingData | undefined;
  span: TileSpan;
}

export function OwedTile({ line, open, aging, span }: OwedTileProps) {
  const t = useT();
  const id = useId();
  const proof = lineProof(line);
  // Balances are shown only under the receipt that sums them; a model-written figure proves nothing under it.
  const receipted = proof !== null && proof.receiptId !== undefined;
  const figure = line && proof && <Figure {...proof} value={line.value} size="stat" className={s.owedFigure} />;
  const list = open && open.length > 0 && !aging && <OpenList items={open} balances={receipted} />;

  return (
    <Tile as="section" labelledBy={id} span={span} className={s.owed}>
      <TileHead id={id} title={t('money.owed.title')} meta={open ? <Counted text={t('money.owed.count', { count: String(open.length) })} count={open.length} /> : undefined} />
      <div className={s.owedBody} data-figure-group={receipted && list ? '' : undefined}>
        {figure}
        {list}
      </div>
      {aging && <div className={s.tileChart}><AgingBar data={aging} /></div>}
      {open && open.length === 0 && <p className={s.quietLine}>{t('money.owed.none')}</p>}
    </Tile>
  );
}

/** Open invoices as rows: the client, the number (it opens the invoice) and due date, and the balance when proved. */
export function OpenList({ items, balances, className }: { items: readonly OpenInvoice[]; balances: boolean; className?: string | undefined }) {
  const t = useT();
  const day = useDay();
  return (
    <ul className={className ?? s.openList}>
      {items.map((item) => (
        <li key={item.invoiceId} className={s.openItem}>
          <span className={s.openText}>
            <span className={s.openClient} data-client="">{item.clientName}</span>
            <span className={s.openSub}>
              <InvoiceRef id={item.invoiceId} number={item.number} />
              <span aria-hidden="true">·</span>
              <span>{t('money.due', { date: day(item.dueDate) })}</span>
            </span>
          </span>
          {balances && <span className={`${s.openAmount} mono`}>{item.balanceDisplay}</span>}
        </li>
      ))}
    </ul>
  );
}
