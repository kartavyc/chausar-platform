/**
 * Money (D-Money): an overview, invoices, bills, books, margins, spend and the journal, each one address (#/money,
 * #/money/invoices, ...), as a segmented row of links. Every figure here is text the engine formatted, through the
 * Figure part with its receipt, or labelled a model estimate. The screen never adds, parses or rounds an amount.
 *
 * Simple first: the overview is plain money in and out; tax detail sits one step away under Books, and a business not
 * registered for GST never sees GST at all.
 *
 * Above the overview (W4 4J20): the businesses on this computer as chips (Across.tsx, W4 4J6), the month the tiles show
 * (?month=2026-09, this month when none) and Export for your CA for that month. Margins takes the same month.
 *
 * Sheets: `invoice` (one invoice; a draft is issued from it), `payment` (record a payment against an invoice),
 * `limit` (what to do when a spend limit is used up, W4 4F2) and `accountant` (a read-only month of books for the
 * owner's accountant, from the business menu).
 */

import { useT } from '../../text';
import { setQuery, useRoute } from '../../shell/navigation';
import { StorageNotice } from '../../shell/StorageNotice';
import { PageTitle } from '../../parts/PageTitle';
import { Segmented, type SegmentLink } from '../../parts/Segmented';
import { Icon } from '../../parts/Icon';
import type { IconName } from '../../parts/icons';
import type { SheetComponent } from '../../shell/sheets';
import { AccountantSheet } from './AccountantSheet';
import { AcrossChips, AcrossView, useAcrossChoice } from './Across';
import { Bills } from './Bills';
import { Books } from './Books';
import { ExportButton } from './ExportButton';
import { InvoiceSheet } from './InvoiceSheet';
import { Invoices } from './Invoices';
import { Journal } from './Journal';
import { LimitSheet } from './LimitSheet';
import { Margins } from './Margins';
import { Overview } from './Overview';
import { PaymentSheet } from './PaymentSheet';
import { Spend } from './Spend';
import { notYet } from './views';
import { monthsOffered, useChosenMonth, useMonthWords } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

const SUBS = ['invoices', 'bills', 'books', 'margins', 'spend', 'journal', 'businesses'] as const;
type Sub = (typeof SUBS)[number];
const isSub = (value: string | undefined): value is Sub => SUBS.includes(value as Sub);

const ICONS: Readonly<Record<Sub | 'overview', IconName>> = {
  overview: 'layout-grid',
  invoices: 'receipt-text',
  bills: 'file-pen',
  books: 'file-text',
  margins: 'trending-up',
  spend: 'bot',
  journal: 'history',
  businesses: 'layout-grid',
};


export function Place() {
  const t = useT();
  const route = useRoute();
  const sub = isSub(route.sub) ? route.sub : undefined;
  const { month } = useChosenMonth(route.query);
  const { across, chosen, error } = useAcrossChoice();
  const links: SegmentLink[] = [
    { id: 'overview', label: t('money.sub.overview'), icon: ICONS.overview, href: '#/money' },
    // Money across businesses (4J6) is its own page, offered only when this computer has more than one business.
    ...SUBS.filter((id) => id !== 'businesses' || (across?.businesses.length ?? 0) > 1).map((id) => ({ id, label: t(`money.sub.${id}`), icon: ICONS[id], href: `#/money/${id}` })),
  ];
  const monthly = sub === undefined || sub === 'margins';

  return (
    <>
      <PageTitle title={t('place.money')} line={sub === undefined ? t('money.line') : undefined} />
      <StorageNotice />
      <div className={s.toolbar}>
        <Segmented mode="links" label={t('money.nav')} value={sub ?? 'overview'} options={links} />
      </div>
      {monthly && (
        <div className={v.bar}>
          {/* A compact row of the businesses over the overview, only when there is more than one (4J6). */}
          {sub === undefined && <AcrossChips across={across} chosen={null} overview />}
          <span className={v.barEnd}>
            <MonthPicker month={month} />
            {sub === undefined && <ExportButton month={month} />}
          </span>
        </div>
      )}
      {sub === 'invoices' ? <Invoices />
        : sub === 'bills' ? <Bills />
          : sub === 'books' ? <Books />
            : sub === 'margins' ? <Margins month={month} />
              : sub === 'spend' ? <Spend />
                : sub === 'journal' ? <Journal />
                  : sub === 'businesses' ? (
                    <>
                      <div className={v.bar}><AcrossChips across={across} chosen={chosen ?? 'all'} /></div>
                      <AcrossView across={across} chosen={chosen ?? 'all'} error={notYet(error) ? undefined : error} />
                    </>
                  )
                    : <Overview />}
    </>
  );
}

/** The month the page shows, as a short list of this month and the ones before it, held in the address. */
function MonthPicker({ month }: { month: string }) {
  const t = useT();
  const route = useRoute();
  const monthWords = useMonthWords();
  const { thisMonth } = useChosenMonth({});
  const months = monthsOffered(thisMonth);
  return (
    <label className={v.month}>
      <Icon name="calendar" size={16} />
      <span className="sr-only">{t('money.month')}</span>
      <select
        className={v.monthSelect}
        value={month}
        onChange={(event) => {
          const { month: _old, ...query } = route.query;
          const next = event.currentTarget.value;
          setQuery(next === thisMonth ? query : { ...query, month: next });
        }}
      >
        {months.map((item) => <option key={item} value={item}>{monthWords(item)}</option>)}
      </select>
    </label>
  );
}

export const sheets: Readonly<Record<string, SheetComponent>> = {
  invoice: InvoiceSheet, payment: PaymentSheet, limit: LimitSheet, accountant: AccountantSheet,
};
