/**
 * Bills (W4 4J5, M10; D-Money's bills): what the business owes others. The list is the engine's (venture.bills.list),
 * nearest due first, each with its vendor, dates, state in words and whether it repeats, and what is left to pay on it
 * with the receipt of that balance (its lines and tax less what was paid, 4J20); what open bills owe in all is the
 * engine's figure with its receipt. Amounts go to the engine as the owner typed them; it reads them in the currency.
 *
 * Simple first: adding a bill asks for the vendor, what it was for, the amount and the dates; the tax name and rate are
 * asked only of a business registered for GST (its plan says so), and a business that is not never sees GST fields.
 * Paying records a payment the owner made (Chausar moves no money); it asks a second time, repeating what was typed,
 * and the books count it as a cost. A repeating bill can stop repeating, after a second ask.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Row } from '../../parts/Row';
import { PAYMENT_METHODS, type BillView, type PaymentMethod } from '../../engine/types';
import { Failed, Section } from './parts';
import { messageOf, onMoney, useDay, useLocalToday } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

/** The ways a bill can be paid: the payment sheet's, and a cheque. */
const METHODS: readonly PaymentMethod[] = [...PAYMENT_METHODS, 'cheque'];

export function Bills() {
  const t = useT();
  const list = useResource('venture.bills.list', {}, { refreshOn: onMoney });
  const plan = useResource('venture.blueprint.get', {}, { refreshOn: onMoney });
  const gst = plan.data?.blueprint?.backOffice.taxRegistered.value === true;
  const currency = plan.data?.blueprint?.backOffice.currency ?? 'INR';
  const bills = list.data?.bills ?? [];
  const owed = list.data?.owed ?? null;
  const [adding, setAdding] = useState(false);
  const total = owed && <span className={v.owedBills}><span>{t('money.bills.owed')}</span><Figure value={owed.display} receiptId={owed.receiptId} /></span>;

  return (
    <>
      {list.error && <Failed error={list.error} />}
      <Section title={t('money.sub.bills')} end={!adding ? <Button size="sm" onClick={() => setAdding(true)}>{t('money.bills.add')}</Button> : undefined}>
        {list.data && bills.length === 0 && <EmptyState title={t('money.bills.none')} line={t('money.bills.noneLine')} />}
        {bills.length > 0 && (
          <>
            {total}
            <ul className={s.list}>
              {bills.map((bill) => <BillRow key={bill.id} bill={bill} currency={currency} onChanged={list.reload} />)}
            </ul>
          </>
        )}
      </Section>
      {/* Simple first: the form opens on request. */}
      {adding && (
        <Section title={t('money.bills.add')}>
          <AddBill gst={gst} currency={currency} onAdded={list.reload} onClose={() => setAdding(false)} />
        </Section>
      )}
    </>
  );
}

function BillRow({ bill, currency, onChanged }: { bill: BillView; currency: string; onChanged: () => void }) {
  const t = useT();
  const day = useDay();
  const engine = useEngine();
  const [paying, setPaying] = useState(false);
  const [stopping, setStopping] = useState<'ask' | 'busy' | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const open = bill.state !== 'paid';

  async function stop() {
    setStopping('busy');
    try {
      await engine.request('venture.bills.stop', { billId: bill.id });
      onChanged();
    } catch (error) {
      setSaid(t('money.bills.failed', { message: messageOf(error) }));
    }
    setStopping(null);
  }

  return (
    <Row
      id={bill.id}
      title={bill.vendor}
      line={t('money.bills.line', { bill: day(bill.billDate), due: day(bill.dueDate) })}
      aside={(
        <span className={v.billAside}>
          <span className={v.billState} data-state={bill.state}>{t(`money.bills.state.${bill.state}`)}</span>
          {bill.recurring && <span className={v.quiet}>{t(`money.bills.repeats.${bill.recurring}`)}</span>}
          {/* What is left to pay, with the receipt of how it was made; a paid bill says so in words. */}
          {bill.receiptId && bill.state !== 'paid' && <Figure value={bill.balance} receiptId={bill.receiptId} />}
        </span>
      )}
      actions={(
        <>
          {bill.recurring && stopping === null && !paying && <Button size="sm" variant="quiet" onClick={() => setStopping('ask')}>{t('money.bills.stop')}</Button>}
          {open && bill.state !== 'draft' && !paying && stopping === null && <Button size="sm" onClick={() => setPaying(true)}>{t('money.bills.pay')}</Button>}
        </>
      )}
    >
      {stopping !== null && (
        <div className={s.ask}>
          <p>{t('money.bills.stopAsk', { vendor: bill.vendor })}</p>
          <div className={s.buttons}>
            <Button disabled={stopping === 'busy'} onClick={() => setStopping(null)}>{t('approval.cancel')}</Button>
            <Button variant="primary" data-confirm="" disabled={stopping === 'busy'} onClick={() => void stop()}>{t('money.bills.stopConfirm')}</Button>
          </div>
        </div>
      )}
      {paying && <PayBill bill={bill} currency={currency} onDone={() => { setPaying(false); onChanged(); }} onCancel={() => setPaying(false)} />}
      {said && <p className={s.refusal} role="status" data-engine-line="">{said}</p>}
    </Row>
  );
}

/** Record a payment the owner made of a bill: typed, asked again, then sent. */
function PayBill({ bill, currency, onDone, onCancel }: { bill: BillView; currency: string; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const day = useDay();
  const engine = useEngine();
  const today = useLocalToday();
  const methodId = useId();
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>('bank-transfer');
  const [phase, setPhase] = useState<'form' | 'confirm' | 'sending'>('form');
  const [problem, setProblem] = useState<string | null>(null);
  async function pay() {
    setPhase('sending');
    setProblem(null);
    try {
      // As typed: the engine reads it in the bill's currency.
      await engine.request('venture.bills.pay', { billId: bill.id, amount: amount.trim(), paidOn, method });
      onDone();
    } catch (error) {
      setProblem(t('money.bills.failed', { message: messageOf(error) }));
      setPhase('form');
    }
  }

  return (
    <form className={s.form} noValidate onSubmit={(event) => { event.preventDefault(); if (amount.trim() !== '' && paidOn) setPhase('confirm'); else setProblem(t('money.typed.amount', { currency })); }}>
      <Field label={t('money.bills.paid')} hint={t('money.bills.amountHint', { currency })} value={amount} inputMode="decimal" autoComplete="off" disabled={phase !== 'form'} onChange={(event) => setAmount(event.currentTarget.value)} />
      <Field label={t('money.bills.paidOn')} type="date" value={paidOn} disabled={phase !== 'form'} onChange={(event) => setPaidOn(event.currentTarget.value)} />
      <div className={s.field}>
        <label htmlFor={methodId} className={s.fieldLabel}>{t('money.payment.method')}</label>
        <select id={methodId} className={s.select} value={method} disabled={phase !== 'form'} onChange={(event) => setMethod(event.currentTarget.value as PaymentMethod)}>
          {METHODS.map((option) => <option key={option} value={option}>{t(`money.method.${option}`)}</option>)}
        </select>
      </div>
      {phase === 'form' ? (
        <div className={s.buttons}>
          <Button onClick={onCancel}>{t('approval.cancel')}</Button>
          <Button variant="primary" type="submit">{t('money.bills.pay')}</Button>
        </div>
      ) : (
        <div className={s.ask}>
          <p>{t('money.bills.payAsk', { amount: amount.trim(), currency, vendor: bill.vendor, date: day(paidOn) })}</p>
          <div className={s.buttons}>
            <Button disabled={phase === 'sending'} onClick={() => setPhase('form')}>{t('approval.cancel')}</Button>
            <Button variant="primary" data-confirm="" disabled={phase === 'sending'} onClick={() => void pay()}>{t('money.bills.payConfirm')}</Button>
          </div>
        </div>
      )}
      {problem && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
    </form>
  );
}

/** Add a bill: one line, its dates and whether it repeats; tax only for a GST business. */
function AddBill({ gst, currency, onAdded, onClose }: { gst: boolean; currency: string; onAdded: () => void; onClose: () => void }) {
  const t = useT();
  const engine = useEngine();
  const today = useLocalToday();
  const repeatId = useId();
  const [vendor, setVendor] = useState('');
  const [what, setWhat] = useState('');
  const [amount, setAmount] = useState('');
  const [taxName, setTaxName] = useState('');
  const [rate, setRate] = useState('');
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [repeats, setRepeats] = useState<'none' | 'monthly' | 'quarterly'>('none');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);

  async function add() {
    const typedRate = gst && rate.trim() !== '' ? rate.trim() : '0';
    setBusy(true);
    setSaid(null);
    try {
      await engine.request('venture.bills.add', {
        vendor: vendor.trim(), billDate, dueDate, recurring: repeats === 'none' ? null : repeats,
        // As typed: the engine reads the amount in the business's currency and the rate as a percentage.
        lines: [{ description: what.trim() || vendor.trim(), amount: amount.trim(), taxName: typedRate !== '0' ? taxName.trim() : '', taxRate: typedRate }],
      });
      setVendor(''); setWhat(''); setAmount(''); setTaxName(''); setRate(''); setRepeats('none');
      setSaid({ text: t('money.bills.added'), problem: false });
      onAdded();
    } catch (error) {
      setSaid({ text: t('money.bills.failed', { message: messageOf(error) }), problem: true });
    }
    setBusy(false);
  }

  return (
    <form className={s.form} noValidate onSubmit={(event) => { event.preventDefault(); void add(); }}>
      <Field label={t('money.bills.vendor')} value={vendor} autoComplete="off" disabled={busy} onChange={(event) => setVendor(event.currentTarget.value)} />
      <Field label={t('money.bills.what')} value={what} autoComplete="off" disabled={busy} onChange={(event) => setWhat(event.currentTarget.value)} />
      <Field label={t('money.bills.amount')} hint={t('money.bills.amountHint', { currency })} value={amount} inputMode="decimal" autoComplete="off" disabled={busy} onChange={(event) => setAmount(event.currentTarget.value)} />
      {gst && (
        <>
          <Field label={t('money.bills.taxName')} hint={t('money.bills.taxNameHint')} value={taxName} autoComplete="off" disabled={busy} onChange={(event) => setTaxName(event.currentTarget.value)} />
          <Field label={t('money.bills.taxRate')} hint={t('money.bills.taxRateHint')} value={rate} inputMode="decimal" autoComplete="off" disabled={busy} onChange={(event) => setRate(event.currentTarget.value)} />
        </>
      )}
      <Field label={t('money.bills.billDate')} type="date" value={billDate} disabled={busy} onChange={(event) => setBillDate(event.currentTarget.value)} />
      <Field label={t('money.bills.dueDate')} type="date" value={dueDate} disabled={busy} onChange={(event) => setDueDate(event.currentTarget.value)} />
      <div className={s.field}>
        <label htmlFor={repeatId} className={s.fieldLabel}>{t('money.bills.repeat')}</label>
        <select id={repeatId} className={s.select} value={repeats} disabled={busy} onChange={(event) => setRepeats(event.currentTarget.value as typeof repeats)}>
          <option value="none">{t('money.bills.repeat.none')}</option>
          <option value="monthly">{t('money.bills.repeat.monthly')}</option>
          <option value="quarterly">{t('money.bills.repeat.quarterly')}</option>
        </select>
      </div>
      <div className={s.buttons}>
        <Button disabled={busy} onClick={onClose}>{t('approval.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy || vendor.trim() === '' || amount.trim() === ''}>{t('money.bills.addButton')}</Button>
      </div>
      {said && <p className={said.problem ? s.refusal : s.notice} role="status" data-engine-line={said.problem ? '' : undefined}>{said.text}</p>}
    </form>
  );
}
