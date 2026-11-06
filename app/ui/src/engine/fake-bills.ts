/**
 * The fake engine's bills (Ink v2 wave 4, 4J5), for `npm run dev:ui` and tests: venture.bills.add, .pay, .list and .stop
 * in the engine's shapes, order and refusals (money/bills.ts). A bill keeps each line with the tax name and rate it was
 * charged at; its total is the lines plus their tax, half up; states draft, posted, partial, paid and overdue come from
 * the bill and today; a payment over what is left is BILL_PAYMENT_TOO_LARGE; the list is the nearest due date first,
 * with what open bills owe and its receipt; stopping a repeat cancels its waiting expected bill. Chausar moves no money:
 * a payment here is one the owner says they made. Like the money desk it keeps paise and lets only formatted text out.
 * The sample engine has no clock running, so it never drafts a repeating bill's next one by itself.
 */

import { EngineError, PAYMENT_METHODS, type BillView, type MoneyFigure, type ReceiptLite } from './types';
import { inr } from './fake-money';

interface HeldLine { description: string; amount: number; taxName: string; rate: number }
interface HeldBill {
  id: string; at: string; businessId: string; vendor: string; lines: HeldLine[]; billDate: string; dueDate: string;
  recurring: 'monthly' | 'quarterly' | null; status: 'draft' | 'posted' | 'cancelled'; total: number; paid: number;
}

/** What the bills desk needs from the money desk around it. */
export interface BillsHost { now: () => string; business: () => string }

export const FAKE_4J5_BILL_METHODS: readonly string[] = ['venture.bills.add', 'venture.bills.pay', 'venture.bills.list', 'venture.bills.stop'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINOR = /^(0|[1-9]\d{0,13})$/;
const lineTax = (line: HeldLine) => Math.floor((line.amount * line.rate + 5000) / 10000);
const vendorKey = (vendor: string) => vendor.trim().replace(/\s+/g, ' ').toLowerCase();
const text = (value: unknown, field: string, max: number): string => {
  const said = typeof value === 'string' ? value.trim() : '';
  if (!said || said.length > max || /[\n\r\t]/.test(said)) throw new EngineError('INVALID_VENTURE_REQUEST', `${field} must be one line of 1 to ${max} characters.`);
  return said;
};

/** 4J20: an amount as typed ('1,500.50') or in minor units ('150050'), exactly one, above zero, as credits.ts typedOrMinor. */
function typedOrMinor(typed: unknown, minor: unknown, field: string): number {
  if ((typed === undefined) === (minor === undefined)) throw new EngineError('INVALID_AMOUNT', `Give ${field.toLowerCase()} once, as you would type it, like 1500 or 1500.50.`);
  if (minor !== undefined) {
    if (typeof minor !== 'string' || !MINOR.test(minor) || minor === '0') throw new EngineError('INVALID_AMOUNT', `${field} must be a whole amount in minor units, above zero.`);
    return Number.parseInt(minor, 10);
  }
  const text = typeof typed === 'string' && typed.length <= 40 ? typed.replace(/[\s,]/g, '') : '';
  const match = /^(\d{1,13})(?:\.(\d+))?$/.exec(text);
  const fraction = (match?.[2] ?? '').replace(/0+$/, '');
  if (!match || fraction.length > 2) throw new EngineError('INVALID_AMOUNT', `${field} must be a positive amount like 2499 or 2499.50.`);
  const paise = Number.parseInt(match[1]!, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0'), 10);
  if (paise <= 0) throw new EngineError('INVALID_AMOUNT', `${field} must be above zero.`);
  return paise;
}

export class FakeBills {
  private bills: HeldBill[] = [];
  private receipts: ReceiptLite[] = [];
  private seq = 1;
  private receiptSeq = 900;
  /** 4J20: one receipt per distinct balance of a bill. */
  private balanceIds = new Map<string, string>();
  /** 4J20: each payment of a bill with its day, as the books' cost facts keep it. */
  private payments: { billId: string; vendor: string; paidOn: string; amount: number }[] = [];
  private readonly host: BillsHost;

  constructor(host: BillsHost) {
    this.host = host;
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.bills.add': return this.add(p);
      case 'venture.bills.pay': return this.pay(p);
      case 'venture.bills.list': return this.list();
      case 'venture.bills.stop': return this.stop(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** A receipt this desk made (what open bills owe). */
  receipt(id: string): ReceiptLite | undefined {
    const receipt = this.receipts.find((r) => r.id === id);
    return receipt ? structuredClone(receipt) : undefined;
  }

  /**
   * 4J20: the open business's bills in paise for the money views (fake-money-views.ts): each bill still to pay (posted,
   * or expected from a repeat), and each payment the owner made with its day, which the books count as a cost.
   */
  ledger(): { due: { billId: string; vendor: string; dueDate: string; balance: number; expected: boolean; currency: string }[]; paid: { billId: string; vendor: string; paidOn: string; amount: number }[] } {
    const mine = this.mine();
    return {
      due: mine.filter((b) => b.total > b.paid).map((b) => ({ billId: b.id, vendor: b.vendor, dueDate: b.dueDate, balance: b.total - b.paid, expected: b.status === 'draft', currency: 'INR' })),
      paid: this.payments.filter((p) => mine.some((b) => b.id === p.billId)).map((p) => ({ ...p })),
    };
  }

  private today(): string { return this.host.now().slice(0, 10); }
  private mine(): HeldBill[] { return this.bills.filter((b) => b.businessId === this.host.business() && b.status !== 'cancelled'); }

  private view(bill: HeldBill, withReceipt = false): BillView {
    const balance = bill.total - bill.paid;
    const state: BillView['state'] = bill.status === 'draft' ? 'draft' : balance <= 0 ? 'paid' : bill.dueDate < this.today() ? 'overdue' : bill.paid > 0 ? 'partial' : 'posted';
    return { id: bill.id, vendor: bill.vendor, billDate: bill.billDate, dueDate: bill.dueDate, total: inr(bill.total), paid: inr(bill.paid), balance: inr(balance), state, recurring: bill.recurring, ...(withReceipt ? { receiptId: this.balanceReceipt(bill) } : {}) };
  }

  /** 4J20: one bill's balance receipt, as bills.list proves each row: its lines and their tax less each payment. */
  private balanceReceipt(bill: HeldBill): string {
    const parts = [...bill.lines.map((line) => `${line.description} ${inr(line.amount)}`), ...bill.lines.filter((line) => lineTax(line) > 0).map((line) => `${line.taxName} on ${line.description} ${inr(lineTax(line))}`), ...(bill.paid ? [`Paid ${inr(-bill.paid)}`] : [])];
    const explanation = `${parts.join('; ')}. Added together: ${inr(bill.total - bill.paid)}.`;
    const key = `${bill.id}|${explanation}`;
    const held = this.balanceIds.get(key);
    if (held) return held;
    const id = `R-0${this.receiptSeq++}`;
    this.balanceIds.set(key, id);
    this.receipts.push({ id, at: this.host.now(), stale: false, explanation, figures: [{ key: 'total', label: `Left to pay to ${bill.vendor}`, display: inr(bill.total - bill.paid) }] });
    return id;
  }

  /** What posted bills still owe, with a receipt listing each, as the engine's 'bills' sum receipt does; null for none. */
  private owed(): MoneyFigure | null {
    const open = this.mine().filter((b) => b.status === 'posted' && b.total > b.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (!open.length) return null;
    const total = open.reduce((sum, b) => sum + b.total - b.paid, 0);
    const id = `R-0${this.receiptSeq++}`;
    this.receipts.push({
      id, at: this.host.now(), stale: false, explanation: `${open.length === 1 ? '1 bill' : `${open.length} bills`}: ${open.map((b) => `${b.vendor}, due ${b.dueDate} ${inr(b.total - b.paid)}`).join('; ')}. Added together: ${inr(total)}.`,
      figures: [{ key: 'total', label: 'Owed on bills', display: inr(total) }],
    });
    return { display: inr(total), receiptId: id };
  }

  private lines(value: unknown): HeldLine[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new EngineError('INVALID_VENTURE_REQUEST', 'A bill has 1 to 50 lines.');
    return value.map((item: Record<string, unknown>) => {
      const keys = Object.keys(item ?? {});
      if (keys.some((key) => !['description', 'amount', 'amountMinor', 'taxName', 'taxRate', 'taxRateBps'].includes(key)) || !keys.includes('description') || !keys.includes('taxName')) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
      const description = text(item.description, 'A line', 200);
      // 4J20: the amount as typed or in minor units, and the rate as typed (a percentage) or in basis points; one of each.
      const amount = typedOrMinor(item.amount, item.amountMinor, 'A line amount');
      if ((item.taxRate === undefined) === (item.taxRateBps === undefined)) throw new EngineError('INVALID_TAX_RATE', 'Give the tax rate once, like 18 for 18%, or 0 for no tax.');
      const typedRate = item.taxRate === undefined ? null : /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(item.taxRate).replace(/[\s%]/g, ''));
      if (item.taxRate !== undefined && !typedRate) throw new EngineError('INVALID_TAX_RATE', 'The tax rate must be a rate like 18 or 8.25.');
      if (item.taxRateBps !== undefined && (typeof item.taxRateBps !== 'string' || !/^\d{1,5}$/.test(item.taxRateBps))) throw new EngineError('INVALID_TAX_RATE', 'A tax rate is whole basis points from 0 to 10000, like 1800 for 18%.');
      const rate = typedRate ? Number.parseInt(typedRate[1]!, 10) * 100 + Number.parseInt((typedRate[2] ?? '').padEnd(2, '0'), 10) : Number.parseInt(item.taxRateBps as string, 10);
      if (rate > 10000) throw new EngineError('INVALID_TAX_RATE', 'The tax rate must be 100 or less.');
      const taxName = rate === 0 && typeof item.taxName === 'string' && item.taxName.trim() === '' ? '' : text(item.taxName, 'The tax name', 40);
      return { description, amount, taxName, rate };
    });
  }

  private add(p: Record<string, unknown>): { bill: BillView; receiptId?: string } {
    const vendor = text(p.vendor, 'The vendor', 120);
    const lines = this.lines(p.lines);
    if (typeof p.billDate !== 'string' || !DATE.test(p.billDate) || typeof p.dueDate !== 'string' || !DATE.test(p.dueDate)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Use dates like 2026-10-15.');
    if (p.dueDate < p.billDate) throw new EngineError('INVALID_VENTURE_REQUEST', 'The due date must be on or after the bill date.');
    if (p.recurring !== undefined && p.recurring !== null && p.recurring !== 'monthly' && p.recurring !== 'quarterly') throw new EngineError('INVALID_VENTURE_REQUEST', 'A bill repeats monthly or quarterly, or not at all.');
    const total = lines.reduce((sum, line) => sum + line.amount + lineTax(line), 0);
    // The real bill takes a waiting expected one's place, keeping its repeat unless told.
    const expected = this.mine().find((b) => b.status === 'draft' && vendorKey(b.vendor) === vendorKey(vendor));
    const recurring = p.recurring === undefined ? (expected?.recurring ?? null) : (p.recurring as HeldBill['recurring']);
    const fields = { vendor, lines, billDate: p.billDate, dueDate: p.dueDate, recurring, status: 'posted' as const, total };
    let bill: HeldBill;
    if (expected) {
      Object.assign(expected, fields);
      bill = expected;
    } else {
      bill = { id: `bill-${this.seq++}`, at: this.host.now(), businessId: this.host.business(), paid: 0, ...fields };
      this.bills.push(bill);
    }
    const owed = this.owed();
    return { bill: this.view(bill), ...(owed ? { receiptId: owed.receiptId } : {}) };
  }

  private pay(p: Record<string, unknown>): { bill: BillView; receiptId?: string } {
    const bill = this.mine().find((b) => b.id === p.billId);
    if (!bill) throw new EngineError('INVALID_VENTURE_REQUEST', 'This bill was not found.');
    const amount = typedOrMinor(p.amount, p.amountMinor, 'The payment');
    if (typeof p.paidOn !== 'string' || !DATE.test(p.paidOn)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Date paid must be a date like 2026-10-15.');
    if (!(PAYMENT_METHODS as readonly string[]).includes(String(p.method)) && p.method !== 'cheque') throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose how you paid it.');
    const balance = bill.total - bill.paid;
    if (amount > balance) throw new EngineError('BILL_PAYMENT_TOO_LARGE', balance <= 0 ? 'This bill is already paid in full.' : `This is more than the ${inr(balance)} left to pay on this bill.`);
    bill.paid += amount;
    bill.status = 'posted';
    this.payments.push({ billId: bill.id, vendor: bill.vendor, paidOn: p.paidOn, amount });
    const id = `R-0${this.receiptSeq++}`;
    this.receipts.push({ id, at: this.host.now(), stale: false, explanation: `A payment you made of the ${bill.vendor} bill on ${p.paidOn}, counted in your costs.`, figures: [{ key: 'total', label: 'Costs', display: inr(amount) }] });
    return { bill: this.view(bill), receiptId: id };
  }

  private list(): { bills: BillView[]; owed: MoneyFigure | null } {
    const bills = this.mine().sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.billDate.localeCompare(b.billDate) || a.at.localeCompare(b.at));
    return { bills: bills.map((bill) => this.view(bill, true)), owed: this.owed() };
  }

  private stop(p: Record<string, unknown>): { bills: BillView[]; owed: MoneyFigure | null } {
    const bill = this.mine().find((b) => b.id === p.billId);
    if (!bill) throw new EngineError('INVALID_VENTURE_REQUEST', 'This bill was not found.');
    const chain = this.mine().filter((b) => b.recurring !== null && vendorKey(b.vendor) === vendorKey(bill.vendor));
    if (!chain.length) throw new EngineError('INVALID_VENTURE_REQUEST', 'This bill does not repeat.');
    for (const item of chain) {
      item.recurring = null;
      if (item.status === 'draft') item.status = 'cancelled';
    }
    return this.list();
  }

  /** Test and demo helper: the expected bill a repeat would draft on its day (the engine's sweep does it). */
  expect(vendor: string, billDate: string, dueDate: string): BillView {
    const last = this.mine().filter((b) => vendorKey(b.vendor) === vendorKey(vendor) && b.recurring !== null).at(-1);
    if (!last) throw new EngineError('INVALID_VENTURE_REQUEST', 'This bill does not repeat.');
    const bill: HeldBill = { ...last, id: `bill-${this.seq++}`, at: this.host.now(), lines: last.lines.map((line) => ({ ...line })), billDate, dueDate, status: 'draft', paid: 0 };
    this.bills.push(bill);
    return this.view(bill);
  }
}
