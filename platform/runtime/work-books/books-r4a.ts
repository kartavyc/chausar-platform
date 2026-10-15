/**
 * Round 4, Books sources and recipes (BK-02, BK-03, BK-05) over connectors-ext's round-4 methods:
 *
 * - "Which company?" from the companies open in Tally (`connectorsx.tally.companies`);
 * - one source's refused reads and where their files are (never opened), the sign-in path before
 *   the button is pressed, and the data's age (`books.sourceMore`);
 * - a recipe question answered in place, who answered it, the version diff and reconcile
 *   (`recipes.answer`, `recipes.answers`, `recipes.answerRemove`, `recipes.upgradeDiff`, `recipes.reconcile`).
 *
 * Another lane's method is used only when the method registry lists it (`installed`): it is never
 * probed, because a probe could start a real change. Every reply is checked field by field and
 * copied into the shapes in docs/lanes/work-books.md "Round 4 contracts", never passed through.
 */
import { check, ChausarError, type Context } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { input, plainId, text } from './books-common.ts';
import { connections, envelopeOf, envelopes, NOT_INSTALLED, type EnvelopeView } from './books-connectors.ts';
import { refusals, sourceVisible, visibleSourceIds } from './books-sources.ts';
import { installed } from './work-jobs-sheet.ts';

type Raw = Record<string, unknown>;
const plain = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const str = (value: unknown, max = 400): string | null => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) ? value : null;
const int = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const digits = (value: unknown): string | null => typeof value === 'string' && /^-?\d{1,30}$/.test(value) ? String(BigInt(value)) : null;
const one = <T extends string>(value: unknown, allowed: readonly T[]): T | null => typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null;
const rows = (value: unknown, max = 400): Raw[] => Array.isArray(value) ? value.filter(plain).slice(0, max) : [];
const strings = (value: unknown, max = 50, length = 200): string[] => Array.isArray(value) ? value.map(v => str(v, length)).filter((v): v is string => v !== null).slice(0, max) : [];
const instant = (value: unknown): string | null => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
const REQUEST = 'INVALID_BOOKS_REQUEST';
function SHAPE(ok: unknown): asserts ok { check(ok, 'CONNECTOR_REPLY_INVALID', 'The connector lane answered in an unexpected shape.'); }
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/* ------------------------------------------------------------------ raw reads (checked here) */

/** The raw read history the caller may see: the round-4 fields (`question`, `reconciliations`) are read from it. */
async function rawEnvelopes(host: ModuleHost, ctx: Context, payload: Raw): Promise<{ available: boolean; items: Raw[] }> {
  const reply = await optionalCall(host, 'connectorsx.envelopes', payload);
  if (!reply.available) return { available: false, items: [] };
  return { available: true, items: rows(reply.value).filter(e => typeof e.sourceId === 'string' && sourceVisible(host.store, ctx, e.sourceId)) };
}
async function visibleEnvelope(host: ModuleHost, ctx: Context, envelopeId: string): Promise<EnvelopeView> {
  const list = await envelopes(host, ctx);
  check(list.available, NOT_INSTALLED, 'Connecting systems is not installed in this build. Bring a file instead.');
  const found = list.items.find(e => e.id === envelopeId);
  check(found, 'ENVELOPE_NOT_FOUND', 'This read is no longer waiting.'); return found;
}

const QUESTION_REASONS = ['ambiguous_field', 'unknown_value', 'date_format', 'currency', 'sign_convention'] as const;
export type QuestionView = { envelopeId: string; sourceId: string; at: string; reason: typeof QUESTION_REASONS[number]; field: string; sample: string | null; choices: string[] };
export function questionOf(raw: Raw): QuestionView | null {
  const q = raw.question, envelopeId = str(raw.id, 200), sourceId = str(raw.sourceId, 200), at = instant(raw.fetchedAt);
  if (!plain(q) || !envelopeId || !sourceId || !at || raw.status !== 'abstained') return null;
  const reason = one(q.reason, QUESTION_REASONS), field = str(q.field, 200), choices = strings(q.choices, 40);
  if (!reason || !field || choices.length === 0) return null;
  // `sample` is the source's own value: outside text, shown as data only.
  return { envelopeId, sourceId, at, reason, field, sample: str(q.sample, 400), choices };
}

export type AnswerView = { id: string; sourceId: string; recipeId: string; recipeVersion: string; reason: string; field: string; sample: string | null; choice: string;
  answeredBy: { name: string; role: string; at: string }; envelopeId: string | null };
export function answerOf(raw: unknown): AnswerView | null {
  if (!plain(raw) || !plain(raw.answeredBy)) return null;
  const id = str(raw.id, 200), sourceId = str(raw.sourceId, 200), recipeId = str(raw.recipeId, 200), recipeVersion = str(raw.recipeVersion, 40);
  const reason = str(raw.reason, 64), field = str(raw.field, 200), choice = str(raw.choice, 200);
  const name = str(raw.answeredBy.name, 200), role = str(raw.answeredBy.role, 40), at = instant(raw.answeredBy.at);
  if (!id || !sourceId || !recipeId || !recipeVersion || !reason || !field || !choice || !name || !role || !at) return null;
  return { id, sourceId, recipeId, recipeVersion, reason, field, sample: str(raw.sample, 400), choice, answeredBy: { name, role, at }, envelopeId: str(raw.envelopeId, 200) };
}

const RECONCILE_STATES = ['matches', 'differs', 'rows-changed', 'not-imported', 'no-source-total'] as const;
export type ReconcileView = { envelopeId: string; importId: string | null; at: string; by: { name: string; role: string }; status: typeof RECONCILE_STATES[number];
  theirs: { total: string | null; rowCount: number | null; reference: string; provenance: string } | null;
  ours: { total: string | null; rowCount: number; live: number; changed: number }; measure: 'money' | 'count'; unit: string };
export function reconcileOf(raw: unknown, envelopeId?: string): ReconcileView | null {
  if (!plain(raw) || !plain(raw.by) || !plain(raw.ours)) return null;
  const id = str(raw.envelopeId, 200) ?? envelopeId ?? null, at = instant(raw.at), status = one(raw.status, RECONCILE_STATES), name = str(raw.by.name, 200), role = str(raw.by.role, 40);
  const measure = one(raw.measure, ['money', 'count'] as const);
  if (!id || !at || !status || !name || !role || !measure) return null;
  const theirs = plain(raw.theirs) ? { total: digits(raw.theirs.total), rowCount: int(raw.theirs.rowCount), reference: str(raw.theirs.reference, 200) ?? '', provenance: str(raw.theirs.provenance, 80) ?? '' } : null;
  return { envelopeId: id, importId: str(raw.importId, 200), at, by: { name, role }, status, theirs,
    ours: { total: digits(raw.ours.total), rowCount: int(raw.ours.rowCount) ?? 0, live: int(raw.ours.live) ?? 0, changed: int(raw.ours.changed) ?? 0 }, measure, unit: str(raw.unit, 40) ?? '' };
}

const EFFECTS = ['columns', 'meaning', 'dates', 'amount', 'check', 'identity', 'other'] as const;
export type DiffView = { recipeId: string; available: boolean; reason: 'OLD_VERSION_NOT_KEPT' | null;
  from: { version: string; digest: string; label: 'read-with' | 'seed' }; to: { version: string; digest: string; label: 'current' | 'with-answers' }; same: boolean;
  changes: { path: string; change: 'added' | 'removed' | 'changed'; before: string | null; after: string | null; effect: typeof EFFECTS[number] }[] };
export function diffOf(raw: unknown): DiffView | null {
  if (!plain(raw) || !plain(raw.from) || !plain(raw.to) || typeof raw.available !== 'boolean' || typeof raw.same !== 'boolean') return null;
  const recipeId = str(raw.recipeId, 200), fromLabel = one(raw.from.label, ['read-with', 'seed'] as const), toLabel = one(raw.to.label, ['current', 'with-answers'] as const);
  if (!recipeId || !fromLabel || !toLabel) return null;
  const changes = rows(raw.changes, 500).flatMap(c => {
    const path = str(c.path, 300), change = one(c.change, ['added', 'removed', 'changed'] as const);
    if (!path || !change) return [];
    // Before and after are recipe text (headings, words from the source): data, shown as text.
    return [{ path, change, before: str(c.before, 600), after: str(c.after, 600), effect: one(c.effect, EFFECTS) ?? 'other' as const }];
  });
  return { recipeId, available: raw.available, reason: raw.reason === 'OLD_VERSION_NOT_KEPT' ? 'OLD_VERSION_NOT_KEPT' : null,
    from: { version: str(raw.from.version, 40) ?? '', digest: str(raw.from.digest, 200) ?? '', label: fromLabel },
    to: { version: str(raw.to.version, 40) ?? '', digest: str(raw.to.digest, 200) ?? '', label: toLabel }, same: raw.same, changes };
}

/* ------------------------------------------------------------------ methods */

export const r4aMethods: Record<string, MethodSpec> = {
  /** BK-03 "Which company?": the companies open in Tally now, read through a Tally connection on this computer. */
  'books.tallyCompanies': { permission: 'admin', external: true, async handler(ctx, payload, host) {
    const request = input(payload, ['sourceId']); check(request.sourceId === undefined || plainId(request.sourceId), REQUEST, 'Name the source.');
    const none = (reason: 'connectors-not-installed' | 'not-built' | 'no-connection') => ({ available: false, reason, sourceId: null, current: null, currentOpen: null, companies: [] });
    const list = await connections(host, ctx);
    if (!list.available) return none('connectors-not-installed');
    if (!(await installed(host, 'connectorsx.tally.companies'))) return none('not-built');
    const tally = list.items.filter(c => c.group === 'tally' && c.road === 'interface');
    if (request.sourceId !== undefined) check(tally.some(c => c.sourceId === request.sourceId), 'TALLY_CONNECTION_REQUIRED', 'Choose a Tally connection on this computer.');
    const conn = request.sourceId === undefined ? tally[0] : tally.find(c => c.sourceId === request.sourceId);
    if (!conn) return none('no-connection');
    const reply = await host.call('connectorsx.tally.companies', { connectionId: conn.connectionId });
    SHAPE(plain(reply) && Array.isArray(reply.companies));
    const seen = new Set<string>();
    const companies = rows(reply.companies, 200).flatMap(c => {
      const name = str(c.name, 200); if (!name || seen.has(name)) return []; seen.add(name);
      return [{ name, booksFrom: str(c.booksFrom, 40) }];
    });
    return { available: true, reason: null, sourceId: conn.sourceId, current: conn.company || null, currentOpen: companies.some(c => c.name === conn.company), companies };
  } },

  /** BK-02 one source, more: refused reads and where their files are, the sign-in path, the data's age. */
  'books.sourceMore': { permission: 'read', async handler(ctx, payload, host) {
    const { sourceId } = input(payload, ['sourceId'], ['sourceId']); check(plainId(sourceId), REQUEST, 'Name the source.');
    check(sourceVisible(host.store, ctx, sourceId), 'SOURCE_NOT_FOUND', 'This source is not available to you.');
    const [conns, reads, fresh] = await Promise.all([
      optionalCall(host, 'connectorsx.connections', {}), rawEnvelopes(host, ctx, { sourceId, limit: 50 }), optionalCall(host, 'connectorsx.freshness', { sourceId })]);
    const conn = conns.available ? rows(conns.value, 200).find(c => c.sourceId === sourceId) ?? null : null;
    const state = host.store.read();
    check(conn || reads.items.length > 0 || visibleSourceIds(host.store, ctx).includes(sourceId), 'SOURCE_NOT_FOUND', 'This source is not available to you.');
    // Refused reads: core file refusals keep only their reason class; connector reads keep their record. No file is kept or opened.
    const refused = [
      ...refusals(state).filter(r => r.sourceId === sourceId).map(r => ({ at: r.at, origin: 'file' as const, what: r.format, code: r.codes[0] ?? null, envelopeId: null })),
      ...reads.items.filter(e => e.status === 'refused' || e.status === 'failed' || e.status === 'abstained').flatMap(e => {
        const at = instant(e.fetchedAt), id = str(e.id, 200); if (!at || !id) return [];
        const code = plain(e.refusal) ? str(e.refusal.code, 64) : plain(e.abstention) ? str(e.abstention.reason, 64) : null;
        return [{ at, origin: 'connector' as const, what: str(e.operation, 120), code, envelopeId: id }];
      }),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
    const settings = conn && plain(conn.settings) ? conn.settings : {};
    const road = conn ? one(conn.road, ['interface', 'file', 'database'] as const) : null, group = conn ? str(conn.group, 80) : null;
    // The place a file or database lives is the connection's own non-secret setting, shown as text; Chausar never opens it from here.
    const where = road === 'file' || road === 'database' ? str(settings.path, 400) : null;
    let signIn: { method: 'browser' | 'key' | 'none'; note: string | null; endpoint: string | null } | null = null;
    if (conn && road === 'interface' && group) {
      const systems = await optionalCall(host, 'connectorsx.systems', { group });
      const sign = systems.available && plain(systems.value) && plain(systems.value.signIn) && Object.hasOwn(systems.value.signIn, group) && plain(systems.value.signIn[group]) ? systems.value.signIn[group] as Raw : {};
      const method = one(sign.method, ['browser', 'key', 'none'] as const) ?? 'none';
      // Tally is read on this computer: its address is the connection's endpoint setting, or Tally's own default port.
      const endpoint = group === 'tally' ? (str(settings.endpoint, 200) ?? 'http://127.0.0.1:9000') : null;
      signIn = { method, note: str(sign.note, 600), endpoint };
    }
    const freshItem = fresh.available ? rows(fresh.value, 50).find(f => f.sourceId === sourceId) ?? null : null;
    const imported = state.imports.filter(i => i.sourceId === sourceId && typeof i.at === 'string').map(i => i.at as string);
    const accepted = reads.items.filter(e => e.status === 'accepted').map(e => instant(e.fetchedAt)).filter((v): v is string => v !== null);
    const lastRead = [...imported, ...accepted, ...(freshItem && instant(freshItem.lastRead) ? [freshItem.lastRead as string] : [])].sort().at(-1) ?? null;
    const schedule = freshItem && plain(freshItem.schedule) ? { everyHours: int(freshItem.schedule.everyHours), freshnessTargetHours: int(freshItem.schedule.freshnessTargetHours) } : null;
    return { sourceId, refused, kept: { file: 'not-kept' as const, where }, signIn,
      age: { lastRead, stale: freshItem?.stale === true, schedule }, connectors: { available: conns.available || reads.available } };
  } },

  /** BK-05 a recipe, more: its open questions with the choices the engine accepts, who answered, reconciliations and what is built. */
  'books.recipeMore': { permission: 'read', async handler(ctx, payload, host) {
    const { recipeId } = input(payload, ['recipeId'], ['recipeId']); check(plainId(recipeId), REQUEST, 'Name the recipe.');
    const [answer, answers, remove, diff, reconcile] = await Promise.all(['recipes.answer', 'recipes.answers', 'recipes.answerRemove', 'recipes.upgradeDiff', 'recipes.reconcile'].map(m => installed(host, m)));
    const reads = (await rawEnvelopes(host, ctx, { limit: 400 })).items.filter(e => e.recipeId === recipeId);
    const answered = answers ? rows((await host.call('recipes.answers', { recipeId }) as Raw)?.answers, 500).map(answerOf)
      .filter((a): a is AnswerView => a !== null && a.recipeId === recipeId && sourceVisible(host.store, ctx, a.sourceId)) : [];
    const reconciliations = reads.flatMap(e => rows(e.reconciliations, 10).map(r => reconcileOf(r, typeof e.id === 'string' ? e.id : undefined)))
      .filter((r): r is ReconcileView => r !== null).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
    // A recipe is graded "reconciled" by a named person's latest "matches".
    const latestMatch = reconciliations.find(r => r.status === 'matches') ?? null;
    const gstin = reads.map(e => typeof e.gstin === 'string' && GSTIN.test(e.gstin) ? e.gstin : null).find(g => g !== null) ?? null;
    return { recipeId, questions: reads.map(questionOf).filter((q): q is QuestionView => q !== null).slice(0, 20), answers: answered, reconciliations,
      reconciled: latestMatch ? { by: latestMatch.by.name, role: latestMatch.by.role, at: latestMatch.at, envelopeId: latestMatch.envelopeId } : null, gstin,
      can: { answer, answers, remove, diff, reconcile } };
  } },
  'books.recipeAnswer': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['envelopeId', 'choice'], ['envelopeId', 'choice']);
    check(plainId(request.envelopeId) && text(request.choice, 200), REQUEST, 'Choose one of the offered answers.');
    await visibleEnvelope(host, ctx, request.envelopeId);
    if (!(await installed(host, 'recipes.answer'))) throw new ChausarError('RECIPE_ANSWER_NOT_BUILT', 'Answering a recipe question here is not built yet. Read the source again.');
    const reply = await host.call('recipes.answer', { envelopeId: request.envelopeId, choice: request.choice });
    SHAPE(plain(reply));
    const answer = answerOf(reply.answer); SHAPE(answer);
    const read = reply.read === null || reply.read === undefined ? null : envelopeOf(reply.read);
    SHAPE(reply.read === null || reply.read === undefined || (read && sourceVisible(host.store, ctx, read.sourceId)));
    const next = read && plain(reply.read) ? questionOf(reply.read as Raw) : null;
    return { answer, read, next, readAgain: one(reply.readAgain, ['not-needed', 'bring-the-file-again', 'read-again'] as const) ?? (read ? 'not-needed' : 'read-again') };
  } },
  'books.recipeAnswerRemove': { permission: 'prepare', async handler(ctx, payload, host) {
    const { answerId } = input(payload, ['answerId'], ['answerId']); check(plainId(answerId), REQUEST, 'Choose an answer.');
    if (!(await installed(host, 'recipes.answerRemove')) || !(await installed(host, 'recipes.answers'))) throw new ChausarError('RECIPE_ANSWER_NOT_BUILT', 'Answering a recipe question here is not built yet. Read the source again.');
    const listed = rows((await host.call('recipes.answers', {}) as Raw)?.answers, 500).map(answerOf);
    check(listed.some(a => a?.id === answerId && sourceVisible(host.store, ctx, a.sourceId)), 'ANSWER_NOT_FOUND', 'This answer was not found.');
    const reply = await host.call('recipes.answerRemove', { answerId });
    SHAPE(plain(reply) && reply.removed === true);
    return { removed: true as const, answerId };
  } },
  'books.recipeDiff': { permission: 'read', async handler(ctx, payload, host) {
    const request = input(payload, ['recipeId', 'envelopeId', 'sourceId'], ['recipeId']);
    check(plainId(request.recipeId) && (request.envelopeId === undefined || plainId(request.envelopeId)) && (request.sourceId === undefined || plainId(request.sourceId)), REQUEST, 'Name the recipe.');
    if (!(await installed(host, 'recipes.upgradeDiff'))) return { available: false, diff: null };
    if (request.envelopeId !== undefined) await visibleEnvelope(host, ctx, request.envelopeId);
    if (request.sourceId !== undefined) check(sourceVisible(host.store, ctx, request.sourceId), 'SOURCE_NOT_FOUND', 'This source is not available to you.');
    const body: Raw = { recipeId: request.recipeId };
    if (request.envelopeId !== undefined) body.envelopeId = request.envelopeId; else if (request.sourceId !== undefined) body.sourceId = request.sourceId;
    const diff = diffOf(await host.call('recipes.upgradeDiff', body)); SHAPE(diff && diff.recipeId === request.recipeId);
    return { available: true, diff };
  } },
  'books.recipeReconcile': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['envelopeId', 'reportTotals'], ['envelopeId']); check(plainId(request.envelopeId), REQUEST, 'Choose a read.');
    check(request.reportTotals === undefined || (plain(request.reportTotals) && typeof request.reportTotals.total === 'string' && /^-?\d{1,30}$/.test(request.reportTotals.total)
      && (request.reportTotals.rowCount === undefined || request.reportTotals.rowCount === null || int(request.reportTotals.rowCount) !== null)), REQUEST, 'Enter the report total as whole paise.');
    await visibleEnvelope(host, ctx, request.envelopeId);
    if (!(await installed(host, 'recipes.reconcile'))) throw new ChausarError('RECIPE_RECONCILE_NOT_BUILT', 'Reconciling a read is not built yet.');
    const view = reconcileOf(await host.call('recipes.reconcile', { envelopeId: request.envelopeId, ...(request.reportTotals ? { reportTotals: request.reportTotals } : {}) }), request.envelopeId);
    SHAPE(view && view.envelopeId === request.envelopeId); return view;
  } },
};
