// Wave 6 money (6D3): Razorpay Payment Links on the owner's own Razorpay account. venture.invoice.payLink (app only):
//   create: the owner approves the exact link (invoice, number, balance, currency: how-to-pay.ts payLinkDigest); it goes
//           through the action journal as a write to a connected service (operation create-link) and the policy gate,
//           then Chausar asks Razorpay to make it (POST /v1/payment_links) and keeps its id and short URL on the invoice.
//           Razorpay is told not to message the client: the owner shares the link themselves.
//   check:  asks Razorpay for the link's status (GET /v1/payment_links/{id}) while the app is open (the screen asks
//           every so often; no webhooks). Each captured payment Chausar has not recorded yet is recorded once, for its
//           exact amount, with its books fact and received receipt, like a payment the owner types.
// Keys come from the computer's protected storage (billing.ts razorpayKeys) and are never written to a record or a log.
// Built and tested against responses recorded from Razorpay's public API docs; not yet run on a real account, so every
// screen labels it fixture-tested.
import { check, ChausarError, type Context, internalCheck } from '../../contracts.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { digestOf, journalled, type ApplyResult } from '../journal/journal.ts';
import { gateEffect, sealApproval } from '../policy/holds.ts';
import { razorpayKeys } from './billing.ts';
import { payLinkDigest, payLinkOpen } from './how-to-pay.ts';
import { invoiceView } from './invoices.ts';
import { recordPaymentMinor, sealBooks } from './payments.ts';
import { recordId } from './shared.ts';
import type { PayLinkState, PaymentHttp } from './billing-types.ts';
import type { InvoiceRecord, InvoiceView, VentureDeps } from '../contracts.ts';

const API = 'https://api.razorpay.com/v1/payment_links';
const DIGEST_TEXT = /^[A-Za-z0-9]{1,200}$/;
const LINK_ID = /^plink_[A-Za-z0-9]{6,40}$/;
const PAY_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const STATUSES: readonly PayLinkState['status'][] = ['created', 'partially_paid', 'expired', 'cancelled', 'paid'];
const TIMEOUT_MS = 20_000;

/** The real HTTPS call, with a time limit. Only api.razorpay.com is ever asked. */
const fetchHttp: PaymentHttp = async request => {
  check(request.url.startsWith(`${API}`), 'RAZORPAY_FAILED', 'Chausar only asks Razorpay at its own address.');
  const answer = await fetch(request.url, { method: request.method, headers: request.headers, ...(request.body ? { body: request.body } : {}), signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  return { status: answer.status, body: await answer.text() };
};

function authHeader(keys: { keyId: string; keySecret: string }): string {
  return `Basic ${Buffer.from(`${keys.keyId}:${keys.keySecret}`, 'utf8').toString('base64')}`;
}

/** Razorpay's own error words, kept short and on one line; never the keys. */
function errorWords(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { description?: unknown } };
    const words = typeof parsed.error?.description === 'string' ? parsed.error.description.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    return words ? ` Razorpay said: ${words}` : '';
  } catch { return ''; }
}

type LinkAnswer = { id: string; shortUrl: string; status: PayLinkState['status']; amount: string; currency: string; payments: { id: string; amount: string; status: string; createdAt: number; method: string }[] };

/** A payment link as Razorpay answers it, checked field by field. Anything unexpected is refused, never guessed. */
export function linkAnswer(body: string): LinkAnswer {
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { throw new ChausarError('RAZORPAY_FAILED', 'Razorpay answered something Chausar could not read.'); }
  const { id, short_url: shortUrl, status, amount, currency } = parsed;
  check(typeof id === 'string' && LINK_ID.test(id), 'RAZORPAY_FAILED', 'Razorpay answered without a payment link id.');
  check(typeof shortUrl === 'string' && /^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9/_-]{1,80}$/.test(shortUrl), 'RAZORPAY_FAILED', 'Razorpay answered without a link address.');
  check(typeof status === 'string' && (STATUSES as readonly string[]).includes(status), 'RAZORPAY_FAILED', 'Razorpay answered a link status Chausar does not know.');
  check(Number.isSafeInteger(amount) && (amount as number) > 0, 'RAZORPAY_FAILED', 'Razorpay answered without an amount.');
  check(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency), 'RAZORPAY_FAILED', 'Razorpay answered without a currency.');
  const payments = Array.isArray(parsed.payments) ? parsed.payments : [];
  return {
    id, shortUrl, status: status as PayLinkState['status'], amount: String(amount), currency,
    payments: payments.map(item => {
      const row = item as Record<string, unknown>;
      check(typeof row.payment_id === 'string' && PAY_ID.test(row.payment_id), 'RAZORPAY_FAILED', 'Razorpay answered a payment without its id.');
      check(Number.isSafeInteger(row.amount) && (row.amount as number) > 0, 'RAZORPAY_FAILED', 'Razorpay answered a payment without its amount.');
      check(Number.isSafeInteger(row.created_at), 'RAZORPAY_FAILED', 'Razorpay answered a payment without its time.');
      return { id: row.payment_id, amount: String(row.amount), status: typeof row.status === 'string' ? row.status : '', createdAt: row.created_at as number, method: typeof row.method === 'string' ? row.method : '' };
    }),
  };
}

/** What Razorpay is asked to make: the exact balance, the invoice number as reference, and no message to the client. */
export function createBody(invoice: InvoiceRecord, clientName: string, sellerName: string, expireBy: number): string {
  check(BigInt(invoice.balanceMinor) <= BigInt(Number.MAX_SAFE_INTEGER), 'RAZORPAY_FAILED', 'This amount is too large for a payment link.');
  return JSON.stringify({
    amount: Number.parseInt(invoice.balanceMinor, 10), currency: invoice.currency, accept_partial: false,
    reference_id: `${invoice.number}-${invoice.id.slice(-8)}`.slice(0, 40),
    description: `Invoice ${invoice.number} from ${sellerName}`.slice(0, 2048),
    customer: { name: clientName.slice(0, 100) }, notify: { sms: false, email: false }, reminder_enable: false, expire_by: expireBy,
    notes: { invoice: invoice.number },
  });
}

function findInvoice(deps: VentureDeps, ctx: Context, invoiceId: string) {
  const { state, venture } = readVenture(deps, ctx);
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  return { state, venture, invoice };
}

/** venture.invoice.payLink { invoiceId, action: 'create', digest } | { invoiceId, action: 'check' } (approve, app only). */
export async function invoicePayLink(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  requireAppChannel(ctx, 'venture.invoice.payLink');
  const body = exactPayload(payload, ['invoiceId', 'action', 'digest'], ['invoiceId', 'action']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  check(body.action === 'create' || body.action === 'check', 'INVALID_VENTURE_REQUEST', 'Say create or check.');
  internalCheck(body.action === 'create' ? typeof body.digest === 'string' && DIGEST_TEXT.test(body.digest) : body.digest === undefined, 'INVALID_VENTURE_REQUEST', 'Send the digest of the link you checked, only to create one.');
  const keys = await razorpayKeys(deps, deps.store.read().workspace.id);
  check(keys, 'RAZORPAY_NOT_CONNECTED', 'Add your Razorpay keys in How clients pay first.');
  const http = deps.paymentHttp ?? fetchHttp;
  return body.action === 'create' ? create(deps, ctx, invoiceId, body.digest as string, keys, http) : poll(deps, ctx, invoiceId, keys, http);
}

async function create(deps: VentureDeps, ctx: Context, invoiceId: string, approved: string, keys: { keyId: string; keySecret: string }, http: PaymentHttp): Promise<InvoiceView> {
  const { state, venture, invoice } = findInvoice(deps, ctx, invoiceId);
  check(payLinkOpen(invoice), 'INVALID_VENTURE_REQUEST', 'This invoice has a payment link already, or nothing left to pay.');
  check(payLinkDigest(invoice) === approved, 'APPROVAL_STALE', 'This invoice changed after you checked the link. Look at it again.');
  const clientName = listRecords(state, 'venture-client', venture.id).find(item => item.id === invoice.clientId)?.name ?? 'your client';
  const plan = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === venture.acceptedBlueprintId);
  const sellerName = plan?.name.value ?? venture.workingName;
  // A link lasts 30 days unless paid; Razorpay allows up to six months.
  const expireBy = Math.floor(deps.clock().getTime() / 1000) + 30 * 86_400;
  const request = createBody(invoice, clientName, sellerName, expireBy);
  const line = `Make a Razorpay payment link for invoice ${invoice.number} to ${clientName}.`;
  const done = await journalled<PayLinkState | null>(deps, ctx, {
    action: 'connector.write', operation: 'create-link', subject: `razorpay-link:${invoice.id}:${approved.slice(0, 16)}`, target: 'Razorpay payment links',
    actionDigest: approved, line, descriptionComplete: true,
  }, async (handle): Promise<ApplyResult<PayLinkState | null>> => {
    // The policy gate before the effect: only the owner's approval sealed on this entry, bound to this digest, passes.
    gateEffect({ name: 'payment.link.create', digest: approved, touches: ['send'] }, sealApproval(handle.entry, digestOf(handle.entry)));
    let answer: { status: number; body: string };
    try {
      answer = await http({ method: 'POST', url: `${API}/`, headers: { authorization: authHeader(keys), 'content-type': 'application/json' }, body: request });
    } catch {
      return { outcome: 'unknown', line: 'Razorpay did not answer. Look in your Razorpay dashboard before you try again.', value: null };
    }
    if (answer.status >= 400 && answer.status <= 499) return { outcome: 'not-sent', line: `Razorpay refused the link (${answer.status}).${errorWords(answer.body)}`, value: null, by: 'platform' };
    if (answer.status < 200 || answer.status > 299) return { outcome: 'unknown', line: `Razorpay answered ${answer.status}. Look in your Razorpay dashboard before you try again.`, value: null };
    const link = linkAnswer(answer.body);
    check(link.amount === invoice.balanceMinor && link.currency === invoice.currency, 'RAZORPAY_FAILED', 'Razorpay made a link for a different amount. Cancel it in your Razorpay dashboard.');
    const made: PayLinkState = { id: link.id, shortUrl: link.shortUrl, amountMinor: link.amount, currency: link.currency, status: link.status, createdAt: deps.clock().toISOString(), checkedAt: null, recordedPaymentIds: [], journalId: handle.entry.id };
    await ventureAction(deps, ctx, 'approve', 'invoice.payLink', tx => {
      const current = tx.find('venture-invoice', invoiceId);
      check(current, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
      tx.replace<InvoiceRecord>({ ...current, payLink: made });
      handle.settleIn(tx, `Made a Razorpay payment link for ${invoice.number}.`, invoice.priceReceiptId);
    });
    return { outcome: 'applied', line: `Made a Razorpay payment link for ${invoice.number}.`, value: made, receiptId: invoice.priceReceiptId, url: link.shortUrl, by: 'platform' };
  });
  if (done.entry.state === 'rejected') throw new ChausarError('RAZORPAY_FAILED', done.entry.journal.at(-1)?.line ?? 'Razorpay refused the link.');
  const after = findInvoice(deps, ctx, invoiceId);
  return invoiceView(after.state, after.venture, after.invoice, deps);
}

async function poll(deps: VentureDeps, ctx: Context, invoiceId: string, keys: { keyId: string; keySecret: string }, http: PaymentHttp): Promise<InvoiceView> {
  const { invoice } = findInvoice(deps, ctx, invoiceId);
  const link = invoice.payLink;
  check(link, 'INVALID_VENTURE_REQUEST', 'This invoice has no payment link to check.');
  let answer: { status: number; body: string };
  try {
    answer = await http({ method: 'GET', url: `${API}/${link.id}`, headers: { authorization: authHeader(keys) } });
  } catch {
    throw new ChausarError('RAZORPAY_FAILED', 'Razorpay did not answer. Chausar will ask again while the app is open.');
  }
  check(answer.status >= 200 && answer.status <= 299, 'RAZORPAY_FAILED', `Razorpay answered ${answer.status}.${errorWords(answer.body)}`);
  const status = linkAnswer(answer.body);
  check(status.id === link.id && status.currency === link.currency, 'RAZORPAY_FAILED', 'Razorpay answered about a different link.');
  const recorded = await ventureAction(deps, ctx, 'prepare', 'invoice.payLink.check', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const current = tx.find('venture-invoice', invoiceId);
    check(current && current.payLink?.id === link.id, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
    const seen = new Set(current.payLink.recordedPaymentIds);
    const counted: { paymentId: string; orderId: string; amountMinor: string; date: string }[] = [];
    for (const payment of status.payments) {
      if (payment.status !== 'captured' || seen.has(payment.id)) continue;
      const receivedOn = localDayAt(new Date(payment.createdAt * 1000).toISOString(), venture.country);
      const made = recordPaymentMinor(tx, deps, { invoiceId, amount: { minor: payment.amount }, receivedOn, method: 'payment-link' });
      seen.add(payment.id);
      counted.push({ ...made, date: receivedOn });
    }
    const latest = tx.find('venture-invoice', invoiceId)!;
    tx.replace<InvoiceRecord>({ ...latest, payLink: { ...current.payLink, status: status.status, checkedAt: tx.now, recordedPaymentIds: [...seen] } });
    return counted;
  });
  await sealBooks(deps, ctx, recorded);
  const after = findInvoice(deps, ctx, invoiceId);
  return invoiceView(after.state, after.venture, after.invoice, deps);
}
