/**
 * Due to you next (D-Money `.lt`, without the costs, which the engine does not send yet): the open invoices whose due
 * date is today or later, soonest first, each with its client, number, due date and balance. "Today" is the engine's
 * own day from the books; dates are compared as written (YYYY-MM-DD), never worked out.
 *
 * Balances sit under the owed receipt, the engine's sum of every open balance, shown in the tile head. Without that
 * receipt the invoices show with no amount. Costs coming up (W4 4J) are left out: nothing about them is said.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { Receipt } from '../../parts/Receipt';
import { Tile, TileHead, type TileSpan } from '../../parts/Tile';
import type { MoneyOverviewLine } from '../../engine/types';
import { OpenList } from './OwedTile';
import { lineProof } from './parts';
import type { OpenInvoice } from './words';
import s from './Money.module.css';

/** How many invoices the tile lists: the next few, as on the board. */
const SHOWN = 4;

export function DueNext({ line, open, today, span }: { line: MoneyOverviewLine | undefined; open: OpenInvoice[] | undefined; today: string | undefined; span: TileSpan }) {
  const t = useT();
  const id = useId();
  const proof = lineProof(line);
  const receiptId = proof?.receiptId;
  const next = (open ?? []).filter((item) => !today || item.dueDate >= today).slice(0, SHOWN);

  return (
    <Tile as="section" labelledBy={id} span={span} className={s.dueNext}>
      <div className={s.dueBody} data-figure-group={receiptId && next.length > 0 ? '' : undefined}>
        <TileHead id={id} title={t('money.next.title')} meta={t('money.next.meta')} end={receiptId && next.length > 0 ? <Receipt id={receiptId} /> : undefined} />
        {open && next.length === 0 && <p className={s.quietLine}>{t('money.next.none')}</p>}
        {next.length > 0 && <OpenList items={next} balances={receiptId !== undefined} className={s.nextList} />}
      </div>
    </Tile>
  );
}
