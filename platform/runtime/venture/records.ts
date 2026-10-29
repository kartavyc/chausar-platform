// Chausar venture launcher: shared record helpers, payload checks and text guards.
// Owned by package P0. Every venture package reads and writes its records through these helpers.
// Rule: a work() callback passed to ventureAction must never call store.update or any other
// service write (calculator, memory.append, ontology.publish, trust.updatePolicy, a ModelPort
// method); that rejects with REENTRANT_TRANSACTION.
import { audit, authorize, check, newId, type Context, type State, type StateStore } from '../contracts.ts';
import { digest } from '../actions.ts';
import { validDate } from '../memory.ts';
import { APP_ONLY_METHODS, VENTURE_EVENTS, VENTURE_RECORD_KINDS } from './contracts.ts';
import { confirmSeal, noteSealKeys, noteWrite, sealWrites } from './journal/chain.ts';
import type {
  AnyVentureRecord, DateOrder, IsoTime, Json, RecordBase, RecordOf, TermRecord, VentureDeps, VentureEventName, VentureEventRecord,
  VentureMethod, VentureRecord, VentureRecordKind,
} from './contracts.ts';

export const BOOKS_SOURCE_ID = 'chausar-books';
export const MAX_EVENTS = 500;
export const MAX_STORED_PAYLOAD = 65536;
export type Permission = 'read' | 'prepare' | 'approve' | 'admin';
export { digest };

const ID_PREFIX: Record<VentureRecordKind, string> = {
  'venture-record': 'venture', 'venture-interview': 'interview', 'venture-blueprint': 'blueprint', 'venture-term': 'term',
  'venture-model-connection': 'modelconn', 'venture-model-call': 'modelcall',
  'venture-price-receipt': 'price', 'venture-client': 'client', 'venture-order': 'order', 'venture-invoice': 'invoice', 'venture-payment': 'payment',
  'venture-brief': 'brief', 'venture-handoff': 'handoff', 'venture-build-follow': 'follow', 'venture-build-read': 'ghread',
  'venture-playbook': 'playbook', 'venture-simulation-run': 'simrun', 'venture-delivery-run': 'delivery', 'venture-signal': 'signal',
  'venture-event': 'vevent',
  'venture-upload': 'upload', 'venture-work-table': 'worktable', 'venture-work-receipt': 'work', 'venture-improvement-run': 'improve',
  'venture-delegate-run': 'delegaterun',
  'venture-spend': 'spend', 'venture-spend-quote': 'spendquote', 'venture-spend-policy': 'spendpolicy',
  'venture-composition': 'composition',
  'venture-open-posting-account': 'openaccount', 'venture-connector-post': 'post', 'venture-site-edit': 'siteedit',
  'venture-queue-decision': 'qdecision', 'venture-team-gate': 'teamgate',
  'venture-evidence': 'evidence',
  'venture-journal-entry': 'journal',
  'venture-agent-posture': 'agentposture', 'venture-spot-check': 'spotcheck',
  'venture-ca-firm': 'cafirm',
  'venture-bank-account': 'bankaccount', 'venture-bank-import': 'bankimport', 'venture-lead': 'lead', 'venture-lead-settings': 'leadsettings',
  'venture-sum-receipt': 'sum', 'venture-share-link': 'share',
  'venture-channel-hold': 'channelhold',
  'venture-screen-setting': 'screensetting', 'venture-untrusted-release': 'release',
  'venture-posting-steps': 'postingsteps', 'venture-bank-match': 'bankmatch', 'venture-posting-limits': 'postinglimits',
  'venture-judge-setting': 'judgesetting',
  'venture-transcription-setup': 'transcribesetup',
  // Ink v2 wave 4 (contracts.ts section 9e)
  'venture-keeper-run': 'keeperrun', 'venture-health-clear': 'healthclear',
  'venture-agent-message': 'agentmsg', 'venture-agent-proposal': 'agentprop', 'venture-chat-consent': 'chatconsent',
  'venture-agent-note': 'note', 'venture-agent-note-change': 'notechange',
  'venture-chief-thread': 'chiefthread', 'venture-chief-message': 'chiefmsg', 'venture-proposal': 'proposal',
  'venture-person': 'person', 'venture-network-import': 'netimport', 'venture-forgotten': 'forgotten',
  'venture-tie': 'tie', 'venture-network-search': 'netsearch',
  'venture-opportunity': 'opp', 'venture-pipeline-settings': 'pipesettings',
  'venture-outreach': 'outreach',
  'venture-mailbox': 'mailbox', 'venture-inbound': 'inbound', 'venture-calendar-feed': 'calfeed',
  'venture-away': 'away', 'venture-pause': 'pause', 'venture-write-allowance': 'writeallow',
  'venture-notification': 'notif', 'venture-notify-settings': 'notifysettings', 'venture-notify-digest': 'digest',
  'venture-push-subscription': 'pushsub',
  'venture-cli-check': 'clicheck',
  'venture-goal': 'goal',
  'venture-decision': 'decision',
  'venture-draft-edit': 'draftedit', 'venture-triage-rule': 'triagerule', 'venture-settings-draft': 'settingsdraft', 'venture-queue-view': 'queueview',
  'venture-bill': 'bill', 'venture-credit-note': 'creditnote', 'venture-recurring-invoice': 'recurring',
  'venture-connector-check': 'conncheck', 'venture-file-request': 'filerequest',
  'venture-owner-profile': 'owner',
  'venture-signing-key': 'signkey',
  'venture-journal-chain': 'jchain', 'venture-receipt-signature': 'receiptsig',
  'venture-order-contract': 'contract', 'venture-agent-relay': 'relay',
  'venture-routine': 'routine', 'venture-routine-run': 'routinerun',
  'venture-drill-run': 'drillrun',
  'venture-voice': 'voice', 'venture-persona': 'persona',
  'venture-knowledge': 'knowledge', 'venture-idea': 'idea',
  'venture-owner-offer': 'owneroffer',
  // Ink v2 wave 5 (package 5-0; contracts.ts section 9f)
  'venture-go-no-go': 'gonogo', 'venture-sales-proposal': 'salesprop', 'venture-brand-kit': 'brandkit', 'venture-asset': 'asset', 'venture-voice-consent': 'voiceconsent',
  'venture-report': 'report', 'venture-report-share': 'reportshare', 'venture-monitor': 'monitor', 'venture-local-app': 'localapp', 'venture-youtube-edit': 'ytedit',
  'venture-youtube-dictionary': 'ytdict', 'venture-youtube-style': 'ytstyle', 'venture-ca-citations': 'cacite', 'venture-ca-differential': 'cadiff',
  'venture-ca-data-pack': 'cadatapack', 'venture-ca-working':'cawork', 'venture-social-inbox-item': 'inboxitem', 'venture-social-scheduled': 'socialslot', 'venture-ad-ledger-entry': 'adledger', 'venture-influencer-case': 'influencer',
  'venture-seo-panel': 'seopanel', 'venture-seo-observation': 'seoobs', 'venture-seo-finding': 'seofinding', 'venture-seller-sku': 'sku',
  'venture-seller-feecard': 'feecard', 'venture-seller-stage': 'sellerstage', 'venture-seller-movement': 'movement', 'venture-seller-case': 'sellercase',
  'venture-support-ticket': 'ticket', 'venture-support-message': 'supportmsg', 'venture-support-request': 'supportreq', 'venture-support-rating': 'rating',
  'venture-recruit-role': 'recruitrole', 'venture-recruit-candidate': 'candidate', 'venture-recruit-touch': 'recruittouch', 'venture-recruit-interview': 'recruitinterview',
  'venture-career-fact': 'careerfact', 'venture-career-listing': 'listing', 'venture-career-thread': 'careerthread', 'venture-translation-job': 'tjob',
  'venture-translation-segment': 'tsegment', 'venture-glossary': 'glossary', 'venture-promise-to-pay': 'ptp', 'venture-collection-stage': 'collstage',
  'venture-books-posting': 'booksposting', 'venture-article-ledger': 'articleledger', 'venture-lead-source': 'leadsource', 'venture-newsletter-issue': 'nlissue',
  'venture-newsletter-contact': 'nlcontact', 'venture-tender-question': 'tenderq', 'venture-site-requirement': 'sitereq', 'venture-site-release': 'siterelease',
  'venture-narration-segment': 'narrseg', 'venture-room-brief': 'roombrief', 'venture-entry-record': 'entry', 'venture-test-finding': 'testfinding',
  'venture-dev-permission': 'devperm', 'venture-watch-source': 'watchsource', 'venture-call-log': 'calllog',
};

export function isVentureRecord(value: unknown): value is AnyVentureRecord {
  return !!value && typeof value === 'object' && (VENTURE_RECORD_KINDS as readonly string[]).includes((value as { kind?: unknown }).kind as string);
}

export function listRecords<K extends VentureRecordKind>(state: State, kind: K, ventureId?: string): RecordOf<K>[] {
  return state.conversations.filter(r => r?.kind === kind && (ventureId === undefined || r.ventureId === ventureId)) as RecordOf<K>[];
}

export function findRecord<K extends VentureRecordKind>(state: State, kind: K, id: string): RecordOf<K> | undefined {
  return listRecords(state, kind).find(r => r.id === id);
}

/** One venture per vault in this build. The latest venture record wins. */
export function currentVenture(state: State): VentureRecord | null {
  const all = listRecords(state, 'venture-record');
  return all.length ? all[all.length - 1] : null;
}

export function requireVenture(state: State): VentureRecord {
  const venture = currentVenture(state);
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  return venture;
}

/** A store view over a draft state, for authorize() inside an update callback. */
export function stateView(state: State, store: StateStore): StateStore {
  return { read: () => state, update: store.update.bind(store) };
}

/** Read-only access: authorizes, then returns a snapshot clone and the current venture. */
export function readVenture(deps: VentureDeps, ctx: Context): { state: State; venture: VentureRecord } {
  authorize(deps.store, ctx);
  const state = deps.store.read();
  return { state, venture: requireVenture(state) };
}

export type VentureTx = {
  readonly state: State;
  venture: VentureRecord | null;
  readonly now: IsoTime;
  readonly ctx: Context;
  base<K extends VentureRecordKind>(kind: K): RecordBase<K>;
  put<R extends AnyVentureRecord>(record: R): R;
  replace<R extends AnyVentureRecord>(record: R): R;
  find<K extends VentureRecordKind>(kind: K, id: string): RecordOf<K> | undefined;
  list<K extends VentureRecordKind>(kind: K): RecordOf<K>[];
  emit(name: VentureEventName, data?: Json): void;
  touch(patch: Partial<Omit<VentureRecord, 'id' | 'kind' | 'ventureId'>>): VentureRecord;
};

/** What a temporary business is told when it would issue an invoice or record a payment for real (4J23). */
export const TRIAL_MONEY_LINE = "A temporary business can't issue invoices or record payments for real. Add your email to keep this business, then you can.";
/** What it is told when it would publish or send from the server: a client share link, a file request, an alert address. */
export const TRIAL_SEND_LINE = "A temporary business can't share links or send alerts from this server. Add your email to keep this business, then you can.";
/** What it is told when a write would grow its vault past the trial's cap (held in the hosted vault store, runtime/business.ts). */
export const TRIAL_FULL_LINE = 'This temporary business is full. Add your email to keep it, then add more.';

/**
 * Ink v2 wave 4 (4J23): the records a temporary business on the hosted app never stores while it is one, with what it
 * is told. Real money: an issued invoice (numbered, or issued, part paid or paid), a payment, an issued credit note, a
 * bill with a payment on it. Publishing or sending from the server: a client share link, a client file request, a
 * bank account with an alert address. Drafts, bills to pay later, recurring schedules (which only make drafts), alert
 * rules that only show on Today and everything else are fine: null.
 */
export function trialRefusal(record: AnyVentureRecord): string | null {
  const value = record as { kind: string; status?: unknown; number?: unknown; payments?: unknown; paidMinor?: unknown; alertAddress?: unknown };
  switch (value.kind) {
    case 'venture-invoice': return (value.number !== null && value.number !== undefined) || ['issued', 'part-paid', 'paid'].includes(String(value.status)) ? TRIAL_MONEY_LINE : null;
    case 'venture-payment': return TRIAL_MONEY_LINE;
    case 'venture-credit-note': return value.status === 'issued' ? TRIAL_MONEY_LINE : null;
    case 'venture-bill': return (Array.isArray(value.payments) && value.payments.length > 0) || (value.paidMinor !== undefined && value.paidMinor !== '0') ? TRIAL_MONEY_LINE : null;
    case 'venture-share-link': case 'venture-file-request': case 'venture-report-share': return TRIAL_SEND_LINE;
    case 'venture-bank-account': return value.alertAddress ? TRIAL_SEND_LINE : null;
    default: return null;
  }
}

/** Refuses such a record while the business is temporary, whichever path writes it (deps.trial, asked only then). */
function refuseTrialRecord(deps: VentureDeps, record: AnyVentureRecord) {
  const line = trialRefusal(record);
  if (deps.trial && line) check(!deps.trial(), 'TRIAL_LIMIT', line);
}

/**
 * The venture actor's only write path. Authorizes, runs work() on the draft state, appends declared
 * events, audits, and commits once. A throw discards the whole draft.
 */
export async function ventureAction<T>(
  deps: VentureDeps, ctx: Context, level: Permission, name: string,
  work: (tx: VentureTx) => T | Promise<T>, options: { create?: boolean } = {},
): Promise<T> {
  authorize(deps.store, ctx, level);
  let committed: VentureEventRecord[] = [];
  let sealed = null as State | null;
  const outcome = await deps.store.update(async state => {
    authorize(stateView(state, deps.store), ctx, level);
    const now = deps.clock().toISOString();
    const venture = currentVenture(state);
    if (!options.create) check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const events: { name: VentureEventName; data: Json }[] = [];
    const tx: VentureTx = {
      state, venture, now, ctx,
      base<K extends VentureRecordKind>(kind: K): RecordBase<K> {
        const id = newId(ID_PREFIX[kind]);
        const ventureId = kind === 'venture-record' ? id : tx.venture?.id;
        check(ventureId, 'VENTURE_NOT_FOUND', 'Start a business first.');
        return { id, kind, ventureId, memberId: ctx.memberId, epoch: ctx.epoch, at: now };
      },
      put<R extends AnyVentureRecord>(record: R): R {
        check(isVentureRecord(record) && !state.conversations.some(r => r?.id === record.id), 'INVALID_VENTURE_REQUEST', 'This record already exists.');
        refuseTrialRecord(deps, record);
        const copy = structuredClone(record);
        state.conversations.push(copy);
        noteWrite(state, copy.id);
        if (copy.kind === 'venture-record') tx.venture = copy as VentureRecord;
        return structuredClone(copy);
      },
      replace<R extends AnyVentureRecord>(record: R): R {
        const index = state.conversations.findIndex(r => r?.id === record.id && r?.kind === record.kind);
        check(index >= 0, 'INVALID_VENTURE_REQUEST', 'This record no longer exists.');
        refuseTrialRecord(deps, record);
        const copy = structuredClone(record);
        const before = state.conversations[index];
        state.conversations[index] = copy;
        noteWrite(state, copy.id, before);
        if (copy.kind === 'venture-record') tx.venture = copy as VentureRecord;
        return structuredClone(copy);
      },
      find: (kind, id) => listRecords(state, kind, tx.venture?.id).find(r => r.id === id),
      list: kind => listRecords(state, kind, tx.venture?.id),
      emit(eventName: VentureEventName, data: Json = {}) {
        check((VENTURE_EVENTS as readonly string[]).includes(eventName), 'INVALID_VENTURE_REQUEST', 'Undeclared venture event.');
        events.push({ name: eventName, data });
      },
      touch(patch) {
        check(tx.venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
        return tx.replace({ ...tx.venture, ...patch, updatedAt: now });
      },
    };
    const opened = { list: state.conversations as unknown[], length: state.conversations.length };
    // 4J10: the keys the host derived from the vault's own key, for this transaction's checks and seals.
    noteSealKeys(state, deps);
    sealed = state;
    const result = await work(tx);
    // 4J10: the receipts written are signed and the journal items written are chained, in this same commit.
    sealWrites(state, tx.venture, ctx, now, opened);
    // Today's rows are read from these records, so the screens read the queue again: one queue.changed, after the rest.
    if (events.some(event => QUEUE_EVENTS.has(event.name)) && !events.some(event => event.name === 'queue.changed')) events.push({ name: 'queue.changed', data: {} });
    committed = tx.venture && events.length ? appendEvents(state, tx.venture.id, ctx, now, events) : [];
    audit(state, `venture.${name}`, { ventureId: tx.venture?.id ?? null, memberId: ctx.memberId });
    return structuredClone(result);
  });
  // 4J10: the commit landed, so a sound chain it sealed is remembered for the revision it made.
  if (sealed) confirmSeal(sealed);
  // Only after the commit: the desktop push and /api/events never announce a change that was rolled back.
  if (committed.length && deps.publish) {
    try { deps.publish(committed); } catch { /* The commit stands; a listener's failure is its own. */ }
  }
  return outcome;
}

/**
 * Events that change what Today's queue shows. Build events are left out: their tests pin them as the newest event,
 * and the connector rows they affect are read again on the next queue read.
 */
const QUEUE_EVENTS: ReadonlySet<VentureEventName> = new Set<VentureEventName>([
  'blueprint-drafted', 'blueprint-accepted', 'model-connected', 'model-disconnected', 'invoice-prepared', 'invoice-issued',
  'launch-stage-changed', 'handoff-opened', 'delivery-waiting', 'delivery-ready', 'delivery-reviewed', 'delivery-needs-answer',
  'delivery-brief-waiting', 'delegate-finished', 'run.started', 'run.waiting', 'run.done', 'run.failed',
]);

function appendEvents(state: State, ventureId: string, ctx: Context, at: IsoTime, events: { name: VentureEventName; data: Json }[]): VentureEventRecord[] {
  const existing = listRecords(state, 'venture-event', ventureId);
  let seq = existing.reduce((max, e) => Math.max(max, e.seq), 0);
  const added: VentureEventRecord[] = [];
  for (const event of events) {
    seq += 1;
    const record: VentureEventRecord = { id: newId('vevent'), kind: 'venture-event', ventureId, memberId: ctx.memberId, epoch: ctx.epoch, at, seq, name: event.name, data: event.data };
    state.conversations.push(record);
    added.push(structuredClone(record));
  }
  const all = listRecords(state, 'venture-event', ventureId);
  if (all.length > MAX_EVENTS) {
    const drop = new Set(all.sort((a, b) => a.seq - b.seq).slice(0, all.length - MAX_EVENTS).map(e => e.id));
    state.conversations = state.conversations.filter(r => !drop.has(r?.id));
  }
  return added;
}

/** Marks a proposed term active when evidence arrives. No-op when the term does not exist. */
export function activateTerm(tx: VentureTx, key: TermRecord['key'], evidence: { recordId: string; kind: VentureRecordKind }) {
  const term = tx.list('venture-term').find(t => t.key === key);
  if (!term) return;
  const next: TermRecord = { ...term, lifecycle: term.lifecycle === 'retired' ? 'retired' : 'active', evidence: [...term.evidence, { ...evidence, at: tx.now }].slice(-20) };
  tx.replace(next);
}

// ---------------------------------------------------------------------------
// Payload checks
// ---------------------------------------------------------------------------

/** Exact keys, plain-object prototype. Mirrors Engine.journalPayload. */
export function exactPayload(value: unknown, allowed: readonly string[], required: readonly string[] = [], code = 'INVALID_VENTURE_REQUEST'): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code, 'Send one request object.');
  const record = value as Record<string, unknown>;
  check(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)), code, 'Send the required fields and nothing else.');
  return record;
}

/** Trimmed plain text with bounds. Refuses control characters other than new line and tab. */
export function plainText(value: unknown, field: string, bounds: { min?: number; max?: number } = {}, code = 'INVALID_VENTURE_REQUEST'): string {
  const min = bounds.min ?? 1, max = bounds.max ?? 2000;
  check(typeof value === 'string', code, `${field} must be text.`);
  const text = value.replace(/\r\n/g, '\n').trim();
  check(text.length >= min && text.length <= max, code, `${field} must be between ${min} and ${max} characters.`);
  check(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text), code, `${field} contains characters Chausar cannot keep.`);
  return text;
}

/** One-line text (names and titles): plainText rules, and no new line, carriage return or tab. */
export function singleLine(value: unknown, field: string, bounds: { min?: number; max?: number } = {}, code = 'INVALID_VENTURE_REQUEST'): string {
  check(typeof value !== 'string' || !/[\n\r\t]/.test(value.trim()), code, `${field} must be one line.`);
  return plainText(value, field, bounds, code);
}

export function identifier(value: unknown, field: string, code = 'INVALID_VENTURE_REQUEST'): string {
  check(typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value), code, `${field} must be a known identifier.`);
  return value;
}

/** A real calendar date 'YYYY-MM-DD'. Out-of-range months and days refuse with the venture code, never a bare RangeError. */
export function isoDate(value: unknown, field: string, code = 'INVALID_VENTURE_REQUEST'): string {
  check(validDate(value), code, `${field} must be a date like 2026-10-15.`);
  return value;
}

export function smallInteger(value: unknown, field: string, min: number, max: number, code = 'INVALID_VENTURE_REQUEST'): number {
  check(Number.isInteger(value) && (value as number) >= min && (value as number) <= max, code, `${field} must be a whole number from ${min} to ${max}.`);
  return value as number;
}

/** Owner-typed amount text to minor units: strips spaces and thousands commas, then exact decimal parsing. */
export function amountText(value: unknown, field: string): string {
  check(typeof value === 'string' && value.length <= 40, 'INVALID_AMOUNT', `${field} must be an amount like 2499 or 2499.50.`);
  const cleaned = value.replace(/[\s,]/g, '');
  check(/^\d+(?:\.\d+)?$/.test(cleaned), 'INVALID_AMOUNT', `${field} must be a positive amount like 2499 or 2499.50.`);
  return cleaned;
}

/** Owner-typed percent text ('18', '8.25', '0.25 %') to basis points text. BigInt only; 0 to 100, at most two decimals. */
export {percentBps,bpsPercent} from './money/rate-core.ts';
import {percentBps,bpsPercent} from './money/rate-core.ts';

/**
 * Inside the app: the desktop window or the paired local browser (both 'desktop'), or a signed-in owner on the hosted
 * web app ('web'). Never phone or MCP, and never a request whose source text is tainted.
 */
import {isAppChannel} from '../portable.ts';
export {isAppChannel} from '../portable.ts';

/** Owner approvals happen inside the app, never phone or MCP. */
export function requireAppChannel(ctx: Context, method: VentureMethod) {
  if (!APP_ONLY_METHODS.includes(method)) return;
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-01' as '01 Oct 2026', 'Oct 01, 2026' or '2026-10-01', from the country's date order. No Date arithmetic. */
export function formatVentureDate(iso: string, order: DateOrder): string {
  check(validDate(iso), 'INVALID_VENTURE_REQUEST', 'Use a date like 2026-10-15.');
  const [year, month, day] = iso.split('-');
  const name = MONTHS[Number(month) - 1];
  if (order === 'day-month-year') return `${day} ${name} ${year}`;
  if (order === 'month-day-year') return `${name} ${day}, ${year}`;
  return iso;
}

// ---------------------------------------------------------------------------
// Text guards for model and template words
// ---------------------------------------------------------------------------

const MONEY_SIGN = /[\p{Sc}%]/u;
const MAGNITUDE = /\b(hundreds?|thousands?|lakhs?|crores?|millions?|billions?|percent|per cent)\b/i;
const TOKEN = /[\p{L}\p{Nd}]+(?:[-./'\u2019][\p{L}\p{Nd}]+)*/gu;
const HAS_DIGIT = /\p{Nd}/u;
const HAS_LETTER = /\p{L}/u;

const ALL_CAPITALS = /^\p{Lu}{2,5}$/u;
const OTHER_NUMBER = /[\p{No}\p{Nl}]/u;
/** The letters of a digit token that make it an amount rather than a name: currency codes, rupees and magnitudes. */
const MONEY_TOKEN_LETTERS: ReadonlySet<string> = new Set([
  'inr', 'gbp', 'usd', 'eur', 'aud', 'cad', 'sgd', 'aed', 'nzd', 'jpy', 'rs', 'k', 'mn', 'bn', 'cr', 'lakh', 'lakhs', 'crore', 'crores',
]);

/**
 * Tokens the AI may copy from the owner's own words, lower-cased: tokens that hold both a letter and a digit (B2B,
 * Web3, GPT-6, Q3), and all-capital tokens of two to five letters (CAD, SEO), so a currency code the owner wrote
 * ("CAD drawings") is not refused as money. The digit rule ignores tokens without a digit, so the second kind
 * changes nothing there.
 */
export function copiedTokens(...inputs: string[]): string[] {
  const found = new Set<string>();
  for (const input of inputs) {
    for (const match of input.matchAll(TOKEN)) {
      if ((HAS_DIGIT.test(match[0]) && HAS_LETTER.test(match[0])) || ALL_CAPITALS.test(match[0])) found.add(match[0].toLowerCase());
    }
  }
  return [...found].sort();
}

/**
 * Words with no numbers: template and engine words, and the delivery harness's words (modelWords numbers 'refuse'),
 * where every count and amount has a work receipt. Refuses currency signs, percent and magnitude words in any case,
 * and every token holding a digit (in any script) unless the token also holds a letter and is in allowed (copiedTokens).
 */
export function assertNoNumbers(value: string, field: string, allowed: readonly string[] = []) {
  const message = `The ${field} contained a number. Numbers come from Chausar's calculator, not the AI.`;
  check(!MONEY_SIGN.test(value) && !MAGNITUDE.test(value), 'MODEL_OUTPUT_REJECTED', message);
  // Number characters that are not digits: fractions such as one half, superscripts, circled and Roman numeral signs.
  check(!OTHER_NUMBER.test(value), 'MODEL_OUTPUT_REJECTED', message);
  for (const match of value.matchAll(TOKEN)) {
    if (!HAS_DIGIT.test(match[0])) continue;
    check(HAS_LETTER.test(match[0]) && allowed.includes(match[0].toLowerCase()), 'MODEL_OUTPUT_REJECTED', message);
    // A token copied from the owner may be a name (B2B, Web3), never an amount (15GBP, Rs500, 20k).
    check(!MONEY_TOKEN_LETTERS.has(match[0].toLowerCase().replace(/[^\p{L}]/gu, '')), 'MODEL_OUTPUT_REJECTED', message);
  }
}

// Numbers and money written as words (onboarding spec 6.5). One, first and once stay allowed ("one sentence",
// "your first client"); every other cardinal from two up, ordinal from second up, multiplier and currency name is
// refused, because numbers come only from Chausar's calculator.
const SPELLED_NUMBERS: ReadonlySet<string> = new Set([
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'twentieth',
  'dozen', 'dozens', 'half', 'halves', 'quarter', 'double', 'twice', 'triple',
  'pound', 'pounds', 'pence', 'penny', 'pennies', 'quid', 'dollar', 'dollars', 'buck', 'bucks', 'cent', 'cents', 'rupee', 'rupees',
  'paise', 'euro', 'euros', 'yen', 'dirham', 'dirhams', 'rand', 'franc', 'francs', 'peso', 'pesos',
  'free', 'discount', 'discounts', 'discounted',
  // Beyond the spec's list, the same rule: zero, the other ordinals, and money slang.
  'zero', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'thirtieth', 'fortieth',
  'fiftieth', 'hundredth', 'thousandth', 'quadruple', 'tenner', 'tenners', 'fiver', 'fivers',
]);
const CURRENCY_CODES: ReadonlySet<string> = new Set(['INR', 'GBP', 'USD', 'EUR', 'AUD', 'CAD', 'SGD', 'AED', 'NZD', 'JPY']);
const ALLOWED_COMPOUNDS: ReadonlySet<string> = new Set(['second-hand']);
const WORD = /[\p{L}\p{Nd}]+(?:[-'\u2019][\p{L}\p{Nd}]+)*/gu;

/**
 * The AI never writes numbers in words either: refuses spelled cardinals and ordinals (two upward, second upward),
 * multipliers (half, double, twice), currency names, upper-case currency codes the owner did not write, and price
 * words (free, discount). "stress-free" and "second-hand" pass; any other hyphenated compound with such a word is
 * refused ("two-day"). allowed comes from copiedTokens over the owner's own words.
 */
export function assertNoSpelledNumbers(value: string, field: string, allowed: readonly string[] = []) {
  const message = `The ${field} wrote a number or a price in words. Numbers come from Chausar's calculator, not the AI.`;
  for (const match of value.matchAll(WORD)) {
    const token = match[0];
    const lower = token.toLowerCase().replace(/\u2019/g, "'");
    if (ALLOWED_COMPOUNDS.has(lower)) continue;
    if (CURRENCY_CODES.has(token)) check(allowed.includes(lower), 'MODEL_OUTPUT_REJECTED', message);
    const parts = lower.split('-');
    parts.forEach((part, index) => {
      const word = part.replace(/'s$/, '').replace(/'$/, '');
      if (!SPELLED_NUMBERS.has(word)) return;
      if (word === 'free' && index > 0) return; // joined by a hyphen before it: stress-free, fee-free
      check(false, 'MODEL_OUTPUT_REJECTED', message);
    });
  }
}

// Model words and numbers (founder decision of 21 October 2026): the AI may write numbers. Chausar finds them, so the
// record that carries the words is marked estimate: true and never gets a receipt. An amount of money stays refused in
// model words: it would read as a price, tax or invoice figure, and those come only from Chausar's calculator.

/** Words that count or scale: cardinals from two, ordinals from second, multipliers and magnitudes. One and first are not numbers here. */
const COUNT_WORDS: ReadonlySet<string> = new Set([
  'zero', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
  'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth',
  'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth', 'thirtieth', 'fortieth', 'fiftieth', 'hundredth', 'thousandth',
  'dozen', 'dozens', 'half', 'halves', 'quarter', 'double', 'twice', 'triple', 'quadruple',
  'hundred', 'hundreds', 'thousand', 'thousands', 'lakh', 'lakhs', 'crore', 'crores', 'million', 'millions', 'billion', 'billions', 'percent',
]);
/** Currency codes and names. Next to a number they make an amount of money. */
const CURRENCY_WORDS: ReadonlySet<string> = new Set([
  'inr', 'gbp', 'usd', 'eur', 'aud', 'cad', 'sgd', 'aed', 'nzd', 'jpy', 'rs', 'pound', 'pounds', 'pence', 'penny', 'pennies', 'quid',
  'dollar', 'dollars', 'buck', 'bucks', 'cent', 'cents', 'rupee', 'rupees', 'paise', 'euro', 'euros', 'yen', 'dirham', 'dirhams', 'rand',
  'franc', 'francs', 'peso', 'pesos', 'grand',
]);
/** Words that are an amount of money on their own. */
const AMOUNT_WORDS: ReadonlySet<string> = new Set(['tenner', 'tenners', 'fiver', 'fivers']);
/** The letters of a digit token that make it a number rather than a name (20k, 2nd, 10am); B2B, GPT-6 and 3D stay names. */
const NUMBER_SUFFIXES: ReadonlySet<string> = new Set(['k', 'm', 'mn', 'bn', 'cr', 'lakh', 'lakhs', 'crore', 'crores', 'st', 'nd', 'rd', 'th', 'x', 'am', 'pm']);
const CURRENCY_SIGN = /\p{Sc}/u;

type WordToken = { raw: string; lower: string; digits: boolean; letters: string };

function tokensOf(value: string): WordToken[] {
  return [...value.matchAll(TOKEN)].map(match => {
    const lower = match[0].toLowerCase().replace(/’/g, "'");
    return { raw: match[0], lower, digits: HAS_DIGIT.test(lower), letters: lower.replace(/[^\p{L}]/gu, '') };
  });
}

function isNumberToken(token: WordToken | undefined, allowed: readonly string[]): boolean {
  if (!token || allowed.includes(token.lower)) return false;
  if (token.digits) return token.letters === '' || NUMBER_SUFFIXES.has(token.letters) || CURRENCY_WORDS.has(token.letters);
  if (ALLOWED_COMPOUNDS.has(token.lower)) return false;
  return token.lower.split('-').some(part => COUNT_WORDS.has(part.replace(/'s$/, '').replace(/'$/, '')));
}

/**
 * True when model words hold a number the owner did not write: digits in any script (not names such as B2B or GPT-6,
 * nor tokens copied from the owner), number characters, percent, or a number in words. The record carrying the words
 * is then marked estimate: true, never with a receipt.
 */
export function modelNumbers(value: string, allowed: readonly string[] = []): boolean {
  if (OTHER_NUMBER.test(value) || value.includes('%') || /\bper cent\b/i.test(value)) return true;
  return tokensOf(value).some(token => isNumberToken(token, allowed));
}

/**
 * Model words never state an amount of money: a currency sign, a currency code or name next to a number ("INR 500",
 * "500 rupees", "fifteen pounds"), a digit token with currency letters (Rs500, 15GBP, even copied from the owner),
 * slang amounts (a tenner), or a number before off or price ("20% off", "half price"). Prices, tax, invoice amounts
 * and books come only from Chausar's calculator. Currency codes the owner wrote (allowed: "CAD drawings") pass.
 */
export function assertNoMoney(value: string, field: string, allowed: readonly string[] = []) {
  const message = `The ${field} stated an amount of money. Prices, tax and invoice amounts come from Chausar's calculator, not the AI.`;
  check(!CURRENCY_SIGN.test(value), 'MODEL_OUTPUT_REJECTED', message);
  const tokens = tokensOf(value);
  const counted = (near: WordToken | undefined) => isNumberToken(near, allowed) || near?.lower === 'one';
  tokens.forEach((token, index) => {
    check(!(token.digits && CURRENCY_WORDS.has(token.letters)), 'MODEL_OUTPUT_REJECTED', message);
    if (allowed.includes(token.lower)) return;
    check(!AMOUNT_WORDS.has(token.lower), 'MODEL_OUTPUT_REJECTED', message);
    if (PRICE_AFTER.has(token.lower)) check(!isNumberToken(tokens[index - 1], allowed), 'MODEL_OUTPUT_REJECTED', message);
    if (token.digits || !CURRENCY_WORDS.has(token.lower)) return;
    check(!counted(tokens[index - 1]) && !counted(tokens[index + 1]), 'MODEL_OUTPUT_REJECTED', message);
  });
}

/** After a number these make a price: "20% off", "half price". */
const PRICE_AFTER: ReadonlySet<string> = new Set(['off', 'price', 'prices']);
/** Words that state a price without a number, and currency names. */
const PRICE_WORDS: ReadonlySet<string> = new Set([
  'free', 'discount', 'discounts', 'discounted', 'tenner', 'tenners', 'fiver', 'fivers',
  'pound', 'pounds', 'pence', 'penny', 'pennies', 'quid', 'dollar', 'dollars', 'buck', 'bucks', 'cent', 'cents', 'rupee', 'rupees',
  'paise', 'euro', 'euros', 'yen', 'dirham', 'dirhams', 'rand', 'franc', 'francs', 'peso', 'pesos',
]);

/**
 * Plan words sit beside the owner's prices, so they also keep out price words: upper-case currency codes and currency
 * names the owner did not write ("Priced in GBP", "paid in rupees"), free and discount. "stress-free" passes.
 */
export function assertNoPriceWords(value: string, field: string, allowed: readonly string[] = []) {
  const message = `The ${field} used a price word. Prices come from you and Chausar's calculator, not the AI.`;
  for (const token of tokensOf(value)) {
    if (token.digits || allowed.includes(token.lower) || ALLOWED_COMPOUNDS.has(token.lower)) continue;
    check(!CURRENCY_CODES.has(token.raw), 'MODEL_OUTPUT_REJECTED', message);
    token.lower.split('-').forEach((part, index) => {
      const word = part.replace(/'s$/, '').replace(/'$/, '');
      if (word === 'free' && index > 0) return; // joined by a hyphen before it: stress-free, fee-free
      check(!PRICE_WORDS.has(word), 'MODEL_OUTPUT_REJECTED', message);
    });
  }
}

/** House-style words, shown to people. Matching uses stems so every form is caught ('leveraging', 'delving', 'tapestries'). */
export const BANNED_WORDS = Object.freeze(['delve', 'leverage', 'robust', 'tapestry', 'underscore', 'testament']);
const BANNED_STEMS: readonly (readonly [string, string])[] = Object.freeze([
  ['delve', 'delv'], ['leverage', 'leverag'], ['robust', 'robust'], ['tapestry', 'tapestr'], ['underscore', 'underscor'], ['testament', 'testament'],
] as const);

/** House style: em dashes and AI-tell words. Returns findings (match is the base word); never rewrites silently. */
export function houseStyleFindings(value: string): { rule: 'em-dash' | 'banned-word'; match: string }[] {
  const findings: { rule: 'em-dash' | 'banned-word'; match: string }[] = [];
  if (value.includes('\u2014')) findings.push({ rule: 'em-dash', match: '\u2014' });
  for (const [word, stem] of BANNED_STEMS) if (new RegExp(`\\b${stem}\\w*`, 'i').test(value)) findings.push({ rule: 'banned-word', match: word });
  return findings;
}

const DONE_VERBS = 'matched|sorted|reviewed|checked|sent|filed|reconciled|posted|closed|completed|finished|prepared|uploaded|submitted|verified|analysed|analyzed|fixed|tidied|cleaned';
const DONE_PASSIVE_VERBS = 'matched|sorted|reviewed|checked|filed|reconciled|posted|closed|completed|finished|verified|tidied|cleaned';
const DONE_FIRST_PERSON = new RegExp(`\\b(?:we|i)(?:['\u2019]ve|\\s+have|\\s+has)?(?:\\s+(?:already|just|now|also|all))?\\s+(?:${DONE_VERBS})\\b`, 'i');
const DONE_PASSIVE = new RegExp(`\\b(?:is|are|was|were|has been|have been)(?:\\s+(?:now|already|all|fully))?\\s+(?:${DONE_PASSIVE_VERBS})\\b`, 'i');

/**
 * Phrases that claim finished work an agent in this build cannot have done: it only has the client's message.
 * 'We matched each entry', 'your books are reconciled'. Promises ('we will match') pass.
 */
export function doneClaimFindings(value: string): string[] {
  const found: string[] = [];
  for (const pattern of [DONE_FIRST_PERSON, DONE_PASSIVE]) {
    const match = pattern.exec(value);
    if (match) found.push(match[0]);
  }
  return found;
}

/** Every done-claim phrase in the text, in order, so each one can be checked against what the tools proved. */
export function doneClaimMatches(value: string): string[] {
  const found: { at: number; text: string }[] = [];
  for (const pattern of [DONE_FIRST_PERSON, DONE_PASSIVE]) {
    for (const match of value.matchAll(new RegExp(pattern.source, 'gi'))) found.push({ at: match.index ?? 0, text: match[0] });
  }
  return found.sort((a, b) => a.at - b.at).map(item => item.text);
}

/**
 * Words shown in the app: an em dash becomes a comma and spaces collapse. One line by default (new lines become
 * spaces); multiline keeps single new lines between non-empty lines.
 */
export function tidyWords(value: string, multiline = false): string {
  const dashless = value.replace(/\s*\u2014\s*/g, ', ');
  if (!multiline) return dashless.replace(/\s+/g, ' ').trim();
  return dashless.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(line => line.length > 0).join('\n');
}

const HIDDEN_CHARACTER = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/**
 * numbers 'refuse': words from the delivery harness, which works on the client's own files and books. There every
 * count and amount has a work receipt and reaches the words only by reference (w1.total), so a model number is refused.
 */
export type ModelWordsOptions = { allowed?: readonly string[]; multiline?: boolean; numbers?: 'refuse' };

/**
 * Model words: tidy, bounded, no amount of money, no line that starts a markdown heading. Other numbers pass; the
 * caller marks the record that carries them estimate: true (modelNumbers), never with a receipt.
 */
export function modelWords(value: unknown, field: string, max = 400, options: ModelWordsOptions = {}): string {
  check(typeof value === 'string', 'MODEL_OUTPUT_REJECTED', `The ${field} was not text.`);
  // Hidden characters (zero-width spaces, soft hyphens, controls) could split a word past the checks below
  // (a zero-width space inside "rupees" still shows as "rupees"), so model words never carry them.
  check(!HIDDEN_CHARACTER.test(value), 'MODEL_OUTPUT_REJECTED', `The ${field} held hidden characters. Chausar shows plain words only.`);
  const words = tidyWords(value, options.multiline === true);
  check(words.length >= 1 && words.length <= max, 'MODEL_OUTPUT_REJECTED', `The ${field} was empty or too long.`);
  check(!/^#/m.test(words), 'MODEL_OUTPUT_REJECTED', `The ${field} tried to start a heading.`);
  if (options.numbers === 'refuse') assertNoNumbers(words, field, options.allowed ?? []);
  else assertNoMoney(words, field, options.allowed ?? []);
  return words;
}

// ---------------------------------------------------------------------------
// Deterministic display of model costs (micro units)
// ---------------------------------------------------------------------------

/** 'USD 0.0042' from micros, rounded half up to four decimals. BigInt only. */
export function formatMicros(micros: string, currency = 'USD'): string {
  check(/^\d{1,30}$/.test(micros), 'INVALID_AMOUNT', 'Cost must be whole micro units.');
  const tenThousandths = (BigInt(micros) + 50n) / 100n;
  return `${currency} ${tenThousandths / 10000n}.${String(tenThousandths % 10000n).padStart(4, '0')}`;
}

export function sumMicros(values: string[]): string {
  return String(values.reduce((total, value) => total + BigInt(value), 0n));
}
