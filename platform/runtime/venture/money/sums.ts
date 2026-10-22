// Sum receipts (Ink final pass): what clients owe on open invoices, what came in over a period, and what AI and tools
// cost this month. Code adds the amounts in BigInt from the venture's own records and keeps one receipt per distinct
// sum: the same figure always opens the same receipt, and a changed figure makes a new one while the old one reads
// stale. venture.receipt.get serves them beside price receipts. Nothing here is a model number.
import { type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { digest, formatMicros, formatVentureDate, listRecords, ventureAction } from '../records.ts';
import type {
  InvoiceRecord, IsoDate, PriceFigure, PriceStep, RecordBase, SumReceiptRecord, SumReceiptSubject, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { spendOfMonth } from './spend.ts';

export type Addend = { recordId: string; label: string; amount: string; display: string; estimate: boolean };
export type SumPlan = { subject: SumReceiptSubject; currency: string; unit: 'minor' | 'micros'; addends: Addend[] };

const OPEN: readonly InvoiceRecord['status'][] = ['issued', 'part-paid'];
/** How many addends the explanation names before it says how many more there are. */
const NAMED = 12;

const LABELS: Readonly<Record<SumReceiptSubject['type'], string>> = Object.freeze({
  owed: 'Owed on open invoices', received: 'Received', spent: 'AI and tools',
});

/** Issued invoices with a balance left, oldest due first; one client's when clientId is given. */
export function openInvoices(state: State, ventureId: string, clientId: string | null = null): InvoiceRecord[] {
  return listRecords(state, 'venture-invoice', ventureId)
    .filter(invoice => OPEN.includes(invoice.status) && invoice.number !== null && BigInt(invoice.balanceMinor) > 0n && (clientId === null || invoice.clientId === clientId))
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || (a.number as string).localeCompare(b.number as string));
}

/** What is owed on open invoices, for one client or all of them. Balances count tax, as the invoices do. */
export function owedPlan(state: State, venture: VentureRecord, clientId: string | null): SumPlan {
  const names = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const addends = openInvoices(state, venture.id, clientId).filter(invoice => invoice.currency === venture.country.currency).map(invoice => ({
    recordId: invoice.id,
    label: clientId === null ? `${invoice.number} for ${names.get(invoice.clientId) ?? 'a client'}` : `${invoice.number}`,
    amount: invoice.balanceMinor, display: formatMinor(invoice.balanceMinor, invoice.currency), estimate: false,
  }));
  return { subject: { type: 'owed', clientId }, currency: venture.country.currency, unit: 'minor', addends };
}

/** Payments received from one day to another, both included, on the owner's calendar. Received counts tax. */
export function receivedPlan(state: State, venture: VentureRecord, from: IsoDate, to: IsoDate): SumPlan {
  const numbers = new Map(listRecords(state, 'venture-invoice', venture.id).map(invoice => [invoice.id, invoice.number]));
  const addends = listRecords(state, 'venture-payment', venture.id)
    .filter(payment => payment.receivedOn >= from && payment.receivedOn <= to && payment.currency === venture.country.currency)
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at))
    .map(payment => ({
      recordId: payment.id,
      label: `${numbers.get(payment.invoiceId) ?? 'An invoice'}, ${formatVentureDate(payment.receivedOn, venture.country.dateOrder)}`,
      amount: payment.amountMinor, display: formatMinor(payment.amountMinor, payment.currency), estimate: false,
    }));
  return { subject: { type: 'received', from, to }, currency: venture.country.currency, unit: 'minor', addends };
}

/** Paid calls this UTC month (as the model limits count them): settled ones at what they settled at, held ones at their estimate. */
export function spentPlan(state: State, venture: VentureRecord, month: string): SumPlan {
  const addends = spendOfMonth(listRecords(state, 'venture-spend', venture.id), month).map(item => ({
    recordId: item.record.id, label: item.record.label, amount: String(item.micros),
    display: `${formatMicros(String(item.micros))}${item.estimate ? ' (estimate)' : ''}`, estimate: item.estimate,
  }));
  return { subject: { type: 'spent', month }, currency: 'USD', unit: 'micros', addends };
}

/** The plan for a stored receipt's subject as of now, so a receipt can say whether it is still the current sum. */
export function currentPlan(state: State, venture: VentureRecord, subject: SumReceiptSubject): SumPlan {
  if (subject.type === 'owed') return owedPlan(state, venture, subject.clientId);
  if (subject.type === 'received') return receivedPlan(state, venture, subject.from, subject.to);
  return spentPlan(state, venture, subject.month);
}

export function planTotal(plan: SumPlan): bigint {
  return plan.addends.reduce((total, addend) => total + BigInt(addend.amount), 0n);
}

export function planDisplay(plan: SumPlan, total: bigint = planTotal(plan)): string {
  return plan.unit === 'micros' ? formatMicros(String(total), plan.currency) : formatMinor(total, plan.currency);
}

export function planEstimate(plan: SumPlan): boolean {
  return plan.addends.some(addend => addend.estimate);
}

/** Over what the sum is and exactly which amounts it adds: the same sum always has the same digest. */
export function sumDigest(plan: SumPlan): string {
  return digest({ subject: plan.subject, currency: plan.currency, unit: plan.unit, addends: plan.addends.map(addend => [addend.recordId, addend.amount]) });
}

function explanation(plan: SumPlan, display: string): string {
  const count = plan.addends.length;
  if (count === 0) {
    return plan.subject.type === 'owed' ? 'No open invoices, so nothing is owed.'
      : plan.subject.type === 'received' ? 'No payments were recorded in this period.' : 'No paid calls this month.';
  }
  const what = plan.subject.type === 'owed' ? (count === 1 ? 'open invoice' : 'open invoices')
    : plan.subject.type === 'received' ? (count === 1 ? 'payment' : 'payments') : (count === 1 ? 'paid call' : 'paid calls');
  const named = plan.addends.slice(0, NAMED).map(addend => `${addend.label} ${addend.display}`).join('; ');
  const more = count > NAMED ? `; and ${count - NAMED} more` : '';
  const held = planEstimate(plan) ? ' Calls not settled yet count at their estimate.' : '';
  return `${count} ${what}: ${named}${more}. Added together: ${display}.${held}`;
}

function receiptOf(base: RecordBase<'venture-sum-receipt'>, plan: SumPlan, sealed: string): SumReceiptRecord {
  const total = planTotal(plan);
  const display = planDisplay(plan, total);
  const steps: PriceStep[] = plan.addends.length
    ? [{ op: 'add', inputs: plan.addends.map(addend => addend.amount), resultMinor: String(total), rule: plan.unit === 'micros' ? 'added in whole micro-dollars' : 'added in whole minor units' }]
    : [];
  const figure: PriceFigure = { key: plan.subject.type === 'owed' ? 'balance' : 'total', label: LABELS[plan.subject.type], minor: String(total), display, currency: plan.currency };
  return {
    ...base, subject: plan.subject, operation: 'venture.sum', currency: plan.currency, unit: plan.unit,
    addends: plan.addends.map(({ recordId, label, amount, display: shown }) => ({ recordId, label, amount, display: shown })),
    steps, figures: [figure], totalMinor: String(total), estimate: planEstimate(plan),
    allowedNumbers: [...new Set([display, ...plan.addends.map(addend => addend.display)])],
    explanation: explanation(plan, display), digest: sealed, stale: false,
  };
}

/**
 * The receipt for a sum: the stored one with the same digest, else a new one. A read that finds it writes nothing; a
 * changed sum writes one record (level read: the owner, an agent or a viewer may look at the figure it backs).
 */
export async function sumReceipt(deps: VentureDeps, ctx: Context, ventureId: string, plan: SumPlan): Promise<SumReceiptRecord> {
  const sealed = sumDigest(plan);
  const stored = listRecords(deps.store.read(), 'venture-sum-receipt', ventureId).find(record => record.digest === sealed);
  if (stored) return stored;
  return ventureAction(deps, ctx, 'read', 'sum.receipt', tx =>
    tx.list('venture-sum-receipt').find(record => record.digest === sealed) ?? tx.put<SumReceiptRecord>(receiptOf(tx.base('venture-sum-receipt'), plan, sealed)));
}

/** A stored sum receipt as venture.receipt.get serves it: stale once the same subject adds up to something else. */
export function servedSumReceipt(state: State, venture: VentureRecord, record: SumReceiptRecord): SumReceiptRecord {
  return { ...record, stale: record.stale || sumDigest(currentPlan(state, venture, record.subject)) !== record.digest };
}
