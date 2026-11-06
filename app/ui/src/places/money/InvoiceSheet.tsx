/**
 * One invoice beside the list: the engine's figures, the receipt that priced it, its books receipt (or the engine's
 * reason there is none), payments with their receipts, notes, and the invoice text as the client gets it.
 *
 * A draft is issued from here. Issuing cannot be undone, so it asks a second time, and it sends the digest of the
 * invoice on screen: if the draft changed since, the engine refuses, the sheet says so and shows the new version.
 *
 * W4 4J20 (InvoiceExtras.tsx): the invoice's next step (a reminder to draft or open, a cheque to clear), a draft's rate
 * change, each payment with a cheque waiting and the client's TDS, its credit notes and asking for one, and its
 * timeline.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Receipt } from '../../parts/Receipt';
import { Sheet } from '../../parts/Sheet';
import { EngineError, type InvoiceViewLite } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { Credits, NextStep, PaymentLine, RateChange, Timeline } from './InvoiceExtras';
import { messageOf, onMoney, statusOf, useDay } from './words';
import s from './Money.module.css';

type Notice = { kind: 'done' | 'stale' | 'refused'; text: string; receiptId?: string | undefined };

export function InvoiceSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const day = useDay();
  const engine = useEngine();
  const paymentsId = useId();
  const view = useResource('venture.invoice.get', { invoiceId: id }, { refreshOn: onMoney });
  // What the engine answered to the last action, until the next read brings the same thing.
  const [answered, setAnswered] = useState<InvoiceViewLite | null>(null);
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const [notice, setNotice] = useState<Notice | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setAnswered(null); }, [view.data]);
  useEffect(() => { if (phase === 'confirm') cancelRef.current?.focus(); }, [phase]);

  const current = answered ?? view.data;
  // 4J20: what an action in the sheet answered; a draft made again at today's rate is a new invoice, so it opens.
  const changed = (next?: InvoiceViewLite) => {
    if (next && next.invoice.id !== id) openSheet('invoice', next.invoice.id);
    else if (next) setAnswered(next);
    else view.reload();
  };
  if (!current) {
    return (
      <Sheet label={t('money.invoice.label')} title={t('money.loading')} onClose={onClose} returnFocus={returnFocus}>
        {view.error && <p className={s.failed} role="status" data-engine-line="">{t('money.failed', { message: view.error.message })}</p>}
      </Sheet>
    );
  }
  const { invoice } = current;

  async function issue(shown: InvoiceViewLite) {
    setPhase('sending');
    setNotice(null);
    try {
      const next = await engine.request('venture.invoice.issue', { invoiceId: shown.invoice.id, digest: shown.invoice.digest });
      setAnswered(next);
      setNotice({ kind: 'done', text: t('money.invoice.issued', { number: next.invoice.number ?? '' }), receiptId: next.invoice.booksReceiptId ?? undefined });
    } catch (error) {
      if (error instanceof EngineError && error.code === 'APPROVAL_STALE') {
        setAnswered(null);
        view.reload();
        setNotice({ kind: 'stale', text: `${t('approval.stale')} ${t('approval.staleNew')}` });
      } else {
        setNotice({ kind: 'refused', text: t('money.invoice.failed', { message: messageOf(error) }) });
        view.reload();
      }
    }
    setPhase('idle');
  }

  let footer = null;
  if (invoice.status === 'draft') {
    footer = phase === 'confirm' ? (
      <div className={s.ask}>
        <p>{t('money.invoice.issueAsk')}</p>
        <div className={s.buttons}>
          <Button ref={cancelRef} onClick={() => setPhase('idle')}>{t('approval.cancel')}</Button>
          <Button variant="primary" data-confirm="" onClick={() => void issue(current)}>{t('money.invoice.issueConfirm')}</Button>
        </div>
      </div>
    ) : (
      <div className={s.buttons}>
        <Button variant="primary" disabled={phase === 'sending'} onClick={() => setPhase('confirm')}>{t('money.invoice.issue')}</Button>
      </div>
    );
  } else if (invoice.status === 'issued' || invoice.status === 'part-paid') {
    footer = (
      <div className={s.buttons}>
        <Button variant="primary" onClick={(event) => openSheet('payment', invoice.id, event.currentTarget)}>{t('money.invoices.record')}</Button>
      </div>
    );
  }

  return (
    <Sheet
      label={t('money.invoice.label')}
      eyebrow={current.client.name}
      title={invoice.number ?? t('money.invoice.draft')}
      line={statusOf(t, day, invoice)}
      onClose={onClose}
      returnFocus={returnFocus}
      footer={footer}
    >
      {/* The figures, the receipt that priced them and each payment's books receipt: every amount here is explained by
          the receipts beside it (one data-figure-group). */}
      <div className={s.sheetCard} data-figure-group="">
        <dl className={s.sheetFigures}>
          {current.figures.map((figure) => (
            <div key={figure.key} className={s.sheetFigure} data-key={figure.key}>
              <dt>{figure.label}</dt>
              <dd className="mono">{figure.display}</dd>
            </div>
          ))}
        </dl>
        <p className={s.sheetLine}>
          <span className={s.figureLabel}>{t('money.invoice.priced')}</span>
          {/* 4Z3: the mark named for the total the price receipt proves, when the engine sent it. */}
          <Receipt id={invoice.priceReceiptId} amount={current.figures.find((figure) => figure.key === 'total')?.display} />
          {current.receipt.stale && <span className={s.stale}>{t('money.changed')}</span>}
        </p>
        {invoice.booksReceiptId ? (
          <p className={s.sheetLine}>
            <span className={s.figureLabel}>{t('money.invoice.books')}</span>
            <Receipt id={invoice.booksReceiptId} />
          </p>
        ) : invoice.booksNote ? <p className={s.quietLine} data-engine-line="">{invoice.booksNote}</p> : null}
        {current.payments.length > 0 && (
          <section className={s.block} aria-labelledby={paymentsId}>
            <h3 id={paymentsId} className={s.blockTitle}>{t('money.invoice.payments')}</h3>
            <ul className={s.plain}>
              {current.payments.map((payment) => <PaymentLine key={payment.id} payment={payment} onChanged={changed} />)}
            </ul>
          </section>
        )}
      </div>
      <NextStep view={current} />
      <RateChange view={current} onChanged={changed} />
      {current.notes.map((note) => <p key={note} className={s.quietLine} data-engine-line="">{note}</p>)}
      <Credits view={current} />
      <Timeline view={current} />
      <details className={`${s.fold} ${s.block}`}>
        <summary>{t('money.invoice.document')}</summary>
        {/* The invoice as the client gets it, quoted as written; its figures are the ones above, with their receipts. */}
        <pre className={s.pre} data-content="">{current.documentText}</pre>
      </details>
      {/* Issued and changed-since are this screen's own words; only a refusal carries the engine's, which may name an
          amount. */}
      {notice && (
        <p
          className={notice.kind === 'done' ? s.notice : notice.kind === 'stale' ? `${s.notice} ${s.noticeStale}` : s.refusal}
          role="status"
          data-engine-line={notice.kind === 'refused' ? '' : undefined}
        >
          <span>{notice.text}</span>
          {notice.receiptId && <Receipt id={notice.receiptId} />}
        </p>
      )}
    </Sheet>
  );
}
