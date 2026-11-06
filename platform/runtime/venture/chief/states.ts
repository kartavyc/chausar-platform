// Chausar venture launcher, chief (wave 6, package 6G1, decision D42): every Chats thread is in one of four states,
// Pinned, Active, Snoozed or Settled. Pinned, snoozed and settled-by-the-owner are stored on the thread; settling after
// the owner's quiet days (7 by default, 0 is never) is worked out on every read, so nothing runs in the background and
// nothing is written for it. A chat that waits for the owner (a drafted or raised step, or the chief's question back) is
// never hidden: it does not settle and wakes from a snooze early, and the owner cannot snooze or settle it until it
// stops waiting. Every change is an owner action from the app (ventureAction, so the activity log has it) and returns
// the request that undoes it exactly. No message, proposal or receipt is ever changed here.
// Rules learned from T3 Code (apps/server/src/orchestration-v2/ThreadSettlementService.ts and
// packages/client-runtime/src/state/threadSettled.ts, MIT, T3 Tools Inc.): reimplemented for Chausar, no code copied.
import { check, type Context, type State } from '../../contracts.ts';
import type {
  ChatSettleRecord, ChiefMessageRecord, ChiefSettleResult, ChiefSnoozeOption, ChiefSnoozePreset, ChiefThreadRecord, ChiefThreadState,
  ChiefThreadStateInput, ChiefThreadSummary, IsoTime, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import { readAs } from '../delivery/shared.ts';
import { localTimeAt } from '../local-day.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** D42: a chat settles after this many quiet days unless the owner chose another number. */
export const SETTLE_DAYS = 7;
/** The most quiet days the owner may choose (a year); 0 is never. */
const MAX_SETTLE_DAYS = 365;
/** "Later" wakes this long from now; "Tomorrow" and "Next week" wake at this time where the business is. */
const LATER_MS = 3 * HOUR_MS;
const MORNING = '09:00';
const STATES: readonly ChiefThreadState[] = ['pinned', 'active', 'snoozed', 'settled'];
const PRESETS: readonly ChiefSnoozePreset[] = ['later', 'tomorrow', 'next-week'];
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const WAITING_REFUSED = 'This chat is waiting for you. Answer it or decide its step first.';

/** The owner's quiet days before a chat settles on its own: the newest choice, else 7. */
export function settleDaysOf(state: State, venture: VentureRecord): number {
  return listRecords(state, 'venture-chat-settle', venture.id).at(-1)?.days ?? SETTLE_DAYS;
}

/** True while a step in the chat waits for the owner's Start or approval, or the chief's question is the last word. */
export function waitingOf(state: State, venture: VentureRecord, thread: ChiefThreadRecord, messages: readonly ChiefMessageRecord[]): boolean {
  const last = messages.at(-1);
  if (last?.from === 'chief' && last.ask) return true;
  return listRecords(state, 'venture-proposal', venture.id).some(item => item.threadId === thread.id && (item.status === 'drafted' || item.status === 'raised'));
}

export type ThreadStateView = Pick<ChiefThreadSummary, 'state' | 'snoozedUntil' | 'settled'>;

/**
 * The chat's state now: pinned first; a chat that waits is active whatever else was chosen; then the owner's Settle;
 * then a snooze still ahead; then quiet days counted from its last message, the owner's last change or its last wake.
 */
export function stateOf(thread: ChiefThreadRecord, waiting: boolean, now: IsoTime, days: number): ThreadStateView {
  const active: ThreadStateView = { state: 'active', snoozedUntil: null, settled: null };
  if (thread.pinned) return { ...active, state: 'pinned' };
  if (waiting) return active;
  if (thread.settledAt) return { state: 'settled', snoozedUntil: null, settled: { at: thread.settledAt, by: 'owner' } };
  const nowMs = Date.parse(now);
  const until = thread.snoozedUntil ?? null;
  if (until && Date.parse(until) > nowMs) return { state: 'snoozed', snoozedUntil: until, settled: null };
  if (days > 0) {
    const anchor = Math.max(Date.parse(thread.lastAt), thread.stateAt ? Date.parse(thread.stateAt) : 0, until ? Date.parse(until) : 0);
    const due = anchor + days * DAY_MS;
    if (nowMs >= due) return { state: 'settled', snoozedUntil: null, settled: { at: new Date(due).toISOString(), by: 'auto' } };
  }
  return active;
}

/** The instant a wall-clock time falls at where the business is ('2026-10-22', '09:00' in India is 03:30 UTC). */
function instantAt(day: string, time: string, country: VentureRecord['country']): IsoTime {
  const naive = Date.parse(`${day}T${time}:00.000Z`);
  const offsetAt = (ms: number) => {
    const local = localTimeAt(new Date(ms), country);
    const sign = local.at(-6) === '-' ? -1 : 1;
    return sign * (Number(local.slice(-5, -3)) * 60 + Number(local.slice(-2))) * 60_000;
  };
  // Twice, so a day whose offset changes overnight still lands on that wall-clock time.
  const first = naive - offsetAt(naive);
  return new Date(naive - offsetAt(first)).toISOString();
}

const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The snooze choices now, worked out on the owner's clock, soonest first: in three hours, tomorrow at 09:00 and next
 * Monday at 09:00 (a week on when today is Monday). Two at the same minute are one (on a Sunday, tomorrow is Monday).
 */
export function snoozeOptions(now: IsoTime, country: VentureRecord['country']): ChiefSnoozeOption[] {
  const nowMs = Date.parse(now);
  const today = localTimeAt(new Date(nowMs), country).slice(0, 10);
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const monday = plusDays(today, ((8 - weekday) % 7) || 7);
  const all: ChiefSnoozeOption[] = [
    { id: 'later', until: new Date(Math.floor((nowMs + LATER_MS) / 60_000) * 60_000).toISOString() },
    { id: 'tomorrow', until: instantAt(plusDays(today, 1), MORNING, country) },
    { id: 'next-week', until: instantAt(monday, MORNING, country) },
  ];
  const seen = new Set<string>();
  return all.filter(option => option.until > now).sort((a, b) => a.until.localeCompare(b.until)).filter(option => {
    if (seen.has(option.until)) return false;
    seen.add(option.until);
    return true;
  });
}

/** A wake time as the owner reads it, where the business is: '22 Oct 2026, 09:00'. */
export function wakeWords(until: IsoTime, venture: VentureRecord): string {
  const local = localTimeAt(until, venture.country);
  return `${formatVentureDate(local.slice(0, 10), venture.country.dateOrder)}, ${local.slice(11, 16)}`;
}

/** The request that puts a chat back in the state it shows now. */
function undoOf(threadId: string, view: ThreadStateView): ChiefThreadStateInput {
  return view.state === 'snoozed' && view.snoozedUntil ? { threadId, state: 'snoozed', until: view.snoozedUntil } : { threadId, state: view.state };
}

/** The engine's words for a change, said the same way by the fake engine. */
function lineOf(state: ChiefThreadState, until: IsoTime | null, venture: VentureRecord): string {
  if (state === 'pinned') return 'Pinned to the top of your chats.';
  if (state === 'snoozed' && until) return `Snoozed until ${wakeWords(until, venture)}. It comes back early if it needs you.`;
  if (state === 'settled') return 'Settled. It is in Settled chats until you open it again.';
  return 'Back in your chats.';
}

/** Reads a thread's summary as threads.ts makes it (passed in, so the two files do not import each other). */
export type SummaryOf = (state: State, venture: VentureRecord, thread: ChiefThreadRecord, now: IsoTime) => ChiefThreadSummary;

/**
 * venture.chief.thread.state { threadId, state, preset?, until? } (prepare, app only): pins, unpins, snoozes or settles a
 * chat. A snooze names one preset or an exact time still ahead (Undo sends the time). A chat that waits for the owner
 * cannot be snoozed or settled. Returns the chat, the request that undoes this exactly, and the engine's words.
 */
export function threadStateHandler(summaryOf: SummaryOf) {
  return async (deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ thread: ChiefThreadSummary; undo: ChiefThreadStateInput; line: string }> => {
    requireAppChannel(ctx, 'venture.chief.thread.state');
    const body = exactPayload(payload, ['threadId', 'state', 'preset', 'until'], ['threadId', 'state']);
    const threadId = identifier(body.threadId, 'Chat');
    check(typeof body.state === 'string' && (STATES as readonly string[]).includes(body.state), 'INVALID_VENTURE_REQUEST', 'state is pinned, active, snoozed or settled.');
    const state = body.state as ChiefThreadState;
    if (state === 'snoozed') {
      check((body.preset === undefined) !== (body.until === undefined), 'INVALID_VENTURE_REQUEST', 'A snooze takes a preset or a time.');
      if (body.preset !== undefined) check(typeof body.preset === 'string' && (PRESETS as readonly string[]).includes(body.preset), 'INVALID_VENTURE_REQUEST', 'preset is later, tomorrow or next-week.');
      if (body.until !== undefined) check(typeof body.until === 'string' && INSTANT.test(body.until) && Number.isFinite(Date.parse(body.until)), 'INVALID_VENTURE_REQUEST', 'Send the time like 2026-10-22T03:30:00.000Z.');
    } else {
      check(body.preset === undefined && body.until === undefined, 'INVALID_VENTURE_REQUEST', 'Only a snooze takes a preset or a time.');
    }
    readAs(deps, ctx, 'prepare');
    return ventureAction(deps, ctx, 'prepare', 'chief.state', tx => {
      const venture = tx.venture!;
      const thread = tx.list('venture-chief-thread').find(item => item.id === threadId);
      check(thread, 'INVALID_VENTURE_REQUEST', 'That chat was not found.');
      const before = summaryOf(tx.state, venture, thread, tx.now);
      let until: IsoTime | null = null;
      if (state === 'snoozed' || state === 'settled') check(!before.waiting, 'INVALID_VENTURE_REQUEST', WAITING_REFUSED);
      if (state === 'snoozed') {
        until = typeof body.until === 'string' ? body.until : snoozeOptions(tx.now, venture.country).find(option => option.id === body.preset)?.until ?? null;
        check(until && until > tx.now, 'INVALID_VENTURE_REQUEST', 'Pick a time that is still ahead.');
      }
      const kept = tx.replace<ChiefThreadRecord>({
        ...thread, pinned: state === 'pinned', snoozedUntil: until, settledAt: state === 'settled' ? tx.now : null, stateAt: tx.now,
      });
      return { thread: summaryOf(tx.state, venture, kept, tx.now), undo: undoOf(threadId, before), line: lineOf(state, until, venture) };
    });
  };
}

/** The engine's words for the quiet days. */
const settleLine = (days: number) => (days === 0 ? 'Chats never settle on their own.' : `Chats settle after ${days} quiet ${days === 1 ? 'day' : 'days'}.`);

/**
 * venture.chief.settle.set { days } (prepare, app only): the owner's quiet days before a chat settles on its own, a whole
 * number from 0 (never) to 365. Returns the number, the one before it for Undo, and the engine's words.
 */
export async function settleSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ChiefSettleResult> {
  requireAppChannel(ctx, 'venture.chief.settle.set');
  const body = exactPayload(payload, ['days'], ['days']);
  check(typeof body.days === 'number' && Number.isInteger(body.days) && body.days >= 0 && body.days <= MAX_SETTLE_DAYS, 'INVALID_VENTURE_REQUEST', 'days is a whole number from 0 (never) to 365.');
  const days = body.days;
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'chief.settle', tx => {
    const undo = settleDaysOf(tx.state, tx.venture!);
    tx.put<ChatSettleRecord>({ ...tx.base('venture-chat-settle'), days });
    return { days, undo, line: settleLine(days) };
  });
}
