// Shared by the 4J4 money view tests (Ink v2 wave 4): the build handlers beside the money ones, a paid AI call written
// the way the model port writes it, a bank statement whose money-out rows the owner adds as costs, a credit note issued
// on Today, and copies of records in another currency (as an import or an older business would leave them).
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  BankLedgerView, CreditNoteView, InvoiceRecord, InvoiceView, PaymentRecord, QueueDecision, QueueList, SpendRecord, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as buildHandlers } from '../runtime/venture/build/index.ts';
import type { GoalEnv } from './venture-goals-helpers.ts';
import { call, owner } from './venture-views-env.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;

/** Calls one build handler as the owner, inside the app. */
export const build = <T>(env: GoalEnv, method: string, payload: unknown = {}) => (buildHandlers as Record<string, Handler>)[method](env.deps, owner, payload) as Promise<T>;

/** A paid call (US$1.50 unless given) at the env's time, settled at that figure unless a phase is given; ref: its run. */
export async function paidCall(env: GoalEnv, micros = '1500000', phase: SpendRecord['phase'] = 'settled', ref: string | null = null) {
  return ventureAction(env.deps, owner, 'admin', 'seed.spend', tx => {
    const base = tx.base('venture-spend');
    return tx.put<SpendRecord>({
      ...base, key: `model:${base.id}`, item: 'model:anthropic', label: 'Draft the monthly report', agent: null, connector: 'anthropic',
      payer: 'connection:conn_1', draftDigest: 'digest', rate: null, reservedMicros: micros, settledMicros: phase === 'settled' ? micros : null,
      settledBy: phase === 'settled' ? 'usage' : null, phase, quoteId: null, ref, refusal: null, settledAt: phase === 'settled' ? tx.now : null,
    });
  });
}

/** Imports a statement (Date, Description, Amount, Counterparty, Balance) for an account and adds its money-out rows as costs. */
export async function bankCosts(env: GoalEnv, rows: string[], account = 'HDFC current') {
  await build(env, 'venture.bank.import', { csv: `Date,Description,Amount,Counterparty,Balance\n${rows.join('\n')}\n`, account });
  const view = await build<BankLedgerView>(env, 'venture.bank.ledger');
  for (const row of view.rows) if (row.classification === 'money-out' && !row.decided) await build(env, 'venture.bank.apply', { transactionId: row.id, as: 'cost' });
}

/** Asks for a credit note on an invoice and issues it on Today, the owner's second ask included. */
export async function issueCredit(env: GoalEnv, issued: InvoiceView, amountMinor: string) {
  const asked = await env.money<{ creditNote: CreditNoteView }>('venture.credit.issue', { invoiceId: issued.invoice.id, amountMinor, reason: 'Two sessions were not held.', digest: issued.invoice.digest });
  const row = (await call<QueueList>(env, 'venture.queue.list')).rows.find(item => item.id === asked.creditNote.rowId);
  assert.ok(row, 'the credit note waits on Today');
  const done = await call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'issue' });
  assert.equal(done.outcome, 'done');
}

/** A copy of an issued invoice in another currency, with its own id and number; patch changes any field. */
export async function foreignInvoice(env: GoalEnv, from: InvoiceRecord, patch: Partial<InvoiceRecord> = {}): Promise<InvoiceRecord> {
  return ventureAction(env.deps, owner, 'admin', 'seed.foreign', tx => tx.put<InvoiceRecord>({ ...from, ...tx.base('venture-invoice'), number: 'USD-0001', currency: 'USD', ...patch }));
}

/** A copy of the business's first payment in another currency, received on a day. */
export async function foreignPayment(env: GoalEnv, receivedOn: string): Promise<PaymentRecord> {
  const [first] = listRecords(env.store.read(), 'venture-payment');
  assert.ok(first, 'a payment to copy');
  return ventureAction(env.deps, owner, 'admin', 'seed.foreign', tx => tx.put<PaymentRecord>({ ...first, ...tx.base('venture-payment'), currency: 'USD', receivedOn, bankTransactionId: undefined }));
}
