// Chausar venture launcher, money (Ink v2 wave 4, package 4J2; catalogue O9): the sum receipt of a set approval. The
// owner picks rows on Today and approves them in one go (views/queue-actions.ts); the set's total quote is what
// approving each picked row can cost, worked out by code when the set was approved and held in the receipt's subject,
// so the same set always opens the same receipt. Nothing here is a model number.
import type { SumReceiptSubject } from '../contracts.ts';
import { formatMicros } from '../records.ts';
import type { SumPlan } from './sums.ts';

type SetSubject = Extract<SumReceiptSubject, { type: 'set' }>;

/** The plan behind a set's total: one addend per picked row, in the order the owner picked them, in micro-dollars. */
export function setPlan(subject: SetSubject): SumPlan {
  return {
    subject, currency: 'USD', unit: 'micros',
    addends: subject.items.map(item => ({ recordId: item.rowId, label: item.label, amount: item.micros, display: formatMicros(item.micros), estimate: false })),
    words: { label: 'What this set can cost', one: 'item', many: 'items', none: 'Nothing was picked.' },
  };
}
