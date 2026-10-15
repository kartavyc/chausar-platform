/**
 * The hosted-link desktop methods these screens call, and the checks every reply passes before
 * it is drawn. Every reply is untrusted data: a value that is not what the contract says throws
 * `ReplyError` (code INVALID_REPLY) and the screen draws the error state instead.
 *
 * Contracts (docs/lanes/hosted-link.md, "Round 4 contracts"):
 * - `phone.documents.list` (read) {} -> { documents: [{ documentId, name, channel, mediaType, sizeBytes, receivedAt, collectedAt, ... }], keyRegistered?, label? }
 * - `phone.documents.collect` (admin) {} -> { collected: [{ documentId, outcome, localId?, reason? }] }
 * - `phone.documents.preview` (admin) { documentId, as?: 'statement' | 'bill' } ->
 *     { documentId, route: 'csv' | 'statement' | 'bill', untrusted: true, preview, confirm: { method, input } | null }
 * - `phone.documents.discard` (admin) { documentId } -> { documentId, discarded: true }
 * - `phone.documents.done` (admin) { documentId } -> any object
 * - `phone.messages.log` (read) { filter: 'lost' | 'all' } -> { messages: [{ id, event, channel, status, at, buttons, errorCode, checkedAt }], lost }
 * - `phone.messages.check` (admin) { id } -> the updated entry plus `sendAgain` (also accepted wrapped as { message, sendAgain })
 * - `books.billConfirm` (prepare) { readId, digest, fields } -> any object: a bill preview whose confirm adds 'fields'
 */

export const METHODS = {
  list: 'phone.documents.list', collect: 'phone.documents.collect', preview: 'phone.documents.preview',
  discard: 'phone.documents.discard', done: 'phone.documents.done',
  log: 'phone.messages.log', check: 'phone.messages.check',
} as const;

/** The only methods a preview may name as its confirm: the normal import and bill confirms. */
export const CONFIRM_METHODS = ['sources.import', 'imports.commit', 'books.billConfirm'] as const;

export class ReplyError extends Error {
  readonly code = 'INVALID_REPLY';
  readonly path: string;
  constructor(path: string) { super(`INVALID_REPLY:${path}`); this.path = path; }
}
type Rec = Readonly<Record<string, unknown>>;
function rec(value: unknown, path: string): Rec {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ReplyError(path);
  return value as Rec;
}
function str(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new ReplyError(path);
  return value;
}
function oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw new ReplyError(path);
  return value as T;
}
function list<T>(value: unknown, path: string, item: (v: unknown, p: string) => T, max: number): T[] {
  if (!Array.isArray(value) || value.length > max) throw new ReplyError(path);
  return value.map((v, i) => item(v, `${path}[${i}]`));
}
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function instant(value: unknown, path: string): string {
  const s = str(value, path, 40);
  if (!INSTANT.test(s) || Number.isNaN(Date.parse(s))) throw new ReplyError(path);
  return s;
}
function optInstant(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : instant(value, path);
}
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;
function ident(value: unknown, path: string): string {
  const s = str(value, path, 200);
  if (!ID.test(s)) throw new ReplyError(path);
  return s;
}
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
function optCode(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !CODE.test(value)) throw new ReplyError(path);
  return value;
}

// Documents from your phone (PH-05)

export const DOCUMENT_CHANNELS = ['whatsapp', 'telegram'] as const;
export type DocumentChannel = (typeof DOCUMENT_CHANNELS)[number];
export const MEDIA_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'text/csv'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export type Route = 'csv' | 'statement' | 'bill';
/** How a document may be read: a CSV as rows; a PDF as a statement or a bill (the person chooses); a photo as a bill. */
export function routesFor(mediaType: MediaType): readonly Route[] {
  if (mediaType === 'text/csv') return ['csv'];
  if (mediaType === 'application/pdf') return ['statement', 'bill'];
  return ['bill'];
}
/** The preview request for a chosen route: a CSV carries no `as`. */
export function previewPayload(documentId: string, route: Route): Record<string, unknown> {
  return route === 'csv' ? { documentId } : { documentId, as: route };
}

export interface PhoneDocument {
  readonly documentId: string; readonly name: string; readonly channel: DocumentChannel; readonly mediaType: MediaType;
  readonly sizeBytes: string; readonly receivedAt: string; readonly collectedAt: string;
}
export interface DocumentList {
  readonly documents: readonly PhoneDocument[];
  /** False when this computer has not yet registered its key: documents cannot reach it until it does. */
  readonly keyRegistered: boolean;
}
export function documentList(value: unknown): DocumentList {
  const r = rec(value, 'reply');
  const keyRegistered = r['keyRegistered'] === undefined ? true : r['keyRegistered'];
  if (typeof keyRegistered !== 'boolean') throw new ReplyError('reply.keyRegistered');
  return {
    keyRegistered,
    documents: list(r['documents'], 'reply.documents', (v, p) => {
      const d = rec(v, p);
      const size = d['sizeBytes'];
      if (!Number.isSafeInteger(size) || (size as number) < 0) throw new ReplyError(`${p}.sizeBytes`);
      return {
        documentId: ident(d['documentId'], `${p}.documentId`), name: str(d['name'], `${p}.name`, 200),
        channel: oneOf(d['channel'], `${p}.channel`, DOCUMENT_CHANNELS), mediaType: oneOf(d['mediaType'], `${p}.mediaType`, MEDIA_TYPES),
        sizeBytes: String(size), receivedAt: instant(d['receivedAt'], `${p}.receivedAt`), collectedAt: instant(d['collectedAt'], `${p}.collectedAt`),
      };
    }, 100),
  };
}

export const COLLECT_OUTCOMES = ['held', 'already-held', 'refused', 'held-full', 'not-collected'] as const;
export interface Collected { readonly outcomes: readonly (typeof COLLECT_OUTCOMES)[number][] }
export function collected(value: unknown): Collected {
  const r = rec(value, 'reply');
  return { outcomes: list(r['collected'], 'reply.collected', (v, p) => oneOf(rec(v, p)['outcome'], `${p}.outcome`, COLLECT_OUTCOMES), 500) };
}
/** Some documents waiting on the relay did not reach this computer. */
export function partlyCollected(c: Collected): boolean {
  return c.outcomes.some((o) => o === 'held-full' || o === 'not-collected' || o === 'refused');
}

/** `needsFields`: the confirm also needs fields a person checks and corrects (a bill), drawn as a form on this screen. */
export interface Confirm { readonly method: (typeof CONFIRM_METHODS)[number]; readonly input: Rec; readonly needsFields: boolean }
export interface DocumentPreview {
  readonly documentId: string; readonly route: Route; readonly preview: Rec; readonly confirm: Confirm | null;
  /** For a bill whose confirm needs fields: the reading to check field by field, and the reading it binds to. */
  readonly bill: BillCheck | null;
  /** Why there is nothing to confirm, when the runtime says (only with a null confirm). */
  readonly confirmReason: NoConfirmReason | null;
}
export const NO_CONFIRM_REASONS = ['statement-question', 'statement-refused', 'statement-imported', 'reply-unrecognised'] as const;
export type NoConfirmReason = (typeof NO_CONFIRM_REASONS)[number];
/** The reading of one document. It must be for the document and route asked, and marked untrusted. */
export function documentPreview(value: unknown, asked?: { documentId: string; route: Route }): DocumentPreview {
  const r = rec(value, 'reply');
  if (r['untrusted'] !== true) throw new ReplyError('reply.untrusted');
  const documentId = ident(r['documentId'], 'reply.documentId');
  const route = oneOf(r['route'], 'reply.route', ['csv', 'statement', 'bill'] as const);
  if (asked !== undefined && (asked.documentId !== documentId || asked.route !== route)) throw new ReplyError('reply.route');
  let confirm: Confirm | null = null;
  if (r['confirm'] !== null) {
    const c = rec(r['confirm'], 'reply.confirm');
    const add = c['add'] === undefined ? [] : list(c['add'], 'reply.confirm.add', (v, p) => oneOf(v, p, ['fields'] as const), 4);
    // `optional` names inputs the confirm may also take (a bill's `zoho`); this screen sends none of them.
    if (c['optional'] !== undefined) list(c['optional'], 'reply.confirm.optional', (v, p) => oneOf(v, p, ['zoho'] as const), 4);
    confirm = { method: oneOf(c['method'], 'reply.confirm.method', CONFIRM_METHODS), input: rec(c['input'], 'reply.confirm.input'), needsFields: add.includes('fields') };
  }
  const preview = rec(r['preview'], 'reply.preview');
  let bill: BillCheck | null = null;
  if (confirm !== null && confirm.needsFields) {
    // Only a bill's confirm takes checked fields; anything else is not a contract this screen knows.
    if (route !== 'bill' || confirm.method !== 'books.billConfirm') throw new ReplyError('reply.confirm.add');
    bill = billCheck(preview, confirm.input);
  }
  const reason = r['confirmReason'] === undefined || r['confirmReason'] === null ? null : oneOf(r['confirmReason'], 'reply.confirmReason', NO_CONFIRM_REASONS);
  return { documentId, route, preview, confirm, bill, confirmReason: confirm === null ? reason : null };
}

// A bill's fields, checked and corrected on this screen: the `books.billRead` reply
// (platform/runtime/work-books/books-bill.ts and books-bill-parse.ts), confirmed through `books.billConfirm`.

export const CERTAINTIES = ['sure', 'check-this', 'could-not-read'] as const;
export type Certainty = (typeof CERTAINTIES)[number];
/** One field as read: its text (null when it could not be read) and how sure the reading is. */
export interface BillField { readonly value: string | null; readonly certainty: Certainty }
export interface BillReading {
  readonly supplier: BillField; readonly billNumber: BillField; readonly date: BillField;
  readonly lines: readonly { readonly description: BillField; readonly quantity: BillField; readonly amount: BillField }[];
  readonly tax: readonly { readonly name: BillField; readonly amount: BillField }[];
  readonly total: BillField;
}
/** The reading to check and the exact reading (`readId`, `digest`) the confirm binds to. */
export interface BillCheck { readonly readId: string; readonly digest: string; readonly reading: BillReading }
function billField(value: unknown, path: string): BillField {
  const f = rec(value, path);
  const v = f['value'];
  if (!(v === null || (typeof v === 'string' && v.length <= 500))) throw new ReplyError(`${path}.value`);
  return { value: v, certainty: oneOf(f['certainty'], `${path}.certainty`, CERTAINTIES) };
}
/** The bill reading, strictly. When the reading names its readId and digest, the confirm's must be the same. */
export function billCheck(preview: Rec, input: Rec): BillCheck {
  const readId = str(input['readId'], 'reply.confirm.input.readId', 200);
  const digest = str(input['digest'], 'reply.confirm.input.digest', 200);
  if (preview['readId'] !== undefined && preview['readId'] !== readId) throw new ReplyError('reply.preview.readId');
  if (preview['digest'] !== undefined && preview['digest'] !== digest) throw new ReplyError('reply.preview.digest');
  const p = 'reply.preview';
  return {
    readId, digest,
    reading: {
      supplier: billField(preview['supplier'], `${p}.supplier`), billNumber: billField(preview['billNumber'], `${p}.billNumber`),
      date: billField(preview['date'], `${p}.date`), total: billField(preview['total'], `${p}.total`),
      lines: list(preview['lines'], `${p}.lines`, (v, q) => {
        const l = rec(v, q);
        return { description: billField(l['description'], `${q}.description`), quantity: billField(l['quantity'], `${q}.quantity`), amount: billField(l['amount'], `${q}.amount`) };
      }, 50),
      tax: list(preview['tax'], `${p}.tax`, (v, q) => {
        const x = rec(v, q);
        return { name: billField(x['name'], `${q}.name`), amount: billField(x['amount'], `${q}.amount`) };
      }, 10),
    },
  };
}

const PAISE = /^(0|[1-9]\d{0,15})$/;
/** Whole paise as rupees text, by text only ("73160" -> "731.60"); anything that is not whole paise reads as empty. */
export function rupeesText(minor: string | null): string {
  if (minor === null || !PAISE.test(minor)) return '';
  const d = minor.padStart(3, '0');
  return `${d.slice(0, -2).replace(/^0+(?=\d)/, '')}.${d.slice(-2)}`;
}
/**
 * Rupees a person typed, as whole paise, parsed by hand and never through a float: digits with at
 * most two decimals ("1,234.5" -> "123450"). Commas are allowed only as Indian ("1,23,456") or
 * thousands ("123,456") grouping, and dropped. Null when it is not such an amount.
 */
export function paiseText(typed: string): string | null {
  const plain = typed.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(plain)) return null;
  const [whole = '', fraction = ''] = plain.replace(/,/g, '').split('.');
  const paise = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  return PAISE.test(paise) ? paise : null;
}
/** A quantity the engine takes: a whole number from one, as text. */
export function wholeQuantity(typed: string): string | null {
  const plain = typed.trim();
  return /^[1-9]\d{0,5}$/.test(plain) ? plain : null;
}
export const isoDayText = (typed: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(typed);

/** What the person typed, field by field. Amounts are rupees text. */
export interface BillForm {
  readonly supplier: string; readonly billNumber: string; readonly date: string;
  readonly lines: readonly { readonly description: string; readonly quantity: string; readonly amount: string }[];
  readonly tax: readonly { readonly name: string; readonly amount: string }[];
  readonly total: string;
}
export function billFormOf(reading: BillReading): BillForm {
  return {
    supplier: reading.supplier.value ?? '', billNumber: reading.billNumber.value ?? '', date: reading.date.value ?? '',
    lines: reading.lines.map((l) => ({ description: l.description.value ?? '', quantity: l.quantity.value ?? '', amount: rupeesText(l.amount.value) })),
    tax: reading.tax.map((x) => ({ name: x.name.value ?? '', amount: rupeesText(x.amount.value) })),
    total: rupeesText(reading.total.value),
  };
}
/**
 * The exact `books.billConfirm` request for the checked form, or null while an amount, a quantity or
 * the date cannot be sent the way the engine takes them. Nothing is added up here: the engine checks
 * that lines plus tax make the total, and refuses BILL_TOTAL_MISMATCH.
 */
export function billConfirmPayload(check: BillCheck, form: BillForm): Record<string, unknown> | null {
  const totalMinor = paiseText(form.total);
  if (totalMinor === null || !isoDayText(form.date)) return null;
  const lines: { description: string; quantity: string; amountMinor: string }[] = [];
  for (const l of form.lines) {
    const quantity = wholeQuantity(l.quantity), amountMinor = paiseText(l.amount);
    if (quantity === null || amountMinor === null) return null;
    lines.push({ description: l.description.trim(), quantity, amountMinor });
  }
  const tax: { name: string; amountMinor: string }[] = [];
  for (const x of form.tax) {
    const amountMinor = paiseText(x.amount);
    if (amountMinor === null) return null;
    tax.push({ name: x.name.trim(), amountMinor });
  }
  return {
    readId: check.readId, digest: check.digest,
    fields: { supplier: form.supplier.trim(), billNumber: form.billNumber.trim(), date: form.date, lines, tax, totalMinor },
  };
}
export function discarded(value: unknown): { readonly documentId: string } {
  const r = rec(value, 'reply');
  if (r['discarded'] !== true) throw new ReplyError('reply.discarded');
  return { documentId: ident(r['documentId'], 'reply.documentId') };
}
/** Any object: a confirm or a done is shown only as done, never read for figures. */
export function anyObject(value: unknown): Rec { return rec(value, 'reply'); }

/** One line of what was read: a name path and the value as text. Nothing is added up or worked out. */
export interface ReadLine { readonly path: readonly string[]; readonly value: string; readonly kind: 'text' | 'money' | 'yes' | 'no' }
/**
 * The reading as plain lines, depth-first, at most `max` lines and four levels deep. Strings and
 * numbers are kept as text, yes and no as words the screen supplies; a `...Minor` value of whole
 * paise is marked money so the screen formats it. Anything else is left out.
 */
export function readLines(value: Rec, max = 200): { lines: readonly ReadLine[]; more: boolean } {
  const lines: ReadLine[] = [];
  let more = false;
  const push = (line: ReadLine) => { if (lines.length >= max) more = true; else lines.push(line); };
  const walk = (v: unknown, path: string[], depth: number) => {
    const key = path[path.length - 1] ?? '';
    if (typeof v === 'string') push({ path, value: v.slice(0, 500), kind: /Minor$/.test(key) && /^-?\d{1,18}$/.test(v) ? 'money' : 'text' });
    else if (typeof v === 'number' && Number.isFinite(v)) push({ path, value: String(v), kind: 'text' });
    else if (typeof v === 'boolean') push({ path, value: '', kind: v ? 'yes' : 'no' });
    else if (v !== null && typeof v === 'object' && depth < 4 && !more) {
      const entries = Array.isArray(v) ? v.map((x, i) => [String(i + 1), x] as const) : Object.entries(v as Rec);
      for (const [k, x] of entries) walk(x, [...path, k], depth + 1);
    }
  };
  walk(value, [], 0);
  return { lines, more };
}

// Messages whose result was lost (TL-09, TR-09)

export const MESSAGE_EVENTS = ['week-ahead-ready', 'review-ready', 'document-received', 'due-date-near'] as const;
export const MESSAGE_CHANNELS = ['whatsapp', 'telegram', 'mail'] as const;
/**
 * `unknown` is a lost result: the relay never answered, so it may or may not have been sent.
 * `not-sent`: a check found the relay never received it (platform/runtime/hosted-link/message-log.ts).
 */
export const MESSAGE_STATUSES = ['unknown', 'failed', 'not-sent', 'queued', 'sent', 'delivered', 'read'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];
export const BUTTONS = ['open-only', 'approve-not-now-open'] as const;
export interface MessageEntry {
  readonly id: string; readonly event: (typeof MESSAGE_EVENTS)[number]; readonly channel: (typeof MESSAGE_CHANNELS)[number];
  readonly status: MessageStatus; readonly at: string; readonly buttons: (typeof BUTTONS)[number];
  readonly errorCode: string | null; readonly checkedAt: string | null;
}
export const isLost = (m: Pick<MessageEntry, 'status'>): boolean => m.status === 'unknown';
function entry(value: unknown, p: string): MessageEntry {
  const m = rec(value, p);
  return {
    id: ident(m['id'], `${p}.id`), event: oneOf(m['event'], `${p}.event`, MESSAGE_EVENTS), channel: oneOf(m['channel'], `${p}.channel`, MESSAGE_CHANNELS),
    status: oneOf(m['status'], `${p}.status`, MESSAGE_STATUSES), at: instant(m['at'], `${p}.at`), buttons: oneOf(m['buttons'], `${p}.buttons`, BUTTONS),
    errorCode: optCode(m['errorCode'], `${p}.errorCode`), checkedAt: optInstant(m['checkedAt'], `${p}.checkedAt`),
  };
}
export interface MessageLog { readonly messages: readonly MessageEntry[]; readonly anyLost: boolean; readonly truncated: boolean }
export function messageLog(value: unknown): MessageLog {
  const r = rec(value, 'reply');
  const lost = r['lost'];
  if (!(typeof lost === 'boolean' || (Number.isSafeInteger(lost) && (lost as number) >= 0))) throw new ReplyError('reply.lost');
  const truncated = r['truncated'] === undefined ? false : r['truncated'];
  if (typeof truncated !== 'boolean') throw new ReplyError('reply.truncated');
  return { messages: list(r['messages'], 'reply.messages', entry, 500), anyLost: lost === true || (typeof lost === 'number' && lost > 0), truncated };
}
/** A checked entry, and whether it may be sent again: only ever elsewhere in the app, by a person's press. */
export interface CheckedMessage extends MessageEntry { readonly sendAgain: boolean }
export function messageChecked(value: unknown): CheckedMessage {
  const r = rec(value, 'reply');
  const sendAgain = r['sendAgain'] === undefined ? false : r['sendAgain'];
  if (typeof sendAgain !== 'boolean') throw new ReplyError('reply.sendAgain');
  const checked = r['message'] !== undefined && r['id'] === undefined ? entry(r['message'], 'reply.message') : entry(r, 'reply');
  return { ...checked, sendAgain };
}
