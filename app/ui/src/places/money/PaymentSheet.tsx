/**
 * Recording a payment, as a form beside the list. The amount is the owner's own text, sent as typed; the engine
 * reads it, checks it against the balance and answers with the invoice's new figures. Recording cannot be undone,
 * so the form asks a second time, repeating exactly what was typed.
 *
 * W4 4J20 (4J5, M11 and M15): a cheque is one of the ways money comes in, and it counts only once it clears (marked
 * in the invoice sheet, or matched to a bank row). TDS the client deducted is one step away, for a business in India:
 * its section and amount as the client wrote them, sent as typed, to be shown on the client's TDS certificate.
 *
 * Simple first (4J20): a payment pays this one invoice. "Split across invoices", one step away, names how much of it
 * goes to this invoice and to each other open one (allocations); the engine checks the parts add up to the payment
 * exactly and refuses otherwise, so nothing is added up here. A split payment carries no TDS.
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
/** The ways money comes in: the engine's list, and a cheque, which waits to clear (4J5). */
const METHODS: readonly PaymentMethod[] = [...PAYMENT_METHODS, 'cheque'];

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
  const [tdsSection, setTdsSection] = useState('');
  const [tdsAmount, setTdsAmount] = useState('');
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Record<string, string>>({});
  const list = useResource('venture.invoice.list', {}, { skip: !split });
  const others = (list.data ?? []).filter((item) => item.id !== id && item.number !== null && (item.status === 'issued' || item.status === 'part-paid'));
  const allocations = Object.entries(parts).filter(([, typed]) => typed.trim() !== '').map(([invoiceId, typed]) => ({ invoiceId, amount: typed.trim() }));
  const [phase, setPhase] = useState<Phase>('form');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ view: InvoiceViewLite; receiptId: string | null; note: string | null } | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (phase === 'confirm') cancelRef.current?.focus(); }, [phase]);

  const current = recorded?.view ?? view.data;
  const balance = current?.figures.find((figure) => figure.key === 'balance');
  const takesPayment = current?.invoice.status === 'issued' || current?.invoice.status === 'part-paid';
  // A split needs at least one part typed before it can be recorded.
  const ready = amount.trim() !== '' && receivedOn !== '' && (!split || allocations.length > 0);
  // TDS is an Indian tax: offered by the business's country, whatever the invoice's currency.
  const business = useResource('venture.get', {});
  const india = business.data?.venture.country?.code === 'IN';
  const numberOf = (invoiceId: string) => (invoiceId === id ? current?.invoice.number : others.find((other) => other.id === invoiceId)?.number) ?? '';
  const locked = phase !== 'form';

  async function record(shown: InvoiceViewLite) {
    setPhase('sending');
    setRefusal(null);
    const before = new Set(shown.payments.map((payment) => payment.id));
    try {
      const tds = india && tdsSection.trim() !== '' && tdsAmount.trim() !== '' ? { tds: { section: tdsSection.trim(), amount: tdsAmount.trim() } } : {};
      // Split: the payment, and how much of it goes to each invoice, as typed; the engine checks the parts add up.
      const next = split
        ? await engine.request('venture.payment.record', { amount: amount.trim(), receivedOn, method, allocations })
        : await engine.request('venture.payment.record', { invoiceId: id, amount: amount.trim(), receivedOn, method, ...tds });
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
      {/* 4Z3: the mark named for what is still owed, the amount it sits beside. */}
      <Receipt id={current.invoice.priceReceiptId} amount={balance.display} />
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
              {METHODS.map((option) => <option key={option} value={option}>{t(`money.method.${option}`)}</option>)}
            </select>
          </div>
          {method === 'cheque' && <p className={s.quietLine}>{t('money.payment.chequeNote')}</p>}
          {/* One step away, for a business in India: the TDS the client deducted, as they wrote it (4J5, M15). Kept while
              the payment is split, though a split payment carries none: closing Split brings it back as typed. */}
          {india && (
            <details className={s.fold}>
              <summary>{t('money.payment.tds')}</summary>
              {split && <p className={s.quietLine}>{t('money.payment.tdsSplit')}</p>}
              <Field label={t('money.payment.tdsSection')} hint={t('money.payment.tdsSectionHint')} value={tdsSection} autoComplete="off" disabled={locked || split} onChange={(event) => setTdsSection(event.currentTarget.value)} />
              <Field label={t('money.payment.tdsAmount')} hint={t('money.payment.amountHint', { currency })} value={tdsAmount} inputMode="decimal" autoComplete="off" disabled={locked || split} onChange={(event) => setTdsAmount(event.currentTarget.value)} />
            </details>
          )}
          {/* One step away: the payment split across invoices (4J5, M11). */}
          <details className={s.fold} onToggle={(event) => setSplit(event.currentTarget.open)}>
            <summary>{t('money.payment.split')}</summary>
            <p className={s.quietLine}>{t('money.payment.splitLine')}</p>
            <Field
              label={t('money.payment.splitThis', { number: current.invoice.number ?? '' })} hint={t('money.payment.amountHint', { currency })} value={parts[id] ?? ''}
              inputMode="decimal" autoComplete="off" disabled={locked} onChange={(event) => { const typed = event.currentTarget.value; setParts((was) => ({ ...was, [id]: typed })); }}
            />
            {others.map((other) => (
              <Field
                key={other.id} label={t('money.payment.splitThis', { number: other.number ?? '' })} value={parts[other.id] ?? ''}
                inputMode="decimal" autoComplete="off" disabled={locked} onChange={(event) => { const typed = event.currentTarget.value; setParts((was) => ({ ...was, [other.id]: typed })); }}
              />
            ))}
            {list.data && others.length === 0 && <p className={s.quietLine}>{t('money.payment.splitNone')}</p>}
          </details>
          {phase === 'form' && (
            <div className={s.buttons}>
              <Button variant="primary" type="submit" disabled={!ready}>{t('money.payment.record')}</Button>
            </div>
          )}
        </form>
        {(phase === 'confirm' || phase === 'sending') && (
          <div className={`${s.ask} ${s.block}`}>
            <p>{split ? t('money.payment.splitAsk', { amount: amount.trim(), currency, date: day(receivedOn), count: String(allocations.length) }) : t('money.payment.ask', { amount: amount.trim(), currency, date: day(receivedOn) })}</p>
            {/* A split's second ask names each part as typed, like every other second ask. */}
            {split && (
              <ul className={s.plain}>
                {allocations.map((part) => <li key={part.invoiceId}>{t('money.payment.splitPart', { number: numberOf(part.invoiceId), amount: part.amount, currency })}</li>)}
              </ul>
            )}
            {!split && india && tdsSection.trim() !== '' && tdsAmount.trim() !== '' && <p>{t('money.payment.tdsAsk', { amount: tdsAmount.trim(), currency, section: tdsSection.trim() })}</p>}
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
