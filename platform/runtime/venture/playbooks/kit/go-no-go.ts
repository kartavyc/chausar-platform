// Chausar playbook kit: the GO, HOLD or NO-GO card for a new offer or product (Ink v2 wave 5, package 5A2; catalogue
// M18). Code decides over the owner's typed inputs, never a model: the owner types rupees as they write them, read as
// core/words.ts ownerPrice reads a price; the most the owner could lose is what it costs to start plus what it costs
// each month for the months they will try it, added and multiplied in BigInt paise (the calculator's sumMoney); HOLD lists every input the owner did not know; NO-GO when that loss is above the owner's own
// limit; GO otherwise, and every GO card says "GO spends nothing: each spend still asks you." Each card is stored
// (venture-go-no-go) and listed on Business; its loss opens a receipt (venture.receipt.get with the card's id) worked
// out again from the stored card. Learned from sealeap-ecommerce-skills' assets/decision-template.md, ideas only.
import { check, type Context, type State } from '../../../contracts.ts';
import { numberGuard, sumMoney } from '../../../calculator.ts';
import { formatMinor } from '../../../currency.ts';
import { digest, exactPayload, listRecords, readVenture, singleLine, ventureAction } from '../../records.ts';
import type { GoNoGoRecord, MinorString, PriceStep, RowFigure, RowFigureReceipt, VentureDeps, VentureRecord } from '../../contracts.ts';
import { ownerPrice } from '../../core/words.ts';
import type { GoNoGoBody, GoNoGoCardView, GoNoGoInputName, GoNoGoListView, GoNoGoVerdict } from './records-sales.ts';

/** The inputs a card reads, in its order, with their plain labels and the words HOLD asks for them with. */
export const GO_NO_GO_INPUTS: readonly { name: GoNoGoInputName; label: string; ask: string; kind: 'money' | 'months' }[] = Object.freeze([
  { name: 'upfront', label: 'What it costs to start', ask: 'what it costs to start', kind: 'money' },
  { name: 'monthly', label: 'What it costs each month', ask: 'what it costs each month', kind: 'money' },
  { name: 'months', label: 'How many months you will try it', ask: 'how many months you will try it', kind: 'months' },
  { name: 'limit', label: 'The most you are willing to lose', ask: 'the most you are willing to lose', kind: 'money' },
]);
/** The line every GO card carries. */
export const GO_SPENDS_NOTHING = 'GO spends nothing: each spend still asks you.';
const MAX_MONTHS = 36;
const PLAYBOOK_ID = /^[a-z][a-z0-9-]{0,40}$/;
const ZERO = /^[\s,0]*(?:\.0*)?$/;

/** "a", "a and b", "a, b and c". */
const joined = (items: readonly string[]) => (items.length <= 1 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * The typed inputs, checked and read: only the card's names; money as the owner typed it in rupees ("20,000",
 * "5000.50"), read by ownerPrice into paise, where zero is a cost of nothing; months a whole number from 1 to 36.
 */
function inputsOf(value: unknown, currency: string): Record<GoNoGoInputName, string | null> {
  check(typeof value === 'object' && value !== null && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send the inputs by name.');
  const known = new Set<string>(GO_NO_GO_INPUTS.map(input => input.name));
  for (const key of Object.keys(value)) check(known.has(key), 'INVALID_VENTURE_REQUEST', `The card does not read ${key}.`);
  const out = {} as Record<GoNoGoInputName, string | null>;
  for (const input of GO_NO_GO_INPUTS) {
    const raw = (value as Record<string, unknown>)[input.name];
    if (raw === undefined || raw === null) { out[input.name] = null; continue; }
    if (input.kind === 'months') {
      check(typeof raw === 'string' && /^[1-9]\d{0,1}$/.test(raw) && Number(raw) <= MAX_MONTHS, 'INVALID_VENTURE_REQUEST', `Months must be a whole number from 1 to ${MAX_MONTHS}.`);
      out[input.name] = raw as string;
    } else {
      out[input.name] = typeof raw === 'string' && ZERO.test(raw) && /0/.test(raw) ? '0' : ownerPrice(raw, currency, input.label).minor;
    }
  }
  return out;
}

/** The card's working, worked out from its inputs alone (so the receipt can work it out again from the stored card). */
function working(inputs: Readonly<Record<GoNoGoInputName, string | null>>, currency: string): Pick<GoNoGoBody, 'verdict' | 'unknown' | 'maxLossMinor' | 'limitMinor' | 'steps' | 'explanation' | 'allowedNumbers'> {
  const unknown = GO_NO_GO_INPUTS.filter(input => inputs[input.name] === null).map(input => input.name);
  const { upfront: upfrontMinor, monthly: monthlyMinor, months, limit: limitMinor } = inputs;
  let maxLossMinor: MinorString | null = null;
  let steps: PriceStep[] = [];
  let explanation: string | null = null;
  let allowedNumbers: string[] = [];
  if (upfrontMinor !== null && monthlyMinor !== null && months !== null) {
    const running = String(BigInt(monthlyMinor) * BigInt(months));
    maxLossMinor = sumMoney([upfrontMinor, running]);
    steps = [
      { op: 'multiply', inputs: [monthlyMinor, months], resultMinor: running, rule: 'what it costs each month times the months you will try it' },
      { op: 'add', inputs: [upfrontMinor, running], resultMinor: maxLossMinor, rule: 'plus what it costs to start: the most you could lose' },
    ];
    const show = (minor: string) => formatMinor(minor, currency);
    explanation = `${show(upfrontMinor)} to start, plus ${show(monthlyMinor)} a month for ${months} months (${show(running)}) = ${show(maxLossMinor)} at most.`
      + (limitMinor === null ? '' : ` Your limit is ${show(limitMinor)}.`);
    const plain = (minor: string) => show(minor).slice(currency.length + 1).replace(/,/g, '');
    const amounts = [upfrontMinor, monthlyMinor, running, maxLossMinor, ...(limitMinor === null ? [] : [limitMinor])];
    allowedNumbers = [...new Set([...amounts, ...amounts.map(plain), months])];
    numberGuard(explanation, { allowedNumbers });
  }
  const verdict: GoNoGoVerdict = unknown.length ? 'HOLD' : BigInt(maxLossMinor!) > BigInt(limitMinor!) ? 'NO-GO' : 'GO';
  return { verdict, unknown, maxLossMinor, limitMinor, steps, explanation, allowedNumbers };
}

/** A stored card as the screens read it, with its line in the engine's words. */
export function cardView(record: GoNoGoRecord): GoNoGoCardView {
  const show = (minor: string) => formatMinor(minor, record.currency);
  const label = (name: GoNoGoInputName) => GO_NO_GO_INPUTS.find(input => input.name === name)!;
  const line = record.verdict === 'HOLD'
    ? `HOLD: say ${joined(record.unknown.map(name => label(name).ask))}, then make the card again.`
    : record.verdict === 'NO-GO'
      ? `NO-GO: the most you could lose, ${show(record.maxLossMinor!)}, is above your limit of ${show(record.limitMinor!)}.`
      : `GO: the most you could lose is ${show(record.maxLossMinor!)}, within your limit of ${show(record.limitMinor!)}.`;
  return {
    id: record.id, at: record.at, playbook: record.playbook, subject: record.subject, verdict: record.verdict, line,
    unknown: record.unknown.map(name => ({ input: name, label: label(name).label })),
    maxLoss: record.maxLossMinor === null ? null : { minor: record.maxLossMinor, display: show(record.maxLossMinor), receiptId: record.id },
    limit: record.limitMinor === null ? null : { minor: record.limitMinor, display: show(record.limitMinor) },
    spendsNothing: record.verdict === 'GO' ? GO_SPENDS_NOTHING : null,
  };
}

/**
 * venture.goNoGo.card {playbook, subject, inputs} (prepare): decides GO, HOLD or NO-GO by code, stores the card and
 * answers it. playbook: the playbook the card is for, a short lowercase id ('general' for the business itself).
 */
export async function goNoGoCard(deps: VentureDeps, ctx: Context, payload: unknown): Promise<GoNoGoCardView> {
  const body = exactPayload(payload, ['playbook', 'subject', 'inputs'], ['playbook', 'subject', 'inputs']);
  check(typeof body.playbook === 'string' && PLAYBOOK_ID.test(body.playbook), 'INVALID_VENTURE_REQUEST', 'Name the playbook by its short id, or general.');
  const playbook = body.playbook;
  const subject = singleLine(body.subject, 'What you are deciding', { min: 2, max: 120 });
  return ventureAction(deps, ctx, 'prepare', 'goNoGo.card', tx => {
    const venture = tx.venture as VentureRecord;
    const currency = venture.country.currency;
    const inputs = inputsOf(body.inputs, currency);
    const decided = working(inputs, currency);
    const card: Omit<GoNoGoBody, 'digest'> = { playbook, subject, inputs, currency, ...decided };
    const record = tx.put<GoNoGoRecord>({ ...tx.base('venture-go-no-go'), ...card, digest: digest(card) });
    return cardView(record);
  });
}

/** venture.goNoGo.list {} (read): the business's cards, newest first. */
export async function goNoGoList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<GoNoGoListView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const cards = listRecords(state, 'venture-go-no-go', venture.id).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return { cards: cards.map(cardView) };
}

/**
 * The receipt a card's maximum loss opens (money/quote.ts getReceipt, for an id starting gonogo_): the figures worked
 * out again from the stored inputs, stale when they no longer give the stored loss and digest.
 */
export function goNoGoReceipt(state: State, venture: VentureRecord, id: string): RowFigureReceipt {
  const record = listRecords(state, 'venture-go-no-go', venture.id).find(item => item.id === id);
  check(record, 'RECEIPT_NOT_FOUND', 'This card was not found.');
  check(record.maxLossMinor !== null && record.explanation !== null, 'RECEIPT_NOT_FOUND', 'This card has no loss worked out yet: it is waiting for your inputs.');
  const again = working(record.inputs, record.currency);
  const { id: _id, kind: _kind, ventureId: _venture, memberId: _member, epoch: _epoch, at: _at, digest: stored, ...body } = record;
  const show = (minor: string) => formatMinor(minor, record.currency);
  const figure = (key: string, label: string, amount: string): RowFigure => ({ key, label, amount, unit: 'minor', currency: record.currency, display: show(amount) });
  const { upfront: upfrontMinor, monthly: monthlyMinor, limit: limitMinor } = record.inputs;
  const figures = [
    figure('upfront', 'What it costs to start', upfrontMinor!), figure('monthly', 'What it costs each month', monthlyMinor!),
    figure('running', `Each month for ${record.inputs.months} months`, record.steps[0].resultMinor), figure('max-loss', 'The most you could lose', record.maxLossMinor),
    ...(limitMinor === null ? [] : [figure('limit', 'Your limit', limitMinor)]),
  ];
  return {
    id: record.id, kind: 'row-figure', ventureId: venture.id, at: record.at, operation: 'venture.row-figure', subject: { type: 'go-no-go', recordId: record.id },
    figures, allowedNumbers: record.allowedNumbers, explanation: record.explanation, digest: stored,
    stale: again.maxLossMinor !== record.maxLossMinor || digest(body) !== stored,
  };
}
