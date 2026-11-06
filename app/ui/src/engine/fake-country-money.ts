import { formatMoney, formatUsd } from '../../../../platform/shared/owner-format.ts';
import { countryProfile } from '../../../../platform/shared/venture/core/countries.ts';
import { COUNTRY_TIME_ZONES } from '../../../../platform/shared/venture/local-day-data.ts';
import { incomeTaxTable } from '../../../../platform/shared/venture/playbooks/ca-firm/income-tax.ts';
import { rateTableFor } from '../../../../platform/shared/venture/playbooks/ca-firm/rates.ts';
import type { MoneyLedger } from './fake-money';
import { EngineError, type BlueprintViewLite, type MoneyOverview, type MoneyOverviewLine, type ReceiptLite, type TaxWorking, type TaxWorkingLine, type VentureViewLite } from './types';

export interface CountryMoneyHost {
  current(): string;
  now(): string;
  digest(value: unknown): string;
  ledger?(): MoneyLedger;
  plan?(): BlueprintViewLite | null;
  ask?(method: string, params: Record<string, unknown>): unknown;
}
type Period = { from: string; to: string; display: string; assessmentYear?: string };
type Calculation = { minor: bigint; evidence: unknown };
const PERIOD_WORDS = 'Choose a month like 2026-10, or a financial year like FY 2025-26 or AY 2026-27.';
const BOOKS_TAX_NOTE = 'Billed and earned leave out tax. Received is the cash that came in, tax included.';

/** The fake uses the same country calendar and invoice currency boundaries as the native money views. */
export class FakeCountryMoney {
  private receipts = new Map<string, { business: string; fingerprint: string; read: () => Calculation; receipt: ReceiptLite }>();
  private serial = 0;
  constructor(private host: CountryMoneyHost) {}

  private venture() { return (this.host.ask?.('venture.get', {}) as VentureViewLite | null)?.venture; }
  private currency() { return this.venture()?.country?.currency ?? 'INR'; }
  private today(): string {
    const code = this.venture()?.country?.code ?? 'IN';
    const parts = new Intl.DateTimeFormat('en', { timeZone: COUNTRY_TIME_ZONES[code as keyof typeof COUNTRY_TIME_ZONES] ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(this.host.now()));
    const part = (type: string) => parts.find(item => item.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  private period(raw: unknown): Period {
    const value = raw === undefined ? this.today().slice(0, 7) : typeof raw === 'string' ? raw.trim() : '';
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      const [year, month] = value.split('-').map(Number);
      return { from: value + '-01', to: new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10), display: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + '-01T00:00:00Z')) };
    }
    const match = /^(FY|AY)\s?(\d{4})-(\d{2})$/i.exec(value);
    if (!match || (Number(match[2]) + 1) % 100 !== Number(match[3])) throw new EngineError('INVALID_VENTURE_REQUEST', PERIOD_WORDS);
    const first = Number(match[2]) - (match[1]!.toUpperCase() === 'AY' ? 1 : 0);
    const fy = `${first}-${String((first + 1) % 100).padStart(2, '0')}`, ay = `${first + 1}-${String((first + 2) % 100).padStart(2, '0')}`;
    return { from: `${first}-04-01`, to: `${first + 1}-03-31`, display: `Financial year ${fy} (assessment year ${ay})`, assessmentYear: ay };
  }

  /** Stable original fixtures remain available until real sample edits or a country change add ledger evidence. */
  dynamic(hasFixture: boolean): boolean {
    if (!this.host.ledger || !this.host.ask) return false;
    const ledger = this.host.ledger();
    return !hasFixture || !!this.venture()?.originalCountry || this.currency() !== 'INR' || ledger.invoices.some(invoice => invoice.id.startsWith('inv-draft-')) || ledger.payments.some(payment => payment.id.startsWith('pay-new-'));
  }
  matchesPeriod(raw: unknown, display: string): boolean { return this.period(raw).display === display; }

  private prove(label: string, currency: string, read: () => Calculation, explanation: string, unit: 'minor' | 'micros' = 'minor'): string {
    const computed = read();
    const id = `R-country-${this.host.current()}-${++this.serial}`;
    const display = unit === 'micros' ? formatUsd(String(computed.minor)) : formatMoney(computed.minor, currency);
    const receipt: ReceiptLite = { id, at: this.host.now(), stale: false, totalMinor: String(computed.minor), figures: [{ key: 'total', label, display }], explanation };
    this.receipts.set(id, { business: this.host.current(), fingerprint: this.host.digest(computed.evidence), read, receipt });
    return id;
  }
  receipt(id: string): ReceiptLite | undefined {
    const saved = this.receipts.get(id);
    if (!saved || saved.business !== this.host.current()) return undefined;
    return { ...structuredClone(saved.receipt), stale: saved.fingerprint !== this.host.digest(saved.read().evidence) };
  }

  overview(spent?: MoneyOverviewLine): MoneyOverview {
    const currency = this.currency(), period = this.period(undefined), ledger = this.host.ledger!();
    const open = ledger.invoices.filter(invoice => ['issued', 'part-paid'].includes(invoice.status) && invoice.balance > 0);
    const cleared = ledger.payments.filter(payment => payment.state === 'cleared' && payment.receivedOn >= period.from && payment.receivedOn <= period.to);
    const invoiceCurrency = (id: string) => ledger.invoices.find(invoice => invoice.id === id)?.currency;
    const made = (kind: 'owed' | 'received', label: string, filter: string, other: number, one: string, many: string, read: () => Calculation): MoneyOverviewLine => {
      const receiptId = this.prove(label, currency, read, `${filter}. Other currencies are excluded; no conversion was made.`);
      return { id: kind, label, value: this.receipt(receiptId)!.figures[0]!.display, receiptId, kind: 'calculated', source: { from: 'receipt', receiptId }, basis: { filters: [filter], truncated: false, notCounted: other ? { count: other, line: `${other} not counted: ${other} ${other === 1 ? one : many} in another currency, with no rate to ${currency}` } : null } };
    };
    const owed = made('owed', 'Clients owe you', `Open invoices in ${currency}, tax included`, open.filter(invoice => invoice.currency !== currency).length, 'open invoice', 'open invoices', () => {
      const rows = this.host.ledger!().invoices.filter(invoice => ['issued', 'part-paid'].includes(invoice.status) && invoice.balance > 0 && invoice.currency === currency);
      return { minor: rows.reduce((sum, row) => sum + BigInt(row.balance), 0n), evidence: rows.map(row => [row.id, row.balance, row.status]) };
    });
    const received = made('received', 'Came in this month', `Cleared payments in ${currency}, tax included, this month on your calendar`, cleared.filter(payment => invoiceCurrency(payment.invoiceId) !== currency).length, 'payment', 'payments', () => {
      const current = this.host.ledger!();
      const rows = current.payments.filter(payment => payment.state === 'cleared' && payment.receivedOn >= period.from && payment.receivedOn <= period.to && current.invoices.find(invoice => invoice.id === payment.invoiceId)?.currency === currency);
      return { minor: rows.reduce((sum, row) => sum + BigInt(row.amount), 0n), evidence: rows.map(row => [row.id, row.amount, row.receivedOn]) };
    });
    if (!spent) {
      const receiptId = this.prove('AI and tools this month', 'USD', () => ({ minor: 0n, evidence: [] }), 'No paid AI or tool calls are recorded for this sample business.', 'micros');
      spent = { id: 'spent', label: 'AI and tools this month', value: this.receipt(receiptId)!.figures[0]!.display, receiptId };
    }
    return { lines: [owed, received, spent] };
  }

  tax(raw: unknown, caFirm = false): TaxWorking {
    const period = this.period(raw), venture = this.venture();
    const plan = (this.host.plan?.() ?? this.host.ask?.('venture.blueprint.get', {}) as BlueprintViewLite | null)?.blueprint;
    const taxLabel = plan?.backOffice.taxLabel ?? countryProfile(venture?.country?.code ?? 'IN').tax.label;
    const lines: TaxWorkingLine[] = [];
    const office = plan?.backOffice;
    if (caFirm && venture?.country?.code === 'IN') {
      const registered = !!office && ((office as { taxMode?: string }).taxMode ?? 'gst') === 'gst' && office.taxRegistered.value;
      const assumed = office && office.taxRegistered.label !== 'told-by-you' ? ' Chausar assumed this; turn on I charge GST under Business, Prices if you do.' : '';
      const sections: TaxWorking['sections'] = [{ id: 'gst', title: 'GST', lines: [], note: registered ? 'Add your GSTIN under Business, Prices to see the GST working.' : `${office ? 'Your plan says you do not charge GST, so there is no GST working.' : 'Your plan is not made yet.'}${assumed}` }];
      let unconfirmed = false;
      if (period.assessmentYear) {
        const all = this.host.ledger!().invoices.filter(invoice => ['issued', 'part-paid', 'paid'].includes(invoice.status) && invoice.number && invoice.issueDate && invoice.issueDate >= period.from && invoice.issueDate <= period.to);
        const invoices = all.filter(invoice => invoice.currency === 'INR');
        const billed = invoices.reduce((sum, invoice) => sum + BigInt(invoice.subtotal), 0n);
        const notes = ['The computation needs your whole income for the year, your regime and your deductions, which Chausar does not hold. The income tax return offer works it from Form 16, AIS and 26AS, and your CA signs it off.'];
        if (all.length > invoices.length) notes.push('This total is in INR. Invoices in other currencies are excluded; no conversion was made.');
        try {
          incomeTaxTable(period.assessmentYear);
          const table = rateTableFor('income-tax', period.from);
          const ca = this.host.ask?.('venture.ca.get', {}) as { pendingRates?: { tableId: string; version: string }[] } | null;
          if (!ca?.pendingRates || ca.pendingRates.some(row => row.tableId === table.id && row.version === String(table.version))) {
            unconfirmed = true;
            notes.push(`Your CA has not confirmed "${table.title}" (version ${table.version}) yet.`);
          }
        } catch (error) { unconfirmed = true; notes.push(error instanceof Error ? error.message : 'The GST engine could not work this period.'); }
        sections.push({ id: 'income-tax', title: `Income tax for ${period.display}`, lines: [{ label: 'Billed in the year, without tax', value: formatMoney(billed, 'INR') }], note: notes.join(' ') });
      }
      return { period: period.display, sections, needsCaConfirmation: unconfirmed };
    }
    const bps = BigInt(office?.taxRateBps ?? '0');
    const rate = `${bps / 100n}${bps % 100n ? '.' + String(bps % 100n).padStart(2, '0').replace(/0+$/, '') : ''}`;
    lines.push({ label: 'What your plan says', value: office ? `${office.taxRegistered.value ? `You charge ${taxLabel} at ${rate}%` : `You do not charge ${taxLabel}`}${office.taxRegistered.label === 'told-by-you' ? '' : ' (Chausar assumed this; confirm it under Business, Prices)'}` : 'Your plan is not made yet.' });
    const issued = () => this.host.ledger!().invoices.filter(invoice => ['issued', 'part-paid', 'paid'].includes(invoice.status) && invoice.number !== null && invoice.issueDate !== null && invoice.issueDate >= period.from && invoice.issueDate <= period.to).sort((a, b) => a.issueDate!.localeCompare(b.issueDate!) || a.number!.localeCompare(b.number!));
    const groups = new Map<string, { label: string; currency: string }>();
    const invoices = issued();
    for (const invoice of invoices) {
      const label = countryProfile(invoice.countryCode).tax.label;
      lines.push({ label: `${invoice.number}, ${invoice.client}`, value: `${label} ${formatMoney(BigInt(invoice.tax), invoice.currency)} on ${formatMoney(BigInt(invoice.subtotal), invoice.currency)}`, receiptId: invoice.priceReceiptId });
      groups.set(JSON.stringify([label, invoice.currency]), { label, currency: invoice.currency });
    }
    for (const group of groups.values()) {
      const read = (): Calculation => {
        const rows = issued().filter(invoice => invoice.currency === group.currency && countryProfile(invoice.countryCode).tax.label === group.label);
        return { minor: rows.reduce((sum, row) => sum + BigInt(row.tax), 0n), evidence: rows.map(row => [row.id, row.tax, row.status, row.issueDate]) };
      };
      const receiptId = this.prove(`${group.label} on issued invoices`, group.currency, read, `Tax on issued invoices in ${period.display}, in ${group.currency}. Each currency and tax is totalled separately; no conversion was made.`);
      lines.push({ label: `${group.label} on invoices issued in ${period.display}`, value: this.receipt(receiptId)!.figures[0]!.display, receiptId });
    }
    if (!invoices.length) lines.push({ label: `${taxLabel} on invoices issued in ${period.display}`, value: 'No invoices issued' });
    const title = groups.size > 1 ? 'Tax by currency' : [...groups.values()].some(group => group.label !== taxLabel) ? 'Tax' : taxLabel;
    return { period: period.display, sections: [{ id: 'tax', title, lines, note: BOOKS_TAX_NOTE + (groups.size > 1 ? ' Each currency and tax is totalled separately; no conversion was made.' : '') }], needsCaConfirmation: false };
  }
}
