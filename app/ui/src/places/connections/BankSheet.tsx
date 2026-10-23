/**
 * Connections > Bank account (Ink v2 wave 2, 2D): one sheet for the bank card. The engine's line on why nothing reads
 * the bank on its own; the statement import (BankImport.tsx); each account with its consent line, Renew and Stop
 * (venture.bank.consent), its alert rules in the engine's words with where alerts go, in words, never the address
 * (venture.bank.alerts.*); and the ledger (venture.bank.ledger), each row with how the engine reads it against the
 * books and the decisions it allows: Record payment, Add as cost, Skip (venture.bank.apply). Money in that names no
 * invoice offers the open invoices the engine lists (venture.books.summary); after a payment or a cost the row shows the
 * calculator's receipt. Every figure and line here
 * is the engine's own. Ink works out no amount; a new alert sends the amount as the owner typed it.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type {
  BankAlertRuleInputLite, BankAlertsView, BankConsentView, BankLedgerRow, BankLedgerView, BooksSummaryLite,
} from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Receipt } from '../../parts/Receipt';
import { Sheet } from '../../parts/Sheet';
import type { SheetComponentProps } from '../../shell/sheets';
import { BankImportForm } from './BankImport';
import s from './BankSheet.module.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
type Consent = BankConsentView['status'];
type AlertsOf = BankAlertsView['accounts'][number];

export function BankSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const ledger = useResource('venture.bank.ledger', {});
  const alerts = useResource('venture.bank.alerts.get', {});
  // What the engine answered to this sheet's own clicks, kept while the sheet is open, so its words stay in view.
  const [alertsNow, setAlertsNow] = useState<BankAlertsView | null>(null);
  const [consents, setConsents] = useState<Readonly<Record<string, Consent>>>({});
  const [rows, setRows] = useState<Readonly<Record<string, BankLedgerRow>>>({});
  const [said, setSaid] = useState<Readonly<Record<string, { line: string; receiptId: string | null }>>>({});
  const view: BankLedgerView | undefined = ledger.data;
  const alertsView = alertsNow ?? alerts.data;
  // Money in that names no invoice: the owner picks one of the open invoices the engine lists in the books summary.
  const picking = view?.rows.some((row) => row.decided === null && row.classification === 'money-in') ?? false;
  const books = useResource('venture.books.summary', {}, { skip: !picking, refreshOn: (event) => event.type === 'queue.changed' });
  const openInvoices = books.data?.openInvoices ?? null;

  function reload() { ledger.reload(); alerts.reload(); }

  return (
    <Sheet label={t('connections.bankSheet.label')} title={t('connections.bankSheet.title')} line={view?.provider} onClose={onClose} returnFocus={returnFocus}>
      {ledger.error && <p className={s.problem} role="alert">{t('connections.bankSheet.failed', { message: ledger.error.message })}</p>}
      {!view && !ledger.error && <p className={s.note}>{t('connections.bankSheet.loading')}</p>}

      <section className={s.section}>
        <h3 className={s.heading}>{t('connections.bankSheet.importTitle')}</h3>
        <BankImportForm onImported={reload} />
      </section>

      {view && (
        <div className={s.section}>
          {view.accounts.length === 0 && <p className={s.note}>{t('connections.bankSheet.noAccounts')}</p>}
          {view.accounts.map((account) => (
            <AccountBlock
              key={account.id}
              label={account.label}
              consent={consents[account.id] ?? account.consent}
              alerts={alertsView?.accounts.find((item) => item.accountId === account.id) ?? null}
              onConsent={(status) => setConsents((all) => ({ ...all, [account.id]: status }))}
              onAlerts={(next) => { setAlertsNow(next); alerts.reload(); }}
            />
          ))}
        </div>
      )}

      {view && (
        <section className={s.section}>
          <h3 className={s.heading}>{t('connections.bankSheet.transactions')}</h3>
          <p className={s.line}>{view.line}</p>
          <ul className={s.rows}>
            {view.rows.map((row) => (
              <LedgerRow
                key={row.id}
                row={rows[row.id] ?? row}
                said={said[row.id] ?? null}
                openInvoices={openInvoices}
                onApplied={(next, line, receiptId) => {
                  setRows((all) => ({ ...all, [next.id]: next }));
                  setSaid((all) => ({ ...all, [next.id]: { line, receiptId } }));
                  ledger.reload();
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </Sheet>
  );
}

/** One account: its consent line with Renew and Stop, and its alert rules with where alerts go. */
function AccountBlock({ label, consent, alerts, onConsent, onAlerts }: {
  label: string; consent: Consent | null; alerts: AlertsOf | null;
  onConsent: (status: Consent) => void; onAlerts: (view: BankAlertsView) => void;
}) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function change(params: { days?: number; revoke?: boolean }) {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await client.request('venture.bank.consent', { account: label, ...params });
      onConsent(answer.status);
    } catch (error) {
      setProblem(t('connections.bankSheet.consentFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  // Days are a count, not money: left empty, the engine uses its own default.
  const typedDays = days.trim() ? { days: Number.parseInt(days.trim(), 10) } : {};
  const live = consent !== null && (consent.state === 'active' || consent.state === 'expiring');
  return (
    <section className={s.account} aria-labelledby={headingId} data-bank-account="">
      <h3 id={headingId} className={s.name}>{label}</h3>
      <p className={s.line}>{consent ? consent.line : t('connections.bankSheet.consentNone')}</p>
      <div className={s.inline}>
        <div className={s.days}>
          <Field label={t('connections.bankSheet.days')} inputMode="numeric" autoComplete="off" value={days} maxLength={3} onChange={(event) => setDays(event.currentTarget.value)} />
        </div>
        <Button disabled={busy} onClick={() => void change(typedDays)}>{t('connections.bankSheet.renew')}</Button>
        {live && <Button disabled={busy} onClick={() => void change({ revoke: true })}>{t('connections.bankSheet.stop')}</Button>}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <AlertRules account={label} alerts={alerts} onAlerts={onAlerts} />
    </section>
  );
}

/** The kept rules go back exactly as the engine keeps them; a new rule carries the amount as the owner typed it. */
function kept(rules: AlertsOf['rules']): BankAlertRuleInputLite[] {
  return rules.map((rule) => ({ ...rule }));
}

function AlertRules({ account, alerts, onAlerts }: { account: string; alerts: AlertsOf | null; onAlerts: (view: BankAlertsView) => void }) {
  const t = useT();
  const client = useEngine();
  const kindId = useId();
  const [kind, setKind] = useState<'large-debit' | 'balance-below'>('large-debit');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rules = alerts?.rules ?? [];
  const lines = alerts?.ruleLines ?? [];

  async function save(params: { rules: BankAlertRuleInputLite[]; alertAddress?: string | null }) {
    setBusy(true);
    setProblem(null);
    try {
      onAlerts(await client.request('venture.bank.alerts.set', { account, ...params }));
      setAmount('');
    } catch (error) {
      setProblem(t('connections.bankSheet.alertsFailed', { message: messageOf(error) }));
    } finally {
      // The address is never kept on screen: it goes to the engine once, then the field is empty again.
      setAddress('');
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const added: BankAlertRuleInputLite[] = amount.trim() ? [{ kind, amount: amount.trim() }] : [];
    void save({ rules: [...kept(rules), ...added], ...(address.trim() ? { alertAddress: address.trim() } : {}) });
  }

  return (
    <>
      <h4 className={s.minor}>{t('connections.bankSheet.alerts')}</h4>
      {lines.length === 0 && <p className={s.note}>{t('connections.bankSheet.noRules')}</p>}
      {lines.length > 0 && (
        <ul className={s.rules}>
          {lines.map((line, index) => (
            <li key={`${index}-${line}`} className={s.ruleItem}>
              <span>{line}</span>
              <Button variant="quiet" disabled={busy} onClick={() => void save({ rules: kept(rules.filter((_, at) => at !== index)) })}>{t('connections.bankSheet.remove')}</Button>
            </li>
          ))}
        </ul>
      )}
      {alerts && <p className={s.note}>{alerts.destination}</p>}
      <form className={s.form} onSubmit={submit}>
        <div className={s.field}>
          <label htmlFor={kindId} className={s.label}>{t('connections.bankSheet.kind')}</label>
          <select id={kindId} className={s.select} value={kind} onChange={(event) => setKind(event.currentTarget.value as typeof kind)}>
            <option value="large-debit">{t('connections.bankSheet.kind.large-debit')}</option>
            <option value="balance-below">{t('connections.bankSheet.kind.balance-below')}</option>
          </select>
        </div>
        <Field label={t('connections.bankSheet.amount')} inputMode="decimal" autoComplete="off" value={amount} maxLength={40} onChange={(event) => setAmount(event.currentTarget.value)} />
        <Field label={t('connections.bankSheet.address')} hint={t('connections.bankSheet.addressHint')} type="url" autoComplete="off" value={address} maxLength={2000} onChange={(event) => setAddress(event.currentTarget.value)} />
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        <div className={s.buttons}>
          <Button disabled={busy} onClick={() => void save({ rules: kept(rules), alertAddress: null })}>{t('connections.bankSheet.stopSending')}</Button>
          <Button variant="primary" type="submit" disabled={busy}>{t('connections.bankSheet.save')}</Button>
        </div>
      </form>
    </>
  );
}

type OpenInvoices = BooksSummaryLite['openInvoices'];

/**
 * One statement row as the engine reads it against the books, with only the decisions that row allows. Money in that
 * names no invoice offers the open invoices the engine listed; the engine refuses more than the picked one's balance.
 */
function LedgerRow({ row, said, openInvoices, onApplied }: {
  row: BankLedgerRow; said: { line: string; receiptId: string | null } | null; openInvoices: OpenInvoices | null;
  onApplied: (row: BankLedgerRow, line: string, receiptId: string | null) => void;
}) {
  const t = useT();
  const client = useEngine();
  const pickId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState('');

  async function apply(as: 'payment' | 'cost' | 'skip') {
    setBusy(true);
    setProblem(null);
    try {
      const invoiceId = row.suggestion?.invoiceId ?? picked;
      const params = as === 'payment' ? { transactionId: row.id, as, invoiceId } : { transactionId: row.id, as };
      const answer = await client.request('venture.bank.apply', params);
      onApplied(answer.row, answer.line, answer.receiptId ?? null);
    } catch (error) {
      setProblem(t('connections.bankSheet.applyFailed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  const open = row.decided === null;
  const picking = open && row.classification === 'money-in';
  const canPay = open && ((row.classification === 'suggested-payment' && row.suggestion !== null) || picking);
  const canCost = open && row.classification === 'money-out';
  const canSkip = open && row.classification !== 'own-transfer';
  return (
    <li className={s.row} data-bank-row="">
      <div className={s.head}>
        <span className={s.date}>{row.dateDisplay}</span>
        <span className={s.what}>{row.description ?? row.counterparty ?? ''}</span>
        <span className={s.amount}>{t(row.direction === 'in' ? 'connections.bankSheet.in' : 'connections.bankSheet.out', { amount: row.amount })}</span>
      </div>
      <p className={s.note}>{t(`connections.bankSheet.class.${row.classification}`)} · {row.account}</p>
      {row.flag && <p className={s.flag} data-bank-flag="">{row.flag}</p>}
      {row.suggestion && open && <p className={s.line}>{row.suggestion.line}</p>}
      {said && <p className={s.line} role="status"><span>{said.line}</span>{said.receiptId && <> <Receipt id={said.receiptId} /></>}</p>}
      {picking && openInvoices && openInvoices.length === 0 && <p className={s.note}>{t('connections.bankSheet.noOpenInvoices')}</p>}
      {picking && openInvoices && openInvoices.length > 0 && (
        <div className={`${s.field} ${s.pick}`}>
          <label htmlFor={pickId} className={s.label}>{t('connections.bankSheet.pickInvoice')}</label>
          <select id={pickId} className={s.select} value={picked} onChange={(event) => setPicked(event.currentTarget.value)}>
            <option value="">{t('connections.bankSheet.pickNone')}</option>
            {openInvoices.map((invoice) => (
              <option key={invoice.invoiceId} value={invoice.invoiceId}>
                {t('connections.bankSheet.invoiceOption', { number: invoice.number, client: invoice.clientName, balance: invoice.balanceDisplay })}
              </option>
            ))}
          </select>
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {(canPay || canCost || canSkip) && (
        <div className={s.buttons}>
          {canPay && <Button variant="primary" disabled={busy || (picking && !picked)} onClick={() => void apply('payment')}>{t('connections.bankSheet.recordPayment')}</Button>}
          {canCost && <Button disabled={busy} onClick={() => void apply('cost')}>{t('connections.bankSheet.addCost')}</Button>}
          {canSkip && <Button disabled={busy} onClick={() => void apply('skip')}>{t('connections.bankSheet.skip')}</Button>}
        </div>
      )}
    </li>
  );
}
