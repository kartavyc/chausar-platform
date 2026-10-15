/**
 * Firm side of the CA console (`firm.*`, `clients.*`), in a workspace whose shell is `ca-firm`.
 * The firm holds status only: for each client the label the firm typed, the link code it issued
 * (the HMAC key, inside the vault) and its digest, and the fields of the last status card that
 * client's own workspace issued. These methods never call into a client's data; they read only
 * stored cards. Messages to clients always wait for a person, and there is no relay yet.
 */
import { audit, check, newId, now, type Context, type State } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { laneState, peekLane, shellKind } from './state.ts';
import {
  clockOf, closeMonth, fields, indiaDay, isMonth, label, linkDigest, macMatches, newLinkCode, parseCard,
  type CardSeat, type CloseStrip, type Handover, type StatusCard,
} from './card.ts';

type StoredCard = Omit<StatusCard, 'mac' | 'v' | 'kind' | 'link'>;
type Client = { clientId: string; name: string; code: string; link: string; addedAt: string; workspaceId: string | null; card: StoredCard | null };
type BatchRow = { clientId: string; name: string; result: 'ready' | 'not-joined' | 'no-status' | 'not-assigned' | 'held' | 'sent'; code?: string };
type Batch = { batchId: string; kind: string; month: string | null; at: string; state: 'prepared' | 'held' | 'sent'; rows: BatchRow[]; by: string };
type LibraryItem = { id: string; kind: 'recipe' | 'job' | 'check'; title: string; addedAt: string; body: Record<string, unknown> };
type Firm = { name: string; reportName: string | null; at: string; by: string; clients: Record<string, Client>; people: Record<string, '*' | string[]>; batches: Batch[]; library: LibraryItem[] };

const STALE_MS = 3 * 86_400_000;
const MAX_CLIENTS = 2000, MAX_BATCHES = 50, MAX_LIBRARY = 500, MAX_BODY = 32 * 1024;
const KINDS = [{ id: 'gst-guide', needsMonth: true }, { id: 'month-end-reminder', needsMonth: true }, { id: 'documents-request', needsMonth: false }] as const;
const LIB_KINDS = ['recipe', 'job', 'check'] as const;
const ID = /^[a-z]+_[A-Za-z0-9-]{1,80}$/;

const notFirm = 'This workspace is not a CA firm\'s console.';
const peekFirm = (state: State): Firm | undefined => shellKind(state) === 'ca-firm' ? peekLane(state)?.firm as Firm | undefined : undefined;
function readFirm(state: State): Firm { const firm = peekFirm(state); check(firm, 'CA_NOT_A_FIRM', notFirm); return firm; }
function writeFirm(state: State): Firm {
  check(shellKind(state) === 'ca-firm', 'CA_NOT_A_FIRM', notFirm);
  const firm = laneState(state).firm as Firm | undefined; check(firm, 'CA_NOT_A_FIRM', notFirm);
  firm.clients ??= {}; firm.people ??= {}; firm.batches ??= []; firm.library ??= [];
  return firm;
}
const firmView = (firm: Firm | undefined) => firm ? { name: firm.name, reportName: firm.reportName, pricing: 'planned' as const } : null;
const clientOf = (firm: Firm, clientId: unknown): Client => {
  const client = typeof clientId === 'string' && Object.hasOwn(firm.clients, clientId) ? firm.clients[clientId] : undefined;
  check(client, 'CA_CLIENT_NOT_FOUND', 'There is no such client in this firm.'); return client;
};
const sorted = (firm: Firm) => Object.values(firm.clients).sort((a, b) => a.name.localeCompare(b.name) || a.clientId.localeCompare(b.clientId));

// ---- Who in the firm may open which client (CA-08) -----------------------------------------------------
function memberOf(state: State, ctx: Context) {
  const member = state.members.find(m => m.id === ctx.memberId);
  check(member?.active, 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.'); return member;
}
const everyone = (role: string) => role === 'owner' || role === 'cofounder';
function assignment(firm: Firm, member: { id: string; role: string }): '*' | string[] {
  if (everyone(member.role)) return '*';
  return Object.hasOwn(firm.people, member.id) ? firm.people[member.id]! : [];
}
function mayOpen(state: State, firm: Firm, ctx: Context): (clientId: string) => boolean {
  const scope = assignment(firm, memberOf(state, ctx));
  return scope === '*' ? () => true : (id: string) => scope.includes(id);
}

// ---- Status from stored cards -----------------------------------------------------------------------------
const joined = (client: Client) => !!client.card && client.card.seats.length > 0;
const stale = (client: Client, ms: number) => !client.card || ms - Date.parse(client.card.issuedAt) > STALE_MS;
const sum = (values: (number | null)[]) => values.every(v => v === null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0);
const cosignTotal = (client: Client) => client.card ? sum([client.card.cosign.meanings, client.card.cosign.recipes, client.card.cosign.accountClasses]) : null;
const questionCount = (client: Client) => client.card?.questions.count ?? null;
/** The seat a firm member would open the client with: an accountant seat before a CA seat, and only one not yet ended. */
function seatToOpen(client: Client, day: string): CardSeat | null {
  const live = (client.card?.seats ?? []).filter(s => s.endsOn === null || s.endsOn >= day);
  const pick = live.find(s => s.seat === 'accountant') ?? [...live].sort((a, b) => String(b.endsOn ?? '9999').localeCompare(String(a.endsOn ?? '9999')))[0];
  return pick ? { seat: pick.seat, endsOn: pick.endsOn } : null;
}
const closeOf = (client: Client, month: string): CloseStrip | null => client.card && client.card.month === month ? { ...client.card.close } : null;
const handoverOf = (client: Client, month: string): Handover | null => client.card && client.card.month === month ? { ...client.card.handover } : null;
const needsYou = (client: Client) => (cosignTotal(client) ?? 0) > 0 || (questionCount(client) ?? 0) > 0;
const closeNotDone = (client: Client, month: string) => { const close = closeOf(client, month); return !close || Object.values(close).some(step => step !== 'done'); };

function row(client: Client, month: string, ms: number) {
  const day = indiaDay(ms), due = client.card?.dueNext && client.card.dueNext.date >= day ? { ...client.card.dueNext } : null;
  return { clientId: client.clientId, name: client.name, state: joined(client) ? 'joined' as const : 'invited' as const, booksReadAt: client.card?.booksReadAt ?? null,
    close: closeOf(client, month), awaiting: cosignTotal(client), dueNext: due, cardAt: client.card?.issuedAt ?? null, stale: stale(client, ms), seat: seatToOpen(client, day) };
}

/** Everything a firm read needs: the firm, the clients this caller may open, the clock. */
function scope(host: ModuleHost, ctx: Context) {
  const state = host.store.read(), firm = readFirm(state), may = mayOpen(state, firm, ctx), ms = clockOf(host);
  return { state, firm, ms, day: indiaDay(ms), month: closeMonth(indiaDay(ms)), clients: sorted(firm).filter(c => may(c.clientId)), may };
}

// ---- The one-page guide for a client (CA-09) -------------------------------------------------------------
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/**
 * The guide carries no code: like the accountant's guide in trust-ext, the link code is shown once in the reply's `code`
 * field and reaches the client separately, so a forwarded page alone cannot link anyone to the firm.
 */
export function clientGuide(firmName: string, clientName: string): string {
  const firm = escape(firmName);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Joining ${firm} on Chausar</title></head><body>`
    + `<h1>Joining ${firm} on Chausar</h1><p>Hello ${escape(clientName)}. ${firm} would like to see the status of your books in Chausar, so that it can tell when your month's close needs it.</p>`
    + `<h2>How to join</h2><ol><li>Install Chausar on your computer and open your business's workspace.</li>`
    + `<li>In Trust, then People, give ${firm} a seat: a CA seat that reads and exports until a date you choose, or an accountant seat that also prepares and never approves money.</li>`
    + `<li>In Trust, link ${firm} with the link code it gave you, then read the wording and agree to share status.</li></ol>`
    + `<p>The link code arrives separately, straight from ${firm}. It is not in this page.</p>`
    + `<h2>What is shared</h2><ul><li>Dates: when your books were last read, and the next due date from the published calendar.</li>`
    + `<li>Counts: how many items wait for the firm to co-sign, and how many questions you made for a person.</li>`
    + `<li>States: each step of the month's close (bank, GST, TDS, trial balance) and of the month-end hand-over, and the seats you gave, without names.</li></ul>`
    + `<h2>What is never shared</h2><ul><li>Figures: no amount, balance or total.</li><li>Names of your customers or suppliers.</li><li>Documents or files.</li></ul>`
    + `<p>To see figures, a person of ${firm} opens your workspace with the seat you gave, and only until that seat ends. You can unlink the firm or remove the seat at any time.</p></body></html>`;
}

// ---- The firm's library (CA-07): structure only --------------------------------------------------------
const VALUE_PATTERNS = [/\d{3,}/, /[^\s@]+@[^\s@]+\.[^\s@]+/, /(?:\d[\s().-]*){8,}/, /\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]/, /[A-Z]{5}\d{4}[A-Z]/, /₹|\brs\.?\s*\d|\binr\s*\d/i];
const NOT_STRUCTURE = 'CA_LIBRARY_NOT_STRUCTURE';
const notStructure = 'The library keeps structure only. Take out figures, e-mails, phone numbers, GSTINs, PANs and amounts.';
function structureOnly(value: unknown, depth = 0): void {
  check(depth <= 8, NOT_STRUCTURE, notStructure);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { check(Number.isInteger(value) && value >= 0 && value <= 99, NOT_STRUCTURE, notStructure); return; }
  if (typeof value === 'string') { check(!VALUE_PATTERNS.some(p => p.test(value)), NOT_STRUCTURE, notStructure); return; }
  if (Array.isArray(value)) { for (const item of value) structureOnly(item, depth + 1); return; }
  check(typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)), NOT_STRUCTURE, notStructure);
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    check(key.length <= 64 && !VALUE_PATTERNS.some(p => p.test(key)), NOT_STRUCTURE, notStructure); structureOnly(item, depth + 1);
  }
}
const itemView = (item: LibraryItem) => ({ id: item.id, kind: item.kind, title: item.title, addedAt: item.addedAt });
const batchView = (batch: Batch) => { const { by: _by, ...rest } = batch; return structuredClone(rest); };

// ---- Cursor for the client list: opaque, bound to its filter -------------------------------------------
const encodeCursor = (filter: string, client: Client) => Buffer.from(JSON.stringify([filter, client.name, client.clientId]), 'utf8').toString('base64url');
function decodeCursor(cursor: unknown, filter: string): [string, string] | null {
  if (cursor === undefined || cursor === null) return null;
  let parsed: unknown = null;
  try { if (typeof cursor === 'string' && cursor.length <= 800 && /^[A-Za-z0-9_-]+$/.test(cursor)) parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { parsed = null; }
  check(Array.isArray(parsed) && parsed.length === 3 && parsed[0] === filter && typeof parsed[1] === 'string' && typeof parsed[2] === 'string', 'CA_CURSOR_INVALID', 'This page of the list is no longer valid. Start from the top.');
  return [parsed[1] as string, parsed[2] as string];
}

function newCodeFor(): { code: string; link: string } { const code = newLinkCode(); return { code, link: linkDigest(code) }; }

export const firmMethods: Record<string, MethodSpec> = {
  'firm.status': { permission: 'read', handler(_ctx, payload, host) { fields(payload, []); return { firm: firmView(peekFirm(host.store.read())) }; } },
  'firm.setup': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['name']); const name = label(input.name, 'CA_REQUEST_INVALID', 'Give the firm\'s name in up to 120 characters.');
    return host.store.update(state => {
      check(shellKind(state) !== 'enterprise', 'CA_SHELL_TAKEN', 'This workspace opens as a company install, so it cannot also be a firm\'s console.');
      const lane = laneState(state), at = now();
      const firm = (lane.firm ??= { name, reportName: null, at, by: ctx.memberId, clients: {}, people: {}, batches: [], library: [] }) as Firm;
      firm.name = name; lane.shell = { kind: 'ca-firm', by: ctx.memberId, at };
      audit(state, 'firm.setup', { by: ctx.memberId });
      return { firm: firmView(firm) };
    });
  } },
  'firm.name.set': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['name', 'reportName']);
    const name = input.name === undefined ? undefined : label(input.name, 'CA_REQUEST_INVALID', 'Give the firm\'s name in up to 120 characters.');
    const reportName = input.reportName === undefined || input.reportName === null ? input.reportName : label(input.reportName, 'CA_REQUEST_INVALID', 'Give the name for reports in up to 120 characters.');
    return host.store.update(state => {
      const firm = writeFirm(state);
      if (name !== undefined) firm.name = name;
      if (reportName !== undefined) firm.reportName = reportName;
      audit(state, 'firm.name.set', { by: ctx.memberId });
      return { firm: firmView(firm) };
    });
  } },
  'clients.list': { permission: 'read', handler(ctx, payload, host) {
    const input = fields(payload, ['filter', 'cursor', 'limit']);
    const filter = input.filter ?? 'all';
    check(['needs-you', 'close-not-done', 'all'].includes(filter), 'CA_REQUEST_INVALID', 'Choose Needs you, Close not done or All.');
    const limit = input.limit ?? 50; check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 200, 'CA_REQUEST_INVALID', 'Choose between 1 and 200 rows.');
    const after = decodeCursor(input.cursor, filter);
    const { clients, month, ms } = scope(host, ctx);
    const keep = (c: Client) => filter === 'needs-you' ? needsYou(c) : filter === 'close-not-done' ? closeNotDone(c, month) : true;
    const matching = clients.filter(keep);
    const start = after ? matching.findIndex(c => c.name.localeCompare(after[0]) > 0 || (c.name.localeCompare(after[0]) === 0 && c.clientId.localeCompare(after[1]) > 0)) : 0;
    const page = start < 0 ? [] : matching.slice(start, start + limit);
    const more = start >= 0 && start + limit < matching.length;
    return { month, rows: page.map(c => row(c, month, ms)),
      counts: { needsYou: clients.filter(needsYou).length, closeNotDone: clients.filter(c => closeNotDone(c, month)).length, all: clients.length },
      nextCursor: more ? encodeCursor(filter, page.at(-1)!) : null };
  } },
  'clients.add': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['name']); const name = label(input.name, 'CA_REQUEST_INVALID', 'Give the client\'s name in up to 120 characters.');
    return host.store.update(state => {
      const firm = writeFirm(state);
      check(Object.keys(firm.clients).length < MAX_CLIENTS, 'CA_CLIENT_LIMIT', 'This firm already has as many clients as one console holds.');
      const clientId = newId('client'), { code, link } = newCodeFor();
      firm.clients[clientId] = { clientId, name, code, link, addedAt: now(), workspaceId: null, card: null };
      audit(state, 'clients.added', { clientId, by: ctx.memberId });
      return { clientId, code, guide: { html: clientGuide(firm.name, name) } };
    });
  } },
  'clients.guide': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['clientId']);
    return host.store.update(state => {
      const firm = writeFirm(state), client = clientOf(firm, input.clientId), { code, link } = newCodeFor();
      // A new code: the old one stops matching, so a card made with it is refused as from an unknown client.
      client.code = code; client.link = link;
      audit(state, 'clients.guide.reissued', { clientId: client.clientId, by: ctx.memberId });
      return { clientId: client.clientId, code, guide: { html: clientGuide(firm.name, client.name) } };
    });
  } },
  'clients.remove': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['clientId']);
    return host.store.update(state => {
      const firm = writeFirm(state), client = clientOf(firm, input.clientId);
      delete firm.clients[client.clientId];
      for (const [id, list] of Object.entries(firm.people)) if (Array.isArray(list)) firm.people[id] = list.filter(c => c !== client.clientId);
      audit(state, 'clients.removed', { clientId: client.clientId, by: ctx.memberId });
      return { clientId: client.clientId, removed: true };
    });
  } },
  'clients.statusImport': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = fields(payload, ['card']); readFirm(host.store.read());
    const card = parseCard(input.card);
    return host.store.update(state => {
      const firm = writeFirm(state);
      const client = Object.values(firm.clients).find(c => c.link === card.link);
      check(client, 'CA_CARD_UNKNOWN_CLIENT', 'This card was not made with a link code this firm issued.');
      check(macMatches(client.code, card), 'CA_CARD_FORGED', 'This card was not made by the client\'s own workspace.');
      check(client.workspaceId === null || client.workspaceId === card.workspaceId, 'CA_CARD_FORGED', 'This card came from a different workspace than the client\'s.');
      check(!client.card || card.issuedAt > client.card.issuedAt, 'CA_CARD_STALE', 'This card is not newer than the one the firm already has.');
      const { mac: _mac, v: _v, kind: _kind, link: _link, ...stored } = card;
      client.workspaceId = card.workspaceId; client.card = stored;
      audit(state, 'clients.status.imported', { clientId: client.clientId, by: ctx.memberId });
      return { clientId: client.clientId, cardAt: card.issuedAt };
    });
  } },
  'clients.statusFetch': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, []); readFirm(host.store.read());
    check(false, 'CA_RELAY_NOT_DEPLOYED', 'Status can only be imported from a card for now: no relay service is deployed.');
  } },
  'clients.open': { permission: 'read', async handler(ctx, payload, host) {
    const input = fields(payload, ['clientId']);
    const { firm, may, day } = scope(host, ctx), client = clientOf(firm, input.clientId);
    check(may(client.clientId), 'CA_CLIENT_NOT_ASSIGNED', 'You are not assigned to this client. An owner of the firm assigns clients in People.');
    check(joined(client) && client.workspaceId, 'CA_CLIENT_NOT_JOINED', 'This client has not joined yet: invited, not joined.');
    const seat = seatToOpen(client, day);
    check(seat, 'CA_SEAT_ENDED', 'Every seat this client gave the firm has ended. Ask the client for a new seat.');
    await host.store.update(state => { audit(state, 'clients.opened', { clientId: client.clientId, by: ctx.memberId }); });
    return { clientId: client.clientId, workspaceId: client.workspaceId, seat };
  } },
  'firm.today': { permission: 'read', handler(ctx, payload, host) {
    fields(payload, []); const { clients, month, day } = scope(host, ctx);
    const awaiting = clients.map(c => { const cosign = cosignTotal(c), questions = questionCount(c); return { clientId: c.clientId, name: c.name, cosign, questions, total: sum([cosign, questions]) }; })
      .filter(a => (a.total ?? 0) > 0);
    const due = clients.flatMap(c => c.card?.dueNext && c.card.dueNext.date >= day ? [{ clientId: c.clientId, name: c.name, code: c.card.dueNext.code, date: c.card.dueNext.date }] : [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    return { month, awaiting, due, totals: { clients: clients.length, awaiting: awaiting.reduce((n, a) => n + (a.total ?? 0), 0) } };
  } },
  'firm.cosign': { permission: 'read', handler(ctx, payload, host) {
    fields(payload, []);
    return { rows: scope(host, ctx).clients.map(c => ({ clientId: c.clientId, name: c.name, meanings: c.card?.cosign.meanings ?? null, recipes: c.card?.cosign.recipes ?? null, accountClasses: c.card?.cosign.accountClasses ?? null })) };
  } },
  'firm.questions': { permission: 'read', handler(ctx, payload, host) {
    fields(payload, []);
    return { rows: scope(host, ctx).clients.map(c => ({ clientId: c.clientId, name: c.name, count: c.card?.questions.count ?? null, oldestAt: c.card?.questions.oldestAt ?? null })) };
  } },
  'firm.handover': { permission: 'read', handler(ctx, payload, host) {
    const input = fields(payload, ['clientId']); const { clients, month, firm, may } = scope(host, ctx);
    let list = clients;
    if (input.clientId !== undefined) {
      const client = clientOf(firm, input.clientId);
      check(may(client.clientId), 'CA_CLIENT_NOT_ASSIGNED', 'You are not assigned to this client. An owner of the firm assigns clients in People.');
      list = [client];
    }
    return { month, rows: list.map(c => ({ clientId: c.clientId, name: c.name, handover: handoverOf(c, month) })) };
  } },
  'firm.many.kinds': { permission: 'read', handler(_ctx, payload, host) { fields(payload, []); readFirm(host.store.read()); return { kinds: KINDS.map(k => ({ ...k })) }; } },
  'firm.many.prepare': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = fields(payload, ['kind', 'clientIds', 'month']);
    const kind = KINDS.find(k => k.id === input.kind); check(kind, 'CA_REQUEST_INVALID', 'Choose one of the fixed steps.');
    check(Array.isArray(input.clientIds) && input.clientIds.length >= 1 && input.clientIds.length <= 500 && new Set(input.clientIds).size === input.clientIds.length, 'CA_REQUEST_INVALID', 'Choose between 1 and 500 different clients.');
    check(kind.needsMonth ? input.month === undefined || isMonth(input.month) : input.month === undefined, 'CA_REQUEST_INVALID', kind.needsMonth ? 'Choose a month as YYYY-MM.' : 'This step has no month.');
    const { firm, may, month, ms } = scope(host, ctx);
    const rows: BatchRow[] = input.clientIds.map((id: unknown) => {
      const client = clientOf(firm, id);
      const result = !may(client.clientId) ? 'not-assigned' as const : !joined(client) ? 'not-joined' as const : stale(client, ms) ? 'no-status' as const : 'ready' as const;
      return { clientId: client.clientId, name: client.name, result };
    });
    const batch: Batch = { batchId: newId('batch'), kind: kind.id, month: kind.needsMonth ? input.month ?? month : null, at: now(), state: 'prepared', rows, by: ctx.memberId };
    await host.store.update(state => {
      const live = writeFirm(state); live.batches.push(structuredClone(batch));
      if (live.batches.length > MAX_BATCHES) live.batches.splice(0, live.batches.length - MAX_BATCHES);
      audit(state, 'firm.many.prepared', { batchId: batch.batchId, kind: batch.kind, rows: rows.length, by: ctx.memberId });
    });
    return batchView(batch);
  } },
  'firm.many.send': { permission: 'approve', async handler(ctx, payload, host) {
    const input = fields(payload, ['batchId']);
    return host.store.update(state => {
      const firm = writeFirm(state), batch = firm.batches.find(b => b.batchId === input.batchId);
      check(batch, 'CA_BATCH_NOT_FOUND', 'This batch is no longer on record.');
      check(batch.state === 'prepared', 'CA_BATCH_DONE', 'This batch was already sent or held.');
      // A message to someone outside the firm always waits for a person, and no relay exists yet: every ready row is held.
      for (const r of batch.rows) if (r.result === 'ready') { r.result = 'held'; r.code = 'CA_RELAY_NOT_DEPLOYED'; }
      batch.state = 'held';
      audit(state, 'firm.many.held', { batchId: batch.batchId, by: ctx.memberId });
      return batchView(batch);
    });
  } },
  'firm.many.list': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, []); return { batches: [...readFirm(host.store.read()).batches].reverse().map(batchView) };
  } },
  'firm.library.list': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, []); return { items: [...readFirm(host.store.read()).library].reverse().map(itemView) };
  } },
  'firm.library.add': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = fields(payload, ['kind', 'title', 'body']);
    check(LIB_KINDS.includes(input.kind), 'CA_REQUEST_INVALID', 'Choose a recipe, a job or a check.');
    const title = label(input.title, 'CA_REQUEST_INVALID', 'Give a title in up to 120 characters.');
    check(input.body !== null && typeof input.body === 'object' && !Array.isArray(input.body), 'CA_REQUEST_INVALID', 'The body is one object.');
    let size = Infinity; try { size = Buffer.byteLength(JSON.stringify(input.body), 'utf8'); } catch { /* not JSON: refused below */ }
    check(size <= MAX_BODY, 'CA_REQUEST_INVALID', 'The body is larger than 32 KB.');
    structureOnly(title); structureOnly(input.body);
    const item: LibraryItem = { id: newId('library'), kind: input.kind, title, addedAt: now(), body: JSON.parse(JSON.stringify(input.body)) };
    await host.store.update(state => {
      const firm = writeFirm(state); check(firm.library.length < MAX_LIBRARY, 'CA_LIBRARY_FULL', 'The library is full. Remove an item first.');
      firm.library.push(structuredClone(item)); audit(state, 'firm.library.added', { id: item.id, kind: item.kind, by: ctx.memberId });
    });
    return { item: itemView(item) };
  } },
  'firm.library.remove': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['id']);
    return host.store.update(state => {
      const firm = writeFirm(state), index = firm.library.findIndex(i => i.id === input.id);
      check(index >= 0, 'CA_LIBRARY_NOT_FOUND', 'This library item is no longer on record.');
      firm.library.splice(index, 1); audit(state, 'firm.library.removed', { id: input.id, by: ctx.memberId });
      return { id: input.id, removed: true };
    });
  } },
  'firm.library.export': { permission: 'read', handler(_ctx, payload, host) {
    const input = fields(payload, ['id']);
    const item = readFirm(host.store.read()).library.find(i => i.id === input.id);
    check(item, 'CA_LIBRARY_NOT_FOUND', 'This library item is no longer on record.');
    const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
    return { file: { name: `chausar-library-${item.kind}-${slug}.json`, json: JSON.stringify({ format: 'chausar.firm-library', v: 1, kind: item.kind, title: item.title, body: item.body }, null, 2) } };
  } },
  'firm.people.list': { permission: 'read', handler(_ctx, payload, host) {
    fields(payload, []); const state = host.store.read(), firm = readFirm(state);
    return { people: state.members.filter(m => m.active).map(m => { const a = assignment(firm, m); return { memberId: m.id, name: m.name, role: m.role, clients: a === '*' ? '*' : [...a] }; }) };
  } },
  'firm.people.assign': { permission: 'admin', async handler(ctx, payload, host) {
    const input = fields(payload, ['memberId', 'clients']);
    check(input.clients === '*' || (Array.isArray(input.clients) && input.clients.length <= MAX_CLIENTS && input.clients.every((id: unknown) => typeof id === 'string' && ID.test(id))), 'CA_REQUEST_INVALID', 'Choose every client, or a list of clients.');
    return host.store.update(state => {
      const firm = writeFirm(state), member = state.members.find(m => m.id === input.memberId && m.active);
      check(member, 'MEMBER_NOT_FOUND', 'Member was not found.');
      check(!everyone(member.role), 'CA_OWNER_SEES_ALL', 'An owner or cofounder of the firm opens every client.');
      const clients = input.clients === '*' ? '*' as const : [...new Set(input.clients as string[])].map(id => clientOf(firm, id).clientId).sort();
      firm.people[member.id] = clients;
      audit(state, 'firm.people.assigned', { memberId: member.id, by: ctx.memberId });
      return { memberId: member.id, clients: clients === '*' ? '*' : [...clients] };
    });
  } },
};
