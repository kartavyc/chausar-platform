/**
 * Money at a glance: what clients owe, what came in this month, and what AI and tools cost. Three engine lines, each
 * figure beside what explains it: an invoice, a receipt, or the list of paid calls. Nothing is added up here.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { Receipt } from '../../parts/Receipt';
import { Failed, Figure, InvoiceRef } from './parts';
import { onMoney, onRuns, useDay } from './words';
import s from './Money.module.css';

/** At most this many open invoices at rest; the rest are one link away. */
const AT_REST = 3;

export function Overview() {
  const t = useT();
  const day = useDay();
  const books = useResource('venture.books.summary', { period: 'this-month' }, { refreshOn: onMoney });
  const spend = useResource('venture.spend.list', {}, { refreshOn: onRuns });
  const open = books.data?.openInvoices ?? [];
  const shown = open.slice(0, AT_REST);
  const received = books.data?.figures.find((figure) => figure.operation === 'received');

  return (
    <section aria-label={t('money.sub.overview')}>
      {books.error && <Failed error={books.error} />}
      <ul className={s.lines}>
        {books.data && shown.length === 0 && (
          <li className={s.line} data-row="" data-row-id="owed-none" tabIndex={-1}>
            <span className={s.label}>{t('money.owed')}</span>
            <span className={`${s.value} ${s.note}`}>{t('money.owedNone')}</span>
          </li>
        )}
        {shown.map((item, index) => (
          <li key={item.invoiceId} className={s.line} data-row="" data-row-id={`owed-${item.invoiceId}`} tabIndex={-1}>
            <span className={s.label}>{index === 0 ? t('money.owed') : <span className="sr-only">{t('money.owed')}</span>}</span>
            <span className={s.value}>
              <Figure>{item.balanceDisplay}</Figure>
              <InvoiceRef id={item.invoiceId} number={item.number} />
              <span className={s.note}>{t('money.owedLine', { client: item.clientName, due: day(item.dueDate) })}</span>
            </span>
          </li>
        ))}
        {open.length > shown.length && (
          <li className={s.line}>
            <span className={s.label} />
            <a className={s.more} href="#/money/invoices">{t('money.owedAll')}</a>
          </li>
        )}
        {received && (
          <li className={s.line} data-row="" data-row-id="received" tabIndex={-1}>
            <span className={s.label}>{t('money.received')}</span>
            <span className={s.value}>
              <Figure>{received.display}</Figure>
              <Receipt id={received.receiptId} />
              {received.stale && <span className={s.stale}>{t('money.changed')}</span>}
            </span>
          </li>
        )}
        {(spend.data || spend.error) && (
          <li className={s.line} data-row="" data-row-id="spent" tabIndex={-1}>
            <span className={s.label}>{t('money.spent')}</span>
            {spend.data ? (
              <span className={s.value}>
                <Figure>{spend.data.total}</Figure>
                <a className={s.more} href="#/money/spend" data-ref="">{t('money.spentEach')}</a>
              </span>
            ) : spend.error ? (
              <span className={`${s.value} ${s.note}`}>{t('money.failed', { message: spend.error.message })}</span>
            ) : null}
          </li>
        )}
      </ul>
    </section>
  );
}
