/**
 * Money (D-Money): an overview, invoices, books, spend and the journal, each one address (#/money, #/money/invoices,
 * ...), as a segmented row of links. Every figure here is text the engine formatted, through the Figure part with its
 * receipt, or labelled a model estimate. The screen never adds, parses or rounds an amount.
 *
 * Simple first: the overview is plain money in and out; tax detail sits one step away under Books, and a business not
 * registered for GST never sees GST at all.
 *
 * Sheets: `invoice` (one invoice; a draft is issued from it) and `payment` (record a payment against an invoice).
 */

import { useT } from '../../text';
import { useRoute } from '../../shell/navigation';
import { StorageNotice } from '../../shell/StorageNotice';
import { PageTitle } from '../../parts/PageTitle';
import { Segmented, type SegmentLink } from '../../parts/Segmented';
import type { IconName } from '../../parts/icons';
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

const ICONS: Readonly<Record<Sub | 'overview', IconName>> = {
  overview: 'layout-grid',
  invoices: 'receipt-text',
  books: 'file-text',
  spend: 'bot',
  journal: 'history',
};

export function Place() {
  const t = useT();
  const route = useRoute();
  const sub = isSub(route.sub) ? route.sub : undefined;
  const links: SegmentLink[] = [
    { id: 'overview', label: t('money.sub.overview'), icon: ICONS.overview, href: '#/money' },
    ...SUBS.map((id) => ({ id, label: t(`money.sub.${id}`), icon: ICONS[id], href: `#/money/${id}` })),
  ];

  return (
    <>
      <PageTitle title={t('place.money')} line={sub === undefined ? t('money.line') : undefined} />
      <StorageNotice />
      <div className={s.toolbar}>
        <Segmented mode="links" label={t('money.nav')} value={sub ?? 'overview'} options={links} />
      </div>
      {sub === 'invoices' ? <Invoices /> : sub === 'books' ? <Books /> : sub === 'spend' ? <Spend /> : sub === 'journal' ? <Journal /> : <Overview />}
    </>
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = { invoice: InvoiceSheet, payment: PaymentSheet };
