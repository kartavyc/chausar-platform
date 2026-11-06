// Chausar venture launcher, agents (Ink v2 wave 4, package 4J13; catalogue A12): routines. A routine is a standalone
// prompt on a schedule, for an agent or for Chausar as chief of staff (the chief's Weekly review among them). A
// schedule is stored as once, every so many minutes, or days of the week at a time in a named time zone ("Every Monday
// 09:00, Asia/Kolkata"), never as cron text. The prompt must stand on its own, since a routine runs without the chat:
// words that lean on a conversation ("as above", "this one", "like before") are refused with ROUTINE_NOT_STANDALONE.
// A routine never approves anything: each run waits for the owner on Today (agents/routine-runner.ts). Routines an
// agent or the chief set can never change or remove the owner's (ROUTINE_NOT_YOURS). A routine is switched on only for
// an AI connection that Check connections has looked at (ROUTINE_NEEDS_CHECK, 4J7). History says "delivered", never
// "done". Code only; the rules follow Open Duet's routines and cloudflare-os's schedule types, rewritten.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, plainText, requireAppChannel, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import type {
  IsoTime, RoutineInput, RoutineRecord, RoutineRunRecord, RoutineRunsView, RoutineRunView, RoutineSchedule, RoutinesView, RoutineView, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { readAs } from '../delivery/shared.ts';
import { secretFindings } from '../core/secrets.ts';
import { holdsIdNumber, ID_REFUSED, KEY_REFUSED } from './threads.ts';
import { teamAgents } from '../chief/routing.ts';
import { ventureTimeZone } from '../local-day.ts';
import { ERASED_NAMED } from './notes.ts';
import { chatRoute } from './consent.ts';
import { requireConnectorChecked } from '../build/connector-check.ts';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** The shortest and longest gap an interval routine may have. */
export const MIN_EVERY_MINUTES = 15;
export const MAX_EVERY_MINUTES = 31 * 24 * 60;
const MAX_PROMPT = 2000;
const MAX_NAME = 80;
/** Days are ISO weekdays: 1 is Monday, 7 is Sunday. */
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The chief's Weekly review, as Business > Routines offers it (4J22a): a standalone prompt, Mondays at 09:00 where the business is. */
export function weeklyReview(venture: Pick<VentureRecord, 'country'>): RoutineInput {
  return {
    name: 'Weekly review', agent: null, on: true,
    prompt: 'Give me a weekly review of my business: the money that came in and went out this week, the work finished and still open, what waits on me, and the three things to do first next week.',
    schedule: { kind: 'calendar', weekdays: [1], time: '09:00', timeZone: ventureTimeZone(venture.country ?? { code: 'XX' }) },
  };
}

// ---------------------------------------------------------------------------
// Time zones, by Intl only
// ---------------------------------------------------------------------------

const formats = new Map<string, Intl.DateTimeFormat>();
function format(timeZone: string): Intl.DateTimeFormat {
  let found = formats.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formats.set(timeZone, found);
  }
  return found;
}

/** True for a time zone this computer knows by its IANA name. */
export function knownTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(timeZone)) return false;
  try { format(timeZone); return true; } catch { return false; }
}

/** The wall clock in a zone at an instant: year, month, day, hour, minute. */
function wall(ms: number, timeZone: string): { y: number; m: number; d: number; h: number; min: number } {
  const parts = Object.fromEntries(format(timeZone).formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour), min: Number(parts.minute) };
}

/**
 * The instant a wall-clock day and time in a zone names. One rule for clock changes: a time the clock skips (spring
 * forward: 02:30 in New York on the day it jumps from 02:00 to 03:00) runs when the clock has jumped by the same amount,
 * so at 03:30; a time that happens twice (fall back) runs once, at the first.
 */
export function instantAt(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  // The zone's offset from UTC at an instant, to the minute.
  const offset = (ms: number) => { const w = wall(ms, timeZone); return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min) - Math.floor(ms / MINUTE_MS) * MINUTE_MS; };
  // The offsets on either side of any change that day: every reading of this wall time uses one of them.
  const before = guess - offset(guess - DAY_MS / 2), after = guess - offset(guess + DAY_MS / 2);
  const reads = (at: number) => { const w = wall(at, timeZone); return w.y === y && w.m === m && w.d === d && w.h === h && w.min === min; };
  const real = [...new Set([before, after])].filter(reads).sort((a, b) => a - b);
  // Doubled: the first. Skipped: neither reads it; the offset before the jump lands as far past it as it was skipped.
  return real.length ? real[0] : before;
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?Z$/;
const isInstant = (value: unknown): value is IsoTime => typeof value === 'string' && ISO.test(value) && !Number.isNaN(Date.parse(value));
const CRON_WORDS = 'Use once, every so many minutes, or days of the week at a time. Chausar never keeps cron text.';

/**
 * Checks a schedule the owner sent: a closed shape of one of the three kinds, never cron text. Returns a clean copy.
 * nowMs: a once time at or before it is refused, since it would never run.
 */
export function checkSchedule(raw: unknown, nowMs: number = Number.NEGATIVE_INFINITY): RoutineSchedule {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', CRON_WORDS);
  const body = raw as Record<string, unknown>;
  if (body.kind === 'once') {
    const clean = exactPayload(body, ['kind', 'at'], ['kind', 'at']);
    check(isInstant(clean.at), 'INVALID_VENTURE_REQUEST', 'Give the time as an ISO time in UTC, like 2026-10-27T03:30:00.000Z.');
    check(Date.parse(clean.at) > nowMs, 'INVALID_VENTURE_REQUEST', 'That time has passed, so the routine would never run. Choose a time ahead.');
    return { kind: 'once', at: new Date(Date.parse(clean.at)).toISOString() };
  }
  if (body.kind === 'interval') {
    const clean = exactPayload(body, ['kind', 'everyMinutes', 'from'], ['kind', 'everyMinutes', 'from']);
    check(Number.isSafeInteger(clean.everyMinutes) && (clean.everyMinutes as number) >= MIN_EVERY_MINUTES && (clean.everyMinutes as number) <= MAX_EVERY_MINUTES,
      'INVALID_VENTURE_REQUEST', `Choose every ${MIN_EVERY_MINUTES} minutes at least, and at most every 31 days.`);
    check(isInstant(clean.from), 'INVALID_VENTURE_REQUEST', 'Give the first time as an ISO time in UTC.');
    return { kind: 'interval', everyMinutes: clean.everyMinutes as number, from: new Date(Date.parse(clean.from)).toISOString() };
  }
  if (body.kind === 'calendar') {
    const clean = exactPayload(body, ['kind', 'weekdays', 'time', 'timeZone'], ['kind', 'weekdays', 'time', 'timeZone']);
    const days = clean.weekdays;
    check(Array.isArray(days) && days.length >= 1 && days.length <= 7 && days.every(day => Number.isInteger(day) && day >= 1 && day <= 7) && new Set(days).size === days.length,
      'INVALID_VENTURE_REQUEST', 'Choose one or more days of the week, 1 for Monday to 7 for Sunday.');
    check(typeof clean.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean.time), 'INVALID_VENTURE_REQUEST', 'Give the time as HH:MM on a 24-hour clock, like 09:00.');
    check(typeof clean.timeZone === 'string' && knownTimeZone(clean.timeZone), 'INVALID_VENTURE_REQUEST', 'Choose a time zone by its name, like Asia/Kolkata.');
    return { kind: 'calendar', weekdays: [...(days as number[])].sort((a, b) => a - b), time: clean.time, timeZone: clean.timeZone };
  }
  throw new ChausarError('INVALID_VENTURE_REQUEST', CRON_WORDS);
}

/** The ISO weekday (1 Monday to 7 Sunday) of a calendar day. */
const isoWeekday = (y: number, m: number, d: number) => { const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return day === 0 ? 7 : day; };

/** The occurrences after one instant and up to another: how many, the newest, and the one before it. */
export type Occurrences = { count: number; latest: IsoTime | null; previous: IsoTime | null };

/** The schedule's occurrences in (afterMs, upToMs]. A calendar schedule looks back at most ten years. */
export function occurrencesBetween(schedule: RoutineSchedule, afterMs: number, upToMs: number): Occurrences {
  const none: Occurrences = { count: 0, latest: null, previous: null };
  if (upToMs <= afterMs) return none;
  const iso = (ms: number) => new Date(ms).toISOString();
  if (schedule.kind === 'once') {
    const at = Date.parse(schedule.at);
    return at > afterMs && at <= upToMs ? { count: 1, latest: schedule.at, previous: null } : none;
  }
  if (schedule.kind === 'interval') {
    const from = Date.parse(schedule.from), step = schedule.everyMinutes * MINUTE_MS;
    if (upToMs < from) return none;
    const first = afterMs < from ? 0 : Math.floor((afterMs - from) / step) + 1;
    const last = Math.floor((upToMs - from) / step);
    if (last < first) return none;
    return { count: last - first + 1, latest: iso(from + last * step), previous: last > first ? iso(from + (last - 1) * step) : null };
  }
  const [hour, minute] = schedule.time.split(':').map(Number);
  // Walk the local calendar day by day (never 24-hour steps, which slip across a clock change), from the day before
  // the start to the day after the end, and read each day's time where it falls.
  const first = wall(Math.max(afterMs, upToMs - 3660 * DAY_MS), schedule.timeZone);
  const last = wall(upToMs, schedule.timeZone);
  const days = Math.round((Date.UTC(last.y, last.m - 1, last.d) - Date.UTC(first.y, first.m - 1, first.d)) / DAY_MS);
  const found: number[] = [];
  let count = 0;
  for (let i = -1; i <= days + 1; i += 1) {
    const date = new Date(Date.UTC(first.y, first.m - 1, first.d + i));
    const day = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    if (!schedule.weekdays.includes(isoWeekday(day.y, day.m, day.d))) continue;
    const at = instantAt(day.y, day.m, day.d, hour, minute, schedule.timeZone);
    if (at <= afterMs || at > upToMs) continue;
    count += 1;
    found.push(at);
    if (found.length > 2) found.shift();
  }
  return count ? { count, latest: iso(found.at(-1)!), previous: found.length > 1 ? iso(found[0]) : null } : none;
}

/** The schedule's next occurrence after an instant, or null when there is none (a once that has passed). */
export function nextOccurrence(schedule: RoutineSchedule, afterMs: number): IsoTime | null {
  if (schedule.kind === 'once') return Date.parse(schedule.at) > afterMs ? schedule.at : null;
  if (schedule.kind === 'interval') {
    const from = Date.parse(schedule.from), step = schedule.everyMinutes * MINUTE_MS;
    const k = afterMs < from ? 0 : Math.floor((afterMs - from) / step) + 1;
    return new Date(from + k * step).toISOString();
  }
  return firstOf(schedule, afterMs);
}

/** The first calendar occurrence after an instant, looked for a day further at a time, for eight days. */
function firstOf(schedule: Extract<RoutineSchedule, { kind: 'calendar' }>, afterMs: number): IsoTime | null {
  for (let span = DAY_MS; span <= 8 * DAY_MS; span += DAY_MS) {
    const found = occurrencesBetween(schedule, afterMs, afterMs + span);
    if (found.count) return found.count === 1 ? found.latest : found.previous;
  }
  return null;
}

/** A moment in a zone as the owner reads it: '27 Oct 2026, 09:00'. */
function momentIn(iso: IsoTime, timeZone: string, order: VentureRecord['country']['dateOrder']): string {
  const w = wall(Date.parse(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatVentureDate(`${w.y}-${pad(w.m)}-${pad(w.d)}`, order)}, ${pad(w.h)}:${pad(w.min)}`;
}

const listWords = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** The schedule in words with its time zone: "Every Monday 09:00, Asia/Kolkata". once and interval read in the business's zone. */
export function whenWords(schedule: RoutineSchedule, venture: Pick<VentureRecord, 'country'>): string {
  const order = venture.country?.dateOrder ?? 'year-month-day';
  const zone = ventureTimeZone(venture.country ?? { code: 'XX' });
  if (schedule.kind === 'once') return `Once, ${momentIn(schedule.at, zone, order)}, ${zone}`;
  if (schedule.kind === 'interval') {
    const every = schedule.everyMinutes % (24 * 60) === 0 ? `${schedule.everyMinutes / (24 * 60)} days` : schedule.everyMinutes % 60 === 0 ? `${schedule.everyMinutes / 60} hours` : `${schedule.everyMinutes} minutes`;
    return `Every ${every.replace(/^1 (day|hour|minute)s$/, '$1')}, from ${momentIn(schedule.from, zone, order)}, ${zone}`;
  }
  const days = schedule.weekdays.length === 7 ? 'day' : schedule.weekdays.join() === '1,2,3,4,5' ? 'weekday' : listWords(schedule.weekdays.map(day => DAY_NAMES[day - 1]));
  return `Every ${days} ${schedule.time}, ${schedule.timeZone}`;
}

// ---------------------------------------------------------------------------
// Standalone prompts
// ---------------------------------------------------------------------------

/**
 * Words that lean on a conversation the routine will not have: English, Hinglish and Hindi. A routine runs without the
 * chat, so "as above" or "like before" would point at nothing.
 */
const LEANS = /\b(?:as (?:above|before|discussed|mentioned|we (?:said|discussed|agreed)|i said|usual)|(?:see|the) above|above one|this one|that one|these ones|those ones|like (?:before|last time|the last one)|same as (?:before|last time|usual|above)|the same again|what we (?:discussed|talked about|said)|(?:do|run|repeat|send) (?:it|that|this) again|the previous (?:one|message|answer)|pehle jaisa|jaise pehle|upar wala|wahi wala)\b(?!-)|ऊपर वाला|पहले जैसा|जैसे पहले|वही वाला/iu;

/** Refuses a prompt that leans on a conversation (ROUTINE_NOT_STANDALONE), and keys and id numbers (CHAT_KEY_REFUSED). */
export function checkPrompt(prompt: string): string {
  check(secretFindings(prompt).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
  check(!holdsIdNumber(prompt), 'CHAT_KEY_REFUSED', ID_REFUSED);
  const leans = LEANS.exec(prompt);
  if (leans) throw new ChausarError('ROUTINE_NOT_STANDALONE', `A routine runs without the chat, so "${leans[0]}" would point at nothing. Say in full what you want each time.`);
  return prompt;
}

// ---------------------------------------------------------------------------
// The records
// ---------------------------------------------------------------------------

/** The open business's routines, removed ones left out. */
export function liveRoutines(state: State, ventureId: string): RoutineRecord[] {
  return listRecords(state, 'venture-routine', ventureId).filter(routine => routine.removedAt === null);
}

/** One routine's runs, oldest first by when they were due. */
export function runsOf(state: State, ventureId: string, routineId: string): RoutineRunRecord[] {
  return listRecords(state, 'venture-routine-run', ventureId).filter(run => run.routineId === routineId).sort((a, b) => (a.dueAt === b.dueAt ? a.at.localeCompare(b.at) : a.dueAt.localeCompare(b.dueAt)));
}

/** Who a routine asks: the agent's name, or Chausar for the chief. */
export function askedName(state: State, venture: VentureRecord, agent: string | null): string {
  return agent === null ? 'Chausar' : teamAgents(state, venture).find(item => item.id === agent)?.name ?? agent;
}

/** The input checked: the name, the agent (one on the team, or null for the chief), a standalone prompt and the schedule. */
function checkInput(state: State, venture: VentureRecord, raw: unknown, nowMs: number): RoutineInput {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send the routine.');
  const body = exactPayload(raw, ['id', 'name', 'agent', 'prompt', 'schedule', 'on'], ['name', 'prompt', 'schedule', 'on']);
  const name = tidyWords(plainText(body.name, 'Name', { min: 1, max: MAX_NAME }));
  const agent = body.agent === undefined || body.agent === null ? null : identifier(body.agent, 'Agent');
  if (agent !== null) check(teamAgents(state, venture).some(item => item.id === agent), 'INVALID_VENTURE_REQUEST', 'That agent is not on this team.');
  const prompt = checkPrompt(plainText(body.prompt, 'Prompt', { min: 10, max: MAX_PROMPT }));
  check(typeof body.on === 'boolean', 'INVALID_VENTURE_REQUEST', 'on must be true or false.');
  const id = body.id === undefined ? undefined : identifier(body.id, 'Routine');
  // A time already past is refused only when it is new or changed: a once routine whose time has passed can still be
  // switched off, renamed or have its prompt edited.
  const schedule = checkSchedule(body.schedule);
  const kept = id ? listRecords(state, 'venture-routine', venture.id).find(routine => routine.id === id)?.schedule : undefined;
  if (!kept || JSON.stringify(kept) !== JSON.stringify(schedule)) checkSchedule(body.schedule, nowMs);
  return { ...(id ? { id } : {}), name, agent, prompt, schedule, on: body.on };
}

const NOT_YOURS = "You set this routine yourself, so only you can change or remove it. An agent's routine never touches yours.";

/**
 * Stores a routine inside the caller's transaction: a new one, or a change to one (its occurrences count again from
 * now). setBy: who asks; a routine the owner set can be changed only by the owner (ROUTINE_NOT_YOURS).
 */
export function saveRoutine(tx: VentureTx, input: RoutineInput, setBy: RoutineRecord['setBy']): RoutineRecord {
  if (!input.id) {
    return tx.put<RoutineRecord>({ ...tx.base('venture-routine'), name: input.name, agent: input.agent ?? null, setBy, prompt: input.prompt, schedule: input.schedule, on: input.on, removedAt: null });
  }
  const existing = tx.find('venture-routine', input.id);
  check(existing && existing.removedAt === null, 'INVALID_VENTURE_REQUEST', 'That routine was not found.');
  check(existing.setBy !== 'owner' || setBy === 'owner', 'ROUTINE_NOT_YOURS', NOT_YOURS);
  return tx.replace<RoutineRecord>({ ...existing, name: input.name, agent: input.agent ?? null, prompt: input.prompt, schedule: input.schedule, on: input.on, at: tx.now, setBy: existing.setBy === 'owner' ? 'owner' : setBy });
}

/** Removes a routine inside the caller's transaction; one the owner set only by the owner (ROUTINE_NOT_YOURS). */
export function removeRoutine(tx: VentureTx, id: string, by: RoutineRecord['setBy']): RoutineRecord {
  const existing = tx.find('venture-routine', id);
  check(existing && existing.removedAt === null, 'INVALID_VENTURE_REQUEST', 'That routine was not found.');
  check(existing.setBy !== 'owner' || by === 'owner', 'ROUTINE_NOT_YOURS', NOT_YOURS);
  return tx.replace<RoutineRecord>({ ...existing, on: false, removedAt: tx.now });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** One routine as the owner reads it. withPrompt: only for a role that may change routines (4J22a). */
export function routineView(state: State, venture: VentureRecord, routine: RoutineRecord, nowMs: number, withPrompt = true): RoutineView {
  const order = venture.country?.dateOrder ?? 'year-month-day';
  const zone = routine.schedule.kind === 'calendar' ? routine.schedule.timeZone : ventureTimeZone(venture.country ?? { code: 'XX' });
  const next = routine.on ? nextOccurrence(routine.schedule, nowMs) : null;
  const who = askedName(state, venture, routine.agent);
  const line = !routine.on ? 'Off. Nothing runs.'
    : next ? `Next ${momentIn(next, zone, order)}. It asks ${who}, and waits for your approval on Today before anything goes to your AI.`
      : 'No more times to run.';
  // 4J22a: the prompt too, so the owner turns a routine off, on or changes it by sending the same words back; a role
  // that may not change routines (an accountant, a viewer) reads the schedule without the words.
  return { id: routine.id, name: routine.name, agent: routine.agent, ...(withPrompt ? { prompt: routine.prompt } : {}), schedule: structuredClone(routine.schedule), when: whenWords(routine.schedule, venture), on: routine.on, next, line };
}

/** One run in the history. A finished run says delivered, never done. */
export function routineRunView(run: RoutineRunRecord): RoutineRunView {
  return { id: run.id, dueAt: run.dueAt, state: run.state, line: run.line };
}

/** venture.routines.list {} (read): the open business's routines, oldest first, each with its schedule in words and the next time. */
export async function routinesListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RoutinesView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const nowMs = deps.clock().getTime();
  const mayChange = ctx.role === 'owner' || ctx.role === 'cofounder';
  return { routines: liveRoutines(state, venture.id).map(routine => routineView(state, venture, routine, nowMs, mayChange)) };
}

/** venture.routines.runs { id } (read): one routine's history, newest first. */
export async function routinesRunsHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RoutineRunsView> {
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Routine');
  const { state, venture } = readAs(deps, ctx, 'read');
  check(listRecords(state, 'venture-routine', venture.id).some(routine => routine.id === id), 'INVALID_VENTURE_REQUEST', 'That routine was not found.');
  return { runs: runsOf(state, venture.id, id).reverse().map(routineRunView) };
}

/** venture.routines.set { routine } (approve, app only): the owner sets or changes a routine. */
export async function routinesSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ routine: RoutineView }> {
  requireAppChannel(ctx, 'venture.routines.set');
  const body = exactPayload(payload, ['routine'], ['routine']);
  const { state, venture } = readAs(deps, ctx, 'approve');
  const input = checkInput(state, venture, body.routine, deps.clock().getTime());
  // 4J7 (K7): a routine is switched on only for an AI connection Check connections has looked at (its runs go to it).
  const route = chatRoute(deps.models.status(ctx));
  if (input.on && route) requireConnectorChecked(state, venture.id, `model:${route.presetId}`);
  return ventureAction(deps, ctx, 'approve', 'routines.set', tx => {
    const saved = saveRoutine(tx, input, 'owner');
    return { routine: routineView(tx.state, tx.venture!, saved, Date.parse(tx.now)) };
  });
}

/** venture.routines.remove { id } (approve, app only): the owner removes a routine; its history stays. */
export async function routinesRemoveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ removed: true; line: string }> {
  requireAppChannel(ctx, 'venture.routines.remove');
  const body = exactPayload(payload, ['id'], ['id']);
  const id = identifier(body.id, 'Routine');
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'routines.remove', tx => {
    const removed = removeRoutine(tx, id, 'owner');
    return { removed: true as const, line: `${removed.name} is removed. Its history stays.` };
  });
}

/**
 * 4J22a (NOTES item 28, the eraseNote pattern): Forget of a person erases every routine prompt or name that names them.
 * The prompt becomes ERASED_NAMED and the routine is switched off, since erased words can ask nothing; its id, schedule
 * and history stay. A name that names them reads "Routine".
 */
export function eraseRoutinesNaming(tx: VentureTx, mentionsName: (text: unknown) => boolean): void {
  for (const routine of tx.list('venture-routine')) {
    const prompt = mentionsName(routine.prompt), name = mentionsName(routine.name);
    if (!prompt && !name) continue;
    tx.replace<RoutineRecord>({ ...routine, ...(prompt ? { prompt: ERASED_NAMED, on: false } : {}), ...(name ? { name: 'Routine' } : {}) });
  }
}
