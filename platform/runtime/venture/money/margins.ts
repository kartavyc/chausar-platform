// Chausar venture launcher, money (Ink v2 wave 4, package 4J4, M8): each client's invoiced amount against the AI and
// tool spend of their orders (venture.money.margins). Invoiced is the month's issued invoices before tax, less credit
// notes issued that month, on the owner's calendar (the goal's figure, goal-plans.ts). Spend is the month's paid calls
// (UTC month, as the spend limit counts it) tagged by code from the records, never by guess: a call to its run (the run
// it was charged to, or the run whose model call, judge or turn it paid for), the run to its order, the order to its
// client. The margin is in one currency only: the spend in rupees at the owner's own rate, labelled with it, or "Not
// counted: no rupee rate set". Calls no order can claim are left out and the total says how many. Money in BigInt.
import type { Context, State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { exactPayload, listRecords, readVenture } from '../records.ts';
import type { MarginRowView, MarginsView, SpendRecord, SumReceiptSubject, VentureDeps, VentureRecord } from '../contracts.ts';
import { beforeTax, creditBeforeTax, creditNotesOf, invoicesOf, monthText, monthWords } from './goal-plans.ts';
import { rupeeRateWords, rupeesOf, spendOfMonth } from './spend.ts';
import { calendarMonth } from './dates.ts';
import { callAddend, rateBasis } from './flow.ts';
import { sumReceipt, type Addend, type SumPlan } from './sums.ts';
import { basisOf, calculatedFigure, invoicesElsewhere, moneyCountry, notCountedOf, otherCurrency } from './figure-kinds.ts';

/** Each run's order, found by the run's id and by every model call it holds (its draft, its judge, its turns). */
function runOrders(state: State, ventureId: string): Map<string, string> {
  const orders = new Map<string, string>();
  for (const run of listRecords(state, 'venture-delivery-run', ventureId)) {
    orders.set(run.id, run.orderId);
    if (run.callId) orders.set(run.callId, run.orderId);
    if (run.judge?.callId) orders.set(run.judge.callId, run.orderId);
    for (const turn of run.harness?.turns ?? []) if (turn.callId) orders.set(turn.callId, run.orderId);
  }
  return orders;
}

/** The order a paid call worked for: by the record it names, else by its model call; null when no order claims it. */
function orderOfCall(spend: SpendRecord, orders: Map<string, string>): string | null {
  if (spend.ref && orders.has(spend.ref)) return orders.get(spend.ref)!;
  const callId = spend.key.startsWith('model:') ? spend.key.slice('model:'.length) : null;
  return callId && orders.has(callId) ? orders.get(callId)! : null;
}

/** The month's paid calls by client, and how many no order claims. */
function callsByClient(state: State, venture: VentureRecord, month: string): { byClient: Map<string, { record: SpendRecord; micros: bigint; estimate: boolean }[]>; untagged: number; all: number } {
  const orders = runOrders(state, venture.id);
  const clientOf = new Map(listRecords(state, 'venture-order', venture.id).map(order => [order.id, order.clientId]));
  const byClient = new Map<string, { record: SpendRecord; micros: bigint; estimate: boolean }[]>();
  const items = spendOfMonth(listRecords(state, 'venture-spend', venture.id), month);
  let untagged = 0;
  for (const item of items) {
    const orderId = orderOfCall(item.record, orders);
    const clientId = orderId ? clientOf.get(orderId) ?? null : null;
    if (!clientId) { untagged += 1; continue; }
    byClient.set(clientId, [...(byClient.get(clientId) ?? []), item]);
  }
  return { byClient, untagged, all: items.length };
}

/** One client's invoices before tax in the month (positive) and the credit notes on them (negative). */
function invoicedAddends(state: State, venture: VentureRecord, month: string, clientId: string): Addend[] {
  const currency = venture.country.currency;
  const invoices = listRecords(state, 'venture-invoice', venture.id);
  const issued = invoicesOf(state, venture, month, 'issued').filter(invoice => invoice.clientId === clientId).map(invoice => ({
    recordId: invoice.id, label: `${invoice.number}, before tax`, amount: String(beforeTax(invoice)), display: formatMinor(beforeTax(invoice), currency), estimate: false,
  }));
  const credits = creditNotesOf(state, venture, month).flatMap(note => {
    const invoice = invoices.find(item => item.id === note.invoiceId);
    if (!invoice || invoice.clientId !== clientId) return [];
    const minor = creditBeforeTax(note, invoice);
    return [{ recordId: note.id, label: `Credit note${note.number ? ` ${note.number}` : ''} on ${invoice.number ?? 'an invoice'}, before tax`, amount: String(-minor), display: formatMinor(-minor, currency), estimate: false }];
  });
  return [...issued, ...credits];
}

/** One client's paid calls in rupees at the owner's rate, by flow's one rule (each call half up, the rate frozen in); null without a rate. */
function spendAddends(state: State, venture: VentureRecord, month: string, clientId: string): Addend[] | null {
  const rupees = rupeesOf(state, venture);
  if (!rupees || venture.country.currency !== 'INR') return null;
  return (callsByClient(state, venture, month).byClient.get(clientId) ?? []).map(item => callAddend(item, rupees));
}

/** The `margin` receipt's addends: one client's invoices before tax, the spend of their orders, or both (spend negative). */
export function marginPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'margin' }>): SumPlan {
  const country = moneyCountry(venture);
  const invoiced = invoicedAddends(state, venture, subject.month, subject.clientId);
  const spend = spendAddends(state, venture, subject.month, subject.clientId) ?? [];
  const negate = (addend: Addend): Addend => ({ ...addend, amount: String(-BigInt(addend.amount)), display: formatMinor(-BigInt(addend.amount), country.currency) });
  const addends = subject.part === 'invoiced' ? invoiced : subject.part === 'spend' ? spend : [...invoiced, ...spend.map(negate)];
  const words = {
    invoiced: { label: `Invoiced before tax, ${monthWords(subject.month)}`, one: 'invoice', many: 'invoices and credit notes', none: 'Nothing was invoiced this month.' },
    spend: { label: `AI and tools for this client, ${monthWords(subject.month)}`, one: 'paid call', many: 'paid calls', none: 'No paid calls for this client this month.' },
    margin: { label: `Margin, ${monthWords(subject.month)}`, one: 'amount', many: 'amounts', none: 'Nothing was invoiced or spent this month.' },
  }[subject.part];
  return {
    subject: { type: 'margin', month: subject.month, clientId: subject.clientId, part: subject.part }, currency: country.currency, unit: 'minor', addends, words,
    estimateWords: 'Calls not settled yet count at their estimate.',
  };
}

/**
 * venture.money.margins { month } (read): for each client with invoices or tagged spend that month, invoiced before
 * tax, the AI and tool spend of their orders, and the margin, each with its receipt; one currency only.
 */
export async function moneyMargins(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MarginsView> {
  const body = exactPayload(payload, ['month'], ['month']);
  const month = monthText(body.month);
  const { state, venture } = readVenture(deps, ctx);
  moneyCountry(venture);
  const rupees = rupeesOf(state, venture);
  const counted = rupees !== null && venture.country.currency === 'INR';
  const rate = rupees ? rupeeRateWords(rupees) : null;
  const { byClient, untagged, all } = callsByClient(state, venture, month);
  const invoicedIds = new Set(invoicesOf(state, venture, month, 'issued').map(invoice => invoice.clientId));
  const clients = listRecords(state, 'venture-client', venture.id).filter(client => invoicedIds.has(client.id) || byClient.has(client.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const plan = (clientId: string, part: 'invoiced' | 'spend' | 'margin') => marginPlan(state, venture, { type: 'margin', month, clientId, part });
  const uses = counted && rate ? [rate] : [];
  const rows: MarginRowView[] = [];
  for (const client of clients) {
    const invoiced = calculatedFigure(await sumReceipt(deps, ctx, venture.id, plan(client.id, 'invoiced')));
    if (!counted) { rows.push({ clientId: client.id, client: client.name, invoiced, spend: null, margin: null, note: `Not counted: ${venture.country.currency === 'INR' ? 'no rupee rate set' : `no rate from US dollars to ${venture.country.currency}`}` }); continue; }
    const spend = calculatedFigure(await sumReceipt(deps, ctx, venture.id, plan(client.id, 'spend')), { uses });
    const margin = calculatedFigure(await sumReceipt(deps, ctx, venture.id, plan(client.id, 'margin')), { uses });
    rows.push({ clientId: client.id, client: client.name, invoiced, spend, margin, note: null });
  }
  const shown = monthWords(month);
  const why = venture.country.currency === 'INR' ? 'no rupee rate set' : `no rate from US dollars to ${venture.country.currency}`;
  const basis = basisOf(
    [`Invoices issued in ${shown}, before tax, less credit notes`, 'AI and tool spend by UTC month, tagged to a client through its run and order', ...rateBasis(counted ? rate : null)],
    notCountedOf([
      otherCurrency(invoicesElsewhere(state, venture, calendarMonth(month).from, calendarMonth(month).to), 'invoice', 'invoices', venture.country.currency),
      counted ? { count: untagged, one: 'paid call no order can claim', many: 'paid calls no order can claim' } : { count: all, one: `paid call with ${why}`, many: `paid calls with ${why}` },
    ]),
  );
  const line = counted ? `${shown}: invoiced before tax, less the AI and tool spend of each client's orders at ${rate}.`
    : `${shown}: invoiced before tax. The AI and tool spend is not counted: ${why}.`;
  return { month, rows, line, basis };
}
