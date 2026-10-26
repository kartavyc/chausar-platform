// Chausar delivery harness (Ink v2 wave 4, package 4F2): daily caps on what agents write (catalogue H32). Per business
// and per day on the owner's calendar, agents may make at most 30 drafts, 500 books lines and 40 messages for people, so
// an agent stuck in a loop can never flood a client, the books or the owner. Counts come from stored rows, plus what a
// turn still running has made: drafts are the replies an AI wrote that became ready; books lines are the rows of the
// tables an agent's tools made on a real order; messages for people are the outside actions an agent recorded for the
// owner to approve and the posts an agent proposed. The owner may lower each cap, never raise it past these. The next
// write past a cap does not happen (WRITE_CAP_REACHED) and Today says so; venture.runs.allowWrites (approve, app only)
// raises that cap once for the day, by its own size. Pinloop's limits (src/shared/limits.ts), a rewrite, not a copy.
import { check, type Context, type State } from '../../../contracts.ts';
import { exactPayload, listRecords, requireAppChannel, ventureAction } from '../../records.ts';
import type {
  AllowWritesView, Display, DeliveryRunRecord, QueueAction, SpendPolicyRecord, ToolCallRecord, ToolName, VentureDeps, VentureRecord, WorkTableRecord,
  WriteCapKind, WriteCapView,
} from '../../contracts.ts';
import { localDayAt } from '../../local-day.ts';
import type { Denial } from './recheck.ts';
import type { W4Decision, W4Outcome, W4RowItem } from '../../views/queue-w4.ts';

/** The most agents may write per business per day. Frozen: the owner may only lower them. */
export const WRITE_CAPS: Readonly<Record<WriteCapKind, number>> = Object.freeze({ drafts: 30, 'books-lines': 500, messages: 40 });
export const WRITE_CAP_KINDS: readonly WriteCapKind[] = Object.freeze(['drafts', 'books-lines', 'messages']);
/** The tools whose call writes one of the capped kinds. Everything else writes nothing the caps count. */
const TOOL_WRITES: Readonly<Partial<Record<ToolName, WriteCapKind>>> = Object.freeze({
  'outbox.propose': 'messages', 'sandbox.transform': 'books-lines', 'sandbox.python': 'books-lines', 'bills.pick': 'books-lines',
});
const WORDS: Readonly<Record<WriteCapKind, { one: string; many: string; flood: string }>> = Object.freeze({
  drafts: { one: 'draft', many: 'drafts', flood: 'you' },
  'books-lines': { one: 'books line', many: 'books lines', flood: 'your books' },
  messages: { one: 'message for people', many: 'messages for people', flood: 'anyone' },
});
const AFTER = 'Allow more for today on Today, or wait until tomorrow.';

/** The day on the owner's calendar at an instant; a business with no country yet counts in UTC. */
const dayOf = (at: string, venture: Pick<VentureRecord, 'country'>) => localDayAt(at, venture.country ?? { code: 'XX' });
const count =(kind: WriteCapKind, n: number) => `${n} ${n === 1 ? WORDS[kind].one : WORDS[kind].many}`;
/** "Chausar stops agents at 30 drafts a day so a stuck agent can't flood you." */
export function capWords(kind: WriteCapKind, cap: number): Display {
  return `Chausar stops agents at ${count(kind, cap)} a day so a stuck agent can't flood ${WORDS[kind].flood}.`;
}

/** The kind of write a tool call makes, or null. */
export function writeKindOf(tool: string): WriteCapKind | null {
  return TOOL_WRITES[tool as ToolName] ?? null;
}

function latestPolicy(state: State, ventureId: string): SpendPolicyRecord | null {
  return listRecords(state, 'venture-spend-policy', ventureId).reduce<SpendPolicyRecord | null>((best, item) => (!best || item.at >= best.at ? item : best), null);
}

/** The owner's cap for a kind: theirs when they lowered it, else the default. */
export function ownerCap(state: State, ventureId: string, kind: WriteCapKind): number {
  const set = latestPolicy(state, ventureId)?.writeCaps?.[kind];
  return typeof set === 'number' && Number.isInteger(set) && set >= 0 && set <= WRITE_CAPS[kind] ? set : WRITE_CAPS[kind];
}

/** What a raise for today adds: the owner's cap again, and at least one. */
const raiseOf = (cap: number) => Math.max(cap, 1);

/** A recorded request that waits for the owner; a shadow one never runs, so it is no message. */
function recordedMessage(call: ToolCallRecord): boolean {
  if (call.tool !== 'outbox.propose' || call.outcome !== 'succeeded' || !call.envelope.ok) return false;
  return (call.envelope.result as { shadow?: unknown } | null)?.shadow !== true;
}

/** What is running now and not stored yet: the calls and tables of the turn in flight, for its own run. */
export type InFlight = { runId: string; calls: readonly ToolCallRecord[]; tables: readonly Pick<WorkTableRecord, 'id' | 'at' | 'rows' | 'source'>[] };
/** The tables that are books lines: rows an agent's program made from a table, and bills it picked from PDFs. */
const BOOKS_SOURCES: readonly string[] = Object.freeze(['transform', 'picked']);

/**
 * What agents wrote on one day of the owner's calendar, by kind, from stored rows; with a turn in flight, that run's
 * calls and tables are counted from the turn instead of from the store, so nothing is counted twice. Drafts are the
 * delivery runs whose AI-written draft was kept that day (readyAt): durable records, never the pruned event log.
 */
export function writesOn(state: State, venture: VentureRecord, day: string, flight: InFlight | null = null): Record<WriteCapKind, number> {
  const onDay = (at: string | undefined) => !!at && dayOf(at, venture) === day;
  const drafts = listRecords(state, 'venture-delivery-run', venture.id)
    .filter(run => run.servedBy === 'model' && run.deliverable !== null && onDay(run.readyAt)).length;
  const tables = new Map<string, Pick<WorkTableRecord, 'at' | 'rows' | 'source'>>();
  for (const table of listRecords(state, 'venture-work-table', venture.id)) if (table.runRef.kind === 'delivery') tables.set(table.id, table);
  for (const table of flight?.tables ?? []) tables.set(table.id, table);
  let lines = 0;
  for (const table of tables.values()) if (onDay(table.at) && BOOKS_SOURCES.includes(table.source.kind)) lines += table.rows.length;
  const runs: DeliveryRunRecord[] = listRecords(state, 'venture-delivery-run', venture.id);
  const calls = runs.filter(run => run.id !== flight?.runId).flatMap(run => run.harness?.toolCalls ?? []);
  let messages = [...calls, ...(flight?.calls ?? [])].filter(call => recordedMessage(call) && onDay(call.startedAt)).length;
  messages += listRecords(state, 'venture-connector-post', venture.id).filter(post => post.agent !== null && onDay(post.at)).length;
  return { drafts, 'books-lines': lines, messages };
}

/** Today's caps as the owner sees them: each cap (raised once when allowed today), what agents made, in words. */
export function writeCapsToday(state: State, venture: VentureRecord, nowIso: string, flight: InFlight | null = null): WriteCapView[] {
  const day = dayOf(nowIso, venture);
  const used = writesOn(state, venture, day, flight);
  const raised = new Set(listRecords(state, 'venture-write-allowance', venture.id).filter(item => item.day === day).map(item => item.capKind));
  return WRITE_CAP_KINDS.map(kind => {
    const cap = ownerCap(state, venture.id, kind);
    return { kind, cap: raised.has(kind) ? cap + raiseOf(cap) : cap, used: used[kind], raised: raised.has(kind), line: capWords(kind, cap) };
  });
}

/**
 * The refusal for a write of a kind past today's cap, else null. 'next': before a write, refused once the cap is
 * reached. 'made': after a call made its rows (the flight holds them), refused when they took the count past the cap.
 */
export function writeCapDenial(state: State, venture: VentureRecord, kind: WriteCapKind, nowIso: string, flight: InFlight | null = null, mode: 'next' | 'made' = 'next'): Denial | null {
  const today = writeCapsToday(state, venture, nowIso, flight).find(item => item.kind === kind)!;
  if (mode === 'next' ? today.used < today.cap : today.used <= today.cap) return null;
  return { code: 'WRITE_CAP_REACHED', reason: `${capWords(kind, ownerCap(state, venture.id, kind))} ${today.raised ? 'You allowed more once today; it starts again tomorrow.' : AFTER}` };
}

/**
 * The hook a real order's tool environment carries (env.ts): before a call that writes runs, today's cap for its kind
 * is read again from the vault, counting the turn in flight; and after it ran (made: true, with what it made in the
 * turn's tables), whether its rows took the count past the cap, in which case its table is not kept. A call that
 * writes nothing passes.
 */
export function toolWriteCap(deps: VentureDeps, venture: VentureRecord, runId: string): (tool: string, turn: { calls: readonly ToolCallRecord[]; tables: InFlight['tables']; made?: boolean }) => Denial | null {
  return (tool, turn) => {
    const kind = writeKindOf(tool);
    if (!kind) return null;
    return writeCapDenial(deps.store.read(), venture, kind, deps.clock().toISOString(), { runId, calls: turn.calls, tables: turn.tables }, turn.made ? 'made' : 'next');
  };
}

/** Before an approved call that writes a draft goes out (recheck.ts recheckSend): the drafts cap, read again now. */
export function draftCapDenial(state: State, venture: VentureRecord | null | undefined, run: Pick<DeliveryRunRecord, 'harness'> | null | undefined, nowIso: string): Denial | null {
  if (!venture || !run) return null;
  if (run.harness && run.harness.phase !== 'write') return null;
  return writeCapDenial(state, venture, 'drafts', nowIso);
}

// ---------------------------------------------------------------------------
// venture.runs.allowWrites and Today's rows
// ---------------------------------------------------------------------------

/** Raises one cap for today, once, in its own commit. */
async function allowWrites(deps: VentureDeps, ctx: Context, kind: WriteCapKind): Promise<AllowWritesView> {
  return ventureAction(deps, ctx, 'approve', 'runs.allowWrites', tx => {
    const day = dayOf(tx.now, tx.venture!);
    const already = tx.list('venture-write-allowance').some(item => item.capKind === kind && item.day === day);
    check(!already, 'WRITE_CAP_REACHED', `You already allowed more ${WORDS[kind].many} today. The cap starts again tomorrow.`);
    const cap = ownerCap(tx.state, tx.venture!.id, kind);
    tx.put({ ...tx.base('venture-write-allowance'), capKind: kind, day, capThen: cap, by: ctx.memberId });
    tx.emit('queue.changed', {});
    const more = raiseOf(cap);
    return { kind, line: `Agents may make ${more} more ${more === 1 ? WORDS[kind].one : WORDS[kind].many} today. The cap starts again tomorrow.` };
  });
}

/** venture.runs.allowWrites { kind } (approve, app only): raises that cap once for today, by its own size. */
export async function runsAllowWritesHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AllowWritesView> {
  requireAppChannel(ctx, 'venture.runs.allowWrites');
  const body = exactPayload(payload, ['kind'], ['kind']);
  check((WRITE_CAP_KINDS as readonly unknown[]).includes(body.kind), 'INVALID_VENTURE_REQUEST', 'Choose drafts, books lines or messages.');
  return allowWrites(deps, ctx, body.kind as WriteCapKind);
}

const action = (id: QueueAction['id'], label: string, primary: boolean): QueueAction => ({ id, label, primary });

/** Today's rows: one per cap agents reached today, with Allow more until it was raised once. */
export function writeCapRows(state: State, venture: VentureRecord, nowIso: string): W4RowItem[] {
  const day = dayOf(nowIso, venture);
  return writeCapsToday(state, venture, nowIso).filter(item => item.used >= item.cap).map(item => {
    const cap = ownerCap(state, venture.id, item.kind);
    return {
      kind: 'notice', subject: `writecap:${item.kind}`, version: `${day}-${item.cap}`, createdAt: nowIso,
      title: `Agents reached today's ${item.raised ? 'raised ' : ''}cap of ${count(item.kind, item.cap)}`, line: capWords(item.kind, cap),
      actions: item.raised ? [action('later', 'Not today', true)] : [action('later', 'Not today', false), action('approve', `Allow ${raiseOf(cap)} more today`, true)],
    };
  });
}

/** Allow more on a cap row (views/queue-w4.ts decideRunControl): the same as venture.runs.allowWrites for its kind. */
export async function decideWriteCapRow(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const kind = decision.subject.slice('writecap:'.length) as WriteCapKind;
  check(decision.action === 'approve' && WRITE_CAP_KINDS.includes(kind), 'INVALID_VENTURE_REQUEST', 'This row does not offer that.');
  return { line: (await allowWrites(deps, ctx, kind)).line };
}
