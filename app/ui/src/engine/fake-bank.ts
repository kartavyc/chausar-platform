/**
 * The fake engine's answers for bank statements in the books (Ink v2 wave 2, package 2D), following the engine's rules
 * in platform/runtime/venture/build/bank-methods.ts: the ledger with each row's classification (venture.bank.ledger),
 * recording a row once as a payment, a cost or skipping it (venture.bank.apply), and the alert rules with where alerts
 * go in words only (venture.bank.alerts.*). A payment goes through the money desk's own venture.payment.record, so the
 * invoice screens see it. Imports and consent stay on the extras desk (fake-extras.ts). The sample rows are synthetic.
 */

import {
  EngineError, type BankAlertRuleLite, type BankAlertsView, type BankApplyResult, type BankLedgerRow, type BankLedgerView, type InvoiceViewLite,
  type QueueRow, type VentureRunEvent,
} from './types';
import { inr } from './fake-money';

export interface BankHost {
  current(): string;
  now(): string;
  emit(event: VentureRunEvent): void;
  /** Today's rows, to add a bank row the owner decides, and the fake's digest for a new row. */
  rows(): QueueRow[];
  setRows(rows: QueueRow[]): void;
  digest(value: unknown): string;
  /** Another desk's answer, for the records this desk reads (invoices, payments, the books). */
  ask(method: string, params: Record<string, unknown>): unknown;
}

const BANK_METHODS = new Set<string>(['venture.bank.ledger', 'venture.bank.apply', 'venture.bank.alerts.get', 'venture.bank.alerts.set']);
export const NO_PROVIDER_LINE = 'No bank provider is linked yet, so Chausar reads only the statement files you import.';
const ALERTS_SENT_LINE = 'Alerts go to the address you set, as a count only. Today shows what each one found.';
const ALERTS_TODAY_LINE = 'Alerts show on Today only. No address is set, so nothing is sent.';

interface HeldAccount {
  id: string; label: string; consent: BankLedgerView['accounts'][number]['consent']; rules: BankAlertRuleLite[]; address: string | null;
}
/** A kept row: minor units as a whole number of paise, signed (money in positive). */
interface HeldRow {
  id: string; accountId: string; date: string; minor: number; description: string; counterparty: string | null;
  classification: 'own-transfer' | 'suggested-payment' | 'money-in' | 'money-out'; pairedWith: string | null;
  suggestion: { invoiceId: string; number: string; line: string } | null; decided: 'payment' | 'cost' | 'skip' | null;
}

const SEED_ACCOUNTS: HeldAccount[] = [
  {
    id: 'bankaccount-hdfc', label: 'HDFC current', rules: [{ kind: 'large-debit', minor: '5000000' }], address: null,
    consent: { state: 'active', daysLeft: 82, line: 'Bank access ends on 13 Jan 2027, in 82 days.' },
  },
  { id: 'bankaccount-sbi', label: 'SBI savings', rules: [], address: null, consent: null },
];
const HDFC = 'bankaccount-hdfc';
const SBI = 'bankaccount-sbi';
/** Synthetic rows: a transfer pair between the two own accounts, INV-0039's payment named in full, plain money out and in. */
const SEED_ROWS: HeldRow[] = [
  { id: `${HDFC}:ref_0a1b2c3d4e5f6071`, accountId: HDFC, date: '2026-10-03', minor: -2000000, description: 'TRANSFER TO SAVINGS', counterparty: null, classification: 'own-transfer', pairedWith: `${SBI}:ref_1b2c3d4e5f607182`, suggestion: null, decided: null },
  { id: `${SBI}:ref_1b2c3d4e5f607182`, accountId: SBI, date: '2026-10-04', minor: 2000000, description: 'TRANSFER FROM CURRENT', counterparty: null, classification: 'own-transfer', pairedWith: `${HDFC}:ref_0a1b2c3d4e5f6071`, suggestion: null, decided: null },
  { id: `${HDFC}:ref_2c3d4e5f60718293`, accountId: HDFC, date: '2026-10-16', minor: 2620000, description: 'NEFT/INV-0039/BOAT AUDIO', counterparty: 'Boat Audio', classification: 'suggested-payment', pairedWith: null, suggestion: { invoiceId: 'inv-0039', number: 'INV-0039', line: 'Pays INV-0039 in full.' }, decided: null },
  { id: `${HDFC}:fp_3d4e5f6071829304`, accountId: HDFC, date: '2026-10-18', minor: -2500000, description: 'OFFICE RENT OCTOBER', counterparty: 'R Sharma', classification: 'money-out', pairedWith: null, suggestion: null, decided: null },
  { id: `${HDFC}:fp_4e5f607182930415`, accountId: HDFC, date: '2026-10-20', minor: -45000, description: 'UPI-CAFE BLUE', counterparty: null, classification: 'money-out', pairedWith: null, suggestion: null, decided: null },
  // Money in that names no invoice: the owner picks one; the second is more than INV-0039's balance.
  { id: `${HDFC}:fp_5f60718293041526`, accountId: HDFC, date: '2026-10-21', minor: 500000, description: 'IMPS BOAT AUDIO PART', counterparty: 'Boat Audio', classification: 'money-in', pairedWith: null, suggestion: null, decided: null },
  { id: `${HDFC}:fp_60718293041526a7`, accountId: HDFC, date: '2026-10-21', minor: 3000000, description: 'NEFT LARGE CREDIT', counterparty: null, classification: 'money-in', pairedWith: null, suggestion: null, decided: null },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Paise as the decimal text a typed payment carries: 2620000 as 26200.00. */
const decimalText = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-03' as '03 Oct 2026', the way the engine writes a date for India (records.ts formatVentureDate). */
export function dayMonthYear(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

function ruleLine(rule: BankAlertRuleLite): string {
  if (rule.kind === 'large-debit') return `When ${inr(Number(rule.minor))} or more goes out in one payment.`;
  if (rule.kind === 'balance-below') return `When the balance falls below ${inr(Number(rule.minor))}.`;
  if (rule.kind === 'credit-matching') return `When money comes in that mentions ${rule.text}.`;
  return `When no payment of ${inr(Number(rule.minor))} or more that mentions ${rule.text} has come in by ${rule.by}.`;
}

/** The engine's refusal of an address inside the computer or its network, in the spellings a test reaches for. */
const INSIDE = /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/i;

export class FakeBankDesk {
  private readonly host: BankHost;
  private readonly accounts: Record<string, HeldAccount[]> = {};
  private readonly ledgers: Record<string, HeldRow[]> = {};

  constructor(host: BankHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    if (!(options.fresh ?? false)) {
      this.accounts.lumen = SEED_ACCOUNTS.map((account) => structuredClone(account));
      this.ledgers.lumen = SEED_ROWS.map((row) => structuredClone(row));
    }
  }

  handles(method: string): boolean {
    return BANK_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.bank.ledger': return this.ledger(p);
      case 'venture.bank.apply': return this.apply(p);
      case 'venture.bank.alerts.get': return this.alertsView();
      case 'venture.bank.alerts.set': return this.alertsSet(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  private mine(): { accounts: HeldAccount[]; rows: HeldRow[] } {
    const biz = this.host.current();
    return { accounts: (this.accounts[biz] ??= []), rows: (this.ledgers[biz] ??= []) };
  }

  private view(row: HeldRow): BankLedgerRow {
    const account = this.mine().accounts.find((a) => a.id === row.accountId);
    const classification = row.decided ? (row.decided === 'skip' ? 'skipped' : 'applied') : row.classification;
    return {
      id: row.id, accountId: row.accountId, account: account?.label ?? '', date: row.date, dateDisplay: dayMonthYear(row.date), amount: inr(Math.abs(row.minor)),
      direction: row.minor > 0 ? 'in' : 'out', description: row.description, counterparty: row.counterparty, classification, flag: null,
      pairedWith: row.pairedWith, suggestion: row.decided ? null : row.suggestion, decided: row.decided,
    };
  }

  private ledger(p: Record<string, unknown>): BankLedgerView {
    const { accounts, rows } = this.mine();
    const named = typeof p.account === 'string' ? p.account : null;
    const account = named === null ? null : accounts.find((a) => sameLabel(a.label, named)) ?? null;
    if (named !== null && !account) throw new EngineError('BANK_ACCOUNT_NOT_FOUND', 'There is no bank account with this name. Import a statement for it first.');
    const month = typeof p.month === 'string' ? p.month : null;
    const shown = rows.filter((row) => (!account || row.accountId === account.id) && (!month || row.date.startsWith(`${month}-`))).map((row) => this.view(row));
    const own = shown.filter((row) => row.classification === 'own-transfer').length;
    const suggested = shown.filter((row) => row.classification === 'suggested-payment').length;
    const parts = shown.length
      ? [`${plural(shown.length, 'transaction', 'transactions')} in ${plural(account ? 1 : accounts.length, 'account', 'accounts')}.`]
      : [accounts.length ? 'No bank transactions here yet.' : 'No bank statements imported yet.'];
    if (own) parts.push(own === 1 ? '1 transaction moves between your own accounts, so it is not income or spending.' : `${own} transactions move between your own accounts, so they are not income or spending.`);
    if (suggested) parts.push(`${suggested === 1 ? '1 transaction looks' : `${suggested} transactions look`} like an invoice payment.`);
    return {
      accounts: accounts.map((a) => ({ id: a.id, label: a.label, currency: 'INR', consent: a.consent ? { ...a.consent } : null })),
      rows: shown, line: parts.join(' '), provider: NO_PROVIDER_LINE,
    };
  }

  private apply(p: Record<string, unknown>): BankApplyResult {
    const row = this.mine().rows.find((r) => r.id === p.transactionId);
    if (!row) throw new EngineError('BANK_TRANSACTION_NOT_FOUND', 'This bank row was not found. Import the statement it is on first.');
    if (row.decided) throw new EngineError('BANK_ALREADY_APPLIED', 'You already decided this bank row. Chausar never counts it twice.');
    const as = p.as;
    if (as !== 'payment' && as !== 'cost' && as !== 'skip') throw new EngineError('INVALID_VENTURE_REQUEST', 'Record it as a payment or a cost, or skip it.');
    if (as !== 'skip' && row.classification === 'own-transfer') throw new EngineError('BANK_OWN_TRANSFER', 'This moved between your own accounts, so it is neither income nor a cost.');
    let line = 'Skipped. It stays in your bank ledger and is not counted in the books.';
    let receiptId: string | undefined;
    if (as === 'payment') {
      if (row.minor <= 0) throw new EngineError('BANK_NOT_MONEY_IN', 'Only money that came in can pay an invoice.');
      const invoiceId = typeof p.invoiceId === 'string' ? p.invoiceId : row.suggestion?.invoiceId;
      if (!invoiceId) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose the invoice this pays.');
      // The money desk records it the way a typed payment is recorded, and refuses what it refuses.
      const paid = this.host.ask('venture.payment.record', { invoiceId, amount: decimalText(row.minor), receivedOn: row.date, method: 'bank-transfer' }) as InvoiceViewLite;
      receiptId = paid.payments[paid.payments.length - 1]?.booksReceiptId ?? undefined;
      line = `Recorded ${inr(row.minor)} as a payment of ${paid.invoice.number ?? 'the invoice'}.`;
    } else if (as === 'cost') {
      if (row.minor >= 0) throw new EngineError('BANK_NOT_MONEY_OUT', 'Only money that went out can be a cost.');
      line = `Added ${inr(-row.minor)} to your costs.`;
    }
    row.decided = as;
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    return { row: this.view(row), line, ...(receiptId ? { receiptId } : {}) };
  }

  private alertsView(): BankAlertsView {
    return {
      accounts: this.mine().accounts.map((a) => ({
        account: a.label, accountId: a.id, rules: a.rules.map((rule) => ({ ...rule })), ruleLines: a.rules.map(ruleLine),
        destination: a.address ? ALERTS_SENT_LINE : ALERTS_TODAY_LINE,
      })),
    };
  }

  private alertsSet(p: Record<string, unknown>): BankAlertsView {
    const label = typeof p.account === 'string' ? p.account.trim() : '';
    if (!label || label.length > 80) throw new EngineError('INVALID_VENTURE_REQUEST', 'The account name must be between 1 and 80 characters.');
    if (!Array.isArray(p.rules) || p.rules.length > 10) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send a list of at most 10 alert rules.');
    const rules = (p.rules as Record<string, unknown>[]).map((rule): BankAlertRuleLite => {
      if (rule.kind === 'credit-matching' && typeof rule.text === 'string') return { kind: 'credit-matching', text: rule.text };
      if (rule.kind !== 'large-debit' && rule.kind !== 'balance-below') throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose a kind of alert Chausar checks.');
      if (typeof rule.minor === 'string' && /^\d{1,18}$/.test(rule.minor) && rule.amount === undefined) return { kind: rule.kind, minor: rule.minor };
      const typed = typeof rule.amount === 'string' && rule.minor === undefined ? rule.amount.replace(/[\s,]/g, '') : '';
      const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(typed);
      if (!match) throw new EngineError('INVALID_VENTURE_REQUEST', 'Type the amount for this alert like 50000 or 50000.00.');
      const minor = `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
      if (/^0+$/.test(minor)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The amount for this alert must be above zero.');
      return { kind: rule.kind, minor };
    });
    let address: string | null | undefined;
    if (p.alertAddress === null) address = null;
    else if (typeof p.alertAddress === 'string') {
      let url: URL;
      try { url = new URL(p.alertAddress); } catch { throw new EngineError('INVALID_VENTURE_REQUEST', 'Alerts go only to an https address.'); }
      if (url.protocol !== 'https:' || url.username || url.password) throw new EngineError('INVALID_VENTURE_REQUEST', 'Alerts go only to an https address.');
      if (INSIDE.test(url.hostname)) throw new EngineError('NET_ADDRESS_REFUSED', 'This address points inside your computer or your network, so Chausar will not open it.');
      address = url.href;
    }
    const { accounts } = this.mine();
    let account = accounts.find((a) => sameLabel(a.label, label));
    if (!account) {
      account = { id: `bankaccount-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label, consent: null, rules: [], address: null };
      accounts.push(account);
    }
    account.rules = rules;
    if (address !== undefined) account.address = address;
    return this.alertsView();
  }
}
