/**
 * The books for a period: billed, received and earned, each from the calculator with its receipt; the engine's own
 * notes on what the figures include (tax among them); and the invoices still open. The period is in the address.
 * Under them, the tax working (venture.tax.working): each part worked by the calculator, each figure with its receipt,
 * and a plain line when the working needs the CA to confirm it before anything is filed.
 */

import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { setQuery, useRoute } from '../../shell/navigation';
import { Receipt } from '../../parts/Receipt';
import type { BooksPeriodKey, TaxWorking } from '../../engine/types';
import { Failed, Figure, InvoiceRef, Section } from './parts';
import { onMoney, useDay } from './words';
import s from './Money.module.css';

const PERIODS: readonly BooksPeriodKey[] = ['all', 'this-month', 'last-month', 'this-year'];
const isPeriod = (value: string | undefined): value is BooksPeriodKey => PERIODS.includes(value as BooksPeriodKey);

export function Books() {
  const t = useT();
  const day = useDay();
  const route = useRoute();
  const chosen: BooksPeriodKey = isPeriod(route.query.period) ? route.query.period : 'this-month';
  const books = useResource('venture.books.summary', { period: chosen }, { refreshOn: onMoney });
  const data = books.data;
  const periods = data?.periods ?? PERIODS.map((key) => ({ key, label: t(`money.books.period.${key}`) }));
  const [first, ...more] = data?.notes ?? [];

  return (
    <>
      <div role="group" aria-label={t('money.books.period')} className={s.periods}>
        {periods.map((period) => (
          <button key={period.key} type="button" className={s.period} aria-pressed={period.key === chosen} onClick={() => setQuery({ ...route.query, period: period.key })}>
            {period.label}
          </button>
        ))}
      </div>
      {data && <p className={s.range}>{t('money.books.range', { from: day(data.period.from), to: day(data.period.to) })}</p>}
      {books.error && <Failed error={books.error} />}
      {data && (
        <>
          <Section title={t('money.books.figures')}>
            <ul className={s.lines}>
              {data.figures.map((figure) => (
                <li key={figure.operation} className={s.line} data-row="" data-row-id={`books-${figure.operation}`} tabIndex={-1}>
                  <span className={s.label}>{figure.label}</span>
                  <span className={s.value}>
                    <Figure>{figure.display}</Figure>
                    <Receipt id={figure.receiptId} />
                    {figure.stale && <span className={s.stale}>{t('money.changed')}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {first && <p className={s.quiet}>{first}</p>}
            {more.length > 0 && (
              <details className={s.fold}>
                <summary>{t('money.books.about')}</summary>
                {more.map((note) => <p key={note}>{note}</p>)}
              </details>
            )}
          </Section>
          <Section title={t('money.books.open')}>
            {data.openInvoices.length === 0 ? <p className={s.quiet}>{t('money.books.openNone')}</p> : (
              <ul className={s.lines}>
                {data.openInvoices.map((item) => (
                  <li key={item.invoiceId} className={s.line} data-row="" data-row-id={`open-${item.invoiceId}`} tabIndex={-1}>
                    <span className={s.label}><InvoiceRef id={item.invoiceId} number={item.number} /></span>
                    <span className={s.value}>
                      <Figure>{item.balanceDisplay}</Figure>
                      <span className={s.note}>{t('money.owedLine', { client: item.clientName, due: day(item.dueDate) })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
      <TaxWorkingPart />
    </>
  );
}

/** The tax working for the engine's current period. A line without a receipt is shown as the engine wrote it. */
function TaxWorkingPart() {
  const t = useT();
  const working = useResource('venture.tax.working', {}, { refreshOn: onMoney });
  const data: TaxWorking | undefined = working.data;
  if (!data && !working.error) return null;
  return (
    <Section title={data ? t('money.tax.title', { period: data.period }) : t('money.tax.titlePlain')}>
      {working.error && <Failed error={working.error} />}
      {data?.needsCaConfirmation && <p className={`${s.quiet} ${s.wait}`}>{t('money.tax.needsCa')}</p>}
      {data?.sections.map((section) => (
        <div key={section.id} className={s.taxPart}>
          <h3 className={s.blockTitle}>{section.title}</h3>
          {section.lines.length > 0 && (
            <ul className={s.lines}>
              {section.lines.map((line, index) => (
                <li key={`${index}:${line.label}`} className={s.line} data-row="" data-row-id={`tax-${section.id}-${index}`} tabIndex={-1}>
                  <span className={s.label}>{line.label}</span>
                  <span className={s.value}>
                    <Figure>{line.value}</Figure>
                    {line.receiptId && <Receipt id={line.receiptId} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {section.note && <p className={s.quiet}>{section.note}</p>}
        </div>
      ))}
    </Section>
  );
}
