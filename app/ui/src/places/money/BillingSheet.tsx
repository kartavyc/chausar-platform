/**
 * Wave 6 money (6D1 to 6D3): how clients pay, the owner's own billing settings, in a sheet beside the invoices. The UPI
 * ID, the name clients see, the bank details, the days until an invoice is due, a payment terms line and the reminder
 * days late. Everything is sent as typed; the engine checks it (a UPI ID must be one) and answers in its own words. The
 * Razorpay keys go straight to the engine, which keeps them in this computer's protected storage; the sheet never shows
 * them again, only which account they are for. Razorpay is labelled fixture-tested until it has run on a real account.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { BillingPatch, BillingView } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { messageOf, onMoney } from './words';
import s from './Money.module.css';

type Form = { upiId: string; payeeName: string; accountName: string; accountNumber: string; ifsc: string; swift: string; bankName: string; dueInDays: string; terms: string; reminders: string };
const EMPTY: Form = { upiId: '', payeeName: '', accountName: '', accountNumber: '', ifsc: '', swift: '', bankName: '', dueInDays: '', terms: '', reminders: '' };

function formOf(view: BillingView): Form {
  const { settings } = view;
  return {
    upiId: settings.upiId ?? '', payeeName: settings.payeeName ?? '', accountName: settings.bank?.accountName ?? '', accountNumber: settings.bank?.accountNumber ?? '',
    ifsc: settings.bank?.ifsc ?? '', swift: settings.bank?.swift ?? '', bankName: settings.bank?.bankName ?? '', dueInDays: String(settings.dueInDays),
    terms: settings.terms ?? '', reminders: settings.reminderDays.join(', '),
  };
}

/** The settings as typed: an empty field clears it; days go as typed text, which the engine reads and checks. */
function patchOf(form: Form): BillingPatch {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  const bank = form.accountNumber.trim() || form.accountName.trim()
    ? { accountName: form.accountName.trim(), accountNumber: form.accountNumber.trim(), ifsc: text(form.ifsc), swift: text(form.swift), bankName: text(form.bankName) }
    : null;
  return {
    upiId: text(form.upiId), payeeName: text(form.payeeName), bank, terms: text(form.terms),
    // Days go as typed; the engine reads and checks them.
    ...(form.dueInDays.trim() ? { dueInDays: form.dueInDays.trim() } : {}),
    ...(form.reminders.trim() ? { reminderDays: form.reminders.split(',').map((day) => day.trim()) } : {}),
  };
}

export function BillingSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const view = useResource('venture.billing.get', {}, { refreshOn: onMoney });
  const [answered, setAnswered] = useState<BillingView | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const current = answered ?? view.data ?? null;
  const filled = useRef(false);

  // The form starts from the saved settings once; what the owner types is never overwritten by a later read.
  useEffect(() => { if (view.data && !filled.current) { filled.current = true; setForm(formOf(view.data)); } }, [view.data]);

  const field = (key: keyof Form) => ({ value: form[key], disabled: busy, autoComplete: 'off', onChange: (event: { currentTarget: { value: string } }) => setForm({ ...form, [key]: event.currentTarget.value }) });

  async function send(patch: BillingPatch) {
    setBusy(true);
    setSaid(null);
    setProblem(null);
    try {
      const next = await engine.request('venture.billing.set', patch);
      setAnswered(next);
      setSaid(t('money-pay.settings.saved'));
      return true;
    } catch (error) {
      setProblem(t('money-pay.failed', { message: messageOf(error) }));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveKeys() {
    if (await send({ razorpayKeys: { keyId: keyId.trim(), keySecret: keySecret.trim() } })) { setKeyId(''); setKeySecret(''); }
  }

  const account = current?.settings.razorpay ?? null;
  return (
    <Sheet
      label={t('money-pay.title')}
      eyebrow={t('money-pay.settings.label')}
      title={t('money-pay.title')}
      onClose={onClose}
      returnFocus={returnFocus}
      footer={<div className={s.buttons}><Button variant="primary" disabled={busy || !current} onClick={() => void send(patchOf(form))}>{t('money-pay.settings.save')}</Button></div>}
    >
      <div className={s.sheetCard}>
        <Field label={t('money-pay.settings.upiId')} hint={t('money-pay.settings.upiHint')} {...field('upiId')} />
        <Field label={t('money-pay.settings.payee')} {...field('payeeName')} />
        <Field label={t('money-pay.settings.accountName')} {...field('accountName')} />
        <Field label={t('money-pay.settings.accountNumber')} {...field('accountNumber')} />
        <Field label={t('money-pay.settings.ifsc')} {...field('ifsc')} />
        <Field label={t('money-pay.settings.swift')} {...field('swift')} />
        <Field label={t('money-pay.settings.bankName')} {...field('bankName')} />
        <Field label={t('money-pay.settings.due')} inputMode="numeric" {...field('dueInDays')} />
        <Field label={t('money-pay.settings.terms')} {...field('terms')} />
        <Field label={t('money-pay.settings.reminders')} {...field('reminders')} />
      </div>
      <section className={s.block} aria-label={t('money-pay.settings.razorpay')}>
        <h3 className={s.blockTitle}>{t('money-pay.settings.razorpay')} <span className={s.chipQuiet}>{t('money-pay.fixture')}</span></h3>
        <p className={s.quietLine}>{t('money-pay.settings.razorpayNote')}</p>
        {account && <p className={s.quietLine} data-engine-line="">{t('money-pay.settings.connected', { mode: account.mode, hint: account.keyHint })}</p>}
        <Field label={t('money-pay.settings.keyId')} value={keyId} autoComplete="off" disabled={busy} onChange={(event) => setKeyId(event.currentTarget.value)} />
        <Field label={t('money-pay.settings.keySecret')} type="password" value={keySecret} autoComplete="off" disabled={busy} onChange={(event) => setKeySecret(event.currentTarget.value)} />
        <div className={s.buttons}>
          <Button size="sm" disabled={busy || !keyId.trim() || !keySecret.trim()} onClick={() => void saveKeys()}>{t('money-pay.settings.saveKeys')}</Button>
          {account && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void send({ razorpayKeys: null })}>{t('money-pay.settings.forget')}</Button>}
        </div>
      </section>
      {said && <p className={s.notice} role="status">{said}</p>}
      {problem && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
    </Sheet>
  );
}
