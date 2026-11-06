// Chausar venture launcher, mini apps (wave 6 package 6H1, DECISIONS D39). The owner asks for a small tool and the
// owner's AI writes it: one HTML page, kept as data in a venture-mini-app record with its versions. Code checks the
// code (frame.ts appCodeFindings) and works out from it which permissions it needs (permissionsOf): no more than the
// tools its code names. The Ink app runs it only in a locked frame (sandbox without allow-same-origin, served by the
// sandbox proxy with MINI_FRAME_CSP: no network, no frames, no forms) and relays the app's MCP Apps tools/call
// requests to venture.apps.call. Nothing answers before the owner allows the app on its permission screen; reads
// answer within the grant (names only for clients, receipt-backed displays for invoices); notes are the app's own and
// go when it is deleted; amounts come from the calculator with a receipt; an action becomes a card on Today
// (draftProposal, raised at once, decided like any other, under the method's own gates). Versions with undo, pin to
// Today, export as one file, Turn off and delete.
import { check, type Context, type State } from '../../contracts.ts';
import type {
  Json, MiniAppCallResult, MiniAppCard, MiniAppMessage, MiniAppRecord, MiniAppVersion, MiniAppView, ProposalKind, ProposalRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { digest, exactPayload, identifier, listRecords, requireAppChannel, tidyWords, ventureAction } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { ownerToday } from '../local-day.ts';
import { APP_PREVIEW_ONLY, DATA_READS, NOT_IN_PREVIEW, sampleAnswer } from './sample-data.ts';
import { chatCall } from '../agents/answer.ts';
import { chatRoute } from '../agents/consent.ts';
import { secretFindings } from '../core/secrets.ts';
import { short } from '../views/shared.ts';
import { proposalRowId, targetOf } from '../chief/gate.ts';
import { draftProposal } from '../chief/store.ts';
import { statementPlan } from '../money/statement.ts';
import { sumReceipt } from '../money/sums.ts';
import { appCalcPlan, appCalcSubject } from './calc.ts';
import { makeTask } from './make.ts';
import { APP_PERMISSIONS, APP_TOOLS, appCodeFindings, appDocument, appUri, exportDocument, permissionsOf, type AppPermission } from './frame.ts';
import { APP_ERRORS, APP_IDEAS, type AppIdea, APP_LINES, APP_NEVER_LINE, madeLine, PERMISSION_WORDS } from './words.ts';

/** At most this many versions are kept; the oldest that is not in use goes first. */
export const APP_VERSIONS_KEPT = 20;
/** An app's own notes: at most this many, each at most NOTE_MAX characters, all of them at most NOTES_MAX. */
export const NOTES_KEYS = 500;
export const NOTE_MAX = 20_000;
export const NOTES_MAX = 100_000;
/** An app may have at most this many cards waiting on Today at once (untrusted code must not flood Today). */
export const APP_OPEN_CARDS = 10;
const ASK_MAX = 600;
const NOTE_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

// ---------------------------------------------------------------------------
// Reading an app
// ---------------------------------------------------------------------------

function appIn(state: State, ventureId: string, id: string): MiniAppRecord {
  const record = listRecords(state, 'venture-mini-app', ventureId).find(item => item.id === id);
  check(record, 'APP_NOT_FOUND', APP_ERRORS.notFound);
  return record;
}
const currentOf = (record: MiniAppRecord): MiniAppVersion => record.versions.find(item => item.version === record.current)!;
const ordered = (items: Iterable<AppPermission>): AppPermission[] => { const set = new Set(items); return APP_PERMISSIONS.filter(item => set.has(item)); };

/** What answers now: the current version's needs that the owner allowed. */
export function allowedOf(record: MiniAppRecord): AppPermission[] {
  if (!record.grant) return [];
  const granted = new Set(record.grant.permissions);
  return currentOf(record).permissions.filter(item => granted.has(item));
}
const toolsNow = (record: MiniAppRecord): string[] => { const allowed = new Set(allowedOf(record)); return Object.keys(APP_TOOLS).filter(tool => allowed.has(APP_TOOLS[tool]!)); };
/** The digest Allow takes: this app, the version on screen and exactly the permissions the screen lists. */
const grantDigest = (record: MiniAppRecord): string => digest({ app: record.id, version: record.current, permissions: currentOf(record).permissions });

function askOf(record: MiniAppRecord): MiniAppView['ask'] {
  const needs = currentOf(record).permissions;
  const added = needs.filter(item => !record.grant?.permissions.includes(item));
  if (!added.length) return null;
  return { digest: grantDigest(record), added, first: record.grant === null };
}

function cardOf(record: MiniAppRecord): MiniAppCard {
  const version = currentOf(record);
  return {
    id: record.id, name: record.name, version: record.current, summary: version.summary,
    reads: version.permissions.map(item => PERMISSION_WORDS[item].chip), pinned: record.pinned, madeAt: record.at, allowed: askOf(record) === null,
  };
}

/**
 * C4 task 29: whether the app's own reads have nothing to show now: it reads the business and every read it may make is
 * empty. Only then does the app offer Preview with sample data.
 */
function readsEmpty(state: State, record: MiniAppRecord): boolean {
  const reads = toolsNow(record).filter(tool => DATA_READS.has(tool));
  if (!reads.length) return false;
  return reads.every(tool => (tool === 'clients_list' ? listRecords(state, 'venture-client', record.ventureId).every(client => client.self)
    : tool === 'orders_list' ? listRecords(state, 'venture-order', record.ventureId).length === 0
      : listRecords(state, 'venture-invoice', record.ventureId).every(invoice => invoice.number === null || invoice.status === 'draft')));
}

export function appView(record: MiniAppRecord, state: State): MiniAppView {
  const version = currentOf(record);
  return {
    ...cardOf(record), empty: readsEmpty(state, record),
    uri: appUri(record.id, record.current), document: appDocument(version.html, record.name),
    versions: record.versions.map(item => ({ version: item.version, at: item.at, summary: item.summary, current: item.version === record.current })),
    permissions: version.permissions.map(id => ({ id, verb: PERMISSION_WORDS[id].verb, line: PERMISSION_WORDS[id].line })),
    grant: record.grant ? { permissions: [...record.grant.permissions], at: record.grant.at } : null,
    ask: askOf(record), tools: toolsNow(record), messages: record.messages.map(item => ({ ...item })), never: APP_NEVER_LINE,
  };
}

const appId = (payload: unknown, fields: readonly string[] = ['app']) => {
  const body = exactPayload(payload, fields, fields);
  return { body, id: identifier(body.app, 'App') };
};

/** venture.apps.list {} (read): the business's apps, newest first, with ideas and the line about what apps never do. */
export async function appsListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ apps: MiniAppCard[]; ideas: AppIdea[]; never: string }> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const apps = listRecords(state, 'venture-mini-app', venture.id).map(cardOf).reverse();
  return { apps, ideas: APP_IDEAS.map(idea => ({ ...idea })), never: APP_NEVER_LINE };
}

/** venture.apps.get { app } (read): one app, opened, with its frame document and its permission screen if it needs one. */
export async function appsGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ app: MiniAppView }> {
  const { id } = appId(payload);
  const { state, venture } = readAs(deps, ctx, 'read');
  return { app: appView(appIn(state, venture.id, id), state) };
}

// ---------------------------------------------------------------------------
// Making and changing an app
// ---------------------------------------------------------------------------

function trimVersions(versions: MiniAppVersion[], current: number): MiniAppVersion[] {
  const kept = [...versions];
  while (kept.length > APP_VERSIONS_KEPT) {
    const index = kept.findIndex(item => item.version !== current);
    kept.splice(index, 1);
  }
  return kept;
}

/**
 * venture.apps.make { ask, app? } (prepare, app only): the owner's AI writes a new app, or a new version of app. The
 * owner's words go to their AI (after the chat consent); its answer is checked as words, then as code: code that
 * reaches outside or writes money is not kept (APP_CODE_REFUSED with the reasons). Chausar's reply in the making chat
 * is written by code from what the code uses. A change keeps the app's name, grant and notes; new needs ask again.
 */
export async function appsMakeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ app: MiniAppView; line: string }> {
  requireAppChannel(ctx, 'venture.apps.make');
  const body = exactPayload(payload, ['ask', 'app'], ['ask']);
  check(typeof body.ask === 'string', 'INVALID_VENTURE_REQUEST', APP_ERRORS.askEmpty);
  const ask = tidyWords(body.ask);
  check(ask.length >= 1 && ask.length <= ASK_MAX, 'INVALID_VENTURE_REQUEST', APP_ERRORS.askEmpty);
  check(secretFindings(ask).length === 0, 'INVALID_VENTURE_REQUEST', APP_ERRORS.askSecret);
  const changing = body.app === undefined ? null : identifier(body.app, 'App');
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const before = changing ? appIn(state, venture.id, changing) : null;
  const route = chatRoute(deps.models.status(ctx));
  check(route, 'APP_NEEDS_AI', APP_ERRORS.needsAi);
  const current = before ? { name: before.name, html: currentOf(before).html } : null;
  const answered = await chatCall(deps, ctx, route, makeTask(ask, current));
  check(answered, 'APP_NOT_PASSED', APP_ERRORS.notPassed);
  const made = answered.value;
  const findings = appCodeFindings(made.html);
  check(findings.length === 0, 'APP_CODE_REFUSED', APP_ERRORS.refused(findings));
  const permissions = permissionsOf(made.html);
  return ventureAction(deps, ctx, 'prepare', 'apps.make', tx => {
    const at = tx.now;
    const versionOf = (number: number): MiniAppVersion => ({
      version: number, at, html: made.html, summary: made.summary, permissions, ask, callId: answered.callId,
      digest: digest({ html: made.html, permissions }),
    });
    const said = (number: number): MiniAppMessage[] => [
      { at, from: 'owner', text: ask, version: null },
      { at, from: 'chausar', text: madeLine(number, permissions), version: number },
    ];
    let record: MiniAppRecord;
    if (changing) {
      const found = tx.find('venture-mini-app', changing);
      check(found && found.ventureId === tx.venture!.id, 'APP_NOT_FOUND', APP_ERRORS.notFound);
      const number = Math.max(...found.versions.map(item => item.version)) + 1;
      record = tx.replace<MiniAppRecord>({
        ...found, versions: trimVersions([...found.versions, versionOf(number)], number), current: number, messages: [...found.messages, ...said(number)],
      });
    } else {
      record = tx.put<MiniAppRecord>({
        ...tx.base('venture-mini-app'), name: made.name, versions: [versionOf(1)], current: 1, grant: null, pinned: false, notes: {}, messages: said(1),
      });
    }
    return { app: appView(record, tx.state), line: madeLine(record.current, permissions) };
  });
}

// ---------------------------------------------------------------------------
// The permission screen, versions, pin, export and delete
// ---------------------------------------------------------------------------

/**
 * venture.apps.grant { app, digest } (approve, app only): Allow on the permission screen. The digest binds the app, the
 * version on screen and exactly the permissions it listed (APPROVAL_STALE otherwise). What was allowed before stays
 * allowed, so going back a version keeps working.
 */
export async function appsGrantHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ app: MiniAppView; line: string }> {
  requireAppChannel(ctx, 'venture.apps.grant');
  const { body, id } = appId(payload, ['app', 'digest']);
  check(typeof body.digest === 'string' && /^[0-9a-f]{64}$/.test(body.digest), 'APPROVAL_STALE', APP_ERRORS.stale);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'apps.grant', tx => {
    const record = appIn(tx.state, tx.venture!.id, id);
    const ask = askOf(record);
    check(ask && ask.digest === body.digest, 'APPROVAL_STALE', APP_ERRORS.stale);
    const permissions = ordered([...(record.grant?.permissions ?? []), ...currentOf(record).permissions]);
    const next = tx.replace<MiniAppRecord>({ ...record, grant: { permissions, version: record.current, digest: ask.digest, at: tx.now } });
    return { app: appView(next, tx.state), line: APP_LINES.granted(record.name) };
  });
}

/** venture.apps.revoke { app } (approve, app only): Turn off. Nothing answers until the owner allows it again. */
export async function appsRevokeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ app: MiniAppView; line: string }> {
  requireAppChannel(ctx, 'venture.apps.revoke');
  const { id } = appId(payload);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'apps.revoke', tx => {
    const record = appIn(tx.state, tx.venture!.id, id);
    const next = tx.replace<MiniAppRecord>({ ...record, grant: null });
    return { app: appView(next, tx.state), line: APP_LINES.revoked(record.name) };
  });
}

/** venture.apps.restore { app, version } (prepare, app only): use another kept version; undo names the one before. */
export async function appsRestoreHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ app: MiniAppView; undo: { version: number }; line: string }> {
  requireAppChannel(ctx, 'venture.apps.restore');
  const { body, id } = appId(payload, ['app', 'version']);
  check(Number.isSafeInteger(body.version), 'INVALID_VENTURE_REQUEST', APP_ERRORS.version);
  const version = body.version as number;
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'apps.restore', tx => {
    const record = appIn(tx.state, tx.venture!.id, id);
    check(record.versions.some(item => item.version === version), 'INVALID_VENTURE_REQUEST', APP_ERRORS.version);
    const next = tx.replace<MiniAppRecord>({ ...record, current: version });
    return { app: appView(next, tx.state), undo: { version: record.current }, line: APP_LINES.restored(version) };
  });
}

/** venture.apps.pin { app, pinned } (prepare, app only): pin to Today, or take it off; undo is the value before. */
export async function appsPinHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ app: MiniAppView; undo: { pinned: boolean }; line: string }> {
  requireAppChannel(ctx, 'venture.apps.pin');
  const { body, id } = appId(payload, ['app', 'pinned']);
  check(typeof body.pinned === 'boolean', 'INVALID_VENTURE_REQUEST', 'pinned is true or false.');
  const pinned = body.pinned;
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'apps.pin', tx => {
    const record = appIn(tx.state, tx.venture!.id, id);
    const next = tx.replace<MiniAppRecord>({ ...record, pinned });
    return { app: appView(next, tx.state), undo: { pinned: record.pinned }, line: pinned ? APP_LINES.pinned : APP_LINES.unpinned };
  });
}

const fileNameOf = (name: string): string => `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'app'}.html`;

/** venture.apps.export { app } (read, app only): the current version as one HTML file with the same policy and no data. */
export async function appsExportHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ fileName: string; document: string; mediaType: 'text/html' }> {
  requireAppChannel(ctx, 'venture.apps.export');
  const { id } = appId(payload);
  const { state, venture } = readAs(deps, ctx, 'read');
  const record = appIn(state, venture.id, id);
  return { fileName: fileNameOf(record.name), document: exportDocument(currentOf(record).html, record.name), mediaType: 'text/html' };
}

/** venture.apps.remove { app } (approve, app only): deletes the app, every version and its notes. Its Today cards stay. */
export async function appsRemoveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ removed: true; line: string }> {
  requireAppChannel(ctx, 'venture.apps.remove');
  const { id } = appId(payload);
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'apps.remove', tx => {
    const record = appIn(tx.state, tx.venture!.id, id);
    (tx.state as { conversations: unknown[] }).conversations = tx.state.conversations.filter(item => (item as { id?: string })?.id !== record.id);
    return { removed: true as const, line: APP_LINES.removed(record.name) };
  });
}

// ---------------------------------------------------------------------------
// The bridge: one MCP Apps tools/call from the app's frame
// ---------------------------------------------------------------------------

const result = (structuredContent: Json): MiniAppCallResult => ({ content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: false });
function none(args: Record<string, unknown>): void {
  check(Object.keys(args).length === 0, 'INVALID_VENTURE_REQUEST', 'This tool takes no arguments.');
}

async function invoicesOf(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord): Promise<Json> {
  const issued = listRecords(state, 'venture-invoice', venture.id).filter(invoice => invoice.number !== null && invoice.status !== 'draft');
  const invoices: Json[] = [];
  for (const invoice of issued) {
    const plan = statementPlan(state, venture, { type: 'statement', clientId: invoice.clientId, part: 'balance', invoiceId: invoice.id });
    const receipt = await sumReceipt(deps, ctx, venture.id, plan);
    invoices.push({
      id: invoice.id, number: invoice.number, clientId: invoice.clientId, status: invoice.status, dueDate: invoice.dueDate,
      balance: { display: receipt.figures[0]!.display, receiptId: receipt.id },
    });
  }
  return { invoices };
}

const PROPOSE_INPUT: Readonly<Partial<Record<ProposalKind, string>>> = Object.freeze({ 'draft-reminder': 'invoiceId', 'draft-invoice': 'orderId' });

async function propose(deps: VentureDeps, ctx: Context, record: MiniAppRecord, args: Record<string, unknown>): Promise<Json> {
  const kind = args.kind as ProposalKind;
  const field = typeof kind === 'string' ? PROPOSE_INPUT[kind] : undefined;
  check(field, 'INVALID_VENTURE_REQUEST', 'An app proposes draft-reminder with invoiceId, or draft-invoice with orderId.');
  exactPayload(args, ['kind', field], ['kind', field]);
  const target = identifier(args[field], field === 'invoiceId' ? 'Invoice' : 'Order');
  const input: Json = { [field]: target };
  return ventureAction(deps, ctx, 'prepare', 'apps.propose', tx => {
    const venture = tx.venture!;
    const gate = targetOf(tx.state, venture, kind, input);
    check(gate.ok, 'APP_PROPOSAL_REFUSED', gate.ok ? '' : `This can't go on Today: ${gate.reason}`);
    const mine = tx.list('venture-proposal').filter(item => item.ventureId === venture.id && item.source === 'app' && item.appId === record.id && item.status === 'raised');
    const same = mine.find(item => item.proposalKind === kind && JSON.stringify(item.input) === JSON.stringify(input));
    if (same) return { card: { id: same.id, title: same.title }, line: APP_LINES.proposedAlready };
    check(mine.length < APP_OPEN_CARDS, 'APP_PROPOSALS_FULL', APP_ERRORS.proposalsFull);
    const { title, line, spends, sends } = gate.target;
    const drafted = draftProposal(tx, { kind, source: 'app', title, line: `From the app "${record.name}". ${line}`, input, agent: null, spends, sends });
    const raised = tx.replace<ProposalRecord>({ ...drafted, appId: record.id, status: 'raised', raisedAt: tx.now });
    tx.emit('proposal.created', { proposalId: raised.id });
    tx.emit('queue.changed', { rowId: proposalRowId(tx.state, venture, raised) });
    return { card: { id: raised.id, title: raised.title }, line: APP_LINES.proposed };
  });
}

async function setNote(deps: VentureDeps, ctx: Context, id: string, args: Record<string, unknown>): Promise<Json> {
  exactPayload(args, ['key', 'value'], ['key', 'value']);
  check(typeof args.key === 'string' && NOTE_KEY.test(args.key), 'INVALID_VENTURE_REQUEST', 'A note key uses letters, digits, dots, dashes and underscores, up to 64.');
  check(args.value === null || (typeof args.value === 'string' && args.value.length <= NOTE_MAX), 'INVALID_VENTURE_REQUEST', `A note is text of up to ${NOTE_MAX} characters, or null to delete it.`);
  const key = args.key, value = args.value as string | null;
  return ventureAction(deps, ctx, 'prepare', 'apps.note', tx => {
    const record = appIn(tx.state, tx.venture!.id, id);
    const notes = { ...record.notes };
    if (value === null) delete notes[key];
    else notes[key] = value;
    const size = Object.entries(notes).reduce((total, [name, text]) => total + name.length + text.length, 0);
    check(Object.keys(notes).length <= NOTES_KEYS && size <= NOTES_MAX, 'APP_NOTES_FULL', APP_ERRORS.notesFull);
    tx.replace<MiniAppRecord>({ ...record, notes });
    return { notes };
  });
}

/**
 * venture.apps.call { app, tool, arguments, sample? } (prepare, app only): one tools/call the app's frame sent through
 * the Ink app's bridge. Unknown tools are APP_TOOL_UNKNOWN; before Allow, or for a tool whose permission the current
 * version did not get, APP_NOT_ALLOWED. The answer is an MCP CallToolResult. C4 task 29: with sample: true a read answers
 * the made-up rows (sample-data.ts) without touching a record, and anything that would write says "Not in a preview".
 */
export async function appsCallHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MiniAppCallResult> {
  requireAppChannel(ctx, 'venture.apps.call');
  const body = exactPayload(payload, ['app', 'tool', 'arguments', 'sample'], ['app', 'tool', 'arguments']);
  const id = identifier(body.app, 'App');
  check(!Object.hasOwn(body, 'sample') || body.sample === true, 'INVALID_VENTURE_REQUEST', 'Send sample: true, or leave it out.');
  const sample = body.sample === true;
  check(typeof body.tool === 'string' && Object.hasOwn(APP_TOOLS, body.tool), 'APP_TOOL_UNKNOWN', APP_ERRORS.unknownTool);
  const tool = body.tool;
  const args = exactPayload(body.arguments, Object.keys((body.arguments ?? {}) as object));
  const { state, venture } = readAs(deps, ctx, !sample && (tool === 'notes_set' || tool === 'propose') ? 'prepare' : 'read');
  const record = appIn(state, venture.id, id);
  check(record.grant, 'APP_NOT_ALLOWED', APP_ERRORS.allowFirst);
  check(allowedOf(record).includes(APP_TOOLS[tool]!), 'APP_NOT_ALLOWED', APP_ERRORS.notAllowed);
  if (sample) {
    const rows = sampleAnswer(tool, venture.country.currency, ownerToday(deps.clock, venture.country));
    check(rows, APP_PREVIEW_ONLY, NOT_IN_PREVIEW);
    return result(rows as Json);
  }
  switch (tool) {
    case 'clients_list':
      none(args);
      return result({ clients: listRecords(state, 'venture-client', venture.id).filter(client => !client.self).map(client => ({ id: client.id, name: client.name })) });
    case 'orders_list':
      none(args);
      return result({ orders: listRecords(state, 'venture-order', venture.id).map(order => ({ id: order.id, clientId: order.clientId, status: order.status, request: short(order.request, 160) })) });
    case 'invoices_list':
      none(args);
      return result(await invoicesOf(deps, ctx, state, venture));
    case 'notes_get':
      none(args);
      return result({ notes: { ...record.notes } });
    case 'notes_set':
      return result(await setNote(deps, ctx, record.id, args));
    case 'calculate': {
      const receipt = await sumReceipt(deps, ctx, venture.id, appCalcPlan(appCalcSubject(record.id, venture.country.currency, args)));
      const figure = receipt.figures[0]!;
      return result({ figure: { label: figure.label, display: figure.display, receiptId: receipt.id } });
    }
    default:
      return result(await propose(deps, ctx, record, args));
  }
}

export const APP_HANDLERS = {
  'venture.apps.list': appsListHandler,
  'venture.apps.get': appsGetHandler,
  'venture.apps.make': appsMakeHandler,
  'venture.apps.grant': appsGrantHandler,
  'venture.apps.revoke': appsRevokeHandler,
  'venture.apps.restore': appsRestoreHandler,
  'venture.apps.pin': appsPinHandler,
  'venture.apps.export': appsExportHandler,
  'venture.apps.call': appsCallHandler,
  'venture.apps.remove': appsRemoveHandler,
} as const;
