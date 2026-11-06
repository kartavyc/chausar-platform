/**
 * Next three weeks, by date (D-Money `.lt`; W4 4J4 venture.money.cash `nextWeeks`): what is due in from clients and out
 * on bills in the next 21 days, soonest first (overdue bills first), each in the engine's words with its amount, a
 * projection proved by the receipt of its week. Under them, the usual costs the forecast takes for each week, an
 * assumption with its receipt. Late invoices are not here: they sit under Owed to you, oldest first.
 */

import { useId } from 'react';
import { useT } from '../../text';
import { Figure } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import { Tile, TileHead, type TileSpan } from '../../parts/Tile';
import type { CashView } from '../../engine/types';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

export function NextWeeks({ cash, span }: { cash: CashView; span: TileSpan }) {
  const t = useT();
  const id = useId();
  const items = cash.nextWeeks;
  return (
    <Tile as="section" labelledBy={id} span={span} className={v.next}>
      <TileHead id={id} title={t('money.weeks.title')} meta={t('money.next.meta')} />
      {items.length === 0 && <p className={s.quietLine}>{t('money.weeks.none')}</p>}
      {items.length > 0 && (
        <ul className={v.weekList}>
          {items.map((item) => (
            <li key={`${item.on}:${item.line}`} className={v.weekItem} data-direction={item.direction}>
              <span className={v.weekMark} aria-hidden="true">
                <Icon name={item.direction === 'in' ? 'trending-up' : 'trending-down'} size={16} />
              </span>
              <span className={v.weekText}>
                <span className={v.weekLine}>{item.line}</span>
                {/* The amount under the words, so a narrow tile keeps the words whole (the figure carries its receipt). */}
                <span className={v.weekSub}>
                  <span>{t(item.direction === 'in' ? 'money.weeks.in' : 'money.weeks.out')}</span>
                  <span className={v.weekAmount}>
                    <Figure value={item.amount.display} receiptId={item.amount.receiptId} />
                    {/* A forecast says so, wherever the engine marks one. */}
                    {item.amount.projected && <span className={v.projected} data-projected="">{t('money.projected')}</span>}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {cash.usualCosts && (
        <p className={v.usual}>
          {t('money.weeks.usual')}
          <Figure value={cash.usualCosts.display} receiptId={cash.usualCosts.receiptId} />
          {t('money.weeks.usualEach')}
        </p>
      )}
    </Tile>
  );
}
