/**
 * Trust rules enforced at the core (TR-02, TR-04, TR-06), registered once at import:
 * - staff see only the entries they added (`Fact.enteredBy`, recorded at write time; older rows without it are not theirs);
 * - a record marking hides that record's facts, and a field marking withholds that field of that record, from seats that do not see the
 *   marking's kind, in every fact read (`canSeeFact`, `visibleFacts`, `selectFacts`), so calculations, reports, history and MCP follow;
 * - keep periods for model receipts, activity, briefs, exports and the learning log remove what is older, through the retention
 *   clean-up, a daily module tick and `keep.enforce`. Evidence something else still needs is held, and the reply says what and why.
 */
import { rememberPreparedExports } from './prepared-exports.ts';
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { authorize, audit, check, hash, newId, registerCoreHook } from '../contracts.ts';
import type { Context, Fact, Member, State } from '../contracts.ts';
import type { MethodSpec, ModuleHost, SchedulerHost } from '../modules/types.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';
import { coreLifecycleIds, purgePrivateState } from '../private-state-lifecycle.ts';
import { registerRetentionHook } from '../trust.ts';
import { knownSources, markKinds, peekCore, seatOf, today } from '../trust-ext/core-state.ts';
import type { Mark } from '../trust-ext/core-state.ts';
import { seatSees } from '../trust-ext/core-markings.ts';
import { peekLane } from '../trust-ext/lane-state.ts';

// ---- TR-02 and TR-06: what a seat may see of each fact ----

/** The record ids a fact names: itself, its entity, and the customer, supplier, item, invoice and order it refers to. */
const REFERENCES = ['customerId', 'supplierId', 'itemId', 'invoiceId', 'orderId'] as const;
type Plan = { hidden: Map<string, string>; fields: Map<string, Record<string, string>> };
/** The compiled plan per marks list, for one set of hidden kinds and one shape of the books. */
const plans = new WeakMap<Mark[], Map<string, Plan | null>>();

/** A record and every id joined with it by a merge not undone, so a marking follows a joined customer. */
function joined(state: State, id: string): string[] {
  const undone = new Set(state.merges.filter(m => m.type === 'undo').map(m => m.mergeId));
  return [...new Set([id, ...state.merges.filter(m => m.type === 'merge' && !undone.has(m.id) && Array.isArray(m.entityIds) && m.entityIds.includes(id)).flatMap(m => (m.entityIds as unknown[]).filter((e): e is string => typeof e === 'string'))])];
}
function planFor(state: State, marks: Mark[], hidden: readonly string[]): Plan | null {
  const key = `${marks.length}|${hidden.join(',')}|${state.merges.length}|${state.facts.length}|${state.imports.length}`;
  let byKey = plans.get(marks); if (!byKey) plans.set(marks, byKey = new Map());
  if (byKey.has(key)) return byKey.get(key)!;
  // A mark on a source the workspace no longer knows is not shown on See, so it hides nothing.
  const narrow = marks.filter(m => m.target.type !== 'source' && typeof m.target.recordId === 'string' && hidden.includes(m.kind));
  const known = narrow.length ? new Set(knownSources(state)) : new Set<string>(); let plan: Plan | null = { hidden: new Map(), fields: new Map() };
  for (const mark of narrow) {
    if (!known.has(mark.target.sourceId)) continue;
    for (const id of joined(state, mark.target.recordId!)) {
      if (mark.target.type === 'record') { if (!plan.hidden.has(id)) plan.hidden.set(id, mark.kind); }
      else if (typeof mark.target.field === 'string') { const fields = plan.fields.get(id) ?? {}; fields[mark.target.field] ??= mark.kind; plan.fields.set(id, fields); }
    }
  }
  if (!plan.hidden.size && !plan.fields.size) plan = null;
  if (byKey.size > 16) byKey.clear(); byKey.set(key, plan); return plan;
}

/**
 * The seat and plan of the last reader, reused while nothing it depends on changed: these hooks run once per fact, so a read of
 * 20,000 facts works the seat and the marks out once. Any change to the state object, the member, its seat or the marks rebuilds it.
 */
type Reader = { state: State; member: Member; role: string; core: any; marks: unknown; marksLength: number; seatValue: unknown; activity: number; shape: number[]; sees: unknown; seat: string; plan: Plan | null };
let last: Reader | undefined;
function reader(state: State, member: Member): Reader {
  const core = peekLane(state)?.trust?.core as any; const marks = core?.marks;
  if (last && last.state === state && last.member === member && last.role === member.role && last.core === core && last.marks === marks && last.marksLength === (marks?.length ?? 0)
    && last.seatValue === core?.memberSeats?.[member.id] && last.activity === state.activity.length && last.sees === core?.seatSees?.[last.seat]
    && last.shape[0] === state.merges.length && last.shape[1] === state.facts.length && last.shape[2] === state.imports.length) return last;
  const seat = seatOf(state, member); const sees = seatSees(state, seat); const hidden = markKinds.filter(kind => !sees[kind]);
  const plan = hidden.length && Array.isArray(marks) && marks.length ? planFor(state, marks, hidden) : null;
  return last = { state, member, role: member.role, core, marks, marksLength: marks?.length ?? 0, seatValue: core?.memberSeats?.[member.id], activity: state.activity.length, shape: [state.merges.length, state.facts.length, state.imports.length], sees: core?.seatSees?.[seat], seat, plan };
}

/** What this member may not see of a fact. The owner sees everything and returns before any work. */
export function factRule(state: State, member: Member, fact: Fact): true | Record<string, string> | null {
  if (member.role === 'owner') return null;
  const { seat, plan } = reader(state, member);
  if (seat === 'staff' && fact.enteredBy !== member.id) return true;
  if (!plan) return null;
  let withheld: Record<string, string> | null = null;
  const look = (id: unknown) => {
    if (typeof id !== 'string' || !id) return false;
    if (plan.hidden.has(id)) return true;
    const fields = plan.fields.get(id); if (fields) withheld = withheld ? { ...withheld, ...fields } : fields;
    return false;
  };
  if (look(fact.id) || look(fact.entityId)) return true;
  for (const field of REFERENCES) if (look(fact.fields[field])) return true;
  return withheld;
}
registerCoreHook('factWithheld', factRule);

// ---- TR-04: keep periods for every kind ----

export const keptKinds = ['modelReceipts', 'activity', 'briefs', 'exports', 'learning'] as const;
export type KeptKind = typeof keptKinds[number];
/** One row per kind: how many were removed, how many older items were held back and why (fixed words, never data). */
export type KeepRow = { kind: KeptKind; days: number | null; removed: number; held: number; why: string[] };
const DAY = 86400000;
const keepDays = (state: State, kind: KeptKind): number | null => { const days = peekCore(state).keep[kind]; return Number.isInteger(days) && (days as number) >= 1 ? days as number : null; };
const dateOf = (item: any): number => { const at = item?.createdAt ?? item?.at ?? item?.dispatchedAt; return typeof at === 'string' ? Date.parse(at) : NaN; };
const why = {
  record: 'The tamper-evident record links these entries; removing one would read as tampering.',
  seat: 'An accepted invitation still decides a person\'s seat.',
  action: 'A change still in the workspace needs its prepared and approved entries.',
  open: 'A model request is still waiting or being sent.',
  month: 'This month\'s model spend and cap are counted from these receipts.',
  locked: 'Locked workspace archives are kept like backups; delete them yourself.',
};

/** Removes items in the workspace state older than their keep period. Runs inside a store update; never touches facts (retention does). */
export function keepState(state: State, at: number): { rows: KeepRow[]; removedIds: string[] } {
  const rows: KeepRow[] = []; const removedIds: string[] = [];
  const sweep = <T>(kind: KeptKind, list: T[], date: (item: T) => number, hold: (item: T) => keyof typeof why | null): T[] => {
    const days = keepDays(state, kind); const row: KeepRow = { kind, days, removed: 0, held: 0, why: [] }; rows.push(row);
    if (days === null) return list;
    const cutoff = at - days * DAY; const reasons = new Set<string>();
    const kept = list.filter(item => {
      const when = date(item); if (!(when < cutoff)) return true;
      const reason = hold(item); if (reason) { row.held++; reasons.add(why[reason]); return true; }
      row.removed++; const id = (item as any)?.id; if (kind !== 'briefs' && typeof id === 'string') removedIds.push(id);
      if (kind === 'modelReceipts' || kind === 'learning') state.tombstones.push({ id: newId('tombstone'), kind: 'retention', digest: (item as any)?.digest || hash(item), ...(kind === 'learning' && typeof (item as any)?.importIdentity?.contentHash === 'string' ? { contentHash: (item as any).importIdentity.contentHash } : {}), deletedAt: new Date(at).toISOString() });
      return false;
    });
    row.why = [...reasons]; return kept;
  };
  // Model receipts: a waiting or sending request, its approval, and this month's spend stay.
  const month = today(at).slice(0, 7);
  const open = state.modelReceipts.filter(r => r?.status === 'preview' || r?.status === 'dispatching');
  const approvals = new Set(open.map(r => r.approvalId).filter(Boolean));
  state.modelReceipts = sweep('modelReceipts', state.modelReceipts, dateOf, r => open.includes(r) || approvals.has(r?.id) ? 'open' : today(dateOf(r)).slice(0, 7) === month ? 'month' : null);
  // Prepared exports are named only in activity; remember them first so a workspace delete still removes the files.
  rememberPreparedExports(state);
  // Activity: what the record chain links, the invitation behind a seat, and the entries of a change still held stay.
  const linked = new Set(((peekLane(state)?.tools?.record?.links ?? []) as { id: string }[]).map(link => link.id));
  const members = new Set(state.members.map(m => m.id)); const actions = new Set(state.actions.map(a => a?.id));
  state.activity = sweep('activity', state.activity, dateOf, a => linked.has(a?.id) ? 'record'
    : a?.event === 'auth.invitation.accepted' && members.has(a.details?.memberId) ? 'seat' : actions.has(a?.details?.actionId) ? 'action' : null);
  // Briefs live with the reports part, one per member and week.
  const briefs = peekLane(state)?.reports?.briefs as Record<string, { brief?: { id?: string; builtAt?: string } }> | undefined;
  const entries = Object.entries(briefs ?? {});
  const keptBriefs = new Set(sweep('briefs', entries, ([, item]) => Date.parse(item?.brief?.builtAt ?? ''), () => null));
  for (const entry of entries) if (!keptBriefs.has(entry)) delete briefs![entry[0]];
  state.learning = sweep('learning', state.learning, dateOf, () => null);
  return { rows, removedIds };
}

// Exports are files the app made in `<directory>/exports/`, found by their exact name patterns. Links are never followed.
const STAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z`;
const PREPARED = /^chausar-prepared-\d{8}-\d{6}Z-[A-Za-z0-9]{1,12}(?:-\d{1,2})?-(?:prepared\.json|checklist\.txt)$/;
const WORKSPACE = /^chausar-workspace_[0-9a-f-]{36}-\d{13}\.(json|vault)$/;
const REPORT = new RegExp(`^[a-z0-9-]{1,160}-[a-z]{2}-\\d{4}-\\d{2}-\\d{2}-\\d{4}-\\d{2}-\\d{2}-${STAMP}\\.(?:csv|xlsx|html)$`);
const QUESTION = /^question-[A-Za-z0-9-]{1,80}\.html$/;
const EVERYTHING = new RegExp(`^everything-${STAMP}$`);
const STORE_FILE = /^(?:facts\.csv|[A-Za-z][A-Za-z0-9]{0,63}\.json)$/;

async function oldFile(path: string, cutoff: number): Promise<boolean> {
  const info = await lstat(path).catch(() => null); return info !== null && info.isFile() && info.mtimeMs < cutoff;
}
async function names(folder: string) {
  const info = await lstat(folder).catch(() => null); if (!info?.isDirectory()) return [];
  return readdir(folder, { withFileTypes: true }).catch(() => []);
}
/** Removes export files older than the cutoff; returns the removed paths (files, and "Export everything" folders) and how many were held. */
export async function keepExports(directory: string, cutoff: number): Promise<{ removed: string[]; held: number; failed: number }> {
  const root = join(directory, 'exports'); const removed: string[] = []; let held = 0, failed = 0;
  const remove = async (path: string) => { try { await unlink(path); removed.push(path); } catch { failed++; } };
  for (const entry of await names(root)) {
    const path = join(root, entry.name);
    if (entry.isFile() && (PREPARED.test(entry.name) || WORKSPACE.exec(entry.name)?.[1] === 'json')) { if (await oldFile(path, cutoff)) await remove(path); }
    else if (entry.isFile() && WORKSPACE.test(entry.name)) { if (await oldFile(path, cutoff)) held++; }
    else if (entry.isDirectory() && (entry.name === 'reports' || entry.name === 'questions')) {
      const pattern = entry.name === 'reports' ? REPORT : QUESTION;
      for (const inner of await names(path)) if (inner.isFile() && pattern.test(inner.name) && await oldFile(join(path, inner.name), cutoff)) await remove(join(path, inner.name));
    } else if (entry.isDirectory() && EVERYTHING.test(entry.name)) {
      const info = await lstat(path).catch(() => null); if (!info?.isDirectory() || info.mtimeMs >= cutoff) continue;
      const inside = await names(path); const unknown = inside.some(inner => !inner.isFile() || !STORE_FILE.test(inner.name));
      if (unknown) { held++; continue; }
      let ok = true; for (const inner of inside) try { await unlink(join(path, inner.name)); } catch { ok = false; }
      if (ok) try { await rmdir(path); removed.push(path); } catch { failed++; } else failed++;
    }
  }
  return { removed, held, failed };
}

type KeepPart = { lastRunOn?: string };
const part = (state: State): KeepPart => { const space = moduleState<Record<string, any>>(state, 'core-data', () => ({})); return (space.trustRules ??= {}) as KeepPart; };

/** Applies every keep period now. Exports are removed first (files), then the state kinds in one update that records the clean-up. */
export async function enforceKeep(ctx: Context, host: ModuleHost, at = Date.now()) {
  const exportDays = keepDays(host.store.read(), 'exports');
  const files = exportDays === null ? { removed: [], held: 0, failed: 0 } : await keepExports(host.directory, at - exportDays * DAY);
  return host.store.update(state => {
    authorize({ read: () => state, update: host.store.update.bind(host.store) }, ctx, 'admin');
    const before = coreLifecycleIds(state); const { rows, removedIds } = keepState(state, at); const after = coreLifecycleIds(state);
    const gone = new Set(files.removed); const reports = peekLane(state)?.reports;
    // The reports part's own records of removed files go with them; locked archives keep theirs.
    if (reports) for (const [list, key] of [['pageExports', 'path'], ['questions', 'path'], ['exports', 'folder']] as const)
      if (Array.isArray(reports[list])) reports[list] = reports[list].filter((item: any) => item?.locked || !gone.has(item?.[key]));
    const lifted = [...new Set([...removedIds, ...[...before].filter(id => !after.has(id))])];
    if (lifted.length) purgePrivateState(state, { removedIds: lifted, at: new Date(at).toISOString() });
    const exportsRow: KeepRow = { kind: 'exports', days: exportDays, removed: files.removed.length, held: files.held + files.failed,
      why: [...(files.held ? [why.locked] : []), ...(files.failed ? ['Some export files could not be removed; they are tried again next time.'] : [])] };
    const kinds = keptKinds.map(kind => kind === 'exports' ? exportsRow : rows.find(row => row.kind === kind)!);
    if (kinds.some(row => row.days !== null)) audit(state, 'trust.keep.enforced', { memberId: ctx.memberId, kinds: kinds.map(({ kind, removed, held }) => ({ kind, removed, held })) });
    part(state).lastRunOn = today(at);
    return { at: new Date(at).toISOString(), kinds };
  });
}

// The retention clean-up applies the state kinds too (it cannot reach export files; `keep.enforce` and the tick do).
registerRetentionHook((state, at) => {
  const { rows, removedIds } = keepState(state, at.getTime()); const removed = rows.reduce((sum, row) => sum + row.removed, 0);
  if (removedIds.length) purgePrivateState(state, { removedIds, at: at.toISOString() });
  if (rows.some(row => row.days !== null)) audit(state, 'trust.keep.enforced', { kinds: rows.map(({ kind, removed: count, held }) => ({ kind, removed: count, held })) });
  return removed;
});

/** Once a day while autonomy is on, when any keep period is set. */
export async function trustRuleTick(ctx: Context, host: ModuleHost, _scheduler: SchedulerHost): Promise<unknown[]> {
  const state = host.store.read();
  if (!keptKinds.some(kind => keepDays(state, kind) !== null)) return [];
  if ((peekModuleState<Record<string, any>>(state, 'core-data')?.trustRules as KeepPart | undefined)?.lastRunOn === today()) return [];
  const result = await enforceKeep(ctx, host);
  return [{ module: 'core-data', event: 'trust.keep.enforced', removed: result.kinds.reduce((sum, row) => sum + row.removed, 0) }];
}

export const trustRuleMethods: Record<string, MethodSpec> = {
  /** `keep.enforce {}` → `{ at, kinds: { kind, days, removed, held, why }[] }` for model receipts, activity, briefs, exports and the learning log. */
  'keep.enforce': { permission: 'admin', async handler(ctx, payload, host) {
    check(payload && typeof payload === 'object' && Object.keys(payload).length === 0, 'INVALID_KEEP', 'This takes no fields.');
    return enforceKeep(ctx, host);
  } },
};
