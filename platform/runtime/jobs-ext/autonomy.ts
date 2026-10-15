/**
 * The autonomy switch (TR-05, Trust · Rules · Do). A new install asks before every action.
 * The owner may let one kind of action run on its own, within a daily count, only when that
 * kind can be undone and stays inside the workspace. The always-waits list has no switch.
 * Auto-run still goes through ActionService: approve exactly this digest, execute once, read back.
 */
import { audit, newId } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { PreparedAction } from '../actions.ts';
import type { ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import { dayOf, lane, peekLane } from './state.ts';

export type Impact = PreparedAction['impact'];
export type KindRow = { kind: string; operation: string; title: string; impact: Impact; switchable: boolean };
export type AutoResult = { actionId: string; kind: string; status: string } | { actionId: string; error: string };

/** Words that put a kind on the always-waits list, matched on the kind split by `.`, `-` and `_`. */
export const ALWAYS_WAITS_WORDS: readonly string[] = Object.freeze(['price', 'prices', 'stock', 'inventory', 'listing', 'listings', 'share', 'sharing',
  'invite', 'webhook', 'tax', 'filing', 'delete', 'remove', 'refund', 'payment', 'pay', 'payout', 'transfer', 'message', 'send', 'email', 'mail',
  'whatsapp', 'sms', 'telegram', 'list', 'pricing', 'publish', 'unlist', 'unpublish', 'archive', 'purge', 'erase', 'void', 'cancel', 'charge', 'grant', 'access', 'member',
  'permission', 'notify', 'notification', 'post', 'reply', 'qty', 'quantity', 'submit', 'shared', 'link', 'invoice', 'gstr', 'return', 'file', 'upload', 'export', 'sync', 'order', 'payroll', 'salary', 'wire', 'debit', 'credit']);
/** Word pairs that put a kind on the list when both appear (a product's status, a GST file). */
export const ALWAYS_WAITS_PAIRS: readonly (readonly [string, string])[] = Object.freeze([['product', 'status'], ['products', 'status'], ['gst', 'file']] as const);
export const ALWAYS_WAITS = Object.freeze({
  intro: 'Anything that cannot be undone, and in particular:',
  items: Object.freeze(['money', 'messages to outsiders', 'deleting', 'prices', 'stock', 'listings', 'sharing', 'invites to outsiders', 'webhooks', 'tax filings (prepare only)']),
});
export const DEFAULT_DAILY_COUNT = 20;
export const RUNS_LIMIT = 5000;
const ROUTINE = /draft|match|reconcile|note|label|tag|sheet/;
const IMPACTS = new Set<Impact>(['reversible', 'message', 'money', 'destructive']);
const PART = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export const words = (kind: string) => kind.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
/** A word and its plain stems (invites, deleting, removed, payouts), so a plural or tense never escapes the list. */
const stems = (word: string) => [word, word.replace(/s$/, ''), word.replace(/es$/, ''), word.replace(/ing$/, ''), word.replace(/ing$/, 'e'), word.replace(/ed$/, ''), word.replace(/d$/, '')];
export function alwaysWaits(kind: string): boolean {
  // Anything outside plain lowercase ASCII names is treated as unknown, and so always waits.
  if (!/^[\x20-\x7e]+$/.test(kind)) return true;
  const parts = new Set(words(kind).flatMap(stems));
  return ALWAYS_WAITS_WORDS.some(word => parts.has(word)) || ALWAYS_WAITS_PAIRS.some(([a, b]) => parts.has(a) && parts.has(b));
}
export const switchable = (kind: string, impact: Impact, rowAlwaysWaits = false) => impact === 'reversible' && !rowAlwaysWaits && !alwaysWaits(kind);
export const routine = (row: KindRow) => row.switchable && ROUTINE.test(row.operation);
export const kindOf = (action: { connector: string; operation: string }) => `${action.connector}.${action.operation}`;

/** Every action kind this workspace knows: the written connector catalogue plus writeback's rows when that lane exists. */
export async function kindTable(ctx: Context, host: Pick<ModuleHost, 'services' | 'call'>): Promise<Map<string, KindRow>> {
  const table = new Map<string, KindRow>();
  const remote = await optionalCall<unknown>(host, 'writeback.catalogue', {});
  const rows = remote.available ? (Array.isArray(remote.value) ? remote.value : (remote.value as any)?.rows) : [];
  // Outside the workspace's own local connector, a kind has a switch only when the writeback catalogue
  // explicitly says it can be undone and need not wait. An unknown or renamed connector always waits.
  const confirmed = (system: string, action: string) => Array.isArray(rows) && rows.some((row: any) => row && row.system === system && row.action === action && row.impact === 'reversible' && row.alwaysWaits === false);
  for (const connector of host.services.actions.catalogue(ctx) as { id: string; operations: { id: string; title: string; impact: Impact }[] }[])
    for (const op of connector.operations) {
      const kind = `${connector.id}.${op.id}`;
      table.set(kind, { kind, operation: op.id, title: op.title, impact: op.impact, switchable: switchable(kind, op.impact) && (connector.id === 'local' || confirmed(connector.id, op.id)) });
    }
  if (Array.isArray(rows)) for (const row of rows.slice(0, 2000)) {
    if (!row || typeof row !== 'object' || typeof row.system !== 'string' || typeof row.action !== 'string' || !PART.test(row.system) || !PART.test(row.action)) continue;
    if (row.impact !== undefined && !IMPACTS.has(row.impact)) continue;
    if (row.alwaysWaits !== undefined && typeof row.alwaysWaits !== 'boolean') continue;
    const kind = `writeback.${row.system}.${row.action}`; if (table.has(kind)) continue;
    // A row that does not state its impact is treated as one that cannot be undone.
    const impact: Impact = row.impact ?? 'destructive';
    table.set(kind, { kind, operation: row.action, title: typeof row.title === 'string' && row.title.length <= 200 ? row.title : kind, impact, switchable: switchable(kind, impact, row.alwaysWaits === true) });
  }
  return table;
}

export const today = (host: Pick<ModuleHost, 'services'>) => dayOf(new Date(host.services.jobs.clock()).toISOString());
/**
 * The money an action touches, in whole paise: an `amountMinor` on its payload or on writeback's inner payload.
 * None means zero. A present but unreadable amount is unknown, and an unknown amount never runs on its own.
 */
export function actionAmount(action: { payload?: any }): bigint | null {
  // Any other field that may name money, at any depth, makes the amount unknown: it never runs on its own.
  let total = 0n; let unknown = false;
  const walk = (value: unknown, depth: number) => {
    if (unknown || value === null || typeof value !== 'object') return;
    if (depth > 8) { unknown = true; return; }
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'amountMinor') { if (typeof inner === 'string' && /^(0|[1-9]\d{0,17})$/.test(inner)) total += BigInt(inner); else unknown = true; }
      else if (/amount|total|value|price|sum|money|balance|paise|rupee|inr/i.test(key)) unknown = true;
      else walk(inner, depth + 1);
    }
  };
  walk(action.payload, 0);
  return unknown ? null : total;
}
export const amountToday = (state: State, kind: string, day: string) => String(peekLane(state).autonomy.runs.filter(run => run.kind === kind && dayOf(run.at) === day).reduce((sum, run) => sum + BigInt(run.amountMinor ?? '0'), 0n));
export const usedToday = (state: State, kind: string, day: string) => peekLane(state).autonomy.runs.filter(run => run.kind === kind && dayOf(run.at) === day).length;

/** Integer counts of how often a person agreed (approved) or declined (cancelled) each kind, leaving out what the rule ran itself. */
export function agreement(state: State): Map<string, { approved: number; declined: number }> {
  const ran = new Set(peekLane(state).autonomy.runs.map(run => run.actionId)); const counts = new Map<string, { approved: number; declined: number }>();
  for (const action of state.actions as PreparedAction[]) {
    if (ran.has(action.id)) continue;
    const entry = counts.get(kindOf(action)) ?? { approved: 0, declined: 0 };
    if (action.approval) entry.approved++; else if (action.status === 'cancelled') entry.declined++; else continue;
    counts.set(kindOf(action), entry);
  }
  return counts;
}

export function taintedActions(state: State): Set<string> {
  return new Set(state.activity.filter((e: any) => e?.event === 'action.prepared' && e.details?.taintedSource === true && typeof e.details.actionId === 'string').map((e: any) => e.details.actionId));
}

/** Runs prepared actions whose kind is switched on, while the master switch in Trust is on. Never throws per action. */
export async function autoRun(ctx: Context, host: ModuleHost): Promise<AutoResult[]> {
  const state = host.store.read();
  if (state.policy.autonomy !== true || ctx.sourceTainted || ctx.channel === 'phone') return [];
  const switches = peekLane(state).autonomy.kinds;
  if (!Object.values(switches).some(entry => entry.on)) return [];
  const table = await kindTable(ctx, host); const tainted = taintedActions(state); const day = today(host);
  const visible = new Set((host.services.actions.list(ctx) as PreparedAction[]).map(action => action.id));
  const results: AutoResult[] = [];
  const jobPrepared = new Map(peekLane(state).reminders.map(reminder => [reminder.actionId, reminder] as const));
  for (const action of state.actions as PreparedAction[]) {
    const kind = kindOf(action); const row = table.get(kind); const entry = switches[kind];
    if (action.status !== 'prepared' || action.attempts.length !== 0 || action.impact !== 'reversible' || !row?.switchable || !entry?.on) continue;
    // A revised action may have been changed by any context; revisions never run on their own.
    // Only work a job prepared runs on its own: a plugin, small app, assistant or manual preparation always waits.
    // The action must be exactly the one a job recorded: its private key, its invoice and the job owner as its author.
    const reminder = jobPrepared.get(action.id);
    if (tainted.has(action.id) || !visible.has(action.id) || action.revision !== 1 || !reminder || reminder.key === undefined || action.idempotencyKey !== reminder.key
      || action.payload?.invoiceId !== reminder.invoiceId || action.createdBy !== reminder.ownerId) continue;
    if (host.store.read().policy.autonomy !== true) break;
    const amount = actionAmount(action);
    // The daily count is checked and the run recorded in one transaction, so overlapping ticks cannot exceed it.
    const claim = newId('claim');
    const claimed = await host.store.update(next => {
      // Everything is read again inside the transaction: the live switch and limits, and that this action
      // is still prepared and not already claimed by an overlapping tick.
      const ns = lane(next); const live = ns.autonomy.kinds[kind]; const current = (next.actions as PreparedAction[]).find(a => a.id === action.id);
      if (!live?.on || next.policy.autonomy !== true || !current || current.status !== 'prepared' || current.attempts.length !== 0 || ns.autonomy.runs.some(run => run.actionId === action.id)) return false;
      if (usedToday(next, kind, day) >= live.dailyCount) return false;
      // The daily amount limit (TR-05): the money this action touches plus what ran today stays within it.
      if (amount === null || BigInt(amountToday(next, kind, day)) + amount > BigInt(live.dailyAmountMinor ?? '0')) return false;
      ns.autonomy.runs.push({ kind, actionId: action.id, at: new Date(host.services.jobs.clock()).toISOString(), claim, ...(amount > 0n ? { amountMinor: String(amount) } : {}) });
      if (ns.autonomy.runs.length > RUNS_LIMIT) ns.autonomy.runs.splice(0, ns.autonomy.runs.length - RUNS_LIMIT);
      audit(next, 'jobsx.autonomy.ran', { actionId: action.id, kind }); return true;
    });
    if (!claimed) continue;
    try {
      try { await host.services.actions.approve(ctx, action.id, action.digest); }
      catch (error) { await host.store.update(next => { const ns = lane(next); ns.autonomy.runs = ns.autonomy.runs.filter(run => run.claim !== claim); }); throw error; }
      const done = await host.services.actions.execute(ctx, action.id) as PreparedAction;
      results.push({ actionId: action.id, kind, status: done.status });
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      results.push({ actionId: action.id, error: typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'AUTONOMY_RUN_FAILED' });
    }
  }
  return results;
}
