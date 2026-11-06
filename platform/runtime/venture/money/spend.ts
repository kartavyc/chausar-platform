// P2-spend: what paid calls cost, held before each call and settled after, in BigInt micro-USD.
//
// Every paid call (a keyed model call, a heavy-work run, a paid connector) goes the same way:
// 1. Price it from the owner's rate card, else Chausar's list price. No price at all is refused (SPEND_UNPRICED),
//    never counted as free.
// 2. Write a charge record keyed by what was asked for, in the same commit that lets the call go. A retry finds the
//    key and is refused (SPEND_ALREADY_CHARGED), so nothing is paid for twice; an answer that never came stays held.
// 3. Hold the estimate against the monthly cap (SPEND_CAP). Above the owner's ask-first figure the call waits for a
//    quote the owner approves, bound to the draft, the figure and the payer for one hour (QUOTE_WAITING).
// 4. Settle with the billed figure, or keep it held at the estimate when no figure came back.
// The design follows Floe-Labs/floe-guard (MIT: reserve then settle, unpriced means refused, an owner rate card over
// list prices) and veedstudio/open-edit (Apache-2.0: the charge record before the call, the hashed one-hour quote).
// Their float arithmetic is not taken: every amount here is whole micro units in BigInt.
// Spend is counted and capped in US dollars. With the owner's own rupee rate set, every figure also shows in rupees
// beside the dollars (paise worked out in BigInt, to the nearest paisa, a half paisa up), labelled with that rate.
import { ChausarError, check, money, type Context, type State } from '../../contracts.ts';
import { ESTIMATE_WORDS, microsAsUsd, usdToMicros } from '../models/cost.ts';
import { localDayAt } from '../local-day.ts';
import {
  currentVenture, exactPayload, formatMicros, formatVentureDate, identifier, isAppChannel, isoDate, listRecords, plainText, readVenture, ventureAction, type VentureTx,
} from '../records.ts';
import { QUOTE_TTL_MS, checkQuoteBinding } from './quote.ts';
import { newestFirst } from './shared.ts';
import { AGENT_ID, AGENT_PURPOSES } from '../views/shared.ts';
import type {
  DateOrder, Display, MicroString, ModelPriceTable, RupeeRate, SpendPolicyRecord, SpendPolicyView, SpendQuoteRecord, SpendRate, SpendRateUnit, SpendRecord, SpendRow,
  VentureDeps, VentureRecord,
} from '../contracts.ts';

const MICROS = /^(0|[1-9][0-9]{0,14})$/;
const ITEM = /^(model|delegate|connector):[A-Za-z0-9_.-]{1,120}$/;
const UNITS: readonly SpendRateUnit[] = ['per-million-tokens', 'per-call', 'per-run-cap'];
const RATE_KEYS = ['item', 'unit', 'inputMicrosPerMillion', 'outputMicrosPerMillion', 'microsPerCall', 'source', 'checkedOn', 'confirmed', 'by'] as const;
const MAX_RATES = 100;
const MAX_ROWS = 200;
/** Phases that still hold the key: a second call with it would pay for the same thing again. */
const HOLDS_KEY: readonly SpendRecord['phase'][] = ['reserved', 'unknown', 'settled'];
const QUOTE_CODES = ['QUOTE_WAITING', 'QUOTE_CHANGED', 'QUOTE_EXPIRED'];

export const SPEND_WORDS = Object.freeze({
  alreadyCharged: 'This was already paid for, or its payment is still being checked. Chausar never pays twice: look at the earlier charge first.',
  noPrice: 'No price',
  notSent: ' (not sent)',
  refusedNoPrice: 'Not run: there is no price for it on your rate card, and Chausar never counts an unknown price as free.',
  refusedOther: 'Not run.',
  estimate: ' (estimate)',
  toolReport: ' (as the tool reported, on your own plan)',
  unknown: '. The answer never came, so the cost is not known and stays held.',
  thisMonth: ' this month',
  includesEstimates: ' (includes estimates)',
  appApproval: 'Approve this inside the Chausar app.',
});

/** What a paid call is, before it has a rate: its key, its words, who pays and exactly what is paid for. */
export type SpendSubject = {
  key: string; // one per thing asked for; a retry of the same thing uses the same key
  item: string; // the rate card line: 'model:<preset id>', 'delegate:<tool>' or 'connector:<id>'
  label: string;
  payer: string;
  draftDigest: string;
  agent?: string | null;
  connector?: string | null;
  ref?: string | null;
};
export type SpendReservation = SpendSubject & { rate: SpendRate; estimateMicros: MicroString };
export type SpendOutcome =
  | { kind: 'billed'; micros: MicroString; by: 'usage' | 'tool-report' | 'bill' }
  | { kind: 'reservation' } // no figure came back but the call is known to be done: settled at the estimate
  | { kind: 'unknown' } // the answer never came: kept held at the estimate, never retried on its own
  | { kind: 'released' }; // the call was never sent

/** A refusal that is written down: a refused row, or for the quote codes, a quote waiting for the owner. */
export class SpendRefusal extends ChausarError {
  readonly subject: SpendSubject | null;
  readonly estimateMicros: MicroString | null;
  constructor(code: string, message: string, subject: SpendSubject | null, estimateMicros: MicroString | null) {
    super(code, message);
    this.subject = subject;
    this.estimateMicros = estimateMicros;
  }
}

function subjectOf(input: SpendSubject): SpendSubject {
  return {
    key: input.key, item: input.item, label: input.label, payer: input.payer, draftDigest: input.draftDigest,
    agent: input.agent ?? null, connector: input.connector ?? null, ref: input.ref ?? null,
  };
}

const monthOf = (iso: string) => iso.slice(0, 7);
const micro = (value: unknown): value is string => typeof value === 'string' && MICROS.test(value);

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** A rate is a price only when every figure its unit needs is there. */
function complete(rate: SpendRate): boolean {
  if (rate.unit === 'per-million-tokens') return micro(rate.inputMicrosPerMillion) && micro(rate.outputMicrosPerMillion);
  return micro(rate.microsPerCall);
}

/**
 * The price of one paid call: the owner's rate card line for the item, else the list price, else a refusal.
 * An owner line keeps its own confirmed flag, so the owner can mark a rate they have not checked.
 */
export function resolveRate(input: { item: string; list: SpendRate | null; owner: readonly SpendRate[]; subject?: SpendSubject }): SpendRate {
  const rate = input.owner.find(line => line.item === input.item) ?? input.list;
  if (rate && complete(rate)) return rate;
  const what = input.subject?.label ?? input.item;
  throw new SpendRefusal('SPEND_UNPRICED', `Chausar has no price for ${what}, so it was not run. Add its price to your rate card first; an unknown price is never counted as free.`,
    input.subject ? subjectOf(input.subject) : null, null);
}

/** The most a fixed-price call can cost: its price per call, or the run's own cap. */
export function fixedEstimate(rate: SpendRate, subject?: SpendSubject): MicroString {
  if (rate.unit !== 'per-million-tokens' && micro(rate.microsPerCall)) return rate.microsPerCall;
  throw new SpendRefusal('SPEND_UNPRICED', `The rate card prices ${subject?.label ?? rate.item} by tokens, but it is paid per call. Add a price per call.`,
    subject ? subjectOf(subject) : null, null);
}

/** A model preset's list price table as a rate card line. Null when the preset has no table. */
export function listRateOfTable(item: string, table: ModelPriceTable | null): SpendRate | null {
  if (!table) return null;
  return {
    item, unit: 'per-million-tokens', inputMicrosPerMillion: table.inputMicrosPerMillion, outputMicrosPerMillion: table.outputMicrosPerMillion,
    microsPerCall: null, source: table.source, checkedOn: table.checkedOn, confirmed: table.confirmed, by: 'list',
  };
}

/** A per-token rate as the price table the model cost code reads. */
export function modelTableOf(rate: SpendRate, subject?: SpendSubject): ModelPriceTable {
  if (rate.unit === 'per-million-tokens' && micro(rate.inputMicrosPerMillion) && micro(rate.outputMicrosPerMillion)) {
    return { currency: 'USD', inputMicrosPerMillion: rate.inputMicrosPerMillion, outputMicrosPerMillion: rate.outputMicrosPerMillion, source: rate.source, checkedOn: rate.checkedOn, confirmed: rate.confirmed };
  }
  throw new SpendRefusal('SPEND_UNPRICED', `The rate card prices ${subject?.label ?? rate.item} per call, but a model call is priced by tokens. Add its price per million tokens.`,
    subject ? subjectOf(subject) : null, null);
}

function latestPolicy(policies: readonly SpendPolicyRecord[]): SpendPolicyRecord | null {
  return newestFirst(policies)[0] ?? null;
}

/** The owner's rate card lines in force. */
export function ownerRates(policies: readonly SpendPolicyRecord[]): SpendRate[] {
  return latestPolicy(policies)?.rates ?? [];
}

/** The owner's rate card lines for a business, read from a state snapshot. */
export function spendRatesOf(state: State, ventureId: string): SpendRate[] {
  return ownerRates(listRecords(state, 'venture-spend-policy', ventureId));
}

// ---------------------------------------------------------------------------
// The ledger: reserve, settle, refuse
// ---------------------------------------------------------------------------

/** What a row counts toward its month: the settled figure, or the estimate while held. Nothing when refused or not sent. */
function counted(record: SpendRecord): bigint {
  if (record.phase === 'settled' && record.settledMicros !== null) return BigInt(record.settledMicros);
  if (record.phase === 'reserved' || record.phase === 'unknown') return BigInt(record.reservedMicros);
  return 0n;
}

/**
 * The paid calls of one UTC month (as the model limits count them) with what each counts toward the month: settled
 * calls at what they settled at, held ones at what they reserved. estimate is true when the figure is not a billed one.
 * Money at a glance (overview.ts) sums these with a receipt.
 */
export function spendOfMonth(records: readonly SpendRecord[], month: string): { record: SpendRecord; micros: bigint; estimate: boolean }[] {
  return records.filter(record => monthOf(record.at) === month)
    .map(record => ({ record, micros: counted(record), estimate: rowKind(record) === 'estimate' }))
    .filter(item => item.micros > 0n);
}

function monthTotal(records: readonly SpendRecord[], month: string): bigint {
  return records.reduce((total, record) => (monthOf(record.at) === month ? total + counted(record) : total), 0n);
}

/**
 * The monthly limit as set now and what this month (UTC) has spent or holds, read from a state snapshot. The gate
 * reads it again just before an approved action applies (delivery/harness/recheck.ts), so a lowered limit counts.
 */
export function monthSpendNow(state: State, ventureId: string, nowIso: string): { capMicros: MicroString | null; spentMicros: MicroString } {
  const policy = latestPolicy(listRecords(state, 'venture-spend-policy', ventureId));
  return { capMicros: policy?.capMicros ?? null, spentMicros: String(monthTotal(listRecords(state, 'venture-spend', ventureId), monthOf(nowIso))) };
}

/** Finds the owner's approved quote for this draft and spends it, or refuses with the quote code that applies. */
function spendQuote(tx: VentureTx, request: SpendReservation, askAboveMicros: MicroString, spendId: string): string {
  const ask = `This may cost ${formatMicros(request.estimateMicros)}, more than the ${formatMicros(askAboveMicros)} you asked to see first. It waits for your approval.`;
  const [quote] = newestFirst(tx.list('venture-spend-quote').filter(item => item.item === request.item && item.draftDigest === request.draftDigest && item.status === 'approved'));
  if (!quote) throw new SpendRefusal('QUOTE_WAITING', ask, subjectOf(request), request.estimateMicros);
  try {
    checkQuoteBinding({ draftDigest: quote.draftDigest, figure: quote.figureMicros, payer: quote.payer, quotedAt: quote.at },
      { draftDigest: request.draftDigest, figure: request.estimateMicros, payer: request.payer }, tx.now);
  } catch (error) {
    if (error instanceof ChausarError) throw new SpendRefusal(error.code, `${error.message} ${ask}`, subjectOf(request), request.estimateMicros);
    throw error;
  }
  tx.replace({ ...quote, status: 'spent', spentBy: spendId });
  return quote.id;
}

/**
 * Writes the charge record for one paid call inside the transaction that lets the call go: the key must be free,
 * the estimate must fit under the monthly cap, and above the ask-first figure an approved quote is spent. Throws
 * before anything is written when any of these fails; the caller passes the error to spendRefused.
 */
export function reserveSpend(tx: VentureTx, request: SpendReservation): SpendRecord {
  check(micro(request.estimateMicros), 'INVALID_AMOUNT', 'A cost estimate must be whole micro units.');
  const records = tx.list('venture-spend');
  check(!records.some(record => record.key === request.key && HOLDS_KEY.includes(record.phase)), 'SPEND_ALREADY_CHARGED', SPEND_WORDS.alreadyCharged);
  const policy = latestPolicy(tx.list('venture-spend-policy'));
  const estimate = BigInt(request.estimateMicros);
  if (policy && policy.capMicros !== null) {
    const after = monthTotal(records, monthOf(tx.now)) + estimate;
    if (after > BigInt(policy.capMicros)) {
      throw new SpendRefusal('SPEND_CAP', `This could take this month's spend to ${formatMicros(String(after))}, past your limit of ${formatMicros(policy.capMicros)}. It was not run. Raise the limit or wait for next month.`,
        subjectOf(request), request.estimateMicros);
    }
  }
  const base = tx.base('venture-spend');
  const quoteId = policy && policy.askAboveMicros !== null && estimate > BigInt(policy.askAboveMicros)
    ? spendQuote(tx, request, policy.askAboveMicros, base.id) : null;
  const subject = subjectOf(request);
  return tx.put({
    ...base, key: subject.key, item: subject.item, label: subject.label, agent: subject.agent ?? null, connector: subject.connector ?? null,
    payer: subject.payer, draftDigest: subject.draftDigest, rate: structuredClone(request.rate), reservedMicros: request.estimateMicros,
    settledMicros: null, settledBy: null, phase: 'reserved', quoteId, ref: subject.ref ?? null, refusal: null, settledAt: null,
  } satisfies SpendRecord);
}

/** Settles the held charge for a key. Null when no charge is held for it (the call was not metered). */
export function settleSpend(tx: VentureTx, key: string, outcome: SpendOutcome): SpendRecord | null {
  const [held] = newestFirst(tx.list('venture-spend').filter(record => record.key === key && (record.phase === 'reserved' || record.phase === 'unknown')));
  if (!held) return null;
  switch (outcome.kind) {
    case 'billed':
      check(micro(outcome.micros), 'INVALID_AMOUNT', 'A billed cost must be whole micro units.');
      return tx.replace({ ...held, phase: 'settled', settledMicros: outcome.micros, settledBy: outcome.by, settledAt: tx.now });
    case 'reservation':
      return tx.replace({ ...held, phase: 'settled', settledMicros: held.reservedMicros, settledBy: 'reservation', settledAt: tx.now });
    case 'unknown':
      return tx.replace({ ...held, phase: 'unknown' });
    case 'released':
      return tx.replace({ ...held, phase: 'released', settledAt: tx.now });
  }
}

/** settleSpend in its own write, for a call that ran outside any transaction. */
export function settleSpendAction(deps: VentureDeps, ctx: Context, key: string, outcome: SpendOutcome): Promise<SpendRecord | null> {
  return ventureAction(deps, ctx, 'prepare', 'spend.settle', tx => settleSpend(tx, key, outcome));
}

/** An open quote can still be approved only within the hour after it was made. */
export function quoteLive(quote: Pick<SpendQuoteRecord, 'status' | 'at'>, nowIso: string): boolean {
  return quote.status === 'open' && Date.parse(nowIso) - Date.parse(quote.at) <= QUOTE_TTL_MS;
}

function openQuote(tx: VentureTx, subject: SpendSubject, figureMicros: MicroString) {
  // A quote over an hour old can no longer be approved, so a fresh refusal makes a fresh quote.
  const waiting = tx.list('venture-spend-quote').some(quote => quoteLive(quote, tx.now) && quote.item === subject.item && quote.draftDigest === subject.draftDigest
    && quote.payer === subject.payer && quote.figureMicros === figureMicros);
  if (waiting) return;
  tx.put({
    ...tx.base('venture-spend-quote'), key: subject.key, item: subject.item, label: subject.label, payer: subject.payer, draftDigest: subject.draftDigest,
    figureMicros, figure: formatMicros(figureMicros), status: 'open', decidedAt: null, decidedBy: null, spentBy: null,
  } satisfies SpendQuoteRecord);
}

/**
 * Writes a spend refusal down in its own commit, then throws it again: a refused row, or for the quote codes a
 * quote for the owner. Any other error passes through untouched. The refusal stands even if it cannot be written.
 */
export async function spendRefused(deps: VentureDeps, ctx: Context, error: unknown): Promise<never> {
  if (error instanceof SpendRefusal && error.subject) {
    const refusal = error;
    const subject = error.subject;
    try {
      await ventureAction(deps, ctx, 'prepare', 'spend.refused', tx => {
        if (QUOTE_CODES.includes(refusal.code) && refusal.estimateMicros !== null) { openQuote(tx, subject, refusal.estimateMicros); return; }
        tx.put({
          ...tx.base('venture-spend'), key: subject.key, item: subject.item, label: subject.label, agent: subject.agent ?? null, connector: subject.connector ?? null,
          payer: subject.payer, draftDigest: subject.draftDigest, rate: null, reservedMicros: refusal.estimateMicros ?? '0', settledMicros: null, settledBy: null,
          phase: 'refused', quoteId: null, ref: subject.ref ?? null, refusal: { code: refusal.code, message: refusal.message }, settledAt: null,
        } satisfies SpendRecord);
      });
    } catch {
      // Nothing to add: the call was refused either way, and the caller gets that refusal below.
    }
  }
  throw error;
}

/** A paid connector call: what it is, plus the list price Chausar knows for it (null when there is none). */
export type PaidCallRequest = SpendSubject & { list: SpendRate | null };

/**
 * One paid connector call, start to finish: the charge record is committed before run() is called, run() makes the
 * call and says what was billed (null when the connector reports no figure), and the record is settled. If run()
 * throws, the money may have moved: the record stays held at the estimate and the same key is refused from then on.
 */
export async function paidCall<T>(deps: VentureDeps, ctx: Context, request: PaidCallRequest, run: () => Promise<{ value: T; billedMicros: MicroString | null }>): Promise<T> {
  const subject = subjectOf(request);
  await ventureAction(deps, ctx, 'prepare', 'spend.reserve', tx => {
    const rate = resolveRate({ item: subject.item, list: request.list, owner: ownerRates(tx.list('venture-spend-policy')), subject });
    return reserveSpend(tx, { ...subject, rate, estimateMicros: fixedEstimate(rate, subject) });
  }).catch(error => spendRefused(deps, ctx, error));
  let answer: { value: T; billedMicros: MicroString | null };
  try {
    answer = await run();
  } catch (error) {
    await settleSpendAction(deps, ctx, subject.key, { kind: 'unknown' }).catch(() => null);
    throw error;
  }
  await settleSpendAction(deps, ctx, subject.key, answer.billedMicros === null ? { kind: 'reservation' } : { kind: 'billed', micros: answer.billedMicros, by: 'bill' });
  return answer.value;
}

/** What one charge counts: its settled figure, the estimate while it is held, else nothing. A run adds it to its spend. */
export function countedMicros(record: SpendRecord): MicroString {
  return String(counted(record));
}

// ---------------------------------------------------------------------------
// The owner's side: rate card, cap and ask-first figure; quotes
// ---------------------------------------------------------------------------

function microsOrNull(value: unknown, field: string): MicroString | null {
  if (value === null) return null;
  check(micro(value), 'INVALID_AMOUNT', `${field} must be whole micro-dollars, like 5000000 for five US dollars.`);
  return value;
}

/** The dollar fields of a rate card line and the micro fields they fill. */
const USD_RATE_FIELDS = [['inputUsdPerMillion', 'inputMicrosPerMillion'], ['outputUsdPerMillion', 'outputMicrosPerMillion'], ['usdPerCall', 'microsPerCall']] as const;

/**
 * A figure given once: in US dollars, through the one parser (models/cost.ts), or in micro units. Undefined when
 * neither was given. Limits take two decimals and rates six.
 */
function usdOrMicros(body: Record<string, unknown>, usd: string, micros: string, field: string, decimals: 2 | 6): unknown {
  if (body[usd] === undefined) return body[micros];
  check(body[micros] === undefined, 'INVALID_VENTURE_REQUEST', `Give ${field.toLowerCase()} once, in US dollars.`);
  return body[usd] === null ? null : usdToMicros(body[usd], { field, decimals });
}

function rateLine(value: unknown): SpendRate {
  const body = exactPayload(value, RATE_KEYS, ['item', 'unit', 'source', 'checkedOn']);
  check(typeof body.item === 'string' && ITEM.test(body.item), 'INVALID_VENTURE_REQUEST', 'A rate card line names a model, a heavy-work tool or a connector.');
  check(UNITS.includes(body.unit as SpendRateUnit), 'INVALID_VENTURE_REQUEST', 'A rate is per million tokens, per call, or a run cap.');
  check(body.by === undefined || body.by === 'owner', 'INVALID_VENTURE_REQUEST', 'Lines on your rate card are your own.');
  check(body.confirmed === undefined || typeof body.confirmed === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say whether this rate is confirmed.');
  const field = (name: 'inputMicrosPerMillion' | 'outputMicrosPerMillion' | 'microsPerCall') => (body[name] === undefined ? null : microsOrNull(body[name], 'A rate'));
  const rate: SpendRate = {
    item: body.item, unit: body.unit as SpendRateUnit, inputMicrosPerMillion: field('inputMicrosPerMillion'), outputMicrosPerMillion: field('outputMicrosPerMillion'),
    microsPerCall: field('microsPerCall'), source: plainText(body.source, 'Where the rate comes from', { max: 200 }), checkedOn: isoDate(body.checkedOn, 'The date checked'),
    confirmed: body.confirmed !== false, by: 'owner',
  };
  check(complete(rate), 'INVALID_VENTURE_REQUEST', 'A rate per million tokens needs both its input and output figures; a rate per call or a run cap needs its figure.');
  return rate;
}

/**
 * Sets the monthly cap, the ask-first figure, the rate card and the owner's rupee rate (inrPerUsd, rupees per US
 * dollar as typed). Fields left out keep their value; null clears a figure. A rupee rate is dated the day it is set
 * (the business's own calendar); the same rate sent again keeps its day. An owner action inside the app. Each change
 * is a new record, so earlier rates stay on file.
 */
export async function setSpendPolicy(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SpendPolicyRecord> {
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', SPEND_WORDS.appApproval);
  const body = exactPayload(payload, ['capMicros', 'askAboveMicros', 'rates', 'inrPerUsd']);
  const cap = body.capMicros === undefined ? undefined : microsOrNull(body.capMicros, 'The monthly limit');
  const askAbove = body.askAboveMicros === undefined ? undefined : microsOrNull(body.askAboveMicros, 'The ask-first figure');
  const perUsd = body.inrPerUsd === undefined ? undefined : body.inrPerUsd === null ? null : rupeeRateOf(body.inrPerUsd);
  let rates: SpendRate[] | undefined;
  if (body.rates !== undefined) {
    check(Array.isArray(body.rates) && body.rates.length <= MAX_RATES, 'INVALID_VENTURE_REQUEST', `A rate card holds up to ${MAX_RATES} lines.`);
    rates = body.rates.map(rateLine);
    check(new Set(rates.map(rate => rate.item)).size === rates.length, 'INVALID_VENTURE_REQUEST', 'Each item has one line on the rate card.');
  }
  return ventureAction(deps, ctx, 'admin', 'spend.policy', tx => {
    const current = latestPolicy(tx.list('venture-spend-policy'));
    const held = current?.rupeeRate ?? null;
    const rupeeRate = perUsd === undefined ? held
      : perUsd === null ? null
        : { perUsd, setOn: held && held.perUsd === perUsd ? held.setOn : localDayAt(tx.now, tx.venture!.country) };
    return tx.put({
      ...tx.base('venture-spend-policy'),
      capMicros: cap !== undefined ? cap : current?.capMicros ?? null,
      askAboveMicros: askAbove !== undefined ? askAbove : current?.askAboveMicros ?? null,
      rates: rates ?? current?.rates ?? [],
      rupeeRate,
    } satisfies SpendPolicyRecord);
  });
}

// ---------------------------------------------------------------------------
// Rupees beside dollars, at the owner's own rate
// ---------------------------------------------------------------------------

/** The owner's rupee rate and how the business writes dates: what puts a rupee figure beside a dollar one. */
export type Rupees = { rate: RupeeRate; dateOrder: DateOrder };

/** Rupees per US dollar as the owner types it ('83.50', up to four places) as ten-thousandths of a rupee. Above zero. */
export function rupeeRateOf(value: unknown): string {
  const message = 'Rupees per US dollar must be a number with at most four decimals, like 83.50.';
  check(typeof value === 'string', 'INVALID_AMOUNT', message);
  const match = /^(\d{1,4})(?:\.(\d{1,4}))?$/.exec(value.trim());
  check(match, 'INVALID_AMOUNT', message);
  const perUsd = BigInt(match[1]) * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0'));
  check(perUsd > 0n, 'INVALID_AMOUNT', message);
  return String(perUsd);
}

/**
 * Micro-dollars as paise at the owner's rate, in BigInt: micros x perUsd / 10^8 (a million micros to the dollar, the
 * rate in ten-thousandths of a rupee, a hundred paise to the rupee), rounded to the nearest paisa, a half paisa up.
 */
export function microsToPaise(micros: MicroString, perUsd: string): bigint {
  return (BigInt(micros) * BigInt(perUsd) + 50_000_000n) / 100_000_000n;
}

/** The rate's whole rupees and its decimals, two places at least and more only when it has them. */
function rateParts(perUsd: string): { whole: bigint; decimals: string } {
  const value = BigInt(perUsd);
  return { whole: value / 10_000n, decimals: String(value % 10_000n).padStart(4, '0').replace(/0+$/, '').padEnd(2, '0') };
}

/** '₹83.50 per $1 (your rate, set 23 Oct 2026)': the owner's rate in words, with the day it was set. */
export function rupeeRateWords(rupees: Rupees): Display {
  const { whole, decimals } = rateParts(rupees.rate.perUsd);
  return `₹${whole.toLocaleString('en-IN')}.${decimals} per $1 (your rate, set ${formatVentureDate(rupees.rate.setOn, rupees.dateOrder)})`;
}

/** '₹20.88', a dollar figure in rupees at the owner's rate. */
export function rupeeFigure(micros: MicroString, rupees: Rupees): Display {
  return money(microsToPaise(micros, rupees.rate.perUsd), 'INR');
}

/** '₹20.88 at ₹83.50 per $1 (your rate, set 23 Oct 2026)', to show beside a dollar figure; null without a rate. */
export function rupeesBeside(micros: MicroString, rupees: Rupees | null): Display | null {
  return rupees ? `${rupeeFigure(micros, rupees)} at ${rupeeRateWords(rupees)}` : null;
}

/** The owner's rupee rate for a business, read from a state snapshot; null when none is set. */
export function rupeesOf(state: State, venture: Pick<VentureRecord, 'id' | 'country'>): Rupees | null {
  const rate = latestPolicy(listRecords(state, 'venture-spend-policy', venture.id))?.rupeeRate ?? null;
  return rate ? { rate, dateOrder: venture.country.dateOrder } : null;
}

// ---------------------------------------------------------------------------
// venture.spend.policy.get and venture.spend.policy.set
// ---------------------------------------------------------------------------

const POLICY_WORDS = Object.freeze({
  noCap: 'No monthly limit', perMonth: ' a month', neverAsks: 'Never asks first', asksAbove: 'Asks you first above ',
  ownRates: 'Rates you set are your own, so they count as confirmed.',
});

/** One rate card line's price in words, worked out here so the screen never formats a figure. */
export function ratePrice(rate: SpendRate): Display {
  if (rate.unit === 'per-million-tokens') {
    return `${formatMicros(rate.inputMicrosPerMillion ?? '0')} in and ${formatMicros(rate.outputMicrosPerMillion ?? '0')} out, per million tokens`;
  }
  const figure = formatMicros(rate.microsPerCall ?? '0');
  return rate.unit === 'per-call' ? `${figure} per call` : `Up to ${figure} a run`;
}

function policyView(policy: SpendPolicyRecord | null, dateOrder: DateOrder): SpendPolicyView {
  const cap = policy?.capMicros ?? null, askFirst = policy?.askAboveMicros ?? null;
  const usd = (micros: MicroString | null) => (micros === null ? null : microsAsUsd(micros));
  const rupees: Rupees | null = policy?.rupeeRate ? { rate: policy.rupeeRate, dateOrder } : null;
  const typed = rupees ? rateParts(rupees.rate.perUsd) : null;
  return {
    inrPerUsd: typed ? `${typed.whole}.${typed.decimals}` : null, rupeeRate: rupees ? rupeeRateWords(rupees) : null,
    ...(rupees && cap !== null ? { capRupees: rupeesBeside(cap, rupees)! } : {}),
    ...(rupees && askFirst !== null ? { askFirstRupees: rupeesBeside(askFirst, rupees)! } : {}),
    capMicros: cap, askFirstMicros: askFirst, capUsd: usd(cap), askFirstUsd: usd(askFirst),
    cap: cap === null ? POLICY_WORDS.noCap : formatMicros(cap) + POLICY_WORDS.perMonth,
    askFirst: askFirst === null ? POLICY_WORDS.neverAsks : POLICY_WORDS.asksAbove + formatMicros(askFirst),
    rates: (policy?.rates ?? []).map(rate => ({
      ...structuredClone(rate), price: ratePrice(rate),
      inputUsdPerMillion: usd(rate.inputMicrosPerMillion), outputUsdPerMillion: usd(rate.outputMicrosPerMillion), usdPerCall: usd(rate.microsPerCall),
    })),
    setAt: policy?.at ?? null,
  };
}

/** venture.spend.policy.get {} (level read): the monthly limit, the ask-first figure and the owner's rate card. */
export async function spendPolicyGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SpendPolicyView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return policyView(latestPolicy(listRecords(state, 'venture-spend-policy', venture.id)), venture.country.dateOrder);
}

/**
 * venture.spend.policy.set { capUsd?, askFirstUsd?, cap?, askFirst?, rates?, inrPerUsd? } (admin, inside the app):
 * through setSpendPolicy. The owner types the limits in US dollars (capUsd, askFirstUsd, up to two decimals) and rates
 * in US dollars too (inputUsdPerMillion, outputUsdPerMillion, usdPerCall, up to six); the engine converts each to micro
 * units. The micro fields (cap, askFirst and the rate's micro figures) still work for callers that have micro units;
 * a figure given both ways is refused. inrPerUsd is the owner's own rupee rate (up to four decimals): spend then shows
 * in rupees beside dollars. A field left out keeps its value and null clears a figure. Every rate line the owner sets
 * is theirs and confirmed by them.
 */
export async function spendPolicySet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SpendPolicyView> {
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', SPEND_WORDS.appApproval);
  const body = exactPayload(payload, ['cap', 'askFirst', 'capUsd', 'askFirstUsd', 'rates', 'inrPerUsd']);
  const cap = usdOrMicros(body, 'capUsd', 'cap', 'The monthly limit', 2);
  const askFirst = usdOrMicros(body, 'askFirstUsd', 'askFirst', 'The ask-first figure', 2);
  let rates: unknown[] | undefined;
  if (body.rates !== undefined) {
    check(Array.isArray(body.rates), 'INVALID_VENTURE_REQUEST', 'rates is a list of rate card lines.');
    rates = body.rates.map(line => {
      const value: Record<string, unknown> = line && typeof line === 'object' && !Array.isArray(line) ? { ...line as Record<string, unknown> } : {};
      check(value.confirmed === undefined || value.confirmed === true, 'INVALID_VENTURE_REQUEST', POLICY_WORDS.ownRates);
      for (const [usd, micros] of USD_RATE_FIELDS) {
        if (value[usd] === undefined) continue;
        value[micros] = usdOrMicros(value, usd, micros, 'A rate', 6);
        delete value[usd];
      }
      return { ...value, confirmed: true, by: 'owner' };
    });
  }
  const record = await setSpendPolicy(deps, ctx, {
    ...(cap !== undefined ? { capMicros: cap } : {}),
    ...(askFirst !== undefined ? { askAboveMicros: askFirst } : {}),
    ...(rates !== undefined ? { rates } : {}),
    ...(body.inrPerUsd !== undefined ? { inrPerUsd: body.inrPerUsd } : {}),
  });
  return policyView(record, readVenture(deps, ctx).venture.country.dateOrder);
}

/**
 * The team agent a paid call worked for (views/team.ts ids), or null when it was no agent's: the plan writer, a judge,
 * a rehearsal client. Heavy work is only ever asked for by the delivery agent; a model call is the agent's when its
 * purpose is one of the agent's. Records that name their agent keep it.
 */
export function spendAgentOf(state: State, spend: { agent?: string | null; item: string; key: string }): string | null {
  if (spend.agent) return spend.agent;
  if (spend.item.startsWith('delegate:')) return AGENT_ID;
  if (!spend.item.startsWith('model:') || !spend.key.startsWith('model:')) return null;
  const callId = spend.key.slice('model:'.length);
  const call = state.conversations.find((record: any) => record?.kind === 'venture-model-call' && record.id === callId) as { purpose?: unknown } | undefined;
  return typeof call?.purpose === 'string' && AGENT_PURPOSES.includes(call.purpose) ? AGENT_ID : null;
}

/** Quotes waiting for the owner, newest first, for the current business. The queue shows them as 'quote' rows. */
export function openSpendQuotes(state: State): SpendQuoteRecord[] {
  const venture = currentVenture(state);
  if (!venture) return [];
  return newestFirst(listRecords(state, 'venture-spend-quote', venture.id).filter(quote => quote.status === 'open'));
}

/**
 * The owner approves one quote, sending back the draft digest, the figure and the payer they read. Any difference is
 * QUOTE_CHANGED, more than an hour after the quote is QUOTE_EXPIRED, and a quote is decided once. The approval is
 * spent by the next matching call, so one approval buys one call.
 */
export async function approveSpendQuote(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SpendQuoteRecord> {
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', SPEND_WORDS.appApproval);
  const body = exactPayload(payload, ['quoteId', 'draftDigest', 'figureMicros', 'payer'], ['quoteId', 'draftDigest', 'figureMicros', 'payer']);
  const quoteId = identifier(body.quoteId, 'Quote');
  check(typeof body.draftDigest === 'string' && typeof body.figureMicros === 'string' && typeof body.payer === 'string', 'INVALID_VENTURE_REQUEST', 'Send the quote you read.');
  const offered = { draftDigest: body.draftDigest, figure: body.figureMicros, payer: body.payer };
  return ventureAction(deps, ctx, 'approve', 'spend.quote', tx => {
    const quote = tx.find('venture-spend-quote', quoteId);
    check(quote && quote.status === 'open', 'APPROVAL_STALE', 'This quote is no longer waiting for you.');
    checkQuoteBinding({ draftDigest: quote.draftDigest, figure: quote.figureMicros, payer: quote.payer, quotedAt: quote.at }, offered, tx.now);
    return tx.replace({ ...quote, status: 'approved', decidedAt: tx.now, decidedBy: ctx.memberId });
  });
}

// ---------------------------------------------------------------------------
// venture.spend.list
// ---------------------------------------------------------------------------

function rowKind(record: SpendRecord): SpendRow['kind'] {
  if (record.phase === 'refused') return 'refused';
  if (record.phase === 'released') return 'billed';
  if (record.phase !== 'settled') return 'estimate';
  if (record.settledBy === 'bill' || record.settledBy === 'tool-report') return 'billed';
  if (record.settledBy === 'usage' && record.rate?.confirmed !== false) return 'billed';
  return 'estimate';
}

function settledDisplay(record: SpendRecord, unconfirmed: string): Display | undefined {
  if (record.phase === 'released') return formatMicros('0') + SPEND_WORDS.notSent;
  if (record.phase !== 'settled' || record.settledMicros === null) return undefined;
  const amount = formatMicros(record.settledMicros);
  if (record.settledBy === 'bill') return amount;
  if (record.settledBy === 'tool-report') return amount + SPEND_WORDS.toolReport;
  if (record.settledBy === 'reservation') return amount + (unconfirmed || SPEND_WORDS.estimate);
  return amount + unconfirmed;
}

/**
 * One row as the Money place shows it. Every figure is formatted here; the UI never computes one. With the owner's
 * rupee rate, the reserved and settled figures come in rupees too, beside the dollars, with that rate.
 */
export function spendRow(record: SpendRecord, agent: string | null = record.agent, rupees: Rupees | null = null): SpendRow {
  const unconfirmed = record.rate !== null && !record.rate.confirmed ? ESTIMATE_WORDS : '';
  const unpriced = record.phase === 'refused' && record.refusal?.code === 'SPEND_UNPRICED';
  const settled = settledDisplay(record, unconfirmed);
  const settledMicros = record.phase === 'settled' ? record.settledMicros : null;
  return {
    id: record.id,
    ...(agent ? { agent } : {}),
    ...(record.connector ? { connector: record.connector } : {}),
    label: record.phase === 'unknown' ? record.label + SPEND_WORDS.unknown : record.label,
    reserved: unpriced ? SPEND_WORDS.noPrice : formatMicros(record.reservedMicros) + unconfirmed,
    ...(rupees && !unpriced ? { reservedRupees: rupeesBeside(record.reservedMicros, rupees)! } : {}),
    ...(settled !== undefined ? { settled } : {}),
    ...(rupees && settledMicros !== null ? { settledRupees: rupeesBeside(settledMicros, rupees)! } : {}),
    kind: rowKind(record),
    ...(record.phase === 'refused' ? { reason: refusalReason(record) } : {}),
  };
}

/** Why a call was refused, in the engine's own words: no price, the monthly limit, a quote waiting for the owner. */
function refusalReason(record: SpendRecord): Display {
  if (record.refusal?.code === 'SPEND_UNPRICED') return SPEND_WORDS.refusedNoPrice;
  const message = record.refusal?.message?.replace(/\s+/g, ' ').trim();
  return message ? `${SPEND_WORDS.refusedOther} ${message}` : SPEND_WORDS.refusedOther;
}

/**
 * venture.spend.list {} (level read): every paid call newest first, with what it reserved and what it settled at,
 * and this month's total (UTC months, as the model limits count them), which includes what is still held. With the
 * owner's rupee rate, every figure and the total come in rupees too, beside the dollars.
 */
export async function listSpend(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ rows: SpendRow[]; total: Display; totalRupees?: Display }> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const records = newestFirst(listRecords(state, 'venture-spend', venture.id));
  const month = monthOf(deps.clock().toISOString());
  let total = 0n;
  let estimated = false;
  for (const record of records) {
    if (monthOf(record.at) !== month) continue;
    const amount = counted(record);
    total += amount;
    if (amount > 0n && rowKind(record) === 'estimate') estimated = true;
  }
  const rupees = rupeesOf(state, venture);
  return {
    rows: records.slice(0, MAX_ROWS).map(record => spendRow(record, spendAgentOf(state, record), rupees)),
    total: formatMicros(String(total)) + SPEND_WORDS.thisMonth + (estimated ? SPEND_WORDS.includesEstimates : ''),
    ...(rupees ? { totalRupees: rupeesBeside(String(total), rupees)! } : {}),
  };
}
