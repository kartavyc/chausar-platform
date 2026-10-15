/**
 * Reply validators for the CA console and the client's "Your CA firm" screen
 * (docs/lanes/ca-enterprise.md, Round 4 contracts). Every reply is untrusted data: an object
 * must carry exactly the keys the contract names, every enum must be one of its words, every
 * count a non-negative safe integer or null ("not known"). Anything else throws INVALID_REPLY
 * and the screen draws its failed state. Nothing here formats or calculates.
 */

export type CloseStep = 'done' | 'in-progress' | 'not-done' | 'refused';
export type CloseStrip = { bank: CloseStep; gst: CloseStep; tds: CloseStep; tb: CloseStep };
export type Ready = 'ready' | 'not-ready' | 'refused';
export type Handover = { tb: Ready; bankRec: Ready; gstMatch: Ready; tdsMatch: Ready; ageing: Ready };
export type SeatKind = 'ca' | 'accountant';
export type Seat = { seat: SeatKind; endsOn: string | null };
export type Due = { code: string; date: string };

export type StatusCard = {
  v: 1; kind: 'chausar.ca-status'; workspaceId: string; link: string; issuedAt: string; month: string;
  booksReadAt: string | null; close: CloseStrip;
  cosign: { meanings: number | null; recipes: number | null; accountClasses: number | null };
  questions: { count: number | null; oldestAt: string | null };
  handover: Handover; dueNext: Due | null; seats: Seat[]; consent: string; mac: string;
};

export type CaStatus = {
  link: { firmName: string; linkedAt: string } | null;
  consent: { version: string; at: string } | null;
  wording: { version: string; approved: boolean; text: string | null };
  lastCardAt: string | null;
};

export type Firm = { name: string; reportName: string | null; pricing: 'planned' };
export type ClientRow = {
  clientId: string; name: string; state: 'invited' | 'joined'; booksReadAt: string | null; close: CloseStrip | null;
  awaiting: number | null; dueNext: Due | null; cardAt: string | null; stale: boolean; seat: Seat | null;
};
export type FilterWord = 'needs-you' | 'close-not-done' | 'all';
export type ClientsList = { month: string; rows: ClientRow[]; counts: { needsYou: number; closeNotDone: number; all: number }; nextCursor: string | null };
export type ClientCode = { clientId: string; code: string; guide: { html: string } };
export type Opened = { clientId: string; workspaceId: string; seat: Seat };
export type FirmToday = {
  month: string;
  awaiting: { clientId: string; name: string; cosign: number | null; questions: number | null; total: number | null }[];
  due: { clientId: string; name: string; code: string; date: string }[];
  totals: { clients: number; awaiting: number };
};
export type CosignRow = { clientId: string; name: string; meanings: number | null; recipes: number | null; accountClasses: number | null };
export type QuestionRow = { clientId: string; name: string; count: number | null; oldestAt: string | null };
export type HandoverRow = { clientId: string; name: string; handover: Handover | null };
export type ManyKind = 'gst-guide' | 'month-end-reminder' | 'documents-request';
export type BatchResult = 'ready' | 'not-joined' | 'no-status' | 'not-assigned' | 'held' | 'sent';
export type BatchRow = { clientId: string; name: string; result: BatchResult; code?: string };
export type Batch = { batchId: string; kind: string; month: string | null; at: string; state: 'prepared' | 'held' | 'sent'; rows: BatchRow[] };
export type LibraryKind = 'recipe' | 'job' | 'check';
export type LibraryItem = { id: string; kind: LibraryKind; title: string; addedAt: string };
export type PersonRow = { memberId: string; name: string; role: string; clients: '*' | string[] };

export const CLOSE_STEPS: readonly CloseStep[] = ['done', 'in-progress', 'not-done', 'refused'];
export const READY_WORDS: readonly Ready[] = ['ready', 'not-ready', 'refused'];
export const MANY_KINDS: readonly ManyKind[] = ['gst-guide', 'month-end-reminder', 'documents-request'];
export const LIBRARY_KINDS: readonly LibraryKind[] = ['recipe', 'job', 'check'];
export const BATCH_RESULTS: readonly BatchResult[] = ['ready', 'not-joined', 'no-status', 'not-assigned', 'held', 'sent'];
export const HANDOVER_ITEMS: readonly (keyof Handover)[] = ['tb', 'bankRec', 'gstMatch', 'tdsMatch', 'ageing'];
export const CLOSE_ITEMS: readonly (keyof CloseStrip)[] = ['bank', 'gst', 'tds', 'tb'];

type Bag = Record<string, unknown>;

export function invalid(): never {
  throw Object.assign(new Error('INVALID_REPLY'), { code: 'INVALID_REPLY' });
}

/** An object with exactly these keys (the optional ones may be absent). */
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): Bag {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const bag = value as Bag;
  for (const key of Object.keys(bag)) if (!required.includes(key) && !optional.includes(key)) invalid();
  for (const key of required) if (!(key in bag)) invalid();
  return bag;
}

function text(value: unknown, max = 200, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max) invalid();
  return value;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
function id(value: unknown): string {
  const v = text(value, 128);
  if (!ID.test(v)) invalid();
  return v;
}
function n(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}
function nOrNull(value: unknown): number | null { return value === null ? null : n(value); }
function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}
function oneOf<T extends string>(value: unknown, words: readonly T[]): T {
  if (typeof value !== 'string' || !(words as readonly string[]).includes(value)) invalid();
  return value as T;
}
function list<T>(value: unknown, each: (item: unknown) => T, max = 10000): T[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value.map(each);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isDay(value: string): boolean {
  const m = DAY.exec(value);
  if (m === null) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function day(value: unknown): string {
  if (typeof value !== 'string' || !isDay(value)) invalid();
  return value;
}
function dayOrNull(value: unknown): string | null { return value === null ? null : day(value); }
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function time(value: unknown): string {
  if (typeof value !== 'string' || !TIME.test(value) || !isDay(value.slice(0, 10)) || Number.isNaN(Date.parse(value))) invalid();
  return value;
}
function timeOrNull(value: unknown): string | null { return value === null ? null : time(value); }
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export function isMonth(value: string): boolean { return MONTH.test(value); }
function month(value: unknown): string {
  if (typeof value !== 'string' || !MONTH.test(value)) invalid();
  return value;
}
const DUE_CODE = /^[a-z0-9][a-z0-9.-]{0,63}$/;
function due(value: unknown): Due {
  const b = exact(value, ['code', 'date']);
  if (typeof b.code !== 'string' || !DUE_CODE.test(b.code)) invalid();
  return { code: b.code, date: day(b.date) };
}
const HEX64 = /^[0-9a-f]{64}$/;
const WORKSPACE = /^[A-Za-z0-9_-]{1,80}$/;
/** Refusal and result codes are short upper-case words. */
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

function closeStrip(value: unknown): CloseStrip {
  const b = exact(value, CLOSE_ITEMS);
  return { bank: oneOf(b.bank, CLOSE_STEPS), gst: oneOf(b.gst, CLOSE_STEPS), tds: oneOf(b.tds, CLOSE_STEPS), tb: oneOf(b.tb, CLOSE_STEPS) };
}
function handover(value: unknown): Handover {
  const b = exact(value, HANDOVER_ITEMS);
  return { tb: oneOf(b.tb, READY_WORDS), bankRec: oneOf(b.bankRec, READY_WORDS), gstMatch: oneOf(b.gstMatch, READY_WORDS), tdsMatch: oneOf(b.tdsMatch, READY_WORDS), ageing: oneOf(b.ageing, READY_WORDS) };
}
function seat(value: unknown): Seat {
  const b = exact(value, ['seat', 'endsOn']);
  return { seat: oneOf(b.seat, ['ca', 'accountant'] as const), endsOn: dayOrNull(b.endsOn) };
}
const name = (value: unknown) => text(value, 120);

// ---------- Client side: castatus.* ----------

export function validateCaStatus(reply: unknown): CaStatus {
  const b = exact(reply, ['link', 'consent', 'wording', 'lastCardAt']);
  const link = b.link === null ? null : (() => { const l = exact(b.link, ['firmName', 'linkedAt']); return { firmName: name(l.firmName), linkedAt: time(l.linkedAt) }; })();
  const consent = b.consent === null ? null : (() => { const c = exact(b.consent, ['version', 'at']); return { version: text(c.version, 64), at: time(c.at) }; })();
  const w = exact(b.wording, ['version', 'approved', 'text']);
  const wording = { version: text(w.version, 64), approved: bool(w.approved), text: w.text === null ? null : text(w.text, 20000) };
  return { link, consent, wording, lastCardAt: timeOrNull(b.lastCardAt) };
}

export function validateLinked(reply: unknown): { firmName: string; linkedAt: string } {
  const b = exact(reply, ['firmName', 'linkedAt']);
  return { firmName: name(b.firmName), linkedAt: time(b.linkedAt) };
}

export function validateUnlinked(reply: unknown): { unlinked: true } {
  const b = exact(reply, ['unlinked']);
  if (b.unlinked !== true) invalid();
  return { unlinked: true };
}

export function validateConsent(reply: unknown): { consent: { version: string; at: string } | null } {
  const b = exact(reply, ['consent']);
  if (b.consent === null) return { consent: null };
  const c = exact(b.consent, ['version', 'at']);
  return { consent: { version: text(c.version, 64), at: time(c.at) } };
}

export const CARD_KEYS = ['v', 'kind', 'workspaceId', 'link', 'issuedAt', 'month', 'booksReadAt', 'close', 'cosign', 'questions', 'handover', 'dueNext', 'seats', 'consent', 'mac'] as const;

export function validateStatusCard(reply: unknown): StatusCard {
  const b = exact(reply, CARD_KEYS);
  if (b.v !== 1 || b.kind !== 'chausar.ca-status') invalid();
  if (typeof b.workspaceId !== 'string' || !WORKSPACE.test(b.workspaceId)) invalid();
  if (typeof b.link !== 'string' || !HEX64.test(b.link)) invalid();
  if (typeof b.mac !== 'string' || !HEX64.test(b.mac)) invalid();
  const cs = exact(b.cosign, ['meanings', 'recipes', 'accountClasses']);
  const q = exact(b.questions, ['count', 'oldestAt']);
  return {
    v: 1, kind: 'chausar.ca-status', workspaceId: b.workspaceId, link: b.link, issuedAt: time(b.issuedAt), month: month(b.month),
    booksReadAt: timeOrNull(b.booksReadAt), close: closeStrip(b.close),
    cosign: { meanings: nOrNull(cs.meanings), recipes: nOrNull(cs.recipes), accountClasses: nOrNull(cs.accountClasses) },
    questions: { count: nOrNull(q.count), oldestAt: timeOrNull(q.oldestAt) },
    handover: handover(b.handover), dueNext: b.dueNext === null ? null : due(b.dueNext), seats: list(b.seats, seat, 20),
    consent: text(b.consent, 64), mac: b.mac,
  };
}

// ---------- Firm side: firm.*, clients.* ----------

function firm(value: unknown): Firm {
  const b = exact(value, ['name', 'reportName', 'pricing']);
  if (b.pricing !== 'planned') invalid();
  return { name: name(b.name), reportName: b.reportName === null ? null : name(b.reportName), pricing: 'planned' };
}
export function validateFirmStatus(reply: unknown): { firm: Firm | null } {
  const b = exact(reply, ['firm']);
  return { firm: b.firm === null ? null : firm(b.firm) };
}
/** firm.setup and firm.name.set answer with the firm itself. */
export function validateFirmSet(reply: unknown): { firm: Firm } {
  const b = exact(reply, ['firm']);
  return { firm: firm(b.firm) };
}

function clientRow(value: unknown): ClientRow {
  const b = exact(value, ['clientId', 'name', 'state', 'booksReadAt', 'close', 'awaiting', 'dueNext', 'cardAt', 'stale', 'seat']);
  return {
    clientId: id(b.clientId), name: name(b.name), state: oneOf(b.state, ['invited', 'joined'] as const), booksReadAt: timeOrNull(b.booksReadAt),
    close: b.close === null ? null : closeStrip(b.close), awaiting: nOrNull(b.awaiting), dueNext: b.dueNext === null ? null : due(b.dueNext),
    cardAt: timeOrNull(b.cardAt), stale: bool(b.stale), seat: b.seat === null ? null : seat(b.seat),
  };
}
export function validateClientsList(reply: unknown): ClientsList {
  const b = exact(reply, ['month', 'rows', 'counts', 'nextCursor']);
  const c = exact(b.counts, ['needsYou', 'closeNotDone', 'all']);
  return {
    month: month(b.month), rows: list(b.rows, clientRow, 200),
    counts: { needsYou: n(c.needsYou), closeNotDone: n(c.closeNotDone), all: n(c.all) },
    nextCursor: b.nextCursor === null ? null : text(b.nextCursor, 512),
  };
}

const ONE_TIME_CODE = /^[A-Z2-7]{16}$/;
export function validateClientCode(reply: unknown): ClientCode {
  const b = exact(reply, ['clientId', 'code', 'guide']);
  if (typeof b.code !== 'string' || !ONE_TIME_CODE.test(b.code)) invalid();
  const g = exact(b.guide, ['html']);
  return { clientId: id(b.clientId), code: b.code, guide: { html: text(g.html, 1_000_000) } };
}

export function validateClientRemoved(reply: unknown): { clientId: string; removed: true } {
  const b = exact(reply, ['clientId', 'removed']);
  if (b.removed !== true) invalid();
  return { clientId: id(b.clientId), removed: true };
}

export function validateImported(reply: unknown): { clientId: string; cardAt: string } {
  const b = exact(reply, ['clientId', 'cardAt']);
  return { clientId: id(b.clientId), cardAt: time(b.cardAt) };
}

export function validateOpened(reply: unknown): Opened {
  const b = exact(reply, ['clientId', 'workspaceId', 'seat']);
  if (typeof b.workspaceId !== 'string' || !WORKSPACE.test(b.workspaceId)) invalid();
  return { clientId: id(b.clientId), workspaceId: b.workspaceId, seat: seat(b.seat) };
}

/** `workspaces.switch` does not exist yet; any object it answers with means it was asked. */
export function validateSwitched(reply: unknown): true {
  if (reply === null || typeof reply !== 'object' || Array.isArray(reply)) invalid();
  return true;
}

export function validateFirmToday(reply: unknown): FirmToday {
  const b = exact(reply, ['month', 'awaiting', 'due', 'totals']);
  const t = exact(b.totals, ['clients', 'awaiting']);
  return {
    month: month(b.month),
    awaiting: list(b.awaiting, (v) => {
      const r = exact(v, ['clientId', 'name', 'cosign', 'questions', 'total']);
      return { clientId: id(r.clientId), name: name(r.name), cosign: nOrNull(r.cosign), questions: nOrNull(r.questions), total: nOrNull(r.total) };
    }),
    due: list(b.due, (v) => {
      const r = exact(v, ['clientId', 'name', 'code', 'date']);
      const d = due({ code: r.code, date: r.date });
      return { clientId: id(r.clientId), name: name(r.name), code: d.code, date: d.date };
    }),
    totals: { clients: n(t.clients), awaiting: n(t.awaiting) },
  };
}

export function validateCosign(reply: unknown): { rows: CosignRow[] } {
  const b = exact(reply, ['rows']);
  return {
    rows: list(b.rows, (v) => {
      const r = exact(v, ['clientId', 'name', 'meanings', 'recipes', 'accountClasses']);
      return { clientId: id(r.clientId), name: name(r.name), meanings: nOrNull(r.meanings), recipes: nOrNull(r.recipes), accountClasses: nOrNull(r.accountClasses) };
    }),
  };
}

export function validateQuestions(reply: unknown): { rows: QuestionRow[] } {
  const b = exact(reply, ['rows']);
  return {
    rows: list(b.rows, (v) => {
      const r = exact(v, ['clientId', 'name', 'count', 'oldestAt']);
      return { clientId: id(r.clientId), name: name(r.name), count: nOrNull(r.count), oldestAt: timeOrNull(r.oldestAt) };
    }),
  };
}

export function validateHandover(reply: unknown): { month: string; rows: HandoverRow[] } {
  const b = exact(reply, ['month', 'rows']);
  return {
    month: month(b.month),
    rows: list(b.rows, (v) => {
      const r = exact(v, ['clientId', 'name', 'handover']);
      return { clientId: id(r.clientId), name: name(r.name), handover: r.handover === null ? null : handover(r.handover) };
    }),
  };
}

export function validateKinds(reply: unknown): { kinds: { id: ManyKind; needsMonth: boolean }[] } {
  const b = exact(reply, ['kinds']);
  return { kinds: list(b.kinds, (v) => { const k = exact(v, ['id', 'needsMonth']); return { id: oneOf(k.id, MANY_KINDS), needsMonth: bool(k.needsMonth) }; }, 50) };
}

export function validateBatch(reply: unknown): Batch {
  const b = exact(reply, ['batchId', 'kind', 'month', 'at', 'state', 'rows']);
  return {
    batchId: id(b.batchId), kind: text(b.kind, 64), month: b.month === null ? null : month(b.month), at: time(b.at),
    state: oneOf(b.state, ['prepared', 'held', 'sent'] as const),
    rows: list(b.rows, (v) => {
      const r = exact(v, ['clientId', 'name', 'result'], ['code']);
      const row: BatchRow = { clientId: id(r.clientId), name: name(r.name), result: oneOf(r.result, BATCH_RESULTS) };
      if ('code' in r) {
        if (typeof r.code !== 'string' || !CODE.test(r.code)) invalid();
        row.code = r.code;
      }
      return row;
    }, 500),
  };
}
export function validateBatches(reply: unknown): { batches: Batch[] } {
  const b = exact(reply, ['batches']);
  return { batches: list(b.batches, validateBatch, 50) };
}

function libraryItem(value: unknown): LibraryItem {
  const b = exact(value, ['id', 'kind', 'title', 'addedAt']);
  return { id: id(b.id), kind: oneOf(b.kind, LIBRARY_KINDS), title: name(b.title), addedAt: time(b.addedAt) };
}
export function validateLibrary(reply: unknown): { items: LibraryItem[] } {
  const b = exact(reply, ['items']);
  return { items: list(b.items, libraryItem) };
}
export function validateLibraryAdded(reply: unknown): { item: LibraryItem } {
  const b = exact(reply, ['item']);
  return { item: libraryItem(b.item) };
}
export function validateLibraryRemoved(reply: unknown): { id: string; removed: true } {
  const b = exact(reply, ['id', 'removed']);
  if (b.removed !== true) invalid();
  return { id: id(b.id), removed: true };
}
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}\.json$/;
export function validateLibraryExport(reply: unknown): { file: { name: string; json: string } } {
  const b = exact(reply, ['file']);
  const f = exact(b.file, ['name', 'json']);
  if (typeof f.name !== 'string' || !FILE_NAME.test(f.name)) invalid();
  return { file: { name: f.name, json: text(f.json, 64 * 1024) } };
}

function clientsScope(value: unknown): '*' | string[] {
  if (value === '*') return '*';
  const ids = list(value, id, 10000);
  if (new Set(ids).size !== ids.length) invalid();
  return ids;
}
export function validatePeople(reply: unknown): { people: PersonRow[] } {
  const b = exact(reply, ['people']);
  return {
    people: list(b.people, (v) => {
      const r = exact(v, ['memberId', 'name', 'role', 'clients']);
      return { memberId: id(r.memberId), name: text(r.name, 200), role: text(r.role, 64), clients: clientsScope(r.clients) };
    }),
  };
}
export function validateAssigned(reply: unknown): { memberId: string; clients: '*' | string[] } {
  const b = exact(reply, ['memberId', 'clients']);
  return { memberId: id(b.memberId), clients: clientsScope(b.clients) };
}

/** A status card someone pasted or chose as a file: only that it is one JSON object is checked here.
 *  Whether it is a status card at all is the engine's decision (CA_CARD_INVALID). */
export function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The one-time code a client types in to link its firm: 16 letters A-Z and digits 2-7. */
export function normaliseLinkCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return ONE_TIME_CODE.test(code) ? code : null;
}
