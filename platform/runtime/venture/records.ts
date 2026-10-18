// Chausar venture launcher: shared record helpers, payload checks and text guards.
// Owned by package P0. Every venture package reads and writes its records through these helpers.
// Rule: a work() callback passed to ventureAction must never call store.update or any other
// service write (calculator, memory.append, ontology.publish, trust.updatePolicy, a ModelPort
// method); that rejects with REENTRANT_TRANSACTION.
import { audit, authorize, check, newId, type Context, type State, type StateStore } from '../contracts.ts';
import { digest } from '../actions.ts';
import { validDate } from '../memory.ts';
import { APP_ONLY_METHODS, VENTURE_EVENTS, VENTURE_RECORD_KINDS } from './contracts.ts';
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

/**
 * The venture actor's only write path. Authorizes, runs work() on the draft state, appends declared
 * events, audits, and commits once. A throw discards the whole draft.
 */
export async function ventureAction<T>(
  deps: VentureDeps, ctx: Context, level: Permission, name: string,
  work: (tx: VentureTx) => T | Promise<T>, options: { create?: boolean } = {},
): Promise<T> {
  authorize(deps.store, ctx, level);
  return deps.store.update(async state => {
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
        const copy = structuredClone(record);
        state.conversations.push(copy);
        if (copy.kind === 'venture-record') tx.venture = copy as VentureRecord;
        return structuredClone(copy);
      },
      replace<R extends AnyVentureRecord>(record: R): R {
        const index = state.conversations.findIndex(r => r?.id === record.id && r?.kind === record.kind);
        check(index >= 0, 'INVALID_VENTURE_REQUEST', 'This record no longer exists.');
        const copy = structuredClone(record);
        state.conversations[index] = copy;
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
    const result = await work(tx);
    if (tx.venture && events.length) appendEvents(state, tx.venture.id, ctx, now, events);
    audit(state, `venture.${name}`, { ventureId: tx.venture?.id ?? null, memberId: ctx.memberId });
    return structuredClone(result);
  });
}

function appendEvents(state: State, ventureId: string, ctx: Context, at: IsoTime, events: { name: VentureEventName; data: Json }[]) {
  const existing = listRecords(state, 'venture-event', ventureId);
  let seq = existing.reduce((max, e) => Math.max(max, e.seq), 0);
  for (const event of events) {
    seq += 1;
    const record: VentureEventRecord = { id: newId('vevent'), kind: 'venture-event', ventureId, memberId: ctx.memberId, epoch: ctx.epoch, at, seq, name: event.name, data: event.data };
    state.conversations.push(record);
  }
  const all = listRecords(state, 'venture-event', ventureId);
  if (all.length > MAX_EVENTS) {
    const drop = new Set(all.sort((a, b) => a.seq - b.seq).slice(0, all.length - MAX_EVENTS).map(e => e.id));
    state.conversations = state.conversations.filter(r => !drop.has(r?.id));
  }
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
export function percentBps(value: unknown, field: string): string {
  check(typeof value === 'string' && value.length <= 12, 'INVALID_TAX_RATE', `${field} must be a rate like 18 or 8.25.`);
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.replace(/[\s%]/g, ''));
  check(match, 'INVALID_TAX_RATE', `${field} must be a rate like 18 or 8.25.`);
  const bps = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  check(bps <= 10000n, 'INVALID_TAX_RATE', `${field} must be 100 or less.`);
  return String(bps);
}

/** Basis points text to percent text for display and prefills: '1800' is '18', '825' is '8.25', '25' is '0.25'. */
export function bpsPercent(bps: string): string {
  check(/^\d{1,5}$/.test(bps), 'INVALID_TAX_RATE', 'A tax rate must be whole basis points.');
  const value = BigInt(bps), whole = value / 100n, fraction = value % 100n;
  if (fraction === 0n) return String(whole);
  const digits = String(fraction).padStart(2, '0');
  return `${whole}.${digits.endsWith('0') ? digits.slice(0, 1) : digits}`;
}

/**
 * Inside the app: the desktop window or the paired local browser (both 'desktop'), or a signed-in owner on the hosted
 * web app ('web'). Never phone or MCP, and never a request whose source text is tainted.
 */
export function isAppChannel(ctx: Context | undefined): boolean {
  return (ctx?.channel === 'desktop' || ctx?.channel === 'web') && !ctx.sourceTainted;
}

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

/** Tokens that hold both a letter and a digit (B2B, Web3, GPT-6, Q3) in the owner's own words, lower-cased. */
export function copiedTokens(...inputs: string[]): string[] {
  const found = new Set<string>();
  for (const input of inputs) for (const match of input.matchAll(TOKEN)) if (HAS_DIGIT.test(match[0]) && HAS_LETTER.test(match[0])) found.add(match[0].toLowerCase());
  return [...found].sort();
}

/**
 * The AI never writes numbers. Refuses currency signs, percent and magnitude words in any case, and every token
 * holding a digit (in any script) unless the token also holds a letter and is in allowed (from copiedTokens).
 */
export function assertNoNumbers(value: string, field: string, allowed: readonly string[] = []) {
  const message = `The ${field} contained a number. Numbers come from Chausar's calculator, not the AI.`;
  check(!MONEY_SIGN.test(value) && !MAGNITUDE.test(value), 'MODEL_OUTPUT_REJECTED', message);
  for (const match of value.matchAll(TOKEN)) {
    if (!HAS_DIGIT.test(match[0])) continue;
    check(HAS_LETTER.test(match[0]) && allowed.includes(match[0].toLowerCase()), 'MODEL_OUTPUT_REJECTED', message);
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

export type ModelWordsOptions = { allowed?: readonly string[]; multiline?: boolean };

/** Model words: tidy, bounded, no numbers, no line that starts a markdown heading. */
export function modelWords(value: unknown, field: string, max = 400, options: ModelWordsOptions = {}): string {
  check(typeof value === 'string', 'MODEL_OUTPUT_REJECTED', `The ${field} was not text.`);
  const words = tidyWords(value, options.multiline === true);
  check(words.length >= 1 && words.length <= max, 'MODEL_OUTPUT_REJECTED', `The ${field} was empty or too long.`);
  check(!/^#/m.test(words), 'MODEL_OUTPUT_REJECTED', `The ${field} tried to start a heading.`);
  assertNoNumbers(words, field, options.allowed ?? []);
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
