/**
 * The status card: the only thing that crosses from a client's workspace to its CA firm.
 * A closed schema of dates, counts and states (no free text at all), sealed with an
 * HMAC-SHA-256 keyed by the link code the firm issued for that client. `parseCard` is the one
 * gate on both sides: the client runs its own card through it before handing it out, and the
 * firm refuses anything it does not accept exactly.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { check } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';

export type CloseStep = 'done' | 'in-progress' | 'not-done' | 'refused';
export type CloseStrip = { bank: CloseStep; gst: CloseStep; tds: CloseStep; tb: CloseStep };
export type Ready = 'ready' | 'not-ready' | 'refused';
export type Handover = { tb: Ready; bankRec: Ready; gstMatch: Ready; tdsMatch: Ready; ageing: Ready };
export type CardSeat = { seat: 'ca' | 'accountant'; endsOn: string | null };
export type StatusCard = {
  v: 1; kind: 'chausar.ca-status'; workspaceId: string; link: string; issuedAt: string; month: string; booksReadAt: string | null;
  close: CloseStrip; cosign: { meanings: number | null; recipes: number | null; accountClasses: number | null };
  questions: { count: number | null; oldestAt: string | null }; handover: Handover; dueNext: { code: string; date: string } | null;
  seats: CardSeat[]; consent: string; mac: string;
};
export type UnsealedCard = Omit<StatusCard, 'mac'>;

export const CLOSE_STEPS: readonly CloseStep[] = ['done', 'in-progress', 'not-done', 'refused'];
export const READY: readonly Ready[] = ['ready', 'not-ready', 'refused'];
export const LINK_CODE = /^[A-Z2-7]{16}$/;
export const DUE_CODE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
/** A consent wording version: a short label, never prose. */
export const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WORKSPACE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MAX_COUNT = 1_000_000;
const MAX_BYTES = 4096;
const INVALID = 'CA_CARD_INVALID';
const bad = 'This status card does not match the card format.';

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export const isTime = (value: unknown): value is string => typeof value === 'string' && ISO_TIME.test(value) && !Number.isNaN(Date.parse(value)) && isDay(value.slice(0, 10));
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_COUNT;

/** The object with exactly these keys, or CA_CARD_INVALID. */
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  check(plain(value), INVALID, bad);
  const own = Object.keys(value);
  check(own.length === keys.length && keys.every(key => Object.hasOwn(value, key)), INVALID, bad);
  return value;
}
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T => { check(allowed.includes(value as T), INVALID, bad); return value as T; };
const countOrNull = (value: unknown): number | null => { check(value === null || isCount(value), INVALID, bad); return value as number | null; };
const timeOrNull = (value: unknown): string | null => { check(value === null || isTime(value), INVALID, bad); return value as string | null; };

const CARD_KEYS = ['v', 'kind', 'workspaceId', 'link', 'issuedAt', 'month', 'booksReadAt', 'close', 'cosign', 'questions', 'handover', 'dueNext', 'seats', 'consent', 'mac'] as const;

/** Accepts exactly a status card and returns a fresh copy of it; anything else throws CA_CARD_INVALID. */
export function parseCard(value: unknown): StatusCard {
  let size = Infinity;
  try { size = Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8'); } catch { /* A value JSON cannot hold is not a card. */ }
  check(size <= MAX_BYTES, INVALID, 'This status card is too large to be a card.');
  const card = exact(value, CARD_KEYS);
  check(card.v === 1 && card.kind === 'chausar.ca-status', INVALID, bad);
  check(typeof card.workspaceId === 'string' && WORKSPACE_ID.test(card.workspaceId), INVALID, bad);
  check(typeof card.link === 'string' && HEX64.test(card.link) && typeof card.mac === 'string' && HEX64.test(card.mac), INVALID, bad);
  check(isTime(card.issuedAt) && isMonth(card.month), INVALID, bad);
  const close = exact(card.close, ['bank', 'gst', 'tds', 'tb']);
  const cosign = exact(card.cosign, ['meanings', 'recipes', 'accountClasses']);
  const questions = exact(card.questions, ['count', 'oldestAt']);
  const handover = exact(card.handover, ['tb', 'bankRec', 'gstMatch', 'tdsMatch', 'ageing']);
  let dueNext: StatusCard['dueNext'] = null;
  if (card.dueNext !== null) {
    const due = exact(card.dueNext, ['code', 'date']);
    check(typeof due.code === 'string' && DUE_CODE.test(due.code) && isDay(due.date), INVALID, bad);
    dueNext = { code: due.code, date: due.date };
  }
  check(Array.isArray(card.seats) && card.seats.length <= 20, INVALID, bad);
  const seats = card.seats.map(item => {
    const seat = exact(item, ['seat', 'endsOn']);
    check(seat.endsOn === null || isDay(seat.endsOn), INVALID, bad);
    return { seat: oneOf(seat.seat, ['ca', 'accountant'] as const), endsOn: seat.endsOn as string | null };
  });
  check(typeof card.consent === 'string' && VERSION.test(card.consent), INVALID, bad);
  return {
    v: 1, kind: 'chausar.ca-status', workspaceId: card.workspaceId, link: card.link, issuedAt: card.issuedAt as string, month: card.month as string,
    booksReadAt: timeOrNull(card.booksReadAt),
    close: { bank: oneOf(close.bank, CLOSE_STEPS), gst: oneOf(close.gst, CLOSE_STEPS), tds: oneOf(close.tds, CLOSE_STEPS), tb: oneOf(close.tb, CLOSE_STEPS) },
    cosign: { meanings: countOrNull(cosign.meanings), recipes: countOrNull(cosign.recipes), accountClasses: countOrNull(cosign.accountClasses) },
    questions: { count: countOrNull(questions.count), oldestAt: timeOrNull(questions.oldestAt) },
    handover: { tb: oneOf(handover.tb, READY), bankRec: oneOf(handover.bankRec, READY), gstMatch: oneOf(handover.gstMatch, READY), tdsMatch: oneOf(handover.tdsMatch, READY), ageing: oneOf(handover.ageing, READY) },
    dueNext, seats, consent: card.consent, mac: card.mac,
  };
}

/** JSON with object keys sorted at every level: the exact bytes the MAC covers. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Hex HMAC-SHA-256 keyed by the link code over the canonical JSON of every field except `mac`. */
export function macCard(code: string, card: UnsealedCard): string {
  const { mac: _mac, ...body } = card as UnsealedCard & { mac?: unknown };
  return createHmac('sha256', code).update(canonical(body)).digest('hex');
}
export function sealCard(code: string, card: UnsealedCard): StatusCard { return parseCard({ ...card, mac: macCard(code, card) }); }
/** Constant-time check of a parsed card's MAC against the code. */
export function macMatches(code: string, card: StatusCard): boolean {
  const want = Buffer.from(macCard(code, card), 'hex'), got = Buffer.from(card.mac, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** A new link code: 16 base32 characters, 80 random bits. */
export function newLinkCode(): string { const bytes = randomBytes(16); return [...bytes].map(byte => BASE32[byte & 31]).join(''); }
/** The link as it appears on a card: hex SHA-256 of the code. */
export const linkDigest = (code: string) => createHash('sha256').update(code, 'utf8').digest('hex');

// ---- Time: the lane's day is the India date, as for CA seat end dates. --------------------------------
/** Trusted test hosts may pin the clock through the module's options; production uses the system clock. */
export function clockOf(host: ModuleHost): number { const pinned = host.options.clock; return typeof pinned === 'function' ? Number((pinned as () => number)()) : Date.now(); }
export const indiaDay = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(0, 10);
/** The month whose close is being worked on: the calendar month before today's India date. */
export function closeMonth(day: string): string { const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
export const monthLastDay = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

const NAME_TEXT = /^[^\u0000-\u001f\u007f]+$/;
/** A label a person typed (a firm's or a client's name): trimmed, 1..max characters, no control characters. */
export function label(value: unknown, code: string, message: string, max = 120): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && NAME_TEXT.test(value), code, message);
  return value.trim();
}
/** The payload with only these keys, or `CA_REQUEST_INVALID`. */
export function fields(payload: unknown, allowed: readonly string[]): Record<string, any> {
  check(plain(payload) && Object.keys(payload).every(key => allowed.includes(key)), 'CA_REQUEST_INVALID', 'This request has fields Chausar does not accept here.');
  return payload;
}
