/**
 * Money: an overview, invoices, books, spend and the journal, each one address (#/money, #/money/invoices, ...).
 * Every figure here is text the engine formatted, shown beside its receipt or the invoice that explains it, or
 * labelled a model estimate. The screen never adds, parses or rounds an amount.
 *
 * Sheets: `invoice` (one invoice; a draft is issued from it) and `payment` (record a payment against an invoice).
 */

import { useT } from '../../text';
import { useRoute } from '../../shell/navigation';
import { PageTitle } from '../../parts/PageTitle';
import type { SheetComponent } from '../../shell/sheets';
import { Books } from './Books';
import { InvoiceSheet } from './InvoiceSheet';
import { Invoices } from './Invoices';
import { Journal } from './Journal';
import { Overview } from './Overview';
import { PaymentSheet } from './PaymentSheet';
import { Spend } from './Spend';
import s from './Money.module.css';

const SUBS = ['invoices', 'books', 'spend', 'journal'] as const;
type Sub = (typeof SUBS)[number];
const isSub = (value: string | undefined): value is Sub => SUBS.includes(value as Sub);

export function Place() {
  const t = useT();
  const route = useRoute();
  const sub = isSub(route.sub) ? route.sub : undefined;

  return (
    <>
      <PageTitle title={t('place.money')} />
      <nav aria-label={t('money.nav')} className={s.subnav}>
        <a href="#/money" aria-current={sub === undefined ? 'page' : undefined}>{t('money.sub.overview')}</a>
        {SUBS.map((id) => (
          <a key={id} href={`#/money/${id}`} aria-current={sub === id ? 'page' : undefined}>{t(`money.sub.${id}`)}</a>
        ))}
      </nav>
      {sub === 'invoices' ? <Invoices /> : sub === 'books' ? <Books /> : sub === 'spend' ? <Spend /> : sub === 'journal' ? <Journal /> : <Overview />}
    </>
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = { invoice: InvoiceSheet, payment: PaymentSheet };
