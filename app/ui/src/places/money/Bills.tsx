import { messageOf } from '../../../../../platform/shared/errors.ts';
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
 *
 * One-shot C4 (T22): a bill due today says "Due today" beside its state, and what it is for (the engine's purpose, from
 * its lines) leads its second line. The add form's due date starts at the vendor's last terms (the engine's terms on
 * bills.list), else the engine's default days after the bill date; left as it starts, no due date is sent and the
 * engine works it out the same way.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { dayPlus } from '../../parts/when';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { EmptyState } from '../../parts/EmptyState';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Row } from '../../parts/Row';
import { PAYMENT_METHODS, type BillView, type PaymentMethod } from '../../engine/types';
import { Failed, Section } from './parts';
import { onMoney, typedWords, useDay, useLocalToday } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';
import vLocal from './Bills.module.css';
import { Select } from '../../parts/Select';
import { useArrivals } from '../../parts/useArrivals';
import { Reveal } from '../../parts/RevealBlock';

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
  const total = bills.length > 1 && owed && <span className={vLocal.owedBills}><span>{t('money.bills.owed')}</span><Figure value={owed.display} receiptId={owed.receiptId} /></span>;

  return (
    <>
      {list.error && <Failed error={list.error} />}
      {!adding && list.data && bills.length === 0 && <EmptyState title={t('money.bills.none')} line={t('money.bills.noneLine')} primary={{ label: t('money.bills.add'), onSelect: () => setAdding(true) }} />}
      {!adding && bills.length > 0 && <div className={s.buttons}><Button size="sm" onClick={() => setAdding(true)}>{t('money.bills.add')}</Button></div>}
      <div>
        {list.data && (
          <>
            {total}
            <ul className={s.list}>
              <BillRows bills={bills} currency={currency} onChanged={list.reload} />
            </ul>
          </>
        )}
      </div>
      {/* Simple first: the form opens on request. */}
      <Reveal open={adding}>
        <Section title={t('money.bills.add')}>
          <AddBill gst={gst} currency={currency} terms={list.data?.terms ?? []} defaultDays={list.data?.defaultDueDays ?? null} onAdded={() => { list.reload(); setAdding(false); }} onClose={() => setAdding(false)} />
        </Section>
      </Reveal>
    </>
  );
}

function BillRows({ bills, currency, onChanged }: { bills: BillView[]; currency: string; onChanged: () => void }) {
  const arriving = useArrivals(bills.map(bill => bill.id));
  // Paid bills stay in this plain list, with their new state and receipt. It has no disappearing To pay group.
  return bills.map(bill => <BillRow key={bill.id} bill={bill} arriving={arriving.has(bill.id)} currency={currency} onChanged={onChanged} />);
}

function BillRow({ bill, currency, onChanged, arriving }: { bill: BillView; currency: string; onChanged: () => void; arriving?: boolean }) {
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
      arriving={arriving}
      title={bill.vendor}
      line={bill.purpose ? t('money.bills.lineFor', { purpose: bill.purpose, bill: day(bill.billDate), due: day(bill.dueDate) }) : t('money.bills.line', { bill: day(bill.billDate), due: day(bill.dueDate) })}
      aside={(
        <span className={vLocal.billAside}>
          <span className={vLocal.billState} data-state={bill.state}>{t(`money.bills.state.${bill.state}`)}</span>
          {bill.dueToday && <span className={vLocal.billState} data-state="due-today" data-due-today="">{t('money.bills.dueToday')}</span>}
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
      <Select label={t('money.payment.method')} value={method} disabled={phase !== 'form'} onChange={(event) => setMethod(event.currentTarget.value as PaymentMethod)}>
          {METHODS.map((option) => <option key={option} value={option}>{t(`money.method.${option}`)}</option>)}
        </Select>
      {phase === 'form' ? (
        <div className={s.buttons}>
          <Button onClick={onCancel}>{t('approval.cancel')}</Button>
          <Button variant="primary" type="submit">{t('money.bills.pay')}</Button>
        </div>
      ) : (
        <div className={s.ask}>
          <p>{t('money.bills.payAsk', { amount: typedWords(amount, currency), vendor: bill.vendor, date: day(paidOn) })}</p>
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

const vendorKey = (vendor: string) => vendor.trim().replace(/\s+/g, ' ').toLowerCase();

/** Add a bill: one line, its dates and whether it repeats; tax only for a GST business. */
function AddBill({ gst, currency, terms, defaultDays, onAdded, onClose }: { gst: boolean; currency: string; terms: readonly { vendor: string; days: number }[]; defaultDays: number | null; onAdded: () => void; onClose: () => void }) {
  const t = useT();
  const engine = useEngine();
  const today = useLocalToday();
  const [vendor, setVendor] = useState('');
  const [what, setWhat] = useState('');
  const [amount, setAmount] = useState('');
  const [taxName, setTaxName] = useState('');
  const [rate, setRate] = useState('');
  const [billDate, setBillDate] = useState(today);
  // C4 (T22): null until the owner picks a due date; until then it follows the vendor's last terms.
  const [dueTyped, setDueTyped] = useState<string | null>(null);
  const days = terms.find((item) => vendorKey(item.vendor) === vendorKey(vendor))?.days ?? defaultDays;
  const dueDate = dueTyped ?? (days === null ? billDate : dayPlus(billDate, days));
  const [repeats, setRepeats] = useState<'none' | 'monthly' | 'quarterly'>('none');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);

  async function add() {
    const typedRate = gst && rate.trim() !== '' ? rate.trim() : '0';
    setBusy(true);
    setSaid(null);
    try {
      await engine.request('venture.bills.add', {
        // C4 (T22): left as it started, the engine works the due date out from the same terms.
        vendor: vendor.trim(), billDate, ...(dueTyped !== null || days === null ? { dueDate } : {}), recurring: repeats === 'none' ? null : repeats,
        // As typed: the engine reads the amount in the business's currency and the rate as a percentage.
        lines: [{ description: what.trim() || vendor.trim(), amount: amount.trim(), taxName: typedRate !== '0' ? taxName.trim() : '', taxRate: typedRate }],
      });
      setVendor(''); setWhat(''); setAmount(''); setTaxName(''); setRate(''); setRepeats('none'); setDueTyped(null);
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
      <Field label={t('money.bills.amount')} adornment={currency} value={amount} inputMode="decimal" autoComplete="off" disabled={busy} onChange={(event) => setAmount(event.currentTarget.value)} />
      {gst && (
        <>
          <Field label={t('money.bills.taxName')} hint={t('money.bills.taxNameHint')} value={taxName} autoComplete="off" disabled={busy} onChange={(event) => setTaxName(event.currentTarget.value)} />
          <Field label={t('money.bills.taxRate')} hint={t('money.bills.taxRateHint')} value={rate} inputMode="decimal" autoComplete="off" disabled={busy} onChange={(event) => setRate(event.currentTarget.value)} />
        </>
      )}
      <Field label={t('money.bills.billDate')} type="date" value={billDate} disabled={busy} onChange={(event) => setBillDate(event.currentTarget.value)} />
      <Field label={t('money.bills.dueDate')} type="date" value={dueDate} disabled={busy} onChange={(event) => setDueTyped(event.currentTarget.value)} />
      <Select label={t('money.bills.repeat')} value={repeats} disabled={busy} onChange={(event) => setRepeats(event.currentTarget.value as typeof repeats)}>
          <option value="none">{t('money.bills.repeat.none')}</option>
          <option value="monthly">{t('money.bills.repeat.monthly')}</option>
          <option value="quarterly">{t('money.bills.repeat.quarterly')}</option>
        </Select>
      <div className={s.buttons}>
        <Button disabled={busy} onClick={onClose}>{t('approval.cancel')}</Button>
        <Button variant="primary" type="submit" disabled={busy} disabledReason={vendor.trim() === '' || amount.trim() === '' ? t('money.bills.needBoth') : undefined}>{t('money.bills.addButton')}</Button>
      </div>
      {said && <p className={said.problem ? s.refusal : s.notice} role="status" data-engine-line={said.problem ? '' : undefined}>{said.text}</p>}
    </form>
  );
}
