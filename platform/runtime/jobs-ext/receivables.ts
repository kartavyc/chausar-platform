/**
 * The receivables job's cases: one per unpaid invoice, read from a calculator aging receipt.
 * Software does the arithmetic in BigInt paise from the receipt's own rows, and every case keeps
 * the receipt it came from. The ready-made rule decides remind, wait or ask; a rule that is not
 * sure hands the case on (to an approved procedure, the agent, or you).
 */
import type { CaseFields } from '../procedures/types.ts';
import { DAY_MS } from './templates.ts';

export type ReceiptLike = {
  id: string; sourceIds: string[]; definitions: { name: string; kind: string }[];
  rows: { factId: string; sourceId: string; kind: string; amountMinor: string; dueDate?: string; invoiceId?: string; customerId?: string }[];
};

export type InvoiceCase = { invoiceId: string; customerId: string; factId: string; sourceId: string; outstandingMinor: string; billedMinor: string; dueDate: string; daysOverdue: number };

const REFERENCE = /^[A-Za-z0-9._-]{1,64}$/;

/** Outstanding per invoice from the aging receipt's rows. Invoices without a usable reference are left out and counted. */
export function invoiceCases(receipt: ReceiptLike, onDate: string): { cases: InvoiceCase[]; unusable: number } {
  const billed = receipt.definitions.find(item => item.name === 'billed')?.kind;
  const credits = new Set(receipt.definitions.filter(item => item.name === 'received' || item.name === 'refunds').map(item => item.kind));
  const key = (invoiceId?: string, customerId?: string) => invoiceId && customerId ? JSON.stringify([invoiceId, customerId]) : null;
  const paid = new Map<string, bigint>();
  for (const row of receipt.rows) if (credits.has(row.kind)) { const k = key(row.invoiceId, row.customerId); if (k) paid.set(k, (paid.get(k) ?? 0n) + BigInt(row.amountMinor)); }
  const cases: InvoiceCase[] = []; let unusable = 0;
  for (const row of receipt.rows.filter(item => item.kind === billed)) {
    const k = key(row.invoiceId, row.customerId);
    if (!k || !REFERENCE.test(row.invoiceId!) || !REFERENCE.test(row.customerId!) || !row.dueDate || !Number.isFinite(Date.parse(row.dueDate))) { unusable++; continue; }
    const outstanding = BigInt(row.amountMinor) - (paid.get(k) ?? 0n);
    cases.push({ invoiceId: row.invoiceId!, customerId: row.customerId!, factId: row.factId, sourceId: row.sourceId, billedMinor: row.amountMinor,
      outstandingMinor: String(outstanding < 0n ? 0n : outstanding), dueDate: row.dueDate, daysOverdue: Math.floor((Date.parse(onDate) - Date.parse(row.dueDate)) / DAY_MS) });
  }
  return { cases: cases.sort((a, b) => a.invoiceId.localeCompare(b.invoiceId) || a.customerId.localeCompare(b.customerId)), unusable };
}

export const bucketOf = (days: number) => days <= 0 ? 'not-due' : days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : 'over-90';

/** Typed features for routing. No amounts, names or free text. */
export function caseFields(item: InvoiceCase, consent: 'yes' | 'no' | 'not-asked' | 'stopped', remindedToday: boolean, remindersSoFar: number): CaseFields {
  return { daysOverdue: item.daysOverdue, bucket: bucketOf(item.daysOverdue), partiallyPaid: BigInt(item.outstandingMinor) < BigInt(item.billedMinor), consent, remindedToday, remindersSoFar };
}

export const RECEIVABLE_OPTIONS = ['remind', 'wait', 'ask-owner'] as const;

/** The ready-made rule. It says how sure it is; below the bar the case goes on to a procedure, the agent or you. */
export function readyMadeDecision(fields: CaseFields): { decision: string; confidence: number; reason: string } {
  if (fields.daysOverdue as number <= 0) return { decision: 'wait', confidence: 1, reason: 'not-due' };
  if (fields.consent === 'stopped') return { decision: 'wait', confidence: 1, reason: 'stopped-by-customer' };
  if (fields.consent !== 'yes') return { decision: 'wait', confidence: 1, reason: 'no-agreement' };
  if (fields.remindedToday === true) return { decision: 'wait', confidence: 1, reason: 'reminded-today' };
  if ((fields.daysOverdue as number) > 60 || (fields.remindersSoFar as number) >= 3) return { decision: 'ask-owner', confidence: 0.5, reason: 'long-overdue' };
  return { decision: 'remind', confidence: 1, reason: 'overdue' };
}

/** Fixed reminder words. The invoice reference is data; nothing from a note or description is read. */
export const reminderText = (invoiceId: string) => `Hello. This is a friendly reminder that invoice ${invoiceId} is now due. Please pay it using the link on the invoice. Thank you.`;
