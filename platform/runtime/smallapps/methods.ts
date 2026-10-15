/**
 * Small apps from one line (models-ext, experimental). A line becomes a typed `chausar.smallapp.v1`
 * descriptor over the published menu, the approved action catalogue and the follow-up book. Opening
 * an app runs every figure through the calculator as the caller; pressing an action card only
 * prepares the action for the normal approval card. No generated code ever runs.
 */
import { audit, ChausarError, check, newId, now, type Context, type State } from '../contracts.ts';
import { digest } from '../actions.ts';
import { moduleState, peekModuleState, type MethodSpec, type ModuleHost } from '../modules/types.ts';
import { MODULE_ID, type ModulePart } from '../models-ext/part.ts';
import type { Dictionary } from '../ontology.ts';
import { actionRow, checkAgainstMenu, parseDescriptor, resolvePeriod, staleness, usableOperation, validDay, type Card, type Descriptor, type Menu, type PeriodSpec } from './descriptor.ts';
import { actionNote, plan, WAITS_WORDS } from './planner.ts';
import { checkPayload, grantedConnections, loadCatalogue, prepareAction, type Catalogue } from './catalogue-adapter.ts';
import { customerScope, latestView, MAX_ENTRIES, MAX_VERSIONS, newEntry, personText, purgeBook, status, visible, visibleVersions, whenDay, type Entry } from './book.ts';

type App = { id: string; descriptor: Descriptor; digest: string; version: number; createdBy: string; createdAt: string; updatedAt: string; request: string | null;
  history: { version: number; digest: string; dictionaryVersion: number; dictionaryHash: string; at: string; by: string; change: 'created' | 'rebuilt' }[];
  presses: { actionId: string; cardId: string; at: string; by: string }[] };
type SmallApps = { apps: App[]; book: Entry[] };
const MAX_APPS = 200, MAX_PRESSES = 200;
const EMPTY: SmallApps = { apps: [], book: [] };

const mine = (state: State): SmallApps => {
  const ns = moduleState<Record<string, any>>(state, MODULE_ID, () => ({}));
  return (ns.smallApps ??= { apps: [], book: [] }) as SmallApps;
};
const peek = (state: State): SmallApps => (peekModuleState<Record<string, any>>(state, MODULE_ID)?.smallApps as SmallApps | undefined) ?? EMPTY;
function fields(payload: Record<string, any>, required: string[], optional: string[] = [], code = 'SMALLAPP_INVALID'): Record<string, any> {
  const keys = Object.keys(payload);
  check(required.every(k => keys.includes(k)) && keys.every(k => required.includes(k) || optional.includes(k)), code, 'Use only the declared request fields.');
  return payload;
}
const appId = (value: unknown) => { check(typeof value === 'string' && /^smallapp_[A-Za-z0-9-]{1,80}$/.test(value), 'SMALLAPP_NOT_FOUND', 'This small app is unavailable.'); return value; };
function findApp(state: State, id: unknown): App {
  const app = peek(state).apps.find(a => a.id === appId(id)); check(app, 'SMALLAPP_NOT_FOUND', 'This small app is unavailable.'); return app;
}
/** Branches that exist in the workspace: named on a live record or granted to a member. */
const knownBranches = (state: State) => [...new Set([...state.facts.filter(f => !f.deletedAt && f.branch).map(f => f.branch!), ...state.members.flatMap(m => m.branches.filter(b => b !== '*'))])].sort();
async function load(host: ModuleHost): Promise<{ menu: Menu; catalogue: Catalogue }> {
  const ontology = await host.call('ontology.get', {}) as { current: Dictionary | null };
  const catalogue = await loadCatalogue(host);
  return { menu: { dictionary: ontology.current, actions: catalogue.rows, branches: knownBranches(host.store.read()) }, catalogue };
}
const menu = async (host: ModuleHost) => (await load(host)).menu;
const branchesOf = (state: State, ctx: Context) => state.members.find(m => m.id === ctx.memberId)?.branches ?? [];
const catalogueWords = (c: Catalogue) => ({ writeback: c.writeback, notCounted: c.notCounted, words: c.words });
/** The reference day for period presets: a trusted host clock when one is given (tests, fixtures), else the system clock. */
function today(host: ModuleHost): string {
  const clock = host.options.clock;
  if (clock === undefined) return now().slice(0, 10);
  check(typeof clock === 'function', 'SMALLAPP_CLOCK_INVALID', 'The configured clock is not usable.');
  const value = clock(); const iso = value instanceof Date ? value.toISOString() : value;
  check(typeof iso === 'string' && validDay(iso.slice(0, 10)), 'SMALLAPP_CLOCK_INVALID', 'The configured clock is not usable.');
  return iso.slice(0, 10);
}
/** A branch the caller cannot see is not named back to them. */
function redact(descriptor: Descriptor, branches: readonly string[]): Descriptor {
  const copy = structuredClone(descriptor);
  for (const c of copy.cards as any[]) if (c.branch !== undefined && !branches.includes('*') && !branches.includes(c.branch)) { delete c.branch; c.branchWithheld = true; }
  return copy;
}
function requestLine(value: unknown): string | null {
  if (value === undefined) return null;
  check(typeof value === 'string' && value.length <= 500, 'SMALLAPP_INVALID', 'The request line is one short line.');
  return personText(value, 500, 'the request line', false, 'SMALLAPP_INVALID');
}
function summary(app: App, m: Menu) {
  const reasons = staleness(app.descriptor, m);
  return { id: app.id, title: app.descriptor.title, version: app.version, createdBy: app.createdBy, createdAt: app.createdAt, updatedAt: app.updatedAt,
    uses: structuredClone(app.descriptor.uses), dictionary: structuredClone(app.descriptor.dictionary), outOfDate: reasons.length > 0, outOfDateReasons: reasons, experimental: true };
}
const full = (app: App, m: Menu, branches: readonly string[]) => ({ ...summary(app, m), descriptor: redact(app.descriptor, branches), digest: app.digest, request: app.request, history: structuredClone(app.history),
  actions: actionNotes(app.descriptor, m) });
function actionNotes(descriptor: Descriptor, m: Menu) {
  return descriptor.cards.flatMap(c => { if (c.kind !== 'action') return []; const row = actionRow(m, `${c.connector}/${c.operation}`); return row ? [{ ...actionNote(c.id, row), available: row.available }] : []; });
}
const requireCurrent = (app: App, m: Menu) => check(staleness(app.descriptor, m).length === 0, 'SMALLAPP_OUT_OF_DATE', 'A definition this app uses changed. Rebuild the app before opening it.');

const WITHHELD = new Set(['FORBIDDEN_BRANCH', 'BRANCH_FORBIDDEN', 'SOURCE_REVOKED', 'RECEIPT_FORBIDDEN', 'FORBIDDEN']);
const MISSING_WORDS = {
  'absent': 'No records were counted for this period. That is not the same as zero.',
  'not loaded yet': 'No records have been brought in yet.',
  'withheld': 'This figure is outside your current access.',
  'not applicable': 'This calculation does not apply here.',
  'unknown': 'This figure could not be worked out from the records.',
} as const;
/** One figure through the calculator, as the caller. Missing is a word state, never zero. */
async function figure(host: ModuleHost, state: State, dictionary: Dictionary, operation: string, spec: PeriodSpec, branch: string | undefined, onDate: string) {
  const op = usableOperation(dictionary, operation)!; const period = resolvePeriod(spec, onDate);
  const request = { operation, ...(period ? { period } : {}), ...(branch ? { branch } : {}), ...(op.type === 'aging' ? { onDate } : {}) };
  try {
    const receipt = await host.call('calculation.run', request) as any;
    if (receipt.coverage.countedRows === 0) {
      const missing = state.imports.length === 0 ? 'not loaded yet' : 'absent';
      return { state: 'missing' as const, missing, words: MISSING_WORDS[missing], receiptId: receipt.id, period: period ?? null };
    }
    return { state: 'figure' as const, receiptId: receipt.id, period: period ?? null, figures: receipt.figures.map((f: any) => ({ key: f.key, label: f.label, minor: f.minor, display: f.display, unit: f.unit })),
      completeness: receipt.coverage.completeness, gaps: [...receipt.coverage.gaps] };
  } catch (error) {
    const code = error instanceof ChausarError ? error.code : 'UNKNOWN';
    if (code === 'ACCESS_REVOKED') throw error;
    const missing = WITHHELD.has(code) ? 'withheld' : code === 'DICTIONARY_REQUIRED' ? 'not loaded yet' : code === 'UNKNOWN_CALCULATION' ? 'not applicable' : 'unknown';
    return { state: 'missing' as const, missing, words: MISSING_WORDS[missing], code, period: period ?? null };
  }
}
function visibleBook(state: State, ctx: Context) { return peek(state).book.filter(e => visible(state, ctx, e)); }
function findEntry(state: State, ctx: Context, id: unknown): Entry {
  check(typeof id === 'string' && id.length <= 200, 'SMALLAPP_RECORD_NOT_FOUND', 'This follow-up is unavailable.');
  const entry = peek(state).book.find(e => e.id === id); check(entry && visible(state, ctx, entry), 'SMALLAPP_RECORD_NOT_FOUND', 'This follow-up is unavailable.'); return entry;
}

const methods: Record<string, MethodSpec> = {
  'smallapps.propose': { permission: 'read', async handler(ctx, payload, host) {
    const { line } = fields(payload, ['line']);
    check(typeof line === 'string' && line.trim().length > 0 && line.length <= 500, 'SMALLAPP_INVALID', 'Ask for a small app in one line.');
    const { menu: m, catalogue } = await load(host); const result = plan(line, m, branchesOf(host.store.read(), ctx));
    if (result.supported) checkAgainstMenu(parseDescriptor(result.descriptor), m, branchesOf(host.store.read(), ctx));
    return { ...result, catalogue: catalogueWords(catalogue), experimental: true };
  } },
  'smallapps.validate': { permission: 'read', async handler(ctx, payload, host) {
    const { descriptor } = fields(payload, ['descriptor']);
    const m = await menu(host); const checked = checkAgainstMenu(parseDescriptor(descriptor), m, branchesOf(host.store.read(), ctx));
    return { valid: true, descriptor: checked, uses: checked.uses, actions: actionNotes(checked, m) };
  } },
  'smallapps.create': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = fields(payload, ['descriptor'], ['request']); const request = requestLine(input.request);
    const m = await menu(host);
    const descriptor = checkAgainstMenu(parseDescriptor(input.descriptor), m, branchesOf(host.store.read(), ctx));
    const app = await host.store.update(state => {
      const ns = mine(state); check(ns.apps.length < MAX_APPS, 'SMALLAPP_LIMIT', 'Remove an app before adding another.');
      check(state.ontology?.current?.hash === descriptor.dictionary.hash, 'SMALLAPP_OUT_OF_DATE', 'The dictionary changed while the app was being saved. Propose it again.');
      const at = now(), d = digest(descriptor);
      const created: App = { id: newId('smallapp'), descriptor, digest: d, version: 1, createdBy: ctx.memberId, createdAt: at, updatedAt: at, request,
        history: [{ version: 1, digest: d, dictionaryVersion: descriptor.dictionary.version, dictionaryHash: descriptor.dictionary.hash, at, by: ctx.memberId, change: 'created' }], presses: [] };
      ns.apps.push(created); audit(state, 'smallapp.created', { appId: created.id }); return structuredClone(created);
    });
    return full(app, m, branchesOf(host.store.read(), ctx));
  } },
  'smallapps.list': { permission: 'read', async handler(_ctx, payload, host) {
    fields(payload, []); const m = await menu(host);
    return { apps: peek(host.store.read()).apps.map(app => summary(app, m)), experimental: true };
  } },
  'smallapps.get': { permission: 'read', async handler(ctx, payload, host) {
    const { id } = fields(payload, ['id']); return full(findApp(host.store.read(), id), await menu(host), branchesOf(host.store.read(), ctx));
  } },
  'smallapps.open': { permission: 'read', async handler(ctx, payload, host) {
    const input = fields(payload, ['id'], ['onDate']);
    if (input.onDate !== undefined) check(validDay(input.onDate), 'SMALLAPP_INVALID', 'Give the reference day as a calendar day.');
    const onDate: string = input.onDate ?? today(host);
    const app = structuredClone(findApp(host.store.read(), input.id)); const m = await menu(host); requireCurrent(app, m);
    const dictionary = m.dictionary!, branches = branchesOf(host.store.read(), ctx), shown = redact(app.descriptor, branches).cards as any[];
    const cards = [];
    for (const [index, card] of (app.descriptor.cards as Card[]).entries()) {
      const state = host.store.read(), view = shown[index];
      if (card.kind === 'metric') cards.push({ ...view, value: await figure(host, state, dictionary, card.operation, card.period, card.branch, onDate) });
      else if (card.kind === 'comparison') cards.push({ ...view, current: await figure(host, state, dictionary, card.operation, card.period, card.branch, onDate), previous: await figure(host, state, dictionary, card.operation, card.comparePeriod, card.branch, onDate) });
      else if (card.kind === 'table') { const rows = []; for (const row of card.rows) rows.push({ ...row, value: await figure(host, state, dictionary, row.operation, card.period, card.branch, onDate) }); cards.push({ ...view, rows }); }
      else if (card.kind === 'action') {
        const row = actionRow(m, `${card.connector}/${card.operation}`)!, note = actionNote(card.id, row);
        // Writeback actions go through a connection with this action granted; a practice connection prepares against Practice systems.
        const through = grantedConnections(row).map(c => ({ id: c.id, label: c.label, environment: c.environment, practice: c.environment === 'practice' }));
        const needsConnection = row.origin === 'writeback' && through.length === 0;
        cards.push({ ...view, alwaysWaits: note.alwaysWaits, tier: note.tier, available: row.available, connections: through,
          press: !row.available ? 'unavailable' : ctx.role === 'viewer' ? 'read-only' : needsConnection ? 'needs-connection' : 'prepares-for-approval',
          words: !row.available ? 'This action is in the catalogue but not available now. Pressing it does nothing.'
            : needsConnection ? 'Connect this system and allow this action on it before pressing. Pressing it now does nothing.' : note.words });
      }
      else cards.push({ ...view, experimental: true, entries: visibleBook(state, ctx).map(latestView).filter(e => e.status === 'open').sort((a, b) => a.when.localeCompare(b.when)) });
    }
    return { id: app.id, title: app.descriptor.title, version: app.version, onDate, uses: app.descriptor.uses, dictionary: app.descriptor.dictionary, outOfDate: false, cards, experimental: true };
  } },
  'smallapps.rebuild': { permission: 'prepare', async handler(ctx, payload, host) {
    const { id } = fields(payload, ['id']); const app = structuredClone(findApp(host.store.read(), id)); const m = await menu(host);
    if (staleness(app.descriptor, m).length === 0) return { rebuilt: false, app: full(app, m, branchesOf(host.store.read(), ctx)) };
    check(m.dictionary, 'DICTIONARY_REQUIRED', 'Publish business definitions before rebuilding a small app.');
    const gone = staleness({ ...app.descriptor, dictionary: { version: m.dictionary.version, hash: m.dictionary.hash } }, m);
    check(gone.length === 0, 'SMALLAPP_OPERATION_GONE', 'A calculation or action this app uses is no longer on the menu. Propose a new app instead.');
    const descriptor = checkAgainstMenu({ ...app.descriptor, dictionary: { version: m.dictionary.version, hash: m.dictionary.hash } }, m, branchesOf(host.store.read(), ctx));
    const rebuilt = await host.store.update(state => {
      const stored = mine(state).apps.find(a => a.id === app.id); check(stored, 'SMALLAPP_NOT_FOUND', 'This small app is unavailable.');
      check(stored.digest === app.digest && state.ontology?.current?.hash === descriptor.dictionary.hash, 'SMALLAPP_CHANGED', 'The app or the dictionary changed during the rebuild. Try again.');
      const at = now(); stored.descriptor = descriptor; stored.digest = digest(descriptor); stored.version += 1; stored.updatedAt = at;
      stored.history.push({ version: stored.version, digest: stored.digest, dictionaryVersion: descriptor.dictionary.version, dictionaryHash: descriptor.dictionary.hash, at, by: ctx.memberId, change: 'rebuilt' });
      audit(state, 'smallapp.rebuilt', { appId: stored.id, version: stored.version }); return structuredClone(stored);
    });
    return { rebuilt: true, app: full(rebuilt, m, branchesOf(host.store.read(), ctx)) };
  } },
  'smallapps.remove': { permission: 'prepare', async handler(ctx, payload, host) {
    const { id } = fields(payload, ['id']); appId(id);
    return host.store.update(state => {
      const ns = mine(state); const app = ns.apps.find(a => a.id === id); check(app, 'SMALLAPP_NOT_FOUND', 'This small app is unavailable.');
      check(app.createdBy === ctx.memberId || ['owner', 'cofounder'].includes(ctx.role), 'SMALLAPP_FORBIDDEN', 'Only the person who made this app or an owner can remove it.');
      ns.apps = ns.apps.filter(a => a.id !== id); audit(state, 'smallapp.removed', { appId: id }); return { removed: true, id };
    });
  } },
  'smallapps.pressAction': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = fields(payload, ['id', 'cardId', 'payload'], ['sourceIds', 'idempotencyKey', 'connectionId']);
    const app = findApp(host.store.read(), input.id); const m = await menu(host); requireCurrent(app, m);
    const card = app.descriptor.cards.find(c => c.id === input.cardId);
    check(card?.kind === 'action', 'SMALLAPP_NOT_ACTION_CARD', 'Only an action card can be pressed.');
    const row = actionRow(m, `${card.connector}/${card.operation}`)!;
    check(row.available, 'SMALLAPP_ACTION_UNAVAILABLE', 'This action is in the catalogue but not available now. Nothing was prepared.');
    if (input.sourceIds !== undefined) check(Array.isArray(input.sourceIds) && input.sourceIds.length <= 50 && input.sourceIds.every((s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(s)), 'SMALLAPP_INVALID', 'Give plain source identifiers.');
    if (input.idempotencyKey !== undefined) check(typeof input.idempotencyKey === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(input.idempotencyKey), 'SMALLAPP_INVALID', 'Give a plain idempotency key.');
    if (input.connectionId !== undefined) check(typeof input.connectionId === 'string' && input.connectionId.length <= 200, 'SMALLAPP_INVALID', 'Give a plain connection identifier.');
    // What the person typed is data: its required fields are checked here, its exact shape by the writeback adapter, never by the number guard.
    if (row.origin === 'writeback') checkPayload(row, input.payload);
    // The one path to an action: prepare. Approval and execution stay with the person.
    const action = await prepareAction(host, row, { payload: input.payload, intentId: input.idempotencyKey ?? newId('smallapp'),
      ...(input.sourceIds ? { sourceIds: input.sourceIds } : {}), ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}) });
    if (action.status === 'already-done') return { action: null, alreadyDone: { connector: action.connector, operation: action.operation, externalId: action.externalId },
      words: 'This is already in the system. Nothing was prepared and nothing will be sent.' };
    await host.store.update(state => {
      const stored = mine(state).apps.find(a => a.id === app.id); if (!stored) return;
      stored.presses.push({ actionId: action.id, cardId: card.id, at: now(), by: ctx.memberId }); stored.presses.splice(0, Math.max(0, stored.presses.length - MAX_PRESSES));
      audit(state, 'smallapp.pressed', { appId: app.id, actionId: action.id });
    });
    const writeback = action.through === 'writeback';
    return { action: { id: action.id, connector: action.connector, operation: action.operation, status: action.status, impact: action.impact, digest: action.digest, through: action.through,
        connectionId: action.connectionId, practice: action.practice, expiresAt: action.expiresAt },
      approval: { waits: true, alwaysWaits: action.alwaysWaits, tier: row.tier, kind: 'action', id: action.id, digest: action.digest, secondAsk: action.secondAsk,
        approveWith: writeback ? 'writeback.approve' : 'actions.approve', ...(action.secondAsk ? { reauthWith: 'writeback.reauth' } : {}) },
      words: `${action.practice ? 'Practice: nothing goes to a real system. ' : ''}${action.alwaysWaits ? `Prepared only; nothing was approved or done. ${WAITS_WORDS} This one waits for a person to approve it in the app.`
        : 'Prepared only. It waits on the normal approval card; nothing was approved or done.'}${action.secondAsk ? ' Approving it asks for your passphrase again.' : ''}` };
  } },
  'smallapps.records.add': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = fields(payload, ['who', 'when'], ['said', 'customerId', 'status'], 'SMALLAPP_RECORD_INVALID');
    const first = { who: personText(input.who, 120, 'who to call'), when: whenDay(input.when), said: personText(input.said ?? '', 2000, 'what was said', true),
      status: status(input.status ?? 'open'), ...customerScope(host.store, ctx, input.customerId) };
    const entry = await host.store.update(state => {
      const ns = mine(state); check(ns.book.length < MAX_ENTRIES, 'SMALLAPP_LIMIT', 'The follow-up book is full. Remove old entries first.');
      const created = newEntry(ctx, first); ns.book.push(created); audit(state, 'smallapp.followup.added', { entryId: created.id }); return structuredClone(created);
    });
    return { entry: latestView(entry), experimental: true };
  } },
  'smallapps.records.update': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = fields(payload, ['id', 'expectedVersion'], ['who', 'when', 'said', 'customerId', 'status'], 'SMALLAPP_RECORD_INVALID');
    check(Object.keys(input).length > 2, 'SMALLAPP_RECORD_INVALID', 'Change at least one field.');
    const before = findEntry(host.store.read(), ctx, input.id).versions.at(-1)!;
    const scope = 'customerId' in input ? customerScope(host.store, ctx, input.customerId) : { customerId: before.customerId, sourceIds: before.sourceIds, branches: before.branches };
    const next = { who: 'who' in input ? personText(input.who, 120, 'who to call') : before.who, when: 'when' in input ? whenDay(input.when) : before.when,
      said: 'said' in input ? personText(input.said, 2000, 'what was said', true) : before.said, status: 'status' in input ? status(input.status) : before.status, ...scope };
    const entry = await host.store.update(state => {
      const stored = findEntry(state, ctx, input.id); const latest = stored.versions.at(-1)!;
      check(latest.version === input.expectedVersion, 'SMALLAPP_RECORD_CONFLICT', 'This follow-up changed since you read it. Read it again.');
      check(stored.versions.length < MAX_VERSIONS, 'SMALLAPP_LIMIT', 'This follow-up has too many versions. Add a new one.');
      stored.versions.push({ ...structuredClone(next), version: latest.version + 1, at: now(), by: ctx.memberId });
      audit(state, 'smallapp.followup.updated', { entryId: stored.id, version: latest.version + 1 }); return structuredClone(stored);
    });
    return { entry: latestView(entry), experimental: true };
  } },
  'smallapps.records.list': { permission: 'read', handler(ctx, payload, host) {
    const input = fields(payload, [], ['status', 'dueBy'], 'SMALLAPP_RECORD_INVALID');
    if (input.status !== undefined) status(input.status);
    if (input.dueBy !== undefined) whenDay(input.dueBy);
    const state = host.store.read();
    const entries = visibleBook(state, ctx).map(e => ({ ...latestView(e), versionsWithheld: visibleVersions(state, ctx, e).withheld }))
      .filter(e => (input.status === undefined || e.status === input.status) && (input.dueBy === undefined || e.when <= input.dueBy)).sort((a, b) => a.when.localeCompare(b.when));
    return { book: 'follow-up', entries, experimental: true };
  } },
  'smallapps.records.history': { permission: 'read', handler(ctx, payload, host) {
    const { id } = fields(payload, ['id'], [], 'SMALLAPP_RECORD_INVALID'); const state = host.store.read(), entry = findEntry(state, ctx, id);
    // Every version returned must be one the caller can see now: an entry once about a customer in another branch keeps that past to itself.
    const { versions, withheld, withheldWords } = visibleVersions(state, ctx, entry);
    return { id: entry.id, book: entry.book, createdAt: entry.createdAt, createdBy: entry.createdBy, versions, versionsWithheld: withheld, words: withheldWords, experimental: true };
  } },
};

export const smallAppsPart: ModulePart = {
  methods,
  /** Follow-up entries derived from a deleted source go with their whole history; presses of removed actions are forgotten. */
  purge(state, reason) {
    const current = peek(state); if (current === EMPTY) return 0;
    const ns = mine(state); const before = ns.book.length;
    ns.book = purgeBook(ns.book, new Set(reason.sourceIds), reason.removedIds);
    let removed = before - ns.book.length;
    for (const app of ns.apps) { const kept = app.presses.filter(p => !reason.removedIds.has(p.actionId)); removed += app.presses.length - kept.length; app.presses = kept; }
    return removed;
  },
};
