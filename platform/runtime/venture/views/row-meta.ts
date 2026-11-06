// Chausar venture launcher, views (Ink v2 wave 4, package 4J1): the meta every Today row carries (client, business and
// time, a real expiry, waiting long, "Sends to the client", attempts, counts against limits, the price beside Approve,
// the change count line). Package 4-0 put the hook here; views/queue.ts calls it after each row's digest is made.
//
// Everything here is read from records, never made up and never from a model: the client from the row's order, invoice,
// lead or card; an expiry only where the thing itself expires (a preview, a spend quote, a post proposal, a timed
// question); where an approval sends from its action's declared effect and connector; the attempt from the order's
// earlier runs; counts from the platform limits register; the price and every amount a row states with a receipt that
// venture.receipt.get serves (views/row-receipts.ts); a plan's change count by comparing the two versions in code.
// Meta is added after the digest, so time passing never makes a click stale, and a hook never changes an id or digest.
import type { State } from '../../contracts.ts';
import { currentVenture, findRecord, formatMicros, formatVentureDate, listRecords } from '../records.ts';
import type {
  BlueprintRecord, ConnectorPostRecord, DeliveryRunRecord, Display, EvidenceRecord, InvoiceRecord, IsoTime, ProposalRecord, QueueAmount,
  QueueCount, QueueRow, QueueRowMeta, QueueSendsTo, RoutineRunRecord, SpendQuoteRecord, VentureRecord,
} from '../contracts.ts';
import { ROUTINE_ANSWER_MS } from '../contracts.ts';
import { localDayAt } from '../local-day.ts';
import { QUOTE_TTL_MS } from '../money/quote.ts';
import { latestBlueprint } from '../money/shared.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { capWindow } from '../delivery/harness/loop.ts';
import { classifyEffects } from '../policy/effects.ts';
import { POSTING_CONNECTORS } from '../build/posting.ts';
import { CHANNEL_CAPABILITIES, SOCIAL_CHANNELS, type SocialChannel } from '../playbooks/social/channels.ts';
import { countCharacters, hashtagsOf } from '../playbooks/social/checks.ts';
import { MONEY_TEXT, offerPriceText, ROW_FIGURE } from './row-receipts.ts';
import { noticeAmounts } from './probe-figures.ts';

const DAY_MS = 24 * 60 * 60_000;
/** A draft this many whole days old or more is older than 14 days. */
const STALE_DRAFT_DAYS = 15;

export const META_WORDS = Object.freeze({
  yesterday: 'Waiting since yesterday',
  since: (day: string) => `Waiting since ${day}`,
  staleDraft: (days: number) => `This draft is ${days} days old. Check it still fits.`,
  nothingSpent: 'Nothing spent yet',
  free: 'Or use the built-in template, free',
  coverage: "This comparison doesn't cover wording changes.",
  nothingCounted: 'No prices, offers or steps changed',
});

/** What a row stands for: its id up to the last ':' (the version follows it). */
const subjectOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf(':')));
const versionOf = (id: string) => id.slice(id.lastIndexOf(':') + 1);

/** The records a row is about, read once per row. */
type Source = {
  run?: DeliveryRunRecord; quote?: SpendQuoteRecord; post?: ConnectorPostRecord; invoice?: InvoiceRecord; proposal?: ProposalRecord;
  routineRun?: RoutineRunRecord;
  client: string | null;
};

function own<R extends { ventureId: string }>(record: R | undefined, venture: VentureRecord): R | undefined {
  return record && record.ventureId === venture.id ? record : undefined;
}

function clientById(state: State, venture: VentureRecord, clientId: string | null | undefined): string | null {
  return (clientId ? own(findRecord(state, 'venture-client', clientId), venture)?.name : null) ?? null;
}

function clientOfOrder(state: State, venture: VentureRecord, orderId: string | null | undefined): string | null {
  const order = orderId ? own(findRecord(state, 'venture-order', orderId), venture) : undefined;
  return order ? clientById(state, venture, order.clientId) : null;
}

/** The row's records, from its subject: a run, a spot check, an invoice, a spend quote, a post, evidence, CA papers. */
function sourceOf(state: State, venture: VentureRecord, row: QueueRow): Source {
  const subject = subjectOf(row.id);
  const cut = subject.indexOf(':');
  const head = cut < 0 ? subject : subject.slice(0, cut);
  const id = cut < 0 ? '' : subject.slice(cut + 1);
  if (head === 'run' || head === 'runctl') {
    const run = own(findRecord(state, 'venture-delivery-run', id), venture);
    return { ...(run ? { run } : {}), client: clientOfOrder(state, venture, run?.orderId) };
  }
  if (head === 'spot') {
    const spot = own(findRecord(state, 'venture-spot-check', id), venture);
    const run = spot ? own(findRecord(state, 'venture-delivery-run', spot.runId), venture) : undefined;
    return { client: clientOfOrder(state, venture, run?.orderId) };
  }
  if (head === 'invoice') {
    const invoice = own(findRecord(state, 'venture-invoice', id), venture);
    return { ...(invoice ? { invoice } : {}), client: clientById(state, venture, invoice?.clientId) };
  }
  if (head === 'spend-quote') {
    const quote = own(findRecord(state, 'venture-spend-quote', id), venture);
    return { ...(quote ? { quote } : {}), client: null };
  }
  if (head === 'post') {
    const post = own(findRecord(state, 'venture-connector-post', id), venture);
    const draft = post?.draftId ? own(findRecord(state, 'venture-delivery-run', post.draftId), venture) : undefined;
    return { ...(post ? { post } : {}), client: clientOfOrder(state, venture, draft?.orderId) };
  }
  if (head === 'evidence') {
    const record = own(findRecord(state, 'venture-evidence', id), venture) as EvidenceRecord | undefined;
    const clientId = record?.subject.startsWith('client:') ? record.subject.slice('client:'.length) : null;
    return { client: clientById(state, venture, clientId) };
  }
  if (head === 'ca-signoff') {
    const request = own(findRecord(state, 'venture-ca-firm', id), venture) as { clientName?: unknown } | undefined;
    return { client: typeof request?.clientName === 'string' && request.clientName ? request.clientName : null };
  }
  if (head === 'proposal') {
    const proposal = own(findRecord(state, 'venture-proposal', id), venture);
    return { ...(proposal ? { proposal } : {}), client: null };
  }
  // 4J13: a routine's parked run (agents/routine-runner.ts).
  if (head === 'routine') {
    const routineRun = own(findRecord(state, 'venture-routine-run', id), venture);
    return { ...(routineRun ? { routineRun } : {}), client: null };
  }
  // A follow-up row is about one person on the pipeline (4E1); its card names them.
  return { client: row.followup?.name ?? null };
}

/** Only a real expiry: the preview's, the spend quote's hour, a post proposal's, or a timed question's (4J13). */
function expiryOf(row: QueueRow, source: Source): IsoTime | undefined {
  const run = source.run;
  if (run && row.kind === 'quote' && run.preview) return run.preview.expiresAt;
  if (run && row.kind === 'question' && run.harness) {
    const open = [...run.harness.handoffs].reverse().find(handoff => handoff.answer === null) as { expiresAt?: unknown } | undefined;
    if (typeof open?.expiresAt === 'string' && !Number.isNaN(Date.parse(open.expiresAt))) return open.expiresAt;
  }
  if (source.quote) return new Date(Date.parse(source.quote.at) + QUOTE_TTL_MS).toISOString();
  if (source.post?.expiresAt) return source.post.expiresAt;
  // 4J13: a routine's run waits 24 hours for the owner from when it parked, then counts as no.
  if (source.routineRun) return new Date(Date.parse(source.routineRun.at) + ROUTINE_ANSWER_MS).toISOString();
  return undefined;
}

/** Whole days from one calendar day to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

/** "Waiting since yesterday" once a row has waited 24 hours, then the day it started, on the owner's calendar. */
function waitingWords(venture: VentureRecord | null, at: IsoTime, now: IsoTime): Display | undefined {
  if (!venture || Date.parse(now) - Date.parse(at) < DAY_MS) return undefined;
  // A business with no country yet counts days in UTC and writes dates day first.
  const country = venture.country ?? null;
  const dayOf = (instant: IsoTime) => (country ? localDayAt(instant, country) : instant.slice(0, 10));
  const then = dayOf(at);
  return daysBetween(then, dayOf(now)) <= 1 ? META_WORDS.yesterday : META_WORDS.since(formatVentureDate(then, country?.dateOrder ?? 'day-month-year'));
}

function metaOf(venture: VentureRecord | null, row: QueueRow, source: Source, now: IsoTime): QueueRowMeta {
  const expiresAt = expiryOf(row, source);
  const waitingLong = row.kind === 'locked' ? undefined : waitingWords(venture, row.createdAt, now);
  const days = Math.floor((Date.parse(now) - Date.parse(row.createdAt)) / DAY_MS);
  return {
    client: source.client, business: row.businessName, at: row.createdAt,
    ...(expiresAt ? { expiresAt } : {}), ...(waitingLong ? { waitingLong } : {}),
    ...(row.viewRef?.kind === 'draft' && days >= STALE_DRAFT_DAYS ? { staleDraft: META_WORDS.staleDraft(days) } : {}),
    // 4J16 (Q4): the quotes code moved on this draft, beside Approve, so the owner sees them before approving.
    ...(source.run?.deliverable?.quoteFixes?.length ? { quoteFixes: [...source.run.deliverable.quoteFixes] } : {}),
  };
}

/**
 * Where approving the row sends something, from its action's declared effect and connector: a post goes to the public
 * through a posting connector; a proposal that sends goes to the client. A row that sends nothing has none: a turn
 * sent to the owner's own AI and a draft the owner sends themselves leave nothing to a client from Chausar.
 */
function sendsToOf(source: Source): QueueSendsTo | undefined {
  if (source.post) {
    const effects = classifyEffects({ name: 'connector.post', connector: source.post.connectorId }).effects;
    return effects.includes('send') && POSTING_CONNECTORS.includes(source.post.connectorId) ? 'public' : undefined;
  }
  if (source.proposal?.sends) return 'client';
  return undefined;
}

/** Why a run stopped, in the same words Today's row uses (views/queue.ts runError). */
function runErrorOf(state: State, run: DeliveryRunRecord): string {
  const call = run.callId ? state.conversations.find((record: { id?: unknown } | null) => record?.id === run.callId) as { error?: { message?: unknown } | null } | undefined : undefined;
  return typeof call?.error?.message === 'string' ? call.error.message : run.harness?.stopReason ?? 'This run stopped before it finished. Nothing was sent to the client.';
}

/** On a Run again row: which attempt this was (the order's runs so far) and its last error, when there was one. */
function attemptOf(state: State, venture: VentureRecord, row: QueueRow, source: Source): QueueRow['attempt'] | undefined {
  const run = source.run;
  if (!run || !row.actions.some(action => action.id === 'run-again')) return undefined;
  const n = listRecords(state, 'venture-delivery-run', venture.id).filter(item => item.orderId === run.orderId && item.at <= run.at).length;
  const lastError = run.status === 'failed' ? runErrorOf(state, run) : run.status === 'stopped' ? run.harness?.breaker?.error ?? null : null;
  return { n: Math.max(1, n), lastError };
}

/** The social channel a posting connector posts to, for the limits register. YouTube's text is a title and a description, so it is left out. */
function channelOf(connectorId: string): SocialChannel | null {
  return SOCIAL_CHANNELS.find(id => id !== 'youtube-shorts' && CHANNEL_CAPABILITIES[id].connectorId === connectorId) ?? null;
}

/** A post row's counts against the platform's limits: characters as the platform counts them, and hashtags where capped. */
function countsOf(source: Source): QueueCount[] | undefined {
  const post = source.post;
  const channel = post ? channelOf(post.connectorId) : null;
  if (!post || !channel) return undefined;
  const limits = CHANNEL_CAPABILITIES[channel];
  const counts: QueueCount[] = [{ label: 'Characters', count: countCharacters(post.text, channel), limit: limits.maxChars }];
  if (limits.maxHashtags !== null) counts.push({ label: 'Hashtags', count: hashtagsOf(post.text).length, limit: limits.maxHashtags });
  return counts;
}

/** A spend row's price and the receipt behind it; lineReceiptId backs the amounts the row's line states, if any. */
type Priced = { price: NonNullable<QueueRow['price']>; receiptId: string; lineReceiptId?: string };

/** The price beside Approve on a spend row, with its receipt: a turn to the owner's AI, more room at a cap, a spend quote. */
function priceOf(row: QueueRow, source: Source): Priced | undefined {
  if (row.kind !== 'quote') return undefined;
  const version = versionOf(row.id);
  const run = source.run;
  if (run?.preview && version.startsWith('send-')) {
    const receiptId = ROW_FIGURE.cost(run.id, run.preview.callId);
    // The line's only amount is the judge's bound (judge-run.ts judgeNotice). A template outline is always there instead
    // of the AI: venture.delivery.run with useTemplate, with nothing to pay.
    return { receiptId, lineReceiptId: ROW_FIGURE.judge(run.id, run.preview.callId), price: { display: run.preview.estimatedMaxCostDisplay, receiptId, line: META_WORDS.nothingSpent, free: META_WORDS.free } };
  }
  if (run?.preview && run.harness && version.startsWith('cap-')) {
    const window = capWindow(run.harness, run.preview.estimatedMaxCostMicros);
    if (window === null) return undefined;
    const receiptId = ROW_FIGURE.room(run.id, run.preview.callId);
    return { receiptId, lineReceiptId: receiptId, price: { display: formatMicros(window), receiptId, line: META_WORDS.nothingSpent } };
  }
  if (source.quote) {
    const receiptId = ROW_FIGURE.quote(source.quote.id);
    return { receiptId, price: { display: source.quote.figure, receiptId, line: META_WORDS.nothingSpent } };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The change count on plan rows
// ---------------------------------------------------------------------------

const many = (count: number, one: string, more: string) => `${count} ${count === 1 ? one : more}`;
type Named = { id: string; name: string };

/**
 * The newest plan version compared with the one in use, in code: prices changed, and offers and steps added or removed,
 * by their ids. Words are not compared, and the coverage line says so. Null when there is nothing to compare with.
 */
export function planChangeCount(state: State, venture: VentureRecord): { draft: BlueprintRecord; count: NonNullable<QueueRow['changeCount']> } | null {
  const accepted = acceptedBlueprintOrNull(state, venture);
  const draft = latestBlueprint(listRecords(state, 'venture-blueprint', venture.id));
  if (!accepted || !draft || draft.status !== 'draft' || draft.id === accepted.id) return null;
  const currency = draft.backOffice.currency;
  const parts: string[] = [];
  const details: Display[] = [];
  const priced = draft.offers.filter(offer => {
    const before = accepted.offers.find(item => item.id === offer.id);
    return before !== undefined && before.pricing.unitPriceMinor !== offer.pricing.unitPriceMinor;
  });
  if (priced.length) parts.push(many(priced.length, 'price changed', 'prices changed'));
  for (const offer of priced) details.push(`${offer.name.value}: ${offerPriceText(accepted.offers.find(item => item.id === offer.id), currency)} to ${offerPriceText(offer, currency)}`);
  const lists: [string, string, Named[], Named[]][] = [
    ['offer', 'offers', accepted.offers.map(offer => ({ id: offer.id, name: offer.name.value })), draft.offers.map(offer => ({ id: offer.id, name: offer.name.value }))],
    ['step', 'steps', accepted.deliverySteps.map(step => ({ id: step.id, name: step.title.value })), draft.deliverySteps.map(step => ({ id: step.id, name: step.title.value }))],
  ];
  for (const [one, more, before, after] of lists) {
    const added = after.filter(item => !before.some(old => old.id === item.id));
    const removed = before.filter(item => !after.some(now => now.id === item.id));
    if (added.length) parts.push(many(added.length, `${one} added`, `${more} added`));
    if (removed.length) parts.push(many(removed.length, `${one} removed`, `${more} removed`));
    const word = one.charAt(0).toUpperCase() + one.slice(1);
    for (const item of added) details.push(`${word} added: ${item.name}`);
    for (const item of removed) details.push(`${word} removed: ${item.name}`);
  }
  return { draft, count: { line: parts.length ? parts.join(' · ') : META_WORDS.nothingCounted, details, coverage: META_WORDS.coverage } };
}

// ---------------------------------------------------------------------------
// Amounts with their proof
// ---------------------------------------------------------------------------

type Proof = { receiptId: string } | { estimate: true };

/** Each money text in one field, at its own place, with the proof given; nothing when there is no proof to give. */
function proveIn(amounts: QueueAmount[], where: QueueAmount['where'], text: string | undefined, proof: Proof | null, index?: number): void {
  if (!proof || !text) return;
  for (const match of text.matchAll(MONEY_TEXT)) {
    amounts.push({ text: match[0], where, ...(index === undefined ? {} : { index }), start: match.index, length: match[0].length, ...proof } as QueueAmount);
  }
}

/**
 * Each amount the row states, at its place, with the receipt that backs it: the judge's bound in a send row's line, the
 * most a call can cost, the room at a cap, a spend quote, an invoice total, a plan's prices, this month's spend on 4F2's
 * spend notice. On a model-inferred value only the new value is the model's, so only it carries the estimate label; the
 * value it would replace is the stored one. An amount no receipt backs is left out, never given a made-up proof.
 */
function amountsOf(row: QueueRow, priced: Priced | undefined, plan: ReturnType<typeof planChangeCount>, changeCount: QueueRow['changeCount']): QueueAmount[] {
  const amounts: QueueAmount[] = [];
  const change = row.change;
  const planProof = plan ? { receiptId: ROW_FIGURE.plan(plan.draft.id) } : null;
  if (priced) {
    proveIn(amounts, 'line', row.line, priced.lineReceiptId ? { receiptId: priced.lineReceiptId } : null);
    proveIn(amounts, 'change.before', change?.before, { receiptId: priced.receiptId });
    proveIn(amounts, 'change.after', change?.after, { receiptId: priced.receiptId });
    proveIn(amounts, 'price', priced.price.display, { receiptId: priced.receiptId });
  } else if (change?.estimate) {
    proveIn(amounts, 'change.after', change.after, { estimate: true });
  } else if (change?.receiptId) {
    proveIn(amounts, 'change.before', change.before, { receiptId: change.receiptId });
    proveIn(amounts, 'change.after', change.after, { receiptId: change.receiptId });
  } else if (changeCount) {
    proveIn(amounts, 'change.before', change?.before, planProof);
    proveIn(amounts, 'change.after', change?.after, planProof);
  }
  (changeCount?.details ?? []).forEach((detail, index) => proveIn(amounts, 'details', detail, planProof, index));
  // 4F2's spend notice (money/spend.ts spendRows): this month's spend against the limit, in rupees too at the owner's rate.
  if (subjectOf(row.id) === 'spend:alert') proveIn(amounts, 'line', row.line, { receiptId: ROW_FIGURE.spend(versionOf(row.id)) });
  amounts.push(...noticeAmounts(row)); // 4G2: a probe notice's amounts, each with its own receipt (probe-figures.ts)
  return amounts;
}

/**
 * Adds meta to Today's rows. It keeps every row, in the same order, with the same id and digest, and adds only fields
 * with a real source: meta on every row; sendsTo, attempt, counts, price, changeCount and amounts where they apply.
 */
export function withMeta(state: State, rows: QueueRow[], now: IsoTime): QueueRow[] {
  const venture = currentVenture(state);
  const plan = venture ? planChangeCount(state, venture) : null;
  return rows.map(row => {
    const source: Source = venture && row.kind !== 'locked' ? sourceOf(state, venture, row) : { client: null };
    const sendsTo = sendsToOf(source);
    const attempt = venture ? attemptOf(state, venture, row, source) : undefined;
    const counts = countsOf(source);
    const priced = priceOf(row, source);
    const changeCount = plan && subjectOf(row.id).startsWith('plan:') && (row.kind === 'plan' || row.kind === 'price') ? plan.count : undefined;
    const amounts = amountsOf(row, priced, plan, changeCount);
    return {
      ...row, meta: metaOf(venture, row, source, now),
      ...(sendsTo ? { sendsTo } : {}), ...(attempt ? { attempt } : {}), ...(counts ? { counts } : {}),
      ...(priced ? { price: priced.price } : {}), ...(changeCount ? { changeCount } : {}), ...(amounts.length ? { amounts } : {}),
    };
  });
}
