/**
 * The parts of one invoice that wave 4 adds to its sheet (W4 4J5, M11, M12 and M15): its one next step by state, a
 * draft's rate change (recalculating is the owner's choice), its credit notes and a way to ask for one, each payment
 * with a cheque that waits to clear and the TDS the client deducted, and its short timeline. Every line is worded here
 * from the engine's codes and dates. The one amount here is a credit note's own, shown as a Figure with the receipt that
 * names it (credit-note:<id>, 4J20); every other amount stays in the invoice's figures above, under their receipts.
 * Amounts the owner types go to the engine as typed; it reads them in the invoice's currency.
 *
 * A credit note goes on the always-ask floor: asking for one here (after a second ask) puts it on Today, where issuing
 * it asks a second time again. Clearing a cheque counts its money as received from today, after a second ask.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Receipt } from '../../parts/Receipt';
import type { InvoiceViewLite, PaymentLite } from '../../engine/types';
import { keepDraft } from '../clients/handoff';
import { messageOf, useDay } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

type Changed = (next?: InvoiceViewLite) => void;

/** The invoice's one next step (the engine's `next`), in the UI's words, with its action where it has one. */
export function NextStep({ view }: { view: InvoiceViewLite }) {
  const t = useT();
  const engine = useEngine();
  const [problem, setProblem] = useState<string | null>(null);
  const next = view.next;
  if (!next || next.action === 'none' || next.action === 'issue') return null;
  const late = view.late ?? view.invoice.late;
  const words = next.action === 'clear' ? t('money.next.clear')
    : next.action === 'remind' ? (next.draftId ? t('money.next.drafted') : t('money.next.remind'))
      : t('money.next.wait');

  async function remind(origin: HTMLElement) {
    setProblem(null);
    try {
      const made = await engine.request('venture.invoice.remind', { invoiceId: view.invoice.id });
      keepDraft(engine, made.draft);
      openSheet('outreach', made.draft.id, origin);
    } catch (error) {
      setProblem(t('money.remind.failedOne', { message: messageOf(error) }));
    }
  }

  return (
    <div className={v.nextStep} data-next={next.action}>
      <p>
        {late && <span className={v.late}>{t('money.late', { count: String(late.days) })}</span>}
        <span>{words}</span>
      </p>
      {next.action === 'remind' && (next.draftId
        ? <Button size="sm" onClick={(event) => openSheet('outreach', next.draftId!, event.currentTarget)}>{t('money.remind.open')}</Button>
        : <Button size="sm" onClick={(event) => void remind(event.currentTarget)}>{t('money.invoices.remind')}</Button>)}
      {problem && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
    </div>
  );
}

/** A draft priced at a tax rate the plan no longer charges: the change in the engine's words, and drafting it again. */
export function RateChange({ view, onChanged }: { view: InvoiceViewLite; onChanged: Changed }) {
  const t = useT();
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const change = view.rateChange;
  if (!change || view.invoice.status !== 'draft') return null;

  async function again() {
    setBusy(true);
    setProblem(null);
    try {
      onChanged(await engine.request('venture.invoice.prepare', { orderId: view.invoice.orderId }));
    } catch (error) {
      setProblem(t('money.invoices.prepareFailed', { message: messageOf(error) }));
    }
    setBusy(false);
  }

  return (
    <div className={v.banner} role="status">
      {/* The engine's sentence names the rate charged and the rate now (rates, never amounts). */}
      <p data-engine-line="">{change.line}</p>
      <p className={v.quiet}>{t('money.rate.choice')}</p>
      <Button size="sm" disabled={busy} onClick={() => void again()}>{t('money.rate.again')}</Button>
      {problem && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
    </div>
  );
}

/** One payment: how and when it came, a cheque still waiting with Mark cleared, the TDS the client deducted. */
export function PaymentLine({ payment, onChanged }: { payment: PaymentLite; onChanged: Changed }) {
  const t = useT();
  const day = useDay();
  const engine = useEngine();
  const [phase, setPhase] = useState<'idle' | 'ask' | 'busy'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const pending = payment.state === 'pending';

  async function clear() {
    setPhase('busy');
    setProblem(null);
    try {
      onChanged(await engine.request('venture.payment.clear', { paymentId: payment.id }));
    } catch (error) {
      setProblem(t('money.cheque.failed', { message: messageOf(error) }));
    }
    setPhase('idle');
  }

  return (
    <li className={s.payment}>
      <span>
        {pending ? t('money.cheque.waiting', { date: day(payment.receivedOn) }) : t('money.invoice.payment', { date: day(payment.receivedOn), method: t(`money.method.${payment.method}`) })}
        {payment.chequeOn && !pending && <span className={v.quiet}> · {t('money.cheque.came', { date: day(payment.chequeOn) })}</span>}
      </span>
      {payment.booksReceiptId ? <Receipt id={payment.booksReceiptId} /> : payment.booksNote ? <span className={s.note} data-engine-line="">{payment.booksNote}</span> : null}
      {payment.tds && <span className={v.tds}>{t('money.payment.tdsLine', { section: payment.tds.section })}</span>}
      {pending && phase === 'idle' && <Button size="sm" onClick={() => setPhase('ask')}>{t('money.cheque.clear')}</Button>}
      {pending && phase !== 'idle' && (
        <span className={s.ask}>
          <span>{t('money.cheque.ask')}</span>
          <span className={s.buttons}>
            <Button size="sm" disabled={phase === 'busy'} onClick={() => setPhase('idle')}>{t('approval.cancel')}</Button>
            <Button size="sm" variant="primary" data-confirm="" disabled={phase === 'busy'} onClick={() => void clear()}>{t('money.cheque.confirm')}</Button>
          </span>
        </span>
      )}
      {problem && <span className={s.refusal} role="status" data-engine-line="">{problem}</span>}
    </li>
  );
}

/** Credit notes on this invoice, each in words by its state, and asking for a new one on an open invoice. */
export function Credits({ view }: { view: InvoiceViewLite }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  const credits = view.credits ?? [];
  const open = view.invoice.status === 'issued' || view.invoice.status === 'part-paid';
  if (credits.length === 0 && !open) return null;
  return (
    <section className={s.block} aria-label={t('money.credit.title')}>
      <h3 className={s.blockTitle}>{t('money.credit.title')}</h3>
      {credits.length > 0 && (
        <ul className={s.plain}>
          {credits.map((credit) => (
            <li key={credit.id} className={v.credit} data-state={credit.state}>
              <span className={v.creditState}>{credit.number ?? t(`money.credit.state.${credit.state}`)}</span>
              {/* 4J20: the note's amount, with the receipt of the balance it is part of. */}
              {credit.receiptId && <Figure value={credit.amount} receiptId={credit.receiptId} />}
              {credit.number && <span>{t(`money.credit.state.${credit.state}`)}</span>}
              <span className={v.quiet} data-content="">{credit.reason}</span>
              {credit.rowId && credit.state === 'waiting' && <a className={s.more} href="#/today">{t('money.credit.onToday')}</a>}
            </li>
          ))}
        </ul>
      )}
      {open && !asking && <Button size="sm" onClick={() => setAsking(true)}>{t('money.credit.ask')}</Button>}
      {open && asking && <CreditForm view={view} onDone={() => setAsking(false)} />}
      {credits.length === 0 && open && !asking && <p className={s.quietLine}>{t('money.credit.none')}</p>}
    </section>
  );
}

function CreditForm({ view, onDone }: { view: InvoiceViewLite; onDone: () => void }) {
  const t = useT();
  const engine = useEngine();
  const currency = view.invoice.currency;
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [phase, setPhase] = useState<'form' | 'confirm' | 'sending' | 'done'>('form');
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);

  async function send() {
    setPhase('sending');
    setSaid(null);
    try {
      // As typed: the engine reads it in the invoice's currency.
      await engine.request('venture.credit.issue', { invoiceId: view.invoice.id, amount: amount.trim(), reason: reason.trim(), digest: view.invoice.digest });
      setPhase('done');
      setSaid({ text: t('money.credit.waiting'), problem: false });
    } catch (error) {
      setPhase('form');
      setSaid({ text: t('money.credit.failed', { message: messageOf(error) }), problem: true });
    }
  }

  if (phase === 'done') {
    return (
      <div className={s.notice} role="status">
        <span>{said?.text}</span>
        <a className={s.more} href="#/today" onClick={onDone}>{t('money.credit.onToday')}</a>
      </div>
    );
  }

  return (
    <form className={s.form} noValidate onSubmit={(event) => { event.preventDefault(); if (amount.trim() !== '' && reason.trim().length >= 3) setPhase('confirm'); else setSaid({ text: amount.trim() ? t('money.credit.reasonHint') : t('money.typed.amount', { currency }), problem: true }); }}>
      <Field label={t('money.credit.amount')} hint={t('money.payment.amountHint', { currency })} value={amount} inputMode="decimal" autoComplete="off" disabled={phase !== 'form'} onChange={(event) => setAmount(event.currentTarget.value)} />
      <Field label={t('money.credit.reason')} hint={t('money.credit.reasonHint')} value={reason} autoComplete="off" disabled={phase !== 'form'} onChange={(event) => setReason(event.currentTarget.value)} />
      {phase === 'form' ? (
        <div className={s.buttons}>
          <Button onClick={onDone}>{t('approval.cancel')}</Button>
          <Button variant="primary" type="submit">{t('money.credit.ask')}</Button>
        </div>
      ) : (
        <div className={s.ask}>
          <p>{t('money.credit.askAgain', { amount: amount.trim(), currency, number: view.invoice.number ?? '' })}</p>
          <div className={s.buttons}>
            <Button disabled={phase === 'sending'} onClick={() => setPhase('form')}>{t('approval.cancel')}</Button>
            <Button variant="primary" data-confirm="" disabled={phase === 'sending'} onClick={() => void send()}>{t('money.credit.confirm')}</Button>
          </div>
        </div>
      )}
      {said && <p className={said.problem ? s.refusal : s.notice} role="status" data-engine-line={said.problem ? '' : undefined}>{said.text}</p>}
    </form>
  );
}

/** The invoice's short timeline: what happened by date, then where it stands, each in the UI's words. */
export function Timeline({ view }: { view: InvoiceViewLite }) {
  const t = useT();
  const day = useDay();
  const entries = view.timeline ?? [];
  if (entries.length === 0) return null;
  return (
    <section className={s.block} aria-label={t('money.timeline.title')}>
      <h3 className={s.blockTitle}>{t('money.timeline.title')}</h3>
      <ol className={v.timeline}>
        {entries.map((entry, index) => (
          <li key={`${index}:${entry.what}`} className={v.timelineItem} data-what={entry.what}>
            <span>{t(`money.timeline.${entry.what}`)}</span>
            <span className={v.quiet}>{day(entry.on)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
