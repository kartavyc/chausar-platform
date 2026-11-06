// Chausar venture launcher, money (Ink v2 wave 4, package 4J5, M11, M12): credit notes, and the money rows of Today.
// venture.credit.issue is the owner asking for a credit note against an issued invoice they checked (its digest); the
// note then waits on Today as an 'invoice' row with a second ask, because issuing for real is on the always-ask floor.
// Only the owner's Issue on that row issues it, through the action journal (credit.issue), bound to the note and the
// balance the card showed: a changed card is stale before the claim and again at the claim, and runs nothing. Issuing
// numbers it (CN-0001), links it to its invoice, takes it off the balance (an invoice it settles is paid), and writes its
// share before tax as a refund fact for the books and so off the goal (goal-plans.ts reads issued notes); the last note
// of a full credit takes the rest, so the shares add up exactly. Cancel leaves everything as it was. A waiting note
// holds its amount, so no payment or other note takes the same money. The card's balances carry a receipt worked out
// again from the records on every read ('credit-balance:<note id>', served by venture.receipt.get). A payment that came
// in shows as "<client> paid <invoice>" for a week, until the owner marks it seen; a cheque only once it clears.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { decimalMinor, formatMinor } from '../../currency.ts';
import { amountText, digest, exactPayload, formatVentureDate, listRecords, plainText, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { gateEffect, sealApproval } from '../policy/holds.ts';
import { digestOf, journalled, type ApplyHandle } from '../journal/journal.ts';
import { insertBooksFact, type BooksFactInput } from './facts.ts';
import { beforeTax, creditBeforeTax } from './goal-plans.ts';
import { freeBalance, issuedCredits, METHOD_WORDS, paymentState } from './ledger.ts';
import { recordId } from './shared.ts';
import { statementPlan } from './statement.ts';
import { planTotal, type Addend } from './sums.ts';
import type {
  ClientRecord, CreditNoteRecord, CreditNoteView, InvoiceRecord, PaymentRecord, SumReceiptRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import type { W4Decision, W4Outcome, W4RowItem } from '../views/queue-w4.ts';

const DIGEST_TEXT = /^[A-Za-z0-9]{1,200}$/;
const NOT_FOUND = 'This credit note was not found.';
const STALE = 'This credit note or its invoice changed since you looked. Nothing was issued. Look at it again.';
/** A payment shows on Today for this long after it came in, unless the owner marks it seen first. */
const PAID_ROW_MS = 7 * 86_400_000;
/** The receipt id behind a waiting credit note's card. */
export const CREDIT_BALANCE = 'credit-balance:';
/** 4J20: the receipt id behind a credit note's own amount on its view. */
export const CREDIT_NOTE = 'credit-note:';

/** A whole, positive number of minor units, as a payload gives it. */
export function minorAmount(value: unknown, field: string): bigint {
  check(typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value), 'INVALID_AMOUNT', `${field} must be a whole amount in minor units, like 233050.`);
  const amount = BigInt(value);
  check(amount > 0n, 'INVALID_AMOUNT', `${field} must be above zero.`);
  return amount;
}

/**
 * 4J20: an amount as the owner typed it ('1,500' or '1500.50', read in the currency it is in, as payment.record reads
 * its amount), or as whole minor units: exactly one of the two, above zero.
 */
export function typedOrMinor(typed: unknown, minor: unknown, currency: string, field: string): bigint {
  check((typed === undefined) !== (minor === undefined), 'INVALID_AMOUNT', `Give ${field.toLowerCase()} once, as you would type it, like 1500 or 1500.50.`);
  if (minor !== undefined) return minorAmount(minor, field);
  const amount = BigInt(decimalMinor(amountText(typed, field), currency));
  check(amount > 0n, 'INVALID_AMOUNT', `${field} must be above zero.`);
  return amount;
}

/** What the owner approves when issuing: the invoice, the amount, its currency and the reason. */
export function creditDigest(note: Pick<CreditNoteRecord, 'invoiceId' | 'amountMinor' | 'currency' | 'reason'>): string {
  return digest({ invoiceId: note.invoiceId, amountMinor: note.amountMinor, currency: note.currency, reason: note.reason });
}

/** What the card showed: the note and the invoice's balance then. The journal entry is bound to it. */
function shownDigest(note: CreditNoteRecord, invoice: InvoiceRecord): string {
  return digest({ note: note.digest, balance: invoice.balanceMinor });
}

function tooLarge(free: bigint, invoice: InvoiceRecord): string {
  return free <= 0n
    ? `Nothing is left to credit on ${invoice.number}.`
    : `A credit note can be at most ${formatMinor(free, invoice.currency)} on ${invoice.number}: what is owed and not held by a cheque or another credit note.`;
}

const clientName = (clients: readonly ClientRecord[], invoice: InvoiceRecord) => clients.find(item => item.id === invoice.clientId)?.name ?? 'Your client';

/** The Today row's subject and version: the version changes with the note and with the invoice's balance. */
function rowParts(note: CreditNoteRecord, invoice: InvoiceRecord): { subject: string; version: string } {
  return { subject: `credit:${note.id}`, version: shownDigest(note, invoice).slice(0, 16) };
}

/** The id of a waiting note's Today row, as views/queue.ts builds it from the subject and version. */
export function creditRowId(note: CreditNoteRecord, invoice: InvoiceRecord): string {
  const { subject, version } = rowParts(note, invoice);
  return `${subject}:${version}`;
}

/** One credit note as the screens show it. */
export function creditNoteView(state: State, venture: VentureRecord, note: CreditNoteRecord): CreditNoteView {
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === note.invoiceId);
  const amount = formatMinor(note.amountMinor, note.currency);
  const line = note.status === 'waiting' ? 'Waiting on Today for you to issue it.'
    : note.status === 'cancelled' ? 'Cancelled. Nothing changed.'
      : `Issued on ${formatVentureDate(localDayAt(note.issuedAt as string, venture.country), venture.country.dateOrder)}. Takes ${amount} off ${invoice?.number ?? 'its invoice'}.`;
  return {
    id: note.id, invoiceId: note.invoiceId, amount, reason: note.reason, state: note.status, number: note.number,
    rowId: note.status === 'waiting' && invoice ? creditRowId(note, invoice) : null, line,
    // 4J20: the receipt that names this note's amount (creditNoteReceipt).
    receiptId: note.status === 'cancelled' || !invoice || invoice.number === null ? null : `${CREDIT_NOTE}${note.id}`,
  };
}

/** Every credit note on one invoice, oldest first, as views. */
export function creditViewsOn(state: State, venture: VentureRecord, invoiceId: string): CreditNoteView[] {
  return listRecords(state, 'venture-credit-note', venture.id).filter(note => note.invoiceId === invoiceId).map(note => creditNoteView(state, venture, note));
}

/**
 * venture.credit.issue { invoiceId, amountMinor, reason, digest } (approve, app only): asks for a credit note on an issued
 * invoice the owner checked. It waits on Today; nothing changes until the owner issues it there.
 */
export async function creditIssue(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ creditNote: CreditNoteView }> {
  requireAppChannel(ctx, 'venture.credit.issue');
  // 4J20: the amount as typed (amount, read in the invoice's currency) or in minor units (amountMinor), one of them.
  const body = exactPayload(payload, ['invoiceId', 'amount', 'amountMinor', 'reason', 'digest'], ['invoiceId', 'reason', 'digest']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  check((body.amount === undefined) !== (body.amountMinor === undefined), 'INVALID_AMOUNT', 'Give the credit once, as you would type it, like 1500 or 1500.50.');
  if (body.amountMinor !== undefined) minorAmount(body.amountMinor, 'The credit');
  const reason = plainText(body.reason, 'The reason', { min: 3, max: 300 }).replace(/\s+/g, ' ');
  check(typeof body.digest === 'string' && DIGEST_TEXT.test(body.digest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the invoice you checked.');
  const checked = body.digest;
  return ventureAction(deps, ctx, 'approve', 'credit.ask', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const invoice = tx.find('venture-invoice', invoiceId);
    check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
    check(invoice.status !== 'draft' && invoice.number !== null, 'INVALID_VENTURE_REQUEST', 'This invoice is still a draft. Change the draft instead of crediting it.');
    check(invoice.status !== 'void', 'INVALID_VENTURE_REQUEST', 'This invoice was cancelled.');
    check(invoice.digest === checked, 'APPROVAL_STALE', 'This invoice changed after you checked it. Look at it again.');
    const amount = typedOrMinor(body.amount, body.amountMinor, invoice.currency, 'The credit');
    const free = freeBalance(invoice, tx.list('venture-payment'), tx.list('venture-credit-note'));
    check(amount <= free, 'CREDIT_TOO_LARGE', tooLarge(free, invoice));
    const note: CreditNoteRecord = {
      ...tx.base('venture-credit-note'), invoiceId, amountMinor: String(amount), currency: invoice.currency, reason,
      number: null, status: 'waiting', digest: '', issuedAt: null,
    };
    note.digest = creditDigest(note);
    const stored = tx.put(note);
    tx.emit('queue.changed', { creditNoteId: stored.id });
    return { creditNote: creditNoteView(tx.state, venture, stored) };
  });
}

/**
 * The receipt behind a waiting credit note's card, worked out again from the records on every read: the invoice's total,
 * less each payment and issued credit note (its balance now, as statementPlan adds it up), less this note (after).
 * Stale once the note is no longer waiting. Nothing here is stored.
 */
export function creditBalanceReceipt(state: State, venture: VentureRecord, id: string): SumReceiptRecord {
  const note = listRecords(state, 'venture-credit-note', venture.id).find(item => item.id === id.slice(CREDIT_BALANCE.length));
  check(note, 'RECEIPT_NOT_FOUND', 'This receipt was not found.');
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === note.invoiceId);
  check(invoice && invoice.number !== null, 'RECEIPT_NOT_FOUND', 'The invoice behind this receipt was not found.');
  const plan = statementPlan(state, venture, { type: 'statement', clientId: invoice.clientId, part: 'balance', invoiceId: invoice.id });
  const currency = plan.currency;
  const amount = BigInt(note.amountMinor);
  const now = planTotal(plan), after = now - amount;
  const show = (minor: bigint) => formatMinor(minor, currency);
  const addends: Addend[] = [...plan.addends, { recordId: note.id, label: 'Less this credit note, waiting for you to issue it', amount: String(-amount), display: show(-amount), estimate: false }];
  const figures = [
    { key: 'balance' as const, label: `Left to pay on ${invoice.number} now`, minor: String(now), display: show(now), currency },
    { key: 'total' as const, label: 'Left to pay after this credit note', minor: String(after), display: show(after), currency },
  ];
  return {
    id, kind: 'venture-sum-receipt', ventureId: venture.id, memberId: note.memberId, epoch: note.epoch, at: note.at,
    subject: plan.subject, operation: 'venture.sum', currency, unit: 'minor',
    addends: addends.map(({ recordId: addendId, label, amount: minor, display }) => ({ recordId: addendId, label, amount: minor, display })),
    steps: [{ op: 'add', inputs: addends.map(addend => addend.amount), resultMinor: String(after), rule: 'added in whole minor units' }],
    figures, totalMinor: String(after), estimate: false,
    allowedNumbers: [...new Set([show(now), show(after), ...addends.map(addend => addend.display)])],
    explanation: `Left to pay on ${invoice.number} now: ${show(now)}, its total less what was paid and credited. Less this credit note of ${show(amount)}: ${show(after)} left after it.`,
    digest: digest({ id, now: String(now), amount: note.amountMinor }), stale: note.status !== 'waiting',
  };
}

/**
 * 4J20: the receipt behind a credit note's own amount (`credit-note:<id>`, on its view): while it waits, its card's
 * receipt (the balance now, less this note); once issued, the invoice's balance now, whose addends name this note among
 * what was credited. Nothing here is stored.
 */
export function creditNoteReceipt(state: State, venture: VentureRecord, id: string): SumReceiptRecord {
  const noteId = id.slice(CREDIT_NOTE.length);
  const note = listRecords(state, 'venture-credit-note', venture.id).find(item => item.id === noteId);
  check(note, 'RECEIPT_NOT_FOUND', 'This receipt was not found.');
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === note.invoiceId);
  check(invoice && invoice.number !== null, 'RECEIPT_NOT_FOUND', 'The invoice behind this receipt was not found.');
  if (note.status !== 'issued') return { ...creditBalanceReceipt(state, venture, `${CREDIT_BALANCE}${note.id}`), id };
  const plan = statementPlan(state, venture, { type: 'statement', clientId: invoice.clientId, part: 'balance', invoiceId: invoice.id });
  return issuedNoteReceipt(id, note, invoice.number, plan, venture);
}

/** 4J20: an issued note's receipt: the invoice's balance now, its addends naming this note among the credits. */
function issuedNoteReceipt(id: string, note: CreditNoteRecord, number: string, plan: ReturnType<typeof statementPlan>, venture: VentureRecord): SumReceiptRecord {
  const currency = plan.currency;
  const now = planTotal(plan);
  const show = (minor: bigint) => formatMinor(minor, currency);
  return {
    id, kind: 'venture-sum-receipt', ventureId: venture.id, memberId: note.memberId, epoch: note.epoch, at: note.issuedAt ?? note.at,
    subject: plan.subject, operation: 'venture.sum', currency, unit: 'minor',
    addends: plan.addends.map(({ recordId: addendId, label, amount: minor, display }) => ({ recordId: addendId, label, amount: minor, display })),
    steps: [{ op: 'add', inputs: plan.addends.map(addend => addend.amount), resultMinor: String(now), rule: 'added in whole minor units' }],
    figures: [{ key: 'total' as const, label: `Left to pay on ${number} now`, minor: String(now), display: show(now), currency }], totalMinor: String(now), estimate: false,
    allowedNumbers: [...new Set([show(now), show(BigInt(note.amountMinor)), ...plan.addends.map(addend => addend.display)])],
    explanation: `Left to pay on ${number} now: ${show(now)}, its total less what was paid and credited, this credit note ${note.number ?? ''} of ${show(BigInt(note.amountMinor))} among the credits.`.replace('  ', ' '),
    digest: digest({ id, now: String(now), amount: note.amountMinor, issued: true }), stale: false,
  };
}

/** The credit note cards: one per waiting note, with Cancel and Issue (a second ask). */
function creditRows(state: State, venture: VentureRecord): W4RowItem[] {
  const invoices = new Map(listRecords(state, 'venture-invoice', venture.id).map(invoice => [invoice.id, invoice]));
  const clients = listRecords(state, 'venture-client', venture.id);
  const rows: W4RowItem[] = [];
  for (const note of listRecords(state, 'venture-credit-note', venture.id)) {
    const invoice = invoices.get(note.invoiceId);
    if (note.status !== 'waiting' || !invoice || invoice.number === null) continue;
    const name = clientName(clients, invoice);
    const balance = BigInt(invoice.balanceMinor);
    rows.push({
      kind: 'invoice', ...rowParts(note, invoice), createdAt: note.at,
      title: `Credit note for ${name} on ${invoice.number}`,
      line: `Takes ${formatMinor(note.amountMinor, note.currency)} off what ${name} owes. Reason: ${note.reason}`,
      change: {
        label: `Left to pay on ${invoice.number}`, before: formatMinor(balance, invoice.currency), after: formatMinor(balance - BigInt(note.amountMinor), invoice.currency),
        receiptId: `${CREDIT_BALANCE}${note.id}`,
      },
      viewRef: { kind: 'file', id: invoice.id },
      actions: [{ id: 'deny', label: 'Cancel it', primary: false }, { id: 'issue', label: 'Issue credit note', primary: true, secondAsk: true }],
    });
  }
  return rows;
}

/** When a payment came in as money: when it was recorded, or, for a cheque, when it cleared. */
const cameIn = (payment: PaymentRecord) => payment.clearedAt ?? payment.at;

/** The "<client> paid <invoice>" rows: each payment that came in during the last week, until the owner marks it seen. */
function paidRows(state: State, venture: VentureRecord, now: string): W4RowItem[] {
  const invoices = new Map(listRecords(state, 'venture-invoice', venture.id).map(invoice => [invoice.id, invoice]));
  const clients = listRecords(state, 'venture-client', venture.id);
  const cleared = listRecords(state, 'venture-payment', venture.id).filter(payment => paymentState(payment) === 'cleared');
  const since = Date.parse(now) - PAID_ROW_MS;
  const rows: W4RowItem[] = [];
  for (const payment of cleared) {
    const invoice = invoices.get(payment.invoiceId);
    if (!invoice || invoice.number === null || Date.parse(cameIn(payment)) < since) continue;
    const day = formatVentureDate(payment.receivedOn, venture.country.dateOrder);
    const how = payment.chequeOn !== undefined ? `by cheque, cleared on ${day}` : `by ${METHOD_WORDS[payment.method]} on ${day}`;
    const latest = cleared.filter(item => item.invoiceId === invoice.id)
      .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || cameIn(a).localeCompare(cameIn(b))).at(-1);
    const settled = BigInt(invoice.balanceMinor) <= 0n;
    const credited = issuedCredits(invoice.id, listRecords(state, 'venture-credit-note', venture.id)).length > 0;
    const full = settled && !credited && latest?.id === payment.id;
    const tds = payment.tds ? ` With TDS the client deducted under ${payment.tds.section}.` : '';
    const said = full ? `Paid in full ${how}.` : settled && credited ? `Part paid ${how}. The invoice was settled with a credit note.` : `Part paid ${how}. The rest is still to pay.`;
    const line = `${said}${tds}`;
    rows.push({
      // The version leaves the words out: a row the owner marked seen never comes back because a credit note changed them.
      kind: 'notice', subject: `paid:${payment.id}`, version: digest({ payment: payment.id, receipt: payment.booksReceiptId }).slice(0, 16), createdAt: cameIn(payment),
      title: `${clientName(clients, invoice)} paid ${invoice.number}`, line,
      change: { label: 'Received', after: formatMinor(payment.amountMinor, payment.currency), ...(payment.booksReceiptId ? { receiptId: payment.booksReceiptId } : {}) },
      viewRef: { kind: 'file', id: invoice.id },
      actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'approve', label: 'Seen', primary: true }],
    });
  }
  return rows;
}

/**
 * Today's money rows (the 'money' source in views/queue.ts): credit notes waiting to be issued, and payments that came
 * in. Reads only. A business still in its interview has no country, so nothing to say yet.
 */
export function moneyRows(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  if (!venture.country) return [];
  return [...creditRows(state, venture), ...paidRows(state, venture, deps.clock().toISOString())];
}

/** The refund fact the books count: the note's share before tax, by the owner's day of issue. */
function refundFact(note: CreditNoteRecord, invoice: InvoiceRecord, client: ClientRecord | undefined, share: bigint, day: string, number: string): BooksFactInput {
  return {
    entityId: note.id, kind: 'refund', validFrom: day,
    fields: {
      amountMinor: String(share), taxMinor: String(BigInt(note.amountMinor) - share), currency: note.currency,
      customerId: invoice.clientId, ...(client ? { customerName: client.name } : {}), invoiceId: invoice.id, orderId: invoice.orderId,
      status: 'issued', description: `Credit note ${number} on ${invoice.number}`,
    },
  };
}

/**
 * A note's share before tax: in the same proportion as its invoice; the note that credits the invoice in full takes
 * what the earlier notes left, so the shares add up to the invoice's amount before tax exactly. Never below zero.
 */
function shareOf(note: CreditNoteRecord, invoice: InvoiceRecord, issued: readonly CreditNoteRecord[]): bigint {
  const credited = issued.reduce((total, item) => total + BigInt(item.amountMinor), 0n);
  if (credited + BigInt(note.amountMinor) !== BigInt(invoice.totalMinor)) return creditBeforeTax(note, invoice);
  const rest = beforeTax(invoice) - issued.reduce((total, item) => total + creditBeforeTax(item, invoice), 0n);
  return rest < 0n ? 0n : rest > BigInt(note.amountMinor) ? BigInt(note.amountMinor) : rest;
}

/**
 * Inside the issue's own commit, at the claim: issues one waiting note, refusing APPROVAL_STALE when the note or its
 * invoice's balance is no longer what the card showed (approved), so nothing changed since the click is ever issued.
 * The journal entry is settled in the same commit when a handle is given.
 */
export function issueCreditIn(tx: VentureTx, deps: VentureDeps, noteId: string, approved: string, handle?: ApplyHandle): W4Outcome {
  const venture = tx.venture;
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const note = tx.find('venture-credit-note', noteId);
  check(note, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
  check(note.status === 'waiting', 'ALREADY_DECIDED', 'This credit note was already decided.');
  check(creditDigest(note) === note.digest, 'APPROVAL_STALE', STALE);
  const invoice = tx.find('venture-invoice', note.invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'The invoice of this credit note was not found.');
  check(invoice.status !== 'void' && invoice.status !== 'draft', 'INVALID_VENTURE_REQUEST', 'This invoice can no longer be credited.');
  check(shownDigest(note, invoice) === approved, 'APPROVAL_STALE', STALE);
  const amount = BigInt(note.amountMinor);
  const credits = tx.list('venture-credit-note');
  const free = freeBalance(invoice, tx.list('venture-payment'), credits, note.id);
  check(amount <= free, 'CREDIT_TOO_LARGE', tooLarge(free, invoice));
  const number = `CN-${String(credits.filter(item => item.status === 'issued').length + 1).padStart(4, '0')}`;
  const client = tx.find('venture-client', invoice.clientId);
  const share = shareOf(note, invoice, issuedCredits(invoice.id, credits));
  insertBooksFact(tx, deps.store, refundFact(note, invoice, client, share, localDayAt(tx.now, venture.country), number));
  const left = BigInt(invoice.balanceMinor) - amount;
  // An invoice the credit note settles is paid: nothing is left to pay or to remind about.
  tx.replace<InvoiceRecord>({ ...invoice, balanceMinor: String(left), status: left === 0n ? 'paid' : invoice.status });
  tx.replace<CreditNoteRecord>({ ...note, status: 'issued', number, issuedAt: tx.now, decidedBy: tx.ctx.memberId, beforeTaxMinor: String(share) });
  tx.emit('queue.changed', { creditNoteId: note.id });
  const line = left === 0n
    ? `Issued credit note ${number}. ${invoice.number} is settled.`
    : `Issued credit note ${number}. ${client?.name ?? 'Your client'} now owes ${formatMinor(left, invoice.currency)} on ${invoice.number}.`;
  handle?.settleIn(tx, line);
  return { line };
}

/** Cancels one waiting note: nothing else changes. */
function cancelIn(tx: VentureTx, noteId: string): W4Outcome {
  const note = tx.find('venture-credit-note', noteId);
  check(note, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
  check(note.status === 'waiting', 'ALREADY_DECIDED', 'This credit note was already decided.');
  const invoice = tx.find('venture-invoice', note.invoiceId);
  tx.replace<CreditNoteRecord>({ ...note, status: 'cancelled', decidedBy: tx.ctx.memberId });
  tx.emit('queue.changed', { creditNoteId: note.id });
  return { line: `Cancelled. Nothing changed on ${invoice?.number ?? 'the invoice'}.` };
}

/**
 * Issue on a credit note's card: checked against the card the owner clicked (its id carries the version), then through
 * the action journal, where the floor gate sees the owner's approval of exactly this note and balance, and the claim
 * checks them once more inside the commit.
 */
async function issueFromRow(deps: VentureDeps, ctx: Context, noteId: string, rowId: string): Promise<W4Outcome> {
  const { state, venture } = readVenture(deps, ctx);
  const note = listRecords(state, 'venture-credit-note', venture.id).find(item => item.id === noteId);
  check(note, 'INVALID_VENTURE_REQUEST', NOT_FOUND);
  check(note.status === 'waiting', 'ALREADY_DECIDED', 'This credit note was already decided.');
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === note.invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'The invoice of this credit note was not found.');
  check(rowId === creditRowId(note, invoice), 'APPROVAL_STALE', STALE);
  const approved = shownDigest(note, invoice);
  const client = clientName(listRecords(state, 'venture-client', venture.id), invoice);
  const done = await journalled(deps, ctx, {
    action: 'credit.issue', subject: note.id, target: client, actionDigest: approved,
    line: `Issue a credit note of ${formatMinor(note.amountMinor, note.currency)} on ${invoice.number} for ${client}.`,
  }, async handle => {
    // The always-ask floor: issuing for real goes ahead only on the owner's approval sealed on this entry.
    gateEffect({ name: 'credit.issue', digest: approved, touches: ['issue'] }, sealApproval(handle.entry, digestOf(handle.entry)));
    const value = await ventureAction(deps, ctx, 'approve', 'credit.issue', tx => issueCreditIn(tx, deps, noteId, approved, handle));
    return { outcome: 'applied', line: value.line, value };
  });
  return done.value as W4Outcome;
}

/**
 * A decision on a money row (views/queue-w4.ts), after queue.ts checked the row's digest, the action and the app: Issue
 * or Cancel on a credit note; Seen on a payment that came in.
 */
export async function decideMoneyRow(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  if (decision.subject.startsWith('paid:') && decision.action === 'approve') return { line: 'Marked as seen.' };
  check(decision.subject.startsWith('credit:'), 'INVALID_VENTURE_REQUEST', 'This row is not a money row.');
  const noteId = decision.subject.slice('credit:'.length);
  if (decision.action === 'issue') return issueFromRow(deps, ctx, noteId, decision.row.id);
  if (decision.action === 'deny') return ventureAction(deps, ctx, 'approve', 'credit.cancel', tx => cancelIn(tx, noteId));
  throw new ChausarError('INVALID_VENTURE_REQUEST', 'This row does not offer that.');
}
