import { articleReservation } from '../playbooks/seo-visibility/article-budget.ts';
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
import { NOT_REPORTED } from '../models/types.ts';
import { modelLabel } from '../models/written-by.ts';
import { localDayAt } from '../local-day.ts';
import {
  currentVenture, digest, exactPayload, formatMicros, formatVentureDate, identifier, isAppChannel, isoDate, listRecords, plainText, readVenture, ventureAction, type VentureTx,
} from '../records.ts';
import { QUOTE_TTL_MS, checkQuoteBinding } from './quote.ts';
import { newestFirst } from './shared.ts';
import { AGENT_ID, AGENT_PURPOSES, agentName } from '../views/shared.ts';
import type {
  DateOrder, Display, MicroString, ModelPriceTable, RupeeRate, SpendPolicyRecord, SpendPolicyView, SpendQuoteRecord, SpendRate, SpendRateUnit, SpendRecord, SpendRow,
  VentureDeps, VentureRecord,
  AgentCapView, LimitReachedView, SpendMeterView, WriteCapKind,
} from '../contracts.ts';
// Ink v2 wave 4 (4F2): the write caps' defaults and today's counts, the month's reset day in the owner's words.
import { WRITE_CAP_KINDS, WRITE_CAPS, writeCapsToday } from '../delivery/harness/write-caps.ts';
import { resetDay, shortDay } from '../delivery/failure-words.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { presetSpec } from '../models/presets.ts';
import type { ModelPresetId, ModelTier, RateCardLine } from '../contracts.ts';
// 4Z3: which currency leads spend.
import type { CountryProfile, CurrencyLead, SpendLead } from '../contracts.ts';

const MICROS = /^(0|[1-9][0-9]{0,14})$/;
const ITEM = /^(model|delegate|connector):[A-Za-z0-9_.-]{1,120}$/;
const UNITS: readonly SpendRateUnit[] = ['per-million-tokens', 'per-call', 'per-run-cap'];
const RATE_KEYS = ['item', 'unit', 'inputMicrosPerMillion', 'outputMicrosPerMillion', 'microsPerCall', 'source', 'checkedOn', 'confirmed', 'by',
  // Ink v2 wave 4 (4F2, M6): the prompt-cache read and write prices, each a line of its own on the card.
  'cacheReadMicrosPerMillion', 'cacheWriteMicrosPerMillion'] as const;
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
  const article = articleReservation(tx, request.ref);
  if (article && article.used + estimate > BigInt(article.cap)) throw new SpendRefusal('ARTICLE_SPEND_CAP', 'This call would pass the article AI limit. Review the article limit before starting more work.', subjectOf(request), request.estimateMicros);
  if (policy && policy.capMicros !== null) {
    const after = monthTotal(records, monthOf(tx.now)) + estimate;
    if (after > BigInt(policy.capMicros)) {
      throw new SpendRefusal('SPEND_CAP', `This could take this month's spend to ${formatMicros(String(after))}, past your limit of ${formatMicros(policy.capMicros)}. It was not run. Raise the limit or wait for next month.`,
        subjectOf(request), request.estimateMicros);
    }
  }
  // Ink v2 wave 4 (4F2): the day's cap on the owner's calendar, and the agent's own monthly limit (it alone pauses).
  if (policy) refuseOverLimits(tx, policy, records, request, estimate);
  const base = tx.base('venture-spend');
  const quoteId = policy && policy.askAboveMicros !== null && estimate > BigInt(policy.askAboveMicros)
    ? spendQuote(tx, request, policy.askAboveMicros, base.id) : null;
  const subject = subjectOf(request);
  return tx.put({
    ...base, ...(article ? {articleOrderId:article.orderId} : {}), key: subject.key, item: subject.item, label: subject.label, agent: subject.agent ?? null, connector: subject.connector ?? null,
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
export type PaidCallRequest = SpendSubject & { list: SpendRate | null; approvedRateDigest?: string };

/**
 * One paid connector call, start to finish: the charge record is committed before run() is called, run() makes the
 * call and says what was billed (null when the connector reports no figure), and the record is settled. If run()
 * throws, the money may have moved: the record stays held at the estimate and the same key is refused from then on.
 */
export async function paidCall<T>(deps: VentureDeps, ctx: Context, request: PaidCallRequest, run: () => Promise<{ value: T; billedMicros: MicroString | null }>): Promise<T> {
  const subject = subjectOf(request);
  await ventureAction(deps, ctx, 'prepare', 'spend.reserve', tx => {
    const rate = resolveRate({ item: subject.item, list: request.list, owner: ownerRates(tx.list('venture-spend-policy')), subject });
    check(request.approvedRateDigest===undefined||request.approvedRateDigest===digest(rate),'APPROVAL_STALE','The approved rate changed. Review a fresh quote before spending.');
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
const USD_RATE_FIELDS = [['inputUsdPerMillion', 'inputMicrosPerMillion'], ['outputUsdPerMillion', 'outputMicrosPerMillion'], ['usdPerCall', 'microsPerCall'],
  // Ink v2 wave 4 (4F2, M6): the prompt-cache prices.
  ['cacheReadUsdPerMillion', 'cacheReadMicrosPerMillion'], ['cacheWriteUsdPerMillion', 'cacheWriteMicrosPerMillion']] as const;

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
  // Ink v2 wave 4 (4F2, M6): prompt-cache prices go only on a rate per million tokens, and only when given.
  for (const name of ['cacheReadMicrosPerMillion', 'cacheWriteMicrosPerMillion'] as const) {
    if (body[name] === undefined || body[name] === null) continue;
    check(rate.unit === 'per-million-tokens', 'INVALID_VENTURE_REQUEST', 'Prompt-cache prices go on a rate per million tokens.');
    rate[name] = microsOrNull(body[name], 'A prompt-cache rate');
  }
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
  const body = exactPayload(payload, ['capMicros', 'askAboveMicros', 'rates', 'inrPerUsd', 'dailyCapMicros', 'alertPermille', 'agentCaps', 'writeCaps', 'currencyLead']);
  // 4Z3: which currency leads spend; left out, the choice already set is kept.
  const lead = body.currencyLead === undefined ? undefined : currencyLeadOf(body.currencyLead);
  // Ink v2 wave 4 (4F2): the day's cap, the alert share, each agent's own limit and the lower write caps.
  const limits = limitsOf(body);
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
      ...keptLimits(current, limits),
      // 4Z3: Auto is the default, so it is kept by leaving the field out.
      ...((lead ?? current?.currencyLead ?? 'auto') !== 'auto' ? { currencyLead: lead ?? current!.currencyLead! } : {}),
    } satisfies SpendPolicyRecord);
  });
}

// ---------------------------------------------------------------------------
// Rupees beside dollars, at the owner's own rate
// ---------------------------------------------------------------------------

/**
 * The owner's rupee rate and how the business writes dates: what puts a rupee figure beside a dollar one. leads (4Z3):
 * rupees lead the spend figures, by the owner's choice or, on Auto, because the business is in India.
 */
export type Rupees = { rate: RupeeRate; dateOrder: DateOrder; leads?: boolean };

/** 4Z3: the owner's choices of which currency leads spend. */
export const CURRENCY_LEADS: readonly CurrencyLead[] = Object.freeze(['auto', 'inr', 'usd']);

function currencyLeadOf(value: unknown): CurrencyLead {
  check(typeof value === 'string' && (CURRENCY_LEADS as readonly string[]).includes(value), 'INVALID_VENTURE_REQUEST',
    'Which currency leads is auto (by where your business is), inr (rupees first) or usd (dollars first).');
  return value as CurrencyLead;
}

/** 4Z3: whether rupees lead spend (when a rate is set): the owner's choice, or on Auto, a business in India. */
export function rupeesLead(choice: CurrencyLead, country: Pick<CountryProfile, 'code'>): boolean {
  return choice === 'inr' || (choice === 'auto' && country.code === 'IN');
}

/**
 * 4Z3: dollars for a lead figure, never more than two decimals: micro-dollars to cents in BigInt, a half cent up
 * ('USD 0.72'). A spend above zero that rounds to no cents reads 'under USD 0.01', never as nothing.
 */
export function dollarsLead(micros: MicroString): Display {
  const value = BigInt(micros);
  const cents = (value + 5_000n) / 10_000n;
  if (value > 0n && cents === 0n) return 'under USD 0.01';
  return `USD ${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

/**
 * 4Z3: a spend figure as the owner's currency leads it, with `words` the engine writes after the lead amount. Rupees
 * lead ('₹60.10') with 'USD 0.72 at ₹83.50 per $1' beneath; dollars lead ('USD 0.72') with '₹60.10 at ₹83.50 per $1'
 * beneath, or alone without a rate. The exact figure stays in the receipt.
 */
export function spendLead(micros: MicroString, rupees: Rupees | null, words = '', before = ''): SpendLead {
  const dollars = dollarsLead(micros);
  if (!rupees) return { currency: 'USD', figure: before + dollars + words };
  const rate = rupeeRateShort(rupees);
  const inr = rupeeFigure(micros, rupees);
  return rupees.leads
    ? { currency: 'INR', figure: before + inr + words, beside: `${dollars} at ${rate}`, other: dollars }
    : { currency: 'USD', figure: before + dollars + words, beside: `${inr} at ${rate}`, other: inr };
}

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

/** 4Z3: '₹83.50 per $1', the owner's rate without the day it was set, for a line that says it beside a figure. */
export function rupeeRateShort(rupees: Rupees): Display {
  const { whole, decimals } = rateParts(rupees.rate.perUsd);
  return `₹${whole.toLocaleString('en-IN')}.${decimals} per $1`;
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
  const policy = latestPolicy(listRecords(state, 'venture-spend-policy', venture.id));
  const rate = policy?.rupeeRate ?? null;
  return rate ? { rate, dateOrder: venture.country.dateOrder, leads: rupeesLead(policy?.currencyLead ?? 'auto', venture.country) } : null;
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

function policyView(policy: SpendPolicyRecord | null, dateOrder: DateOrder, country: Pick<CountryProfile, 'code'>): SpendPolicyView {
  const currencyLead = policy?.currencyLead ?? 'auto';
  const cap = policy?.capMicros ?? null, askFirst = policy?.askAboveMicros ?? null;
  const usd = (micros: MicroString | null) => (micros === null ? null : microsAsUsd(micros));
  const rupees: Rupees | null = policy?.rupeeRate ? { rate: policy.rupeeRate, dateOrder, leads: rupeesLead(currencyLead, country) } : null;
  const typed = rupees ? rateParts(rupees.rate.perUsd) : null;
  return {
    // 4Z3: the limit lines as the owner's currency leads them, the dollars to two decimals; absent with no limit.
    ...(cap !== null ? { capLead: spendLead(cap, rupees, POLICY_WORDS.perMonth) } : {}),
    ...(askFirst !== null ? { askFirstLead: spendLead(askFirst, rupees, '', POLICY_WORDS.asksAbove) } : {}),
    inrPerUsd: typed ? `${typed.whole}.${typed.decimals}` : null, rupeeRate: rupees ? rupeeRateWords(rupees) : null,
    ...(rupees && cap !== null ? { capRupees: rupeesBeside(cap, rupees)! } : {}),
    ...(rupees && askFirst !== null ? { askFirstRupees: rupeesBeside(askFirst, rupees)! } : {}),
    capMicros: cap, askFirstMicros: askFirst, capUsd: usd(cap), askFirstUsd: usd(askFirst),
    cap: cap === null ? POLICY_WORDS.noCap : formatMicros(cap) + POLICY_WORDS.perMonth,
    askFirst: askFirst === null ? POLICY_WORDS.neverAsks : POLICY_WORDS.asksAbove + formatMicros(askFirst),
    rates: (policy?.rates ?? []).map(rate => ({
      ...structuredClone(rate), price: ratePrice(rate),
      inputUsdPerMillion: usd(rate.inputMicrosPerMillion), outputUsdPerMillion: usd(rate.outputMicrosPerMillion), usdPerCall: usd(rate.microsPerCall),
      // 4F2 (M6): the prompt-cache prices as typed back, when the line has them.
      ...(rate.cacheReadMicrosPerMillion ? { cacheReadUsdPerMillion: usd(rate.cacheReadMicrosPerMillion) } : {}),
      ...(rate.cacheWriteMicrosPerMillion ? { cacheWriteUsdPerMillion: usd(rate.cacheWriteMicrosPerMillion) } : {}),
    })),
    setAt: policy?.at ?? null,
    // 4Z3: the owner's choice and what it means now: dollars lead without a rate, whatever the choice.
    currencyLead, leads: rupees && rupeesLead(currencyLead, country) ? 'INR' : 'USD',
  };
}

/**
 * venture.spend.policy.get {} (level read): the monthly limit, the ask-first figure and the owner's rate card; with
 * Ink v2 wave 4 (4F2) the day's cap, the alert share, the meter, the limit-reached options, each agent's own limit, the
 * daily write caps and the rate card's confirmed and list prices.
 */
export async function spendPolicyGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SpendPolicyView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const policy = latestPolicy(listRecords(state, 'venture-spend-policy', venture.id));
  return { ...policyView(policy, venture.country.dateOrder, venture.country), ...await limitsView(deps, ctx, state, venture, policy) };
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
  const body = exactPayload(payload, ['cap', 'askFirst', 'capUsd', 'askFirstUsd', 'rates', 'inrPerUsd', 'dailyCap', 'dailyCapUsd', 'alertPermille', 'agentCaps', 'writeCaps', 'currencyLead']);
  const cap = usdOrMicros(body, 'capUsd', 'cap', 'The monthly limit', 2);
  const askFirst = usdOrMicros(body, 'askFirstUsd', 'askFirst', 'The ask-first figure', 2);
  // Ink v2 wave 4 (4F2): the day's cap in US dollars too, each agent's limit in US dollars, the alert share, write caps.
  const dailyCap = usdOrMicros(body, 'dailyCapUsd', 'dailyCap', 'The daily limit', 2);
  const agentCaps = body.agentCaps === undefined ? undefined : agentCapsTyped(body.agentCaps);
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
    ...(dailyCap !== undefined ? { dailyCapMicros: dailyCap } : {}),
    ...(body.alertPermille !== undefined ? { alertPermille: body.alertPermille } : {}),
    ...(agentCaps !== undefined ? { agentCaps } : {}),
    ...(body.writeCaps !== undefined ? { writeCaps: body.writeCaps } : {}),
    ...(body.currencyLead !== undefined ? { currencyLead: body.currencyLead } : {}),
  });
  const { state, venture } = readVenture(deps, ctx);
  return { ...policyView(record, venture.country.dateOrder, venture.country), ...await limitsView(deps, ctx, state, venture, record) };
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

/**
 * Who answered a model call's spend row (H36), read from the call record the way spendAgentOf finds it: the model the
 * provider's answer named, in words ('Claude Sonnet 5.5', else the id as given), or 'not reported' when the answer named
 * none. Null for any other spend, and for a call that has not answered or whose record is not there: nothing is claimed.
 */
export function spendAnsweredBy(calls: ReadonlyMap<string, { answeredBy?: unknown }>, spend: { item: string; key: string }): Display | null {
  if (!spend.item.startsWith('model:') || !spend.key.startsWith('model:')) return null;
  const answeredBy = calls.get(spend.key.slice('model:'.length))?.answeredBy;
  if (typeof answeredBy !== 'string' || answeredBy.length === 0) return null;
  return answeredBy === NOT_REPORTED ? NOT_REPORTED : modelLabel(answeredBy);
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
  const parts = settledParts(record, unconfirmed);
  return parts ? formatMicros(parts.micros) + parts.words : undefined;
}

/** A settled figure's amount and the engine's words after it; undefined while the call has not settled. */
function settledParts(record: SpendRecord, unconfirmed: string): { micros: MicroString; words: string } | undefined {
  if (record.phase === 'released') return { micros: '0', words: SPEND_WORDS.notSent };
  if (record.phase !== 'settled' || record.settledMicros === null) return undefined;
  const micros = record.settledMicros;
  if (record.settledBy === 'bill') return { micros, words: '' };
  if (record.settledBy === 'tool-report') return { micros, words: SPEND_WORDS.toolReport };
  if (record.settledBy === 'reservation') return { micros, words: unconfirmed || SPEND_WORDS.estimate };
  return { micros, words: unconfirmed };
}

/**
 * One row as the Money place shows it. Every figure is formatted here; the UI never computes one. With the owner's
 * rupee rate, the reserved and settled figures come in rupees too, beside the dollars, with that rate. by: who answered
 * a model call (spendAnsweredBy), when it is known.
 */
export function spendRow(record: SpendRecord, agent: string | null = record.agent, rupees: Rupees | null = null, by: Display | null = null, payer: Display | null = null, dateOrder: DateOrder = 'day-month-year'): SpendRow {
  const honest = rowHonesty(record, payer, dateOrder);
  const unconfirmed = record.rate !== null && !record.rate.confirmed ? ESTIMATE_WORDS : '';
  const unpriced = record.phase === 'refused' && record.refusal?.code === 'SPEND_UNPRICED';
  const settled = settledDisplay(record, unconfirmed);
  const settledFigure = settledParts(record, unconfirmed);
  const settledMicros = record.phase === 'settled' ? record.settledMicros : null;
  return {
    id: record.id,
    ...(agent ? { agent } : {}),
    ...(by ? { by } : {}),
    ...(record.connector ? { connector: record.connector } : {}),
    label: record.phase === 'unknown' ? record.label + SPEND_WORDS.unknown : record.label,
    reserved: unpriced ? SPEND_WORDS.noPrice : formatMicros(record.reservedMicros) + unconfirmed,
    ...(rupees && !unpriced ? { reservedRupees: rupeesBeside(record.reservedMicros, rupees)! } : {}),
    ...(settled !== undefined ? { settled } : {}),
    ...(rupees && settledMicros !== null ? { settledRupees: rupeesBeside(settledMicros, rupees)! } : {}),
    // 4Z3: each figure as the owner's currency leads it.
    ...(!unpriced ? { reservedLead: spendLead(record.reservedMicros, rupees, unconfirmed) } : {}),
    ...(settledFigure ? { settledLead: spendLead(settledFigure.micros, rupees, settledFigure.words) } : {}),
    kind: rowKind(record),
    ...(record.phase === 'refused' ? { reason: refusalReason(record) } : {}),
    // 4F2 (M6, M7): how the cost is known, the price it was worked at with its date, and who pays.
    ...honest,
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
 * owner's rupee rate, every figure and the total come in rupees too, beside the dollars. A model call's row says who
 * answered it (by) once it has.
 */
export async function listSpend(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ rows: SpendRow[]; total: Display; totalRupees?: Display; totalLead: SpendLead }> {
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
  // The business's model calls by id, read once, for who answered each model row.
  const calls = new Map(listRecords(state, 'venture-model-call', venture.id).map(call => [call.id, call]));
  return {
    rows: records.slice(0, MAX_ROWS).map(record => spendRow(record, spendAgentOf(state, record), rupees, spendAnsweredBy(calls, record), payerOf(state, venture.id, record.payer), venture.country.dateOrder)),
    total: formatMicros(String(total)) + SPEND_WORDS.thisMonth + (estimated ? SPEND_WORDS.includesEstimates : ''),
    ...(rupees ? { totalRupees: rupeesBeside(String(total), rupees)! } : {}),
    // 4Z3: the month's total as the owner's currency leads it.
    totalLead: spendLead(String(total), rupees, SPEND_WORDS.thisMonth + (estimated ? SPEND_WORDS.includesEstimates : '')),
  };
}

// ---------------------------------------------------------------------------
// Ink v2 wave 4 (4F2): the day's cap, the alert share, each agent's own limit, the meter and budget pressure
// (catalogue M3, M4, M5). Limits stay in US dollars, with rupees beside them at the owner's rate. Every figure here
// is worked out in code; the meter's share comes with the sum receipt of this month's spend.
// ---------------------------------------------------------------------------

/** Today tells the owner once a month when spend reaches this share of the monthly limit, unless the owner sets another. */
export const DEFAULT_ALERT_PERMILLE = 800;
/** The day's cap (and a run's own cap, delivery/harness/breaker.ts) counts as nearly used from this share on. */
const PRESSURE_PERMILLE = 800n;
const MAX_AGENT_CAPS = 20;
const AGENT = /^[a-z][a-z0-9_-]{0,40}$/;
const LIMIT_WORDS = Object.freeze({
  noDaily: 'No daily limit', perDay: ' a day',
  usedUp: "This month's limit is used up",
  reached: "This month's AI limit is used up. Nothing more is spent until you raise it or the month ends.",
  agentGoesOn: 'Other work goes on. Raise its limit in Money to let it go on this month.',
});

type Limits = Partial<Pick<SpendPolicyRecord, 'dailyCapMicros' | 'alertPermille' | 'agentCaps' | 'writeCaps'>>;

/** The 4F2 limits a setSpendPolicy payload carries, checked: the day's cap, the alert share, agent limits, write caps. */
function limitsOf(body: Record<string, unknown>): Limits {
  const limits: Limits = {};
  if (body.dailyCapMicros !== undefined) limits.dailyCapMicros = microsOrNull(body.dailyCapMicros, 'The daily limit');
  if (body.alertPermille !== undefined) {
    const value = body.alertPermille;
    check(typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000, 'INVALID_VENTURE_REQUEST',
      'Say when to tell you as a share of the limit, from 1 to 1000 in a thousand (800 is 80%).');
    limits.alertPermille = value;
  }
  if (body.agentCaps !== undefined) {
    check(Array.isArray(body.agentCaps) && body.agentCaps.length <= MAX_AGENT_CAPS, 'INVALID_VENTURE_REQUEST', `Up to ${MAX_AGENT_CAPS} agents can have their own limit.`);
    limits.agentCaps = body.agentCaps.map(item => {
      const line = exactPayload(item, ['agent', 'capMicros'], ['agent', 'capMicros']);
      check(typeof line.agent === 'string' && AGENT.test(line.agent), 'INVALID_VENTURE_REQUEST', 'An agent limit names one agent of the team.');
      return { agent: line.agent, capMicros: microsOrNull(line.capMicros, "An agent's limit") ?? '0' };
    });
    check(new Set(limits.agentCaps.map(item => item.agent)).size === limits.agentCaps.length, 'INVALID_VENTURE_REQUEST', 'Each agent has one limit.');
  }
  if (body.writeCaps !== undefined) {
    const caps = body.writeCaps;
    check(caps !== null && typeof caps === 'object' && !Array.isArray(caps), 'INVALID_VENTURE_REQUEST', 'Write caps are drafts, books lines and messages, each a whole number.');
    const typed: Partial<Record<WriteCapKind, number>> = {};
    for (const [kind, value] of Object.entries(caps as Record<string, unknown>)) {
      check((WRITE_CAP_KINDS as readonly string[]).includes(kind), 'INVALID_VENTURE_REQUEST', 'Write caps are drafts, books lines and messages.');
      const most = WRITE_CAPS[kind as WriteCapKind];
      check(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= most, 'INVALID_VENTURE_REQUEST',
        `You can lower the ${kind.replace('-', ' ')} cap, from ${most} a day down to none, but not raise it.`);
      typed[kind as WriteCapKind] = value;
    }
    limits.writeCaps = typed;
  }
  return limits;
}

/** The limits a new policy record keeps: those given, else the ones in force. Write caps merge kind by kind. */
function keptLimits(current: SpendPolicyRecord | null, limits: Limits): Limits {
  const kept: Limits = {};
  const daily = limits.dailyCapMicros !== undefined ? limits.dailyCapMicros : current?.dailyCapMicros;
  if (daily !== undefined) kept.dailyCapMicros = daily;
  const alert = limits.alertPermille ?? current?.alertPermille;
  if (alert !== undefined) kept.alertPermille = alert;
  const agents = limits.agentCaps ?? current?.agentCaps;
  if (agents !== undefined) kept.agentCaps = structuredClone(agents);
  if (limits.writeCaps || current?.writeCaps) kept.writeCaps = { ...(current?.writeCaps ?? {}), ...(limits.writeCaps ?? {}) };
  return kept;
}

/** Agent limits as the owner types them, in US dollars (two decimals), turned into micro units. */
function agentCapsTyped(value: unknown): { agent: string; capMicros: MicroString }[] {
  check(Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'agentCaps is a list of one limit per agent.');
  return value.map(item => {
    const line = exactPayload(item, ['agent', 'capUsd'], ['agent', 'capUsd']);
    return { agent: line.agent as string, capMicros: usdToMicros(line.capUsd, { field: "An agent's limit", decimals: 2 }) };
  });
}

/** What a business spent or holds on one day of the owner's calendar. */
function dayTotal(records: readonly SpendRecord[], venture: Pick<VentureRecord, 'country'>, day: string): bigint {
  return records.reduce((total, record) => (localDayAt(record.at, venture.country) === day ? total + counted(record) : total), 0n);
}

/** What one agent spent or holds this month (UTC, as the monthly limit counts). */
function agentMonthTotal(state: State, records: readonly SpendRecord[], agent: string, month: string): bigint {
  return monthTotal(records.filter(record => spendAgentOf(state, record) === agent), month);
}

/** An agent's name in the owner's words: the delivery agent by the plan's service type; any other by its id. */
function agentNameOf(state: State, venture: VentureRecord, agent: string): Display {
  return agent === AGENT_ID ? agentName(state, venture) : agent;
}

/**
 * Inside reserveSpend: the day's cap (a call that would pass it is refused, SPEND_CAP, until tomorrow or a higher limit)
 * and the agent's own monthly limit (past it only that agent's calls are refused; every other call goes on).
 */
function refuseOverLimits(tx: VentureTx, policy: SpendPolicyRecord, records: readonly SpendRecord[], request: SpendReservation, estimate: bigint): void {
  const venture = tx.venture!;
  if (policy.dailyCapMicros !== undefined && policy.dailyCapMicros !== null) {
    const after = dayTotal(records, venture, localDayAt(tx.now, venture.country)) + estimate;
    if (after > BigInt(policy.dailyCapMicros)) {
      throw new SpendRefusal('SPEND_CAP', `This could take today's spend to ${formatMicros(String(after))}, past your daily limit of ${formatMicros(policy.dailyCapMicros)}. It was not run. Raise the limit or wait until tomorrow.`,
        subjectOf(request), request.estimateMicros);
    }
  }
  const agent = spendAgentOf(tx.state, request);
  const cap = agent ? (policy.agentCaps ?? []).find(item => item.agent === agent) : undefined;
  if (agent && cap && agentMonthTotal(tx.state, records, agent, monthOf(tx.now)) + estimate > BigInt(cap.capMicros)) {
    throw new SpendRefusal('SPEND_CAP', `${agentNameOf(tx.state, venture, agent)} reached its own monthly limit of ${formatMicros(cap.capMicros)}, so it is paused until you raise it or the month ends. Other work goes on.`,
      subjectOf(request), request.estimateMicros);
  }
}

/** A share in thousandths as a percentage: 790 is '79%', 755 is '75.5%'. */
const percentOf = (permille: bigint): string => `${permille / 10n}${permille % 10n === 0n ? '' : `.${permille % 10n}`}%`;
const alertOf = (policy: SpendPolicyRecord | null): number => policy?.alertPermille ?? DEFAULT_ALERT_PERMILLE;
/** The share of a cap used, in thousandths; a cap of nothing is used up. */
const permilleOf = (spent: bigint, cap: bigint): bigint => (cap > 0n ? (spent * 1000n) / cap : 1000n);

/**
 * Whether the business is near a spend limit now (M5): this month at its alert share, or today at 80% of the day's
 * cap. An act turn then says "Budget nearly used" and leaves optional steps out (delivery/harness/breaker.ts), and the
 * automatic judge does not run (delivery/judge-run.ts). month: true when it is this month's limit.
 */
export function budgetPressure(state: State, venture: Pick<VentureRecord, 'id' | 'country'>, nowIso: string): { nearlyUsed: boolean; month: boolean } {
  const policy = latestPolicy(listRecords(state, 'venture-spend-policy', venture.id));
  if (!policy) return { nearlyUsed: false, month: false };
  const records = listRecords(state, 'venture-spend', venture.id);
  const month = policy.capMicros !== null && permilleOf(monthTotal(records, monthOf(nowIso)), BigInt(policy.capMicros)) >= BigInt(alertOf(policy));
  const daily = policy.dailyCapMicros ?? null;
  const day = daily !== null && dayTotal(records, venture, localDayAt(nowIso, venture.country)) * 1000n >= BigInt(daily) * PRESSURE_PERMILLE;
  return { nearlyUsed: month || day, month };
}

/** The drafts an AI wrote for this business, newest first, with what each run cost (its turns, or its one call). */
function draftCosts(state: State, ventureId: string): { runId: string; micros: bigint }[] {
  const calls = new Map(listRecords(state, 'venture-model-call', ventureId).map(call => [call.id, call]));
  return listRecords(state, 'venture-delivery-run', ventureId)
    .filter(run => run.servedBy === 'model' && run.deliverable !== null)
    .map(run => {
      const cost = run.harness ? run.harness.used.costMicros : run.callId ? (calls.get(run.callId) as { costMicros?: unknown } | undefined)?.costMicros : null;
      return { runId: run.id, at: run.at, micros: typeof cost === 'string' && MICROS.test(cost) ? BigInt(cost) : 0n };
    })
    .filter(item => item.micros > 0n)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ runId, micros }) => ({ runId, micros }));
}

/**
 * "About 12 more drafts at today's cost": the room left under the month's limit (and today's, when set) divided by the
 * dearest of the last ten drafts' costs, so it leans to the expensive side (M7); labelled a projection.
 */
function projection(state: State, venture: VentureRecord, policy: SpendPolicyRecord, spent: bigint, nowIso: string): SpendMeterView['projection'] | undefined {
  const drafts = draftCosts(state, venture.id).slice(0, 10);
  if (!drafts.length || policy.capMicros === null) return undefined;
  let left = BigInt(policy.capMicros) - spent;
  if (policy.dailyCapMicros !== undefined && policy.dailyCapMicros !== null) {
    const day = BigInt(policy.dailyCapMicros) - dayTotal(listRecords(state, 'venture-spend', venture.id), venture, localDayAt(nowIso, venture.country));
    if (day < left) left = day;
  }
  if (left <= 0n) return undefined;
  const dearest = drafts.reduce((most, item) => (item.micros > most ? item.micros : most), 0n);
  const more = left / dearest;
  const rupees = rupeesOf(state, venture);
  return {
    line: `About ${more} more ${more === 1n ? 'draft' : 'drafts'} at today's cost`,
    label: `projection from your last ${drafts.length} ${drafts.length === 1 ? 'draft' : 'drafts'}`,
    runIds: drafts.map(item => item.runId),
    left: `${formatMicros(String(left))} left`, ...(rupees ? { leftRupees: rupeesBeside(String(left), rupees)! } : {}),
  };
}

/** The month's meter, with the sum receipt of this month's spend behind it; null without a monthly limit. */
async function spendMeter(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, policy: SpendPolicyRecord | null): Promise<SpendMeterView | null> {
  if (!policy || policy.capMicros === null) return null;
  const nowIso = deps.clock().toISOString();
  const { spentPlan, sumReceipt } = await import('./sums.ts');
  const receipt = await sumReceipt(deps, ctx, venture.id, spentPlan(state, venture, monthOf(nowIso)));
  const spent = BigInt(receipt.totalMinor);
  const cap = BigInt(policy.capMicros);
  const permille = permilleOf(spent, cap);
  const over = spent >= cap;
  const resetOn = resetDay(nowIso);
  const ahead = projection(state, venture, policy, spent, nowIso);
  return {
    usedPermille: parseInt(String(permille), 10), line: over ? LIMIT_WORDS.usedUp : `${percentOf(permille - (permille % 10n))} of this month's limit used`,
    near: permille >= BigInt(alertOf(policy)), over, receiptId: receipt.id, resetOn, reset: `Starts again on ${shortDay(resetOn, venture.country.dateOrder)}`,
    ...(ahead ? { projection: ahead } : {}),
  };
}

/** Each agent's own limit as the owner sees it, with what it spent this month and whether it is paused. */
function agentCapViews(state: State, venture: VentureRecord, policy: SpendPolicyRecord | null, nowIso: string): AgentCapView[] {
  const records = listRecords(state, 'venture-spend', venture.id);
  const rupees = rupeesOf(state, venture);
  return (policy?.agentCaps ?? []).map(item => {
    const used = agentMonthTotal(state, records, item.agent, monthOf(nowIso));
    return {
      agent: item.agent, name: agentNameOf(state, venture, item.agent), capMicros: item.capMicros, capUsd: microsAsUsd(item.capMicros),
      cap: `${formatMicros(item.capMicros)}${POLICY_WORDS.perMonth}`, used: formatMicros(String(used)), paused: used >= BigInt(item.capMicros),
      ...(rupees ? { capRupees: rupeesBeside(item.capMicros, rupees)!, usedRupees: rupeesBeside(String(used), rupees)! } : {}),
    };
  });
}

/**
 * Each connected key at its own monthly limit (the one set when it was connected, BUDGET_REACHED in the model port):
 * there, and only there, connecting another key is a way on. Counted the way the port counts it: this month's calls of
 * that AI at their cost, and those still out at their estimate.
 */
function keyLimits(state: State, venture: VentureRecord, nowIso: string): LimitReachedView[] {
  const month = monthOf(nowIso);
  const calls = listRecords(state, 'venture-model-call', venture.id) as { presetId: ModelPresetId; status: string; costMicros: string | null; estimatedMaxCostMicros: string; at: string }[];
  const reset = shortDay(resetDay(nowIso), venture.country.dateOrder);
  return listRecords(state, 'venture-model-connection', venture.id).filter(item => item.status === 'connected').flatMap(connection => {
    let spec: ReturnType<typeof presetSpec>;
    try { spec = presetSpec(connection.presetId); } catch { return []; }
    if (!spec.needsKey) return [];
    let used = 0n;
    for (const call of calls) {
      if (call.presetId !== connection.presetId) continue;
      if (call.status === 'dispatching') used += BigInt(call.estimatedMaxCostMicros);
      else if (call.costMicros !== null && monthOf(call.at) === month) used += BigInt(call.costMicros);
    }
    if (used < BigInt(connection.monthlyCapMicros)) return [];
    return [{
      scope: 'key' as const, presetId: connection.presetId,
      line: `${spec.label} reached its own monthly limit of ${formatMicros(connection.monthlyCapMicros)}. Nothing more goes to it until you raise that limit or the month ends.`,
      options: [{ id: 'raise' as const, label: 'Raise its limit' }, { id: 'connect' as const, label: 'Connect another key' }, { id: 'wait' as const, label: `Wait until ${reset}` }],
    }];
  });
}

/** The 4F2 part of the spend settings view: the day's cap, the alert share, the meter, agent limits and write caps. */
async function limitsView(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, policy: SpendPolicyRecord | null): Promise<Partial<SpendPolicyView>> {
  const nowIso = deps.clock().toISOString();
  const daily = policy?.dailyCapMicros ?? null;
  const rupees = rupeesOf(state, venture);
  const alert = alertOf(policy);
  const meter = await spendMeter(deps, ctx, state, venture, policy);
  // The business's own limit: raise it or wait. Another key would not help, so it is not offered (that is for a
  // key's own limit, keyLimits).
  const limitReached: LimitReachedView | undefined = meter?.over ? {
    scope: 'business', line: LIMIT_WORDS.reached,
    options: [{ id: 'raise', label: 'Raise the limit' }, { id: 'wait', label: `Wait until ${shortDay(meter.resetOn, venture.country.dateOrder)}` }],
  } : undefined;
  const keys = keyLimits(state, venture, nowIso);
  return {
    dailyCapMicros: daily, dailyCapUsd: daily === null ? null : microsAsUsd(daily), dailyCap: daily === null ? LIMIT_WORDS.noDaily : formatMicros(daily) + LIMIT_WORDS.perDay,
    ...(rupees && daily !== null ? { dailyCapRupees: rupeesBeside(daily, rupees)! } : {}),
    alertPermille: alert, alert: `Today tells you at ${percentOf(BigInt(alert))} of this month's limit.`,
    meter, ...(limitReached ? { limitReached } : {}), ...(keys.length ? { keyLimits: keys } : {}),
    agentCaps: agentCapViews(state, venture, policy, nowIso),
    writeCaps: writeCapsToday(state, venture, nowIso),
    card: rateCard(state, venture, policy),
  };
}

const notice = (subject: string, version: string, title: string, line: string, nowIso: string): W4RowItem => ({
  kind: 'notice', subject, version, createdAt: nowIso, title, line, actions: [{ id: 'later', label: 'Got it', primary: true }],
});

/**
 * Today's spend notices (delivery/run-control-rows.ts): once a month when this month's spend reaches the alert share
 * (the row's version is the month, so once seen it stays gone that month), and one per agent its own limit paused.
 */
export function spendRows(state: State, venture: VentureRecord, nowIso: string): W4RowItem[] {
  const policy = latestPolicy(listRecords(state, 'venture-spend-policy', venture.id));
  if (!policy) return [];
  const rows: W4RowItem[] = [];
  const month = monthOf(nowIso);
  const rupees = rupeesOf(state, venture);
  if (policy.capMicros !== null) {
    const spent = monthTotal(listRecords(state, 'venture-spend', venture.id), month);
    const permille = permilleOf(spent, BigInt(policy.capMicros));
    if (permille >= BigInt(alertOf(policy))) {
      const reset = shortDay(resetDay(nowIso), venture.country.dateOrder);
      const title = spent >= BigInt(policy.capMicros) ? "This month's AI limit is used up" : `${percentOf(permille - (permille % 10n))} of this month's AI limit is used`;
      // In US dollars, as providers bill, with rupees beside them at the owner's own rate.
      const inRupees = rupees ? `, ${rupeeFigure(String(spent), rupees)} of ${rupeeFigure(policy.capMicros, rupees)} at ${rupeeRateWords(rupees)}` : '';
      rows.push(notice('spend:alert', month, title, `${formatMicros(String(spent))} of ${formatMicros(policy.capMicros)}${inRupees}. It starts again on ${reset}.`, nowIso));
    }
  }
  for (const view of agentCapViews(state, venture, policy, nowIso)) {
    if (!view.paused) continue;
    const line = view.capRupees ? `${LIMIT_WORDS.agentGoesOn} Its limit is ${view.capRupees}.` : LIMIT_WORDS.agentGoesOn;
    rows.push(notice(`spend:agent:${view.agent}`, month, `${view.name} is paused: it reached its own monthly limit of ${formatMicros(view.capMicros)}`, line, nowIso));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ink v2 wave 4 (4F2): rate honesty and which wallet pays (catalogue M6, M7; M2's surviving part). Chausar sells no
// credits and charges nothing: the owner pays the AI company directly, and each own-key call keeps its usage row.
// ---------------------------------------------------------------------------

/** Who pays for a model preset's calls, in words: the owner's own key or plan; templates cost nothing here. */
export function payerWords(presetId: ModelPresetId): Display {
  const kind = presetSpec(presetId).kind;
  if (kind === 'anthropic-messages') return 'Paid by your Anthropic key';
  if (kind === 'openai-responses') return 'Paid by your OpenAI key';
  if (kind === 'claude-cli') return 'Paid by your Claude Code plan';
  if (kind === 'codex-cli') return 'Paid by your Codex plan';
  return 'Free on this computer';
}

/** Who pays for one spend row, from its payer: a model connection's key, the owner's own plan, or a connector account. */
function payerOf(state: State, ventureId: string, payer: string): Display | null {
  if (payer.startsWith('connection:')) {
    const id = payer.slice('connection:'.length);
    const connection = listRecords(state, 'venture-model-connection', ventureId).find(item => item.id === id);
    if (!connection) return null;
    try { return payerWords(connection.presetId); } catch { return null; }
  }
  if (payer.startsWith('plan:')) return `Paid by your own ${payer.slice('plan:'.length).replace(/-/g, ' ')} plan`;
  if (payer.startsWith('connector:')) return `Paid by your ${payer.slice('connector:'.length).replace(/-/g, ' ')} account`;
  return null;
}

/**
 * How a row's cost is known (M6): an estimate still held, reported by the provider (worked out from the use it
 * reported, at a confirmed price), billed, as the owner's own tool reported, not known, or nothing because it was not
 * sent. priced: the price the row was worked at, with that price's checked date (its snapshot when the call went).
 */
function rowHonesty(record: SpendRecord, payer: Display | null, dateOrder: DateOrder): Pick<SpendRow, 'basis' | 'priced' | 'payer'> {
  const confirmed = record.rate?.confirmed !== false;
  const basis = record.phase === 'reserved' ? 'Estimate: not settled yet'
    : record.phase === 'unknown' ? 'Not known: the answer never came'
      : record.phase === 'released' ? 'Nothing: it was not sent'
        : record.phase === 'refused' ? 'Not run'
          : record.settledBy === 'usage' ? (confirmed ? 'Worked out from the use the provider reported' : 'Estimate: the provider reported its use, at a price not confirmed')
            : record.settledBy === 'bill' ? 'Billed by the service'
              : record.settledBy === 'tool-report' ? (record.settledMicros === '0' ? 'Free on this computer: your own plan' : 'As your own tool reported, on your own plan')
                : 'Estimate: no figure came back';
  const rate = record.rate;
  let priced: Display | undefined;
  if (rate && record.phase !== 'refused') {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(rate.checkedOn) ? formatVentureDate(rate.checkedOn, dateOrder) : rate.checkedOn;
    priced = rate.by === 'owner' ? `At your rate, checked ${day}` : `At the list price, checked ${day}`;
  }
  return { basis, ...(priced ? { priced } : {}), ...(payer ? { payer } : {}) };
}

/** A rate's checked date in words, as the card shows it. */
function checkedWords(rate: SpendRate, dateOrder: DateOrder): Display {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(rate.checkedOn) ? formatVentureDate(rate.checkedOn, dateOrder) : rate.checkedOn;
  if (rate.by === 'owner') return rate.confirmed ? `Your rate, checked ${day}` : `Your rate, not confirmed (noted ${day})`;
  return `List price, checked ${day}`;
}

/** An item's name on the card: the model's own name, else the tool or connector it prices. */
function itemLabel(item: string): Display {
  if (item.startsWith('model:')) { try { return presetSpec(item.slice('model:'.length) as ModelPresetId).label; } catch { return item.slice('model:'.length); } }
  if (item.startsWith('delegate:')) return `Heavy work by ${item.slice('delegate:'.length).replace(/-/g, ' ')}`;
  return item.slice(item.indexOf(':') + 1).replace(/-/g, ' ');
}

/**
 * The rate card (M6): the owner's own lines, each confirmed with its source and date, and for each keyed AI connected
 * with no line of the owner's, Chausar's list price with the day it was checked. Prompt-cache reads and writes are
 * lines of their own.
 */
function rateCard(state: State, venture: VentureRecord, policy: SpendPolicyRecord | null): RateCardLine[] {
  const dateOrder = venture.country?.dateOrder ?? 'day-month-year';
  const owned = policy?.rates ?? [];
  const lines: RateCardLine[] = [];
  const add = (rate: SpendRate) => {
    const label = itemLabel(rate.item);
    const standing: RateCardLine['state'] = rate.by === 'owner' && rate.confirmed ? 'confirmed' : 'list';
    const base = { item: rate.item, state: standing, checked: checkedWords(rate, dateOrder), source: rate.source, ...(rate.confirmed ? {} : { unconfirmed: true }) };
    lines.push({ ...base, label, price: ratePrice(rate) });
    if (rate.cacheReadMicrosPerMillion) lines.push({ ...base, label: `${label}, prompt-cache reads`, price: `${formatMicros(rate.cacheReadMicrosPerMillion)} per million tokens` });
    if (rate.cacheWriteMicrosPerMillion) lines.push({ ...base, label: `${label}, prompt-cache writes`, price: `${formatMicros(rate.cacheWriteMicrosPerMillion)} per million tokens` });
  };
  for (const rate of owned) add(rate);
  const connected = listRecords(state, 'venture-model-connection', venture.id).filter(item => item.status === 'connected');
  for (const presetId of new Set(connected.map(item => item.presetId))) {
    const item = `model:${presetId}`;
    if (owned.some(rate => rate.item === item)) continue;
    let list: SpendRate | null = null;
    try { const spec = presetSpec(presetId); list = spec.needsKey ? listRateOfTable(item, spec.priceTable) : null; } catch { list = null; }
    if (list) add(list);
  }
  return lines;
}

/** The kinds of work a connection does, in the owner's words. */
const TIER_WORDS: Readonly<Record<ModelTier, string>> = Object.freeze({ fast: 'quick work', main: 'writing' });
const workWords = (tiers: readonly ModelTier[]) => tiers.map(tier => TIER_WORDS[tier]).join(' and ');

/**
 * After the owner connects a key or a tool (models/handlers.ts): when it takes over work an earlier connection did,
 * which one now pays for that work, in plain words; null when nothing overlaps. Routing picks the newest connection for
 * each kind of work and every preview names who pays, so a key is never picked silently (M7).
 */
export function payerChangeLine(earlier: readonly { presetId: ModelPresetId; tiers: readonly ModelTier[] }[], fresh: { tiers: readonly ModelTier[] }): Display | null {
  const others = earlier.filter(item => presetSpec(item.presetId).kind !== 'template' && item.tiers.some(tier => fresh.tiers.includes(tier)));
  if (!others.length) return null;
  const taken = (['fast', 'main'] as const).filter(tier => fresh.tiers.includes(tier) && others.some(item => item.tiers.includes(tier)));
  const left = [...new Set(others.flatMap(item => item.tiers.filter(tier => !fresh.tiers.includes(tier))))];
  const names = others.map(item => itemLabel(`model:${item.presetId}`)).join(' and ');
  const stays = left.length ? `stays connected for ${workWords(left)}` : 'stays connected and pays for nothing now';
  return `This key now pays for ${workWords(taken)}; the earlier ${others.length === 1 ? 'key' : 'keys'} (${names}) ${stays}.`;
}
