// Collections ladder ideas from finance-skills (MIT prompt text); original Chausar implementation.
import { ChausarError } from '../../../portable.ts';

export type CollectionStage = { id: string; fromDay: number; name: string };
export type PromiseInput = { invoiceIds: readonly string[]; amountMinor: string; promisedOn: string };
export type PromisePayment = { invoiceId: string; amountMinor: string; receivedOn: string; cleared: boolean };
export const DEFAULT_LADDER: readonly CollectionStage[] = Object.freeze([
  { id: 'reminder', fromDay: 1, name: 'Reminder draft' },
  { id: 'call', fromDay: 31, name: 'Call and email by a person' },
  { id: 'formal', fromDay: 61, name: 'Formal letter for review' },
  { id: 'lawyer', fromDay: 91, name: 'Lawyer review and pause new orders' },
  { id: 'writeoff', fromDay: 181, name: 'Write-off decision by the client' },
]);

/** Refuse a ladder with gaps in ordering, repeated ids or invalid day limits. */
export function validateLadder(ladder: readonly CollectionStage[]): void {
  if (!ladder.length || ladder.length > 12 || ladder[0]!.fromDay !== 1 || new Set(ladder.map(row => row.id)).size !== ladder.length || ladder.some((row, i) => !/^[a-z][a-z0-9-]*$/.test(row.id) || !row.name.trim() || !Number.isSafeInteger(row.fromDay) || row.fromDay < 1 || (i > 0 && row.fromDay <= ladder[i - 1]!.fromDay))) {
    throw new ChausarError('COLLECTION_LADDER_INVALID', 'Keep the stages in increasing days late, starting on the first late day.');
  }
}

/** Days overdue choose a house or owner ladder stage; two broken promises advance one stage. */
export function collectionStage(days: number, broken: number, ladder: readonly CollectionStage[] = DEFAULT_LADDER): CollectionStage {
  validateLadder(ladder);
  if (!Number.isSafeInteger(days) || days < 0 || !Number.isSafeInteger(broken) || broken < 0) throw new ChausarError('COLLECTION_LADDER_INVALID', 'Days late and broken promises must be whole counts.');
  let index = 0;
  for (let i = 0; i < ladder.length; i++) if (days >= ladder[i]!.fromDay) index = i;
  return { ...ladder[Math.min(ladder.length - 1, index + (broken >= 2 ? 1 : 0))]! };
}

/** A promise is kept only by cleared payments to its invoices made by the deadline, never by a model flag. */
export function promiseStatus(promise: PromiseInput, payments: readonly PromisePayment[], today: string): 'kept' | 'pending' | 'broken' {
  const paid = payments.filter(payment => payment.cleared && promise.invoiceIds.includes(payment.invoiceId) && payment.receivedOn <= promise.promisedOn && payment.receivedOn <= today).reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n);
  return paid >= BigInt(promise.amountMinor) ? 'kept' : today > promise.promisedOn ? 'broken' : 'pending';
}

/** Prepare a note for the service client; no debtor address or send operation is accepted. */
export function reminderDraft(clientId: string, invoiceId: string, text: string, debtorRecipient?: string) {
  if (debtorRecipient !== undefined) throw new ChausarError('NO_DEBTOR_CONTACT', 'Only your client may approve and send the reminder to their debtor.');
  return { toClientId: clientId, invoiceId, text, sender: 'client' as const, needsApproval: true as const };
}
