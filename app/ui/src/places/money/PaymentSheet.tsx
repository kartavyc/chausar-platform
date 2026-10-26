/**
 * Recording a payment, as a form beside the list. The amount is the owner's own text, sent as typed; the engine
 * reads it, checks it against the balance and answers with the invoice's new figures. Recording cannot be undone,
 * so the form asks a second time, repeating exactly what was typed.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Receipt } from '../../parts/Receipt';
import { Sheet } from '../../parts/Sheet';
import { PAYMENT_METHODS, type InvoiceViewLite, type PaymentMethod } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { invoiceTitle, messageOf, statusOf, useDay, useLocalToday } from './words';
import s from './Money.module.css';

type Phase = 'form' | 'confirm' | 'sending' | 'done';

export function PaymentSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const day = useDay();
  const engine = useEngine();
  const methodId = useId();
  const today = useLocalToday();
  const view = useResource('venture.invoice.get', { invoiceId: id });
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>('bank-transfer');
  const [phase, setPhase] = useState<Phase>('form');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ view: InvoiceViewLite; receiptId: string | null; note: string | null } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (phase === 'confirm') cancelRef.current?.focus(); }, [phase]);

  const current = recorded?.view ?? view.data;
  const balance = current?.figures.find((figure) => figure.key === 'balance');
  const takesPayment = current?.invoice.status === 'issued' || current?.invoice.status === 'part-paid';
  const ready = amount.trim() !== '' && receivedOn !== '';
  const locked = phase !== 'form';

  async function record(shown: InvoiceViewLite) {
    setPhase('sending');
    setRefusal(null);
    const before = new Set(shown.payments.map((payment) => payment.id));
    try {
      const next = await engine.request('venture.payment.record', { invoiceId: id, amount: amount.trim(), receivedOn, method });
      const added = next.payments.find((payment) => !before.has(payment.id));
      setRecorded({ view: next, receiptId: added?.booksReceiptId ?? null, note: added?.booksNote ?? null });
      setPhase('done');
    } catch (error) {
      setRefusal(t('money.payment.failed', { message: messageOf(error) }));
      setPhase('form');
    }
  }

  // What is still owed, with the receipts that explain it: the one that priced the invoice and each payment's books
  // receipt (one data-figure-group, as in the invoice sheet).
  const owed = current && balance && (
    <span className={s.owedLine} data-figure-group="">
      <span>{t('money.payment.owed')}</span>
      <span className="mono">{balance.display}</span>
      <Receipt id={current.invoice.priceReceiptId} />
      {current.payments.map((payment) => payment.booksReceiptId && <Receipt key={payment.id} id={payment.booksReceiptId} />)}
    </span>
  );

  let body;
  if (!current) {
    body = view.error ? <p className={s.failed} role="status" data-engine-line="">{t('money.failed', { message: view.error.message })}</p> : <p className={s.quietLine}>{t('money.loading')}</p>;
  } else if (phase === 'done' && recorded) {
    body = (
      <>
        <p className={s.notice} role="status">
          <span>{t('money.payment.done')}</span>
          {recorded.receiptId && <Receipt id={recorded.receiptId} />}
        </p>
        {recorded.note && <p className={s.quietLine} data-engine-line="">{recorded.note}</p>}
        <p className={s.sheetLine}>
          <Button variant="quiet" onClick={(event) => openSheet('invoice', id, event.currentTarget)}>{t('money.payment.back')}</Button>
        </p>
      </>
    );
  } else if (!takesPayment) {
    body = <p className={s.quietLine}>{t('money.payment.notOpen')}</p>;
  } else {
    const currency = current.invoice.currency;
    body = (
      <>
        <form className={s.form} noValidate onSubmit={(event) => { event.preventDefault(); if (ready && phase === 'form') { setRefusal(null); setPhase('confirm'); } }}>
          <Field
            label={t('money.payment.amount')} hint={t('money.payment.amountHint', { currency })} value={amount} inputMode="decimal" autoComplete="off"
            disabled={locked} onChange={(event) => setAmount(event.currentTarget.value)}
          />
          <Field label={t('money.payment.on')} type="date" value={receivedOn} disabled={locked} onChange={(event) => setReceivedOn(event.currentTarget.value)} />
          <div className={s.field}>
            <label htmlFor={methodId} className={s.fieldLabel}>{t('money.payment.method')}</label>
            <select id={methodId} className={s.select} value={method} disabled={locked} onChange={(event) => setMethod(event.currentTarget.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((option) => <option key={option} value={option}>{t(`money.method.${option}`)}</option>)}
            </select>
          </div>
          {phase === 'form' && (
            <div className={s.buttons}>
              <Button variant="primary" type="submit" disabled={!ready}>{t('money.payment.record')}</Button>
            </div>
          )}
        </form>
        {(phase === 'confirm' || phase === 'sending') && (
          <div className={`${s.ask} ${s.block}`}>
            <p>{t('money.payment.ask', { amount: amount.trim(), currency, date: day(receivedOn) })}</p>
            <div className={s.buttons}>
              <Button ref={cancelRef} disabled={phase === 'sending'} onClick={() => setPhase('form')}>{t('approval.cancel')}</Button>
              <Button variant="primary" data-confirm="" disabled={phase === 'sending'} onClick={() => void record(current)}>{t('money.payment.confirm')}</Button>
            </div>
          </div>
        )}
        {refusal && <p className={s.refusal} role="status" data-engine-line="">{refusal}</p>}
      </>
    );
  }

  return (
    <Sheet
      label={t('money.payment.label')}
      eyebrow={current ? invoiceTitle(t, current.invoice, current.client.name) : undefined}
      title={t('money.payment.title')}
      line={current && !takesPayment && phase !== 'done' ? statusOf(t, day, current.invoice) : owed || undefined}
      onClose={onClose}
      returnFocus={returnFocus}
    >
      {body}
    </Sheet>
  );
}
