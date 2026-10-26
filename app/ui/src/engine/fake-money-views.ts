/**
 * The fake engine's money views (Ink v2 wave 4, 4J4, read by 4J20's screens): venture.money.aging, .flow, .cash,
 * .margins and .export, with the engine's shapes, order, words and refusals (platform/runtime/venture/money/aging.ts,
 * flow.ts, cash.ts, margins.ts, export.ts and figure-kinds.ts). Each view reads the money desk's own records
 * (fake-money.ts `ledger`), so an invoice issued or a payment recorded on screen moves them; every amount carries the
 * sum receipt this desk keeps for it (one id per distinct sum, as the engine keeps one per digest). Days are on the
 * owner's calendar in Kolkata, as the sample businesses are in India.
 *
 * Where the fake keeps less than the engine, the view says so the engine's way rather than inventing it:
 * - the sample engine keeps no dated paid calls, so its months count no AI spend; with no rupee rate set and calls in
 *   the spend list, this month says "AI spend not counted: no rupee rate set", as the engine does;
 * - the sample books hold no costs but the bills the owner pays here, so the usual costs are none;
 * - a sample bank statement (STATEMENTS, synthetic) gives Lumen Studio a closing balance; other businesses have none,
 *   so their cash view asks for a statement, as the engine's does.
 * The fake's books for a month (booksMonth) count billed and received from the same records; its earned is the billed
 * figure, where the engine's calculator works earned out from the books.
 */

import { EngineError, type AgingBucketId, type AgingView, type BooksFigureLite, type BooksSummaryLite, type CashView, type FlowView, type KindedFigure, type MarginsView, type MoneyExportFile, type ReceiptLite, type SpendPolicyView, type TotalBasis } from './types';
import { inr, type MoneyLedger } from './fake-money';
import { dayMonthYear } from './fake-bank';
import { SPEND } from './fixtures';

export const FAKE_4J20_METHODS: readonly string[] = ['venture.money.aging', 'venture.money.flow', 'venture.money.cash', 'venture.money.margins', 'venture.money.export'];

export interface MoneyViewsHost {
  now: () => string;
  business: () => string;
  ledger: () => MoneyLedger;
  ask: (method: string, params: Record<string, unknown>) => unknown;
  /** The open business's working name, for the export's file name. */
  name: () => string;
}

/** One closing balance from an imported statement, as the bank import keeps its rows (synthetic sample). */
interface Statement { account: string; importId: string; row: string; on: string; minor: number }
const STATEMENTS: Readonly<Record<string, readonly Statement[]>> = {
  lumen: [{ account: 'HDFC current', importId: 'bankimport-hdfc-oct', row: 'bankaccount-hdfc:fp_60718293041526a7', on: '2026-10-21', minor: 21875000 }],
};

const BUCKETS: readonly { id: AgingBucketId; label: string; word: string; upTo: number }[] = [
  { id: 'not-due', label: 'Not due yet', word: 'not due yet', upTo: 0 },
  { id: '1-30', label: '1 to 30 days late', word: '1 to 30 days late', upTo: 30 },
  { id: '31-60', label: '31 to 60 days late', word: '31 to 60 days late', upTo: 60 },
  { id: '61-90', label: '61 to 90 days late', word: '61 to 90 days late', upTo: 90 },
  { id: 'over-90', label: 'Over 90 days late', word: 'over 90 days late', upTo: Number.POSITIVE_INFINITY },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;
const WEEKS = 13;
const NEXT_DAYS = 21;
const NO_RATE = 'no rupee rate set';

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const monthWords = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const shortMonth = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]!.slice(0, 3)} ${month.slice(0, 4)}`;
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
const lastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const monthRange = (month: string) => ({ from: `${month}-01`, to: `${month}-${String(lastDay(month)).padStart(2, '0')}` });
const previousMonth = (month: string) => {
  const year = Number(month.slice(0, 4)), index = Number(month.slice(5, 7)) - 1;
  return index === 0 ? `${year - 1}-12` : `${year}-${String(index).padStart(2, '0')}`;
};
const lateWords = (days: number) => `${days} ${days === 1 ? 'day' : 'days'} late`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const permilleOf = (part: number, whole: number) => (whole <= 0 || part <= 0 ? 0 : Math.max(1, Math.floor((part * 1000) / whole)));
const basisOf = (filters: string[], notCounted: TotalBasis['notCounted'] = null): TotalBasis => ({ filters, truncated: false, notCounted: notCounted && notCounted.count > 0 ? notCounted : null });

/** One amount a sum adds, as a receipt lists it. */
interface Addend { label: string; minor: number; estimate?: boolean }

function monthText(value: unknown): string {
  if (typeof value !== 'string' || !MONTH.test(value)) throw invalid('Use a month like 2026-10.');
  return value;
}

function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): void {
  if (Object.keys(p).some((key) => !allowed.includes(key)) || required.some((key) => !(key in p))) throw invalid('Send the required fields and nothing else.');
}

/** A CSV cell as the engine writes it: text that a spreadsheet would run as a formula gets an apostrophe first. */
function csvCell(value: string): string {
  const cell = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
const decimal = (minor: number) => `${minor < 0 ? '-' : ''}${Math.floor(Math.abs(minor) / 100)}.${String(Math.abs(minor) % 100).padStart(2, '0')}`;

/** The cash line's level lines, as money/cash.ts levelTicks: round amounts, at least two other than zero, zero when below it. */
function levelTicks(lo: number, hi: number): { permille: number; label: string }[] {
  const range = hi - lo;
  if (range <= 0) return [];
  const steps: number[] = [];
  for (let power = 1; power <= range; power *= 10) steps.push(power, power * 2, power * 5);
  for (const step of steps.reverse()) {
    const levels: number[] = [];
    for (let k = Math.ceil(lo / step); k <= Math.floor(hi / step); k += 1) levels.push(k * step);
    if (levels.filter((level) => level !== 0).length < 2) continue;
    return levels.filter((level) => level !== 0 || lo < 0).map((level) => ({ permille: Math.floor(((level - lo) * 1000) / range), label: inr(level) }));
  }
  return [];
}

export class FakeMoneyViews {
  private readonly host: MoneyViewsHost;
  private readonly receipts: ReceiptLite[] = [];
  private readonly made = new Map<string, string>();
  private seq = 4600;

  constructor(host: MoneyViewsHost) {
    this.host = host;
  }

  receipt(id: string): ReceiptLite | undefined {
    const found = this.receipts.find((receipt) => receipt.id === id);
    return found ? structuredClone(found) : undefined;
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.money.aging': return this.aging(p);
      case 'venture.money.flow': return this.flow(p);
      case 'venture.money.cash': return this.cash(p);
      case 'venture.money.margins': return this.margins(p);
      case 'venture.money.export': return this.export(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /**
   * The books for one month from this desk's records (fake-money.ts books for a month period): billed and received with
   * their receipts, and the same month as the `previous` of the month after it, labelled as the engine labels it.
   */
  booksMonth(month: string): { period: { from: string; to: string }; figures: BooksFigureLite[]; before: string; asPrevious: NonNullable<BooksSummaryLite['previous']> } {
    const period = monthRange(month);
    const ledger = this.host.ledger();
    const billed = this.sum(`Billed in ${monthWords(month)}`, ledger.invoices.filter((i) => this.issuedIn(i, period)).map((i) => ({ label: `${i.number} for ${i.client}`, minor: i.subtotal })), 'Nothing was billed.');
    const received = this.sum(`Received in ${monthWords(month)}`, this.receivedIn(ledger, period), 'Nothing came in.');
    const figures: BooksFigureLite[] = [
      { operation: 'billed', label: 'Billed', receiptId: billed.receiptId, display: billed.display, stale: false },
      { operation: 'received', label: 'Received', receiptId: received.receiptId, display: received.display, stale: false },
      { operation: 'earned', label: 'Earned', receiptId: billed.receiptId, display: billed.display, stale: false },
    ];
    return { period, figures, before: previousMonth(month), asPrevious: { month, label: monthWords(month), period, figures } };
  }

  /** Today on the owner's calendar in Kolkata (UTC+05:30). */
  private today(): string {
    return new Date(Date.parse(this.host.now()) + 330 * 60_000).toISOString().slice(0, 10);
  }

  private issuedIn(invoice: MoneyLedger['invoices'][number], period: { from: string; to: string }): boolean {
    return invoice.number !== null && invoice.status !== 'draft' && invoice.status !== 'void' && invoice.issueDate !== null && invoice.issueDate >= period.from && invoice.issueDate <= period.to;
  }

  private receivedIn(ledger: MoneyLedger, period: { from: string; to: string }): Addend[] {
    const numbers = new Map(ledger.invoices.map((i) => [i.id, i.number]));
    return ledger.payments.filter((p) => p.state === 'cleared' && p.receivedOn >= period.from && p.receivedOn <= period.to)
      .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at))
      .map((p) => ({ label: `${numbers.get(p.invoiceId) ?? 'An invoice'}, ${dayMonthYear(p.receivedOn)}`, minor: p.amount }));
  }

  /** A sum receipt: the same lines give the same id. Its figure is the total; an estimate when any line is one. */
  private sum(label: string, addends: Addend[], none: string): { receiptId: string; display: string; minor: number; estimate: boolean } {
    const minor = addends.reduce((total, addend) => total + addend.minor, 0);
    const estimate = addends.some((addend) => addend.estimate);
    const explanation = addends.length
      ? `${plural(addends.length, 'amount', 'amounts')}: ${addends.map((addend) => `${addend.label} ${inr(addend.minor)}${addend.estimate ? ' (estimate)' : ''}`).join('; ')}. Added together: ${inr(minor)}.`
      : none;
    const key = `${label}|${explanation}`;
    let id = this.made.get(key);
    if (!id) {
      id = `R-${this.seq++}`;
      this.made.set(key, id);
      this.receipts.push({ id, at: this.host.now(), explanation, stale: false, figures: [{ key: 'total', label, display: inr(minor) }] });
    }
    return { receiptId: id, display: inr(minor), minor, estimate };
  }

  private figure(sum: { receiptId: string; display: string; estimate: boolean }, extra: { uses?: string[]; projected?: boolean; basis?: TotalBasis } = {}): KindedFigure {
    return {
      display: sum.display, receiptId: sum.receiptId, kind: 'calculated', source: { from: 'receipt', receiptId: sum.receiptId },
      ...(sum.estimate ? { estimate: true as const } : {}), ...(extra.uses?.length ? { uses: [...extra.uses] } : {}),
      ...(extra.projected ? { projected: true as const } : {}), ...(extra.basis ? { basis: extra.basis } : {}),
    };
  }

  private open(): void {
    if (!this.host.business()) throw new EngineError('VENTURE_NOT_FOUND', 'Start a business first.');
  }

  /** venture.money.aging {asOf?}: what was owed on a day, tax included, in five buckets by days late, with one receipt. */
  private aging(p: Record<string, unknown>): AgingView {
    exact(p, ['asOf']);
    this.open();
    if (p.asOf !== undefined && (typeof p.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.asOf))) throw invalid('As of must be a date like 2026-10-21.');
    const asOf = typeof p.asOf === 'string' ? p.asOf : this.today();
    const ledger = this.host.ledger();
    // What was left on each invoice on that day: today's balance, with what cleared or was credited after it added back.
    const later = new Map<string, number>();
    for (const payment of ledger.payments) if (payment.state === 'cleared' && payment.receivedOn > asOf) later.set(payment.invoiceId, (later.get(payment.invoiceId) ?? 0) + payment.amount + (payment.tds?.amount ?? 0));
    for (const credit of ledger.credits) if (credit.status === 'issued' && credit.at.slice(0, 10) > asOf) later.set(credit.invoiceId, (later.get(credit.invoiceId) ?? 0) + credit.amount);
    const owed = ledger.invoices
      .filter((i) => i.number !== null && ['issued', 'part-paid', 'paid'].includes(i.status) && i.issueDate !== null && i.issueDate <= asOf && i.currency === 'INR')
      .map((i) => ({ invoice: i, minor: i.balance + (later.get(i.id) ?? 0) }))
      .filter((item) => item.minor > 0)
      .sort((a, b) => (a.invoice.dueDate ?? '').localeCompare(b.invoice.dueDate ?? '') || (a.invoice.number ?? '').localeCompare(b.invoice.number ?? ''));
    const late = (i: MoneyLedger['invoices'][number]) => (i.dueDate === null ? 0 : daysFrom(i.dueDate, asOf));
    const bucketOf = (days: number) => BUCKETS.find((bucket) => days <= bucket.upTo)!;
    const shown = dayMonthYear(asOf);
    const receipt = this.sum('Owed by age', owed.map(({ invoice, minor }) => ({ label: `${invoice.number} for ${invoice.client}, ${bucketOf(late(invoice)).word}`, minor })), 'No open invoices, so nothing is owed.');
    const part = (minor: number): KindedFigure => ({ display: inr(minor), receiptId: receipt.receiptId, kind: 'calculated', source: { from: 'receipt', receiptId: receipt.receiptId } });
    const sums = new Map(BUCKETS.map((bucket) => [bucket.id, { count: 0, minor: 0 }]));
    const invoices: AgingView['invoices'] = owed.map(({ invoice, minor }) => {
      const days = late(invoice);
      const bucket = bucketOf(days).id;
      const sum = sums.get(bucket)!;
      sum.count += 1;
      sum.minor += minor;
      return { invoiceId: invoice.id, number: invoice.number!, client: invoice.client, dueDate: invoice.dueDate!, bucket, late: days > 0 ? { days, line: lateWords(days) } : null, balance: part(minor) };
    });
    const total = this.figure(receipt, { basis: basisOf([`Invoices in INR issued by ${shown}, tax included, less what was paid or credited by then`, `Days late from the due date, as of ${shown} in Asia/Kolkata`]) });
    const buckets: AgingView['buckets'] = BUCKETS.map((bucket) => {
      const sum = sums.get(bucket.id)!;
      return { id: bucket.id, label: bucket.label, count: sum.count, countLine: sum.count === 0 ? 'None' : plural(sum.count, 'invoice', 'invoices'), amount: part(sum.minor), permille: permilleOf(sum.minor, receipt.minor) };
    });
    const lateCount = invoices.filter((row) => row.late !== null).length;
    const line = invoices.length === 0 ? 'Nothing is owed on open invoices.'
      : `${total.display} is owed on ${plural(invoices.length, 'open invoice', 'open invoices')} as of ${shown}.${lateCount ? ` ${lateCount} of them ${lateCount === 1 ? 'is' : 'are'} late.` : ''}`;
    // 4J20: what the late ones owe, with its own receipt listing each of them; none late, none shown.
    const lateOnes = owed.filter(({ invoice }) => late(invoice) > 0);
    const lateSum = lateOnes.length ? this.sum('Owed on late invoices', lateOnes.map(({ invoice, minor }) => ({ label: `${invoice.number} for ${invoice.client}, ${bucketOf(late(invoice)).word}`, minor })), 'No invoice is late.') : null;
    return { asOf, buckets, total, invoices, line, late: lateSum && this.figure(lateSum) };
  }

  /** Another desk's answer, or undefined where the fake has none to give. */
  private read<T>(method: string): T | undefined {
    try { return this.host.ask(method, {}) as T; } catch { return undefined; }
  }

  /** Whether the owner set a rupee rate, and its words, from the spend settings. */
  private rate(): string | null {
    return this.read<SpendPolicyView>('venture.spend.policy.get')?.rupeeRate ?? null;
  }

  /** How many paid calls the sample's spend list holds (they are this month's), as fake.ts lists them. */
  private calls(): number {
    return SPEND.length;
  }

  /** venture.money.flow {months?}: money in and out by month for the last months, and what was left, each with its receipt. */
  private flow(p: Record<string, unknown>): FlowView {
    exact(p, ['months']);
    this.open();
    const count = p.months === undefined ? 6 : p.months;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 24) throw invalid('Months must be a whole number from 1 to 24.');
    const ledger = this.host.ledger();
    const thisMonth = this.today().slice(0, 7);
    const months = [thisMonth];
    while (months.length < count) months.unshift(previousMonth(months[0]!));
    const rate = this.rate();
    const calls = this.calls();
    let uncounted = 0;
    const rows = months.map((month) => {
      const period = monthRange(month);
      const ins = this.receivedIn(ledger, period);
      const outs: Addend[] = ledger.bills.paid.filter((paid) => paid.paidOn >= period.from && paid.paidOn <= period.to)
        .sort((a, b) => a.paidOn.localeCompare(b.paidOn)).map((paid) => ({ label: `Bill from ${paid.vendor}, ${dayMonthYear(paid.paidOn)}`, minor: paid.amount }));
      // The sample's paid calls are all this month's; without a rupee rate they cannot be counted in rupees.
      const aiLeftOut = month === thisMonth && calls > 0 && rate === null;
      if (aiLeftOut) uncounted += calls;
      const words = monthWords(month);
      const inSum = ins.length ? this.sum(`Money in, ${words}`, ins, 'Nothing came in this month.') : null;
      const outSum = outs.length ? this.sum(`Money out, ${words}`, outs, 'Nothing went out this month.') : null;
      const both = [...ins.map((addend) => ({ ...addend, label: `In: ${addend.label}` })), ...outs.map((addend) => ({ ...addend, label: `Out: ${addend.label}`, minor: -addend.minor }))];
      const leftSum = both.length ? this.sum(`What was left, ${words}`, both, 'Nothing came in or went out this month.') : null;
      return { month, inSum, outSum, leftSum, note: aiLeftOut ? `AI spend not counted: ${NO_RATE}` : null };
    });
    const largest = rows.reduce((max, row) => Math.max(max, row.inSum?.minor ?? 0, row.outSum?.minor ?? 0), 0);
    const scaled = (sum: { minor: number } | null) => (sum === null ? null : largest <= 0 ? 0 : Math.floor((sum.minor * 1000) / largest));
    const spendLine = uncounted ? ` AI spend is not counted: ${NO_RATE}.` : '';
    return {
      months: rows.map((row) => ({
        month: row.month, label: row.month === thisMonth ? `${shortMonth(row.month)} so far` : shortMonth(row.month),
        in: row.inSum && this.figure(row.inSum), out: row.outSum && this.figure(row.outSum), left: row.leftSum && this.figure(row.leftSum),
        inPermille: scaled(row.inSum), outPermille: scaled(row.outSum), receiptId: row.leftSum?.receiptId ?? null, note: row.note,
      })),
      line: `Money in and out for the last ${plural(count, 'month', 'months')}, tax included.${spendLine}`,
      basis: basisOf(
        ['Money in: cleared payments in INR, tax included, by the day received', 'Money out: costs in the books, tax included, by the day paid', 'AI spend by UTC month, as your spend limit counts it'],
        uncounted ? { count: uncounted, line: `${uncounted} not counted: ${plural(uncounted, `paid AI call with ${NO_RATE}`, `paid AI calls with ${NO_RATE}`)}` } : null,
      ),
    };
  }

  /** venture.money.cash {}: the bank today and 13 weeks ahead if clients pay on time, the lowest weeks, the next three weeks. */
  private cash(p: Record<string, unknown>): CashView {
    exact(p, []);
    this.open();
    const asOf = this.today();
    const ledger = this.host.ledger();
    const weeks = Array.from({ length: WEEKS + 1 }, (_, k) => addDays(asOf, 7 * k));
    const until = weeks[WEEKS]!;
    // Everything due in or out up to the last week: open invoices on their due dates (late ones in the first week),
    // bills on theirs (overdue ones in the first week).
    const flows = [
      ...ledger.invoices.filter((i) => (i.status === 'issued' || i.status === 'part-paid') && i.number !== null && i.balance > 0 && i.dueDate !== null && i.dueDate <= until)
        .map((i) => {
          const late = i.dueDate! <= asOf;
          return { on: late ? addDays(asOf, 1) : i.dueDate!, due: i.dueDate!, direction: 'in' as const, late, overdue: false, minor: i.balance, label: late ? `${i.number} from ${i.client}, late since ${dayMonthYear(i.dueDate!)}, counted in the first week` : `${i.number} from ${i.client}, due ${dayMonthYear(i.dueDate!)}`, line: `Due from ${i.client} on ${dayMonthYear(i.dueDate!)}`, estimate: false };
        }),
      ...ledger.bills.due.filter((bill) => bill.dueDate <= until).map((bill) => {
        const overdue = bill.dueDate <= asOf;
        const words = overdue ? `overdue since ${dayMonthYear(bill.dueDate)}` : `due ${dayMonthYear(bill.dueDate)}`;
        return { on: overdue ? addDays(asOf, 1) : bill.dueDate, due: bill.dueDate, direction: 'out' as const, late: false, overdue, minor: -bill.balance, label: `Bill from ${bill.vendor}, ${words}${bill.expected ? ', expected' : ''}`, line: `Bill from ${bill.vendor}, ${words}${bill.expected ? ' (expected)' : ''}`, estimate: bill.expected };
      }),
    ];
    const weekIndex = (on: string) => Math.min(WEEKS, Math.max(1, Math.ceil(daysFrom(asOf, on) / 7)));
    const statements = (STATEMENTS[this.host.business()] ?? []).filter((statement) => statement.on <= asOf);
    const bankDay = statements.reduce((day, statement) => (statement.on > day ? statement.on : day), statements[0]?.on ?? asOf);
    const opening: Addend[] = [
      ...statements.map((statement) => ({ label: `${statement.account}, balance on ${dayMonthYear(statement.on)} from your statement`, minor: statement.minor })),
      ...ledger.payments.filter((payment) => payment.state === 'cleared' && payment.receivedOn > bankDay && payment.receivedOn <= asOf)
        .map((payment) => ({ label: `Recorded since your statement: ${ledger.invoices.find((i) => i.id === payment.invoiceId)?.number ?? 'an invoice'}, ${dayMonthYear(payment.receivedOn)}`, minor: payment.amount })),
    ];
    const plan = (k: number, scenario: 'on-time' | 'late-unpaid') => {
      const ahead = k === 0 ? [] : flows.filter((flow) => weekIndex(flow.on) <= k && !(scenario === 'late-unpaid' && flow.late)).map((flow) => ({ label: flow.label, minor: flow.minor, estimate: true }));
      const label = k === 0 ? 'In the bank today' : `Projected cash in the week to ${dayMonthYear(weeks[k]!)}${scenario === 'late-unpaid' ? ', if the late invoices never pay' : ''}`;
      return this.sum(label, [...opening.map((addend) => ({ ...addend, estimate: k > 0 })), ...ahead], 'Nothing to add up.');
    };
    // The next three weeks by date (overdue bills first), each proved by its week's receipt, which names it.
    const nextWeeks: CashView['nextWeeks'] = flows.filter((flow) => !flow.late && (flow.overdue || flow.due <= addDays(asOf, NEXT_DAYS)))
      .sort((a, b) => a.due.localeCompare(b.due) || a.line.localeCompare(b.line))
      .map((flow) => {
        const proof = plan(weekIndex(flow.on), 'on-time');
        return { on: flow.due, line: flow.line, direction: flow.direction, amount: { display: inr(Math.abs(flow.minor)), receiptId: proof.receiptId, kind: 'calculated' as const, source: { from: 'receipt' as const, receiptId: proof.receiptId }, projected: true as const } };
      });
    const forecastBasis = basisOf(['Open invoices and bills in INR, each on its due date', 'Usual costs from the last 3 full months, bills left out']);
    // 4J20: each draft issued today, the week its money falls due on its terms, its total proved by its price receipt.
    const ifIssued: CashView['ifIssued'] = ledger.invoices.filter((i) => i.status === 'draft' && i.total > 0 && addDays(asOf, i.dueInDays) <= until).map((i) => {
      const due = addDays(asOf, i.dueInDays);
      return { invoiceId: i.id, client: i.client, due, week: weeks[weekIndex(due)]!, amount: { display: inr(i.total), receiptId: i.priceReceiptId, kind: 'calculated' as const, source: { from: 'receipt' as const, receiptId: i.priceReceiptId }, projected: true as const } };
    });
    if (!statements.length) {
      return { bank: null, opening: null, points: [], lowest: { onTime: null, ifLateNeverPay: null }, usualCosts: null, assumptions: [], nextWeeks, ifIssued, ticks: [], basis: forecastBasis, line: 'Import a bank statement to see cash ahead.' };
    }
    const lateCount = flows.filter((flow) => flow.late).length;
    const assumptions = [
      `Starts from your bank balance on ${dayMonthYear(bankDay)}, with what you recorded since.`,
      'Clients pay open invoices on their due dates.',
      ...(lateCount ? [`The ${lateCount} late ${lateCount === 1 ? 'invoice is' : 'invoices are'} paid in the first week.`] : []),
      ...(flows.some((flow) => flow.direction === 'out') ? ['Bills are paid on their due dates; overdue ones in the first week.'] : []),
      'No money went out in the last 3 months, so no usual costs are taken.',
    ];
    const accounts = basisOf(['Bank balances in INR from your statements', 'Recorded since: payments you typed in and bills you paid']);
    const sums = weeks.map((_, k) => plan(k, 'on-time'));
    const openingFigure = this.figure(sums[0]!, { basis: accounts });
    const bankSum = this.sum('In the bank on your statements', statements.map((statement) => ({ label: `${statement.account}, balance on ${dayMonthYear(statement.on)} from your statement`, minor: statement.minor })), 'No bank statement with a balance.');
    const only = statements.length === 1 ? statements[0]! : null;
    const bank: CashView['bank'] = only
      ? { display: inr(only.minor), receiptId: bankSum.receiptId, kind: 'reported', source: { from: 'file', recordId: only.importId, row: only.row, line: `Closing balance on your ${only.account} statement, ${dayMonthYear(only.on)}` }, on: bankDay }
      : { ...this.figure(bankSum, { basis: accounts }), on: bankDay };
    const forecasts = sums.map((sum, k) => (k === 0 ? openingFigure : this.figure(sum, { projected: true, uses: assumptions })));
    const minors = sums.map((sum) => sum.minor);
    const lo = Math.min(0, ...minors), hi = Math.max(lo, ...minors), range = hi - lo;
    const at = (value: number) => (range === 0 ? (value > 0 ? 1000 : 0) : Math.floor(((value - lo) * 1000) / range));
    const lowestOf = (values: number[]) => values.reduce((best, value, index) => (index > 0 && (best === 0 || value < values[best]!) ? index : best), 0);
    const low = lowestOf(minors);
    // 4Z2 (money/cash.ts): a lowest week only when it falls below today's cash, never one that reads above the bank.
    const onTime = minors[low]! < minors[0]! ? { ...forecasts[low]!, week: weeks[low]!, line: 'Lowest week, if clients pay on time' } : null;
    let ifLate: CashView['lowest']['ifLateNeverPay'] = null;
    if (lateCount) {
      const lateSums = weeks.map((_, k) => plan(k, 'late-unpaid'));
      const index = lowestOf(lateSums.map((sum) => sum.minor));
      if (lateSums[index]!.minor < minors[0]!) {
        ifLate = { ...this.figure(lateSums[index]!, { projected: true, uses: assumptions.filter((line) => !line.startsWith(`The ${lateCount} late`)) }), week: weeks[index]!, line: `If the ${lateCount} late ${lateCount === 1 ? 'one never pays' : 'ones never pay'}` };
      }
    }
    const below = minors.findIndex((value, index) => index > 0 && value < 0);
    const falls = minors.some((value, index) => index > 0 && value < minors[index - 1]!);
    const line = below > 0 ? `Projected, if clients pay on time: cash goes below zero in the week to ${dayMonthYear(weeks[below]!)}.`
      : !falls ? `Projected, if clients pay on time: cash does not fall in the next ${WEEKS} weeks.`
        : !onTime ? `Projected, if clients pay on time: cash does not fall below today's balance in the next ${WEEKS} weeks.`
          : `Projected, if clients pay on time: the lowest week is the week to ${dayMonthYear(weeks[low]!)}, at ${onTime.display}.`;
    return {
      bank, opening: openingFigure,
      points: weeks.map((week, k) => ({ week, label: k === 0 ? 'Today' : `Week to ${dayMonthYear(week)}`, actual: k === 0 ? openingFigure : null, forecast: forecasts[k]!, actualPermille: k === 0 ? at(minors[0]!) : null, forecastPermille: at(minors[k]!) })),
      lowest: { onTime, ifLateNeverPay: ifLate }, usualCosts: null, assumptions, nextWeeks, ifIssued,
      ticks: levelTicks(lo, hi), basis: forecastBasis, line,
    };
  }

  /** venture.money.margins {month}: each client's invoiced before tax against the AI spend of their orders, in rupees only. */
  private margins(p: Record<string, unknown>): MarginsView {
    exact(p, ['month'], ['month']);
    const month = monthText(p.month);
    this.open();
    const ledger = this.host.ledger();
    const period = monthRange(month);
    const rate = this.rate();
    const calls = this.calls();
    const words = monthWords(month);
    const issued = ledger.invoices.filter((i) => this.issuedIn(i, period));
    const clients = [...new Map(issued.map((i) => [i.clientId, i.client])).entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
    const rows: MarginsView['rows'] = clients.map(([clientId, client]) => {
      const lines: Addend[] = issued.filter((i) => i.clientId === clientId).map((i) => ({ label: `${i.number}, before tax`, minor: i.subtotal }));
      const credited = ledger.credits.filter((c) => c.status === 'issued' && c.at.slice(0, 7) === month && issued.some((i) => i.id === c.invoiceId && i.clientId === clientId));
      for (const credit of credited) {
        const invoice = issued.find((i) => i.id === credit.invoiceId)!;
        lines.push({ label: `Credit note ${credit.number ?? ''} on ${invoice.number}, before tax`.replace('  ', ' '), minor: -Math.floor((credit.amount * invoice.subtotal) / invoice.total) });
      }
      const invoiced = this.figure(this.sum(`Invoiced to ${client} in ${words}, before tax`, lines, 'Nothing was invoiced.'));
      if (rate === null) return { clientId, client, invoiced, spend: null, margin: null, note: `Not counted: ${NO_RATE}` };
      // The sample's paid calls carry no run or order, so none can be claimed by a client: spend none, the margin what was invoiced.
      const spend = this.figure(this.sum(`AI and tool spend for ${client} in ${words}`, [], 'No paid call of theirs.'), { uses: [rate] });
      const margin = this.figure(this.sum(`Margin on ${client} in ${words}`, lines, 'Nothing was invoiced.'), { uses: [rate] });
      return { clientId, client, invoiced, spend, margin, note: null };
    });
    const leftOut = rate === null ? { count: calls, one: `paid call with ${NO_RATE}`, many: `paid calls with ${NO_RATE}` } : { count: calls, one: 'paid call no order can claim', many: 'paid calls no order can claim' };
    return {
      month, rows,
      line: rate === null ? `${words}: invoiced before tax. The AI and tool spend is not counted: ${NO_RATE}.` : `${words}: invoiced before tax, less the AI and tool spend of each client's orders at ${rate}.`,
      basis: basisOf(
        [`Invoices issued in ${words}, before tax, less credit notes`, "AI and tool spend by UTC month, tagged to a client through its run and order"],
        leftOut.count ? { count: leftOut.count, line: `${leftOut.count} not counted: ${plural(leftOut.count, leftOut.one, leftOut.many)}` } : null,
      ),
    };
  }

  /** venture.money.export {month}: the month for the owner's CA as CSV text, each row in its currency, totals with receipts. */
  private export(p: Record<string, unknown>): MoneyExportFile {
    exact(p, ['month'], ['month']);
    const month = monthText(p.month);
    this.open();
    const ledger = this.host.ledger();
    const period = monthRange(month);
    const name = this.host.name();
    const numbers = new Map(ledger.invoices.map((i) => [i.id, i]));
    const header = ['Section', 'Date', 'Number', 'Party', 'Party tax ID', 'Place of supply', 'Description', 'Before tax', 'Tax', 'Total', 'Status', 'Method', 'TDS section', 'TDS', 'Receipt', 'Currency'] as const;
    type Row = Partial<Record<(typeof header)[number], string>>;
    const statusWords = { draft: 'Draft', issued: 'Issued', 'part-paid': 'Part paid', paid: 'Paid', void: 'Void' } as const;
    const invoices: Row[] = ledger.invoices.filter((i) => this.issuedIn(i, period)).sort((a, b) => (a.issueDate ?? '').localeCompare(b.issueDate ?? '') || (a.number ?? '').localeCompare(b.number ?? ''))
      .map((i) => ({ Section: 'Invoice', Date: i.issueDate!, Number: i.number!, Party: i.client, Description: i.description, 'Before tax': decimal(i.subtotal), Tax: decimal(i.tax), Total: decimal(i.total), Status: statusWords[i.status], Receipt: i.priceReceiptId, Currency: i.currency }));
    const credits: Row[] = ledger.credits.filter((c) => c.status === 'issued' && c.at.slice(0, 10) >= period.from && c.at.slice(0, 10) <= period.to).map((c) => {
      const invoice = numbers.get(c.invoiceId);
      return { Section: 'Credit note', Date: c.at.slice(0, 10), Number: c.number ?? '', Party: invoice?.client ?? '', Description: `On ${invoice?.number ?? 'an invoice'}: ${c.reason}`, Total: decimal(c.amount), Status: 'Issued', Currency: 'INR' };
    });
    const methodWords = { 'bank-transfer': 'Bank transfer', upi: 'UPI', card: 'Card', cash: 'Cash', 'payment-link': 'Payment link', other: 'Other', cheque: 'Cheque' } as const;
    const payments: Row[] = ledger.payments.filter((pay) => pay.state === 'cleared' && pay.receivedOn >= period.from && pay.receivedOn <= period.to)
      .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at))
      .map((pay) => ({ Section: 'Payment', Date: pay.receivedOn, Number: numbers.get(pay.invoiceId)?.number ?? '', Party: numbers.get(pay.invoiceId)?.client ?? '', Total: decimal(pay.amount), Status: 'Cleared', Method: methodWords[pay.method], 'TDS section': pay.tds?.section ?? '', TDS: pay.tds ? decimal(pay.tds.amount) : '', Receipt: pay.booksReceiptId ?? '', Currency: 'INR' }));
    const costs: Row[] = ledger.bills.paid.filter((paid) => paid.paidOn >= period.from && paid.paidOn <= period.to)
      .map((paid) => ({ Section: 'Cost', Date: paid.paidOn, Party: paid.vendor, Description: `Bill from ${paid.vendor}`, Total: decimal(paid.amount), Currency: 'INR', Method: 'Bill paid' }));
    const data = [...invoices, ...credits, ...payments, ...costs];
    const totals: Row[] = [];
    if (data.length) {
      const invoiced = this.sum(`Invoiced in ${monthWords(month)}, before tax`, ledger.invoices.filter((i) => this.issuedIn(i, period)).map((i) => ({ label: `${i.number} for ${i.client}`, minor: i.subtotal })), 'Nothing was invoiced.');
      const received = this.sum(`Received in ${monthWords(month)}`, this.receivedIn(ledger, period), 'Nothing came in.');
      totals.push(
        { Section: 'Total', Description: 'Invoiced before tax, less credit notes', 'Before tax': decimal(invoiced.minor), Receipt: invoiced.receiptId, Currency: 'INR' },
        { Section: 'Total', Description: 'Received, tax included', Total: decimal(received.minor), Receipt: received.receiptId, Currency: 'INR' },
      );
    }
    const rows = [...data, ...totals];
    const amounts = new Set(['Before tax', 'Tax', 'Total', 'TDS']);
    const cell = (column: string, value: string) => (amounts.has(column) && /^-?\d+(?:\.\d+)?$/.test(value) ? value : csvCell(value));
    const csv = `\uFEFF${[header.join(','), ...rows.map((row) => header.map((column) => cell(column, row[column] ?? '')).join(','))].join('\r\n')}\r\n`;
    const parts = [
      ...(invoices.length ? [plural(invoices.length, 'invoice', 'invoices')] : []), ...(credits.length ? [plural(credits.length, 'credit note', 'credit notes')] : []),
      ...(payments.length ? [plural(payments.length, 'payment', 'payments')] : []), ...(costs.length ? [plural(costs.length, 'cost', 'costs')] : []),
    ];
    const what = parts.length <= 1 ? parts.join('') || 'nothing was invoiced, paid or spent' : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
    const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
    // 4J10: the business's signed receipts ride with the file; the sample engine signs nothing, so the list is empty.
    const receipts = { format: 'chausar-signed-receipts/1', business: name, algorithm: 'ed25519', publicKey: null, keys: [], receipts: [] };
    return { fileName: `${slug || 'chausar'}-${month}-for-ca.csv`, csv, rows: rows.length, line: `${monthWords(month)} for your CA: ${what}. Chausar does not send it; save it and share it yourself.`, receipts };
  }
}
