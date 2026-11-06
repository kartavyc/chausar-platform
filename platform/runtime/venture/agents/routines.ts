// Chausar venture launcher, agents (Ink v2 wave 4, package 4J13; catalogue A12): routines. A routine is a standalone
// prompt on a schedule, for an agent or for Chausar as chief of staff (the chief's Weekly review among them). A
// schedule is stored as once, every so many minutes, or days of the week at a time in a named time zone ("Every Monday
// 09:00, Asia/Kolkata"), never as cron text. The prompt must stand on its own, since a routine runs without the chat:
// words that lean on a conversation ("as above", "this one", "like before") are refused with ROUTINE_NOT_STANDALONE.
// A routine never approves anything: each run waits for the owner on Today (agents/routine-runner.ts). Routines an
// agent or the chief set can never change or remove the owner's (ROUTINE_NOT_YOURS). A routine is switched on only for
// an AI connection that Check connections has looked at (ROUTINE_NEEDS_CHECK, 4J7). History says "delivered", never
// "done". Code only; the rules follow Open Duet's routines and cloudflare-os's schedule types, rewritten.
import { FACT_WORDS, checkTrigger, eventWhen, triggerFacts } from '../build/event-triggers.ts';
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, plainText, requireAppChannel, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import type {
  IsoTime, RoutineInput, RoutineRecord, RoutineSuggestion, RoutineSuggestionsView, RoutineRunRecord, RoutineRunsView, RoutineRunView, RoutineSchedule, RoutinesView, RoutineView, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { readAs } from '../delivery/shared.ts';
import { secretFindings } from '../core/secrets.ts';
import { holdsIdNumber, ID_REFUSED, KEY_REFUSED } from './threads.ts';
import { teamAgents } from '../chief/routing.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { teamFlagship } from '../views/team-shape.ts';
import { AGENT_ID } from '../views/shared.ts';
import { ventureTimeZone } from '../local-day.ts';
import { formatClock } from '../../owner-format.ts';
import { ERASED_NAMED } from './notes.ts';
import { chatRoute } from './consent.ts';
import { requireConnectorChecked } from '../build/connector-check.ts';
import {pickPlaybook} from '../playbooks/registry.ts';
import {VA_REPORT_PROMPTS} from '../playbooks/virtual-assistant/routines.ts';
import { RETIRED_LINE, RETIRED_SUFFIX, retirementOf } from './retired.ts';

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

import {knownTimeZone,wall,instantAt,occurrencesBetween,nextOccurrence} from './routine-time.ts';
export {knownTimeZone,instantAt,occurrencesBetween,nextOccurrence,type Occurrences} from './routine-time.ts';

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
  if (body.kind === 'event') {
    const clean = exactPayload(body, ['kind', 'source', 'event'], ['kind', 'source', 'event']);
    const pair = `${clean.source}:${clean.event}`;
    check(['razorpay:payment', 'cal-com:booking', 'cal-com:booking-cancelled'].includes(pair), 'INVALID_VENTURE_REQUEST', 'Choose a payment from Razorpay, or a booking made or cancelled on Cal.com.');
    return { kind: 'event', source: clean.source as 'razorpay' | 'cal-com', event: clean.event as 'payment' | 'booking' | 'booking-cancelled' };
  }
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
  if (body.kind === 'monthly') {
    // C4 task 32: one day of the month, 1 to 28, so the routine runs in every month.
    const clean = exactPayload(body, ['kind', 'day', 'time', 'timeZone'], ['kind', 'day', 'time', 'timeZone']);
    check(Number.isInteger(clean.day) && (clean.day as number) >= 1 && (clean.day as number) <= 28, 'INVALID_VENTURE_REQUEST', 'Choose a day of the month from 1 to 28.');
    check(typeof clean.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean.time), 'INVALID_VENTURE_REQUEST', 'Give the time as HH:MM on a 24-hour clock, like 09:00.');
    check(typeof clean.timeZone === 'string' && knownTimeZone(clean.timeZone), 'INVALID_VENTURE_REQUEST', 'Choose a time zone by its name, like Asia/Kolkata.');
    return { kind: 'monthly', day: clean.day as number, time: clean.time, timeZone: clean.timeZone };
  }
  throw new ChausarError('INVALID_VENTURE_REQUEST', CRON_WORDS);
}

/** A moment in a zone as the owner reads it, on the 12-hour clock (B2 fix round 1): '27 Oct 2026, 9:00 am'. */
function momentIn(iso: IsoTime, timeZone: string, order: VentureRecord['country']['dateOrder']): string {
  const w = wall(Date.parse(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${formatVentureDate(`${w.y}-${pad(w.m)}-${pad(w.d)}`, order)}, ${formatClock(`${pad(w.h)}:${pad(w.min)}`)}`;
}

/** 1st, 2nd, 3rd, 4th ... 21st ... 28th. */
export const ordinal = (day: number) => `${day}${day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'}`;
const listWords = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** The schedule in words with its time zone: "Every Monday 9:00 am, Asia/Kolkata". once and interval read in the business's zone. */
export function whenWords(schedule: RoutineSchedule, venture: Pick<VentureRecord, 'country'>): string {
  if (schedule.kind === 'event') return eventWhen(schedule);
  const order = venture.country?.dateOrder ?? 'year-month-day';
  const zone = ventureTimeZone(venture.country ?? { code: 'XX' });
  if (schedule.kind === 'once') return `Once, ${momentIn(schedule.at, zone, order)}, ${zone}`;
  if (schedule.kind === 'interval') {
    const every = schedule.everyMinutes % (24 * 60) === 0 ? `${schedule.everyMinutes / (24 * 60)} days` : schedule.everyMinutes % 60 === 0 ? `${schedule.everyMinutes / 60} hours` : `${schedule.everyMinutes} minutes`;
    return `Every ${every.replace(/^1 (day|hour|minute)s$/, '$1')}, from ${momentIn(schedule.from, zone, order)}, ${zone}`;
  }
  if (schedule.kind === 'monthly') return `On the ${ordinal(schedule.day)} of each month, ${formatClock(schedule.time)}, ${schedule.timeZone}`;
  const days = schedule.weekdays.length === 7 ? 'day' : schedule.weekdays.join() === '1,2,3,4,5' ? 'weekday' : listWords(schedule.weekdays.map(day => DAY_NAMES[day - 1]));
  return `Every ${days} ${formatClock(schedule.time)}, ${schedule.timeZone}`;
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
  if (agent === null) return 'Chausar';
  const onTeam = teamAgents(state, venture).find(item => item.id === agent)?.name;
  // W6 6G2: a retired agent keeps its name, with "(retired)".
  const retired = onTeam ? null : retirementOf(state, venture.id, agent);
  return onTeam ?? (retired ? `${retired.name}${RETIRED_SUFFIX}` : agent);
}

/** The input checked: the name, the agent (one on the team, or null for the chief), a standalone prompt and the schedule. */
function checkInput(state: State, venture: VentureRecord, raw: unknown, nowMs: number): RoutineInput {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_VENTURE_REQUEST', 'Send the routine.');
  const body = exactPayload(raw, ['id', 'name', 'agent', 'prompt', 'schedule', 'on','recordReport'], ['name', 'prompt', 'schedule', 'on']);
  const name = tidyWords(plainText(body.name, 'Name', { min: 1, max: MAX_NAME }));
  const agent = body.agent === undefined || body.agent === null ? null : identifier(body.agent, 'Agent');
  if (agent !== null) check(!retirementOf(state, venture.id, agent), 'AGENT_RETIRED', RETIRED_LINE);
  if (agent !== null) check(teamAgents(state, venture).some(item => item.id === agent), 'INVALID_VENTURE_REQUEST', 'That agent is not on this team.');
  const prompt = checkPrompt(plainText(body.prompt, 'Prompt', { min: 10, max: MAX_PROMPT }));
  const report=body.recordReport;
  if(report!==undefined)check((report==='va-morning'||report==='va-weekly')&&pickPlaybook(venture.idea)?.id==='virtual-assistant'&&agent===null&&prompt===VA_REPORT_PROMPTS[report==='va-morning'?'morning':'weekly'],'INVALID_VENTURE_REQUEST','Choose a built-in private assistant report with its exact source-only prompt.');
  check(typeof body.on === 'boolean', 'INVALID_VENTURE_REQUEST', 'on must be true or false.');
  const id = body.id === undefined ? undefined : identifier(body.id, 'Routine');
  // A time already past is refused only when it is new or changed: a once routine whose time has passed can still be
  // switched off, renamed or have its prompt edited.
  const schedule = checkSchedule(body.schedule);
  const kept = id ? listRecords(state, 'venture-routine', venture.id).find(routine => routine.id === id)?.schedule : undefined;
  if (!kept || JSON.stringify(kept) !== JSON.stringify(schedule)) checkSchedule(body.schedule, nowMs);
  // C7: a trigger needs the relay and its source, and its prompt uses only its event's blanks.
  if (schedule.kind === 'event') { checkTrigger(venture, schedule); triggerFacts(prompt, schedule); }
  return { ...(id ? { id } : {}), name, agent, prompt, schedule, on: body.on,...(report?{recordReport:report as RoutineInput['recordReport']}:{}) };
}

const NOT_YOURS = "You set this routine yourself, so only you can change or remove it. An agent's routine never touches yours.";

/**
 * Stores a routine inside the caller's transaction: a new one, or a change to one (its occurrences count again from
 * now). setBy: who asks; a routine the owner set can be changed only by the owner (ROUTINE_NOT_YOURS).
 */
export function saveRoutine(tx: VentureTx, input: RoutineInput, setBy: RoutineRecord['setBy']): RoutineRecord {
  if (!input.id) {
    return tx.put<RoutineRecord>({ ...tx.base('venture-routine'), ...(input.schedule.kind === 'event' ? { facts: triggerFacts(input.prompt, input.schedule) } : {}), name: input.name, agent: input.agent ?? null, setBy, prompt: input.prompt, schedule: input.schedule, on: input.on, removedAt: null,...(input.recordReport?{recordReport:input.recordReport}:{}) });
  }
  const existing = tx.find('venture-routine', input.id);
  check(existing && existing.removedAt === null, 'INVALID_VENTURE_REQUEST', 'That routine was not found.');
  check(existing.setBy !== 'owner' || setBy === 'owner', 'ROUTINE_NOT_YOURS', NOT_YOURS);
  const {recordReport:_report,...prior}=existing;
  return tx.replace<RoutineRecord>({ ...prior, ...(input.schedule.kind === 'event' ? { facts: triggerFacts(input.prompt, input.schedule) } : {}), name: input.name, agent: input.agent ?? null, prompt: input.prompt, schedule: input.schedule, on: input.on, at: tx.now, setBy: existing.setBy === 'owner' ? 'owner' : setBy,...(input.recordReport?{recordReport:input.recordReport}:{}) });
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
  const zone = routine.schedule.kind === 'calendar' || routine.schedule.kind === 'monthly' ? routine.schedule.timeZone : ventureTimeZone(venture.country ?? { code: 'XX' });
  const next = routine.on ? nextOccurrence(routine.schedule, nowMs) : null;
  const who = askedName(state, venture, routine.agent);
  const line = !routine.on ? 'Off. Nothing runs.'
    // C7: a trigger starts on its event, while Chausar is open, and only drafts.
    : routine.schedule.kind === 'event' ? `${eventWhen(routine.schedule)}, while Chausar is open. It makes a draft or a proposal for Today, nothing more.`
    : next ? routine.recordReport?`Next ${momentIn(next,zone,order)}. A private report from saved records waits for your approval on Today. No model call.`:`Next ${momentIn(next, zone, order)}. It asks ${who}, and waits for your approval on Today before anything goes to your AI.`
      : 'No more times to run.';
  // 4J22a: the prompt too, so the owner turns a routine off, on or changes it by sending the same words back; a role
  // that may not change routines (an accountant, a viewer) reads the schedule without the words.
  return { id: routine.id, name: routine.name, agent: routine.agent, ...(routine.facts ? { facts: routine.facts.map(fact => FACT_WORDS[fact] ?? fact) } : {}), ...(withPrompt ? { prompt: routine.prompt,...(routine.recordReport?{recordReport:routine.recordReport}:{}) } : {}), schedule: structuredClone(routine.schedule), when: whenWords(routine.schedule, venture), on: routine.on, next, line };
}

/** One run in the history. A finished run says delivered, never done. */
export function routineRunView(run: RoutineRunRecord): RoutineRunView {
  return { id: run.id, dueAt: run.dueAt, state: run.state, line: run.line, ...(run.ranOn ? { ranOn: run.ranOn.why } : {}) };
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
  // W6 6G5 (D44): each run that asked an AI carries its model receipt, its cost behind a sum receipt of its charges.
  const routine = listRecords(state, 'venture-routine', venture.id).find(item => item.id === id)!;
  const calls = listRecords(state, 'venture-model-call', venture.id).filter(call => call.routineId === id);
  const { callsModelReceipt } = await import('../money/model-receipt.ts');
  const { spentByPlan } = await import('../money/spend-meter.ts');
  const { sumReceipt } = await import('../money/sums.ts');
  const runs: RoutineRunView[] = [];
  for (const run of runsOf(state, venture.id, id).reverse()) {
    const mine = calls.filter(call => call.routineRunId === run.id);
    if (!mine.length) { runs.push(routineRunView(run)); continue; }
    const plan = spentByPlan(state, venture, { type: 'spent-by', scope: 'routine-run', id: run.id, month: null });
    const receiptId = plan.addends.length ? (await sumReceipt(deps, ctx, venture.id, plan)).id : undefined;
    runs.push({ ...routineRunView(run), receipt: callsModelReceipt(state, venture, mine, { agent: routine.agent, ...(receiptId ? { receiptId } : {}) }) });
  }
  return { runs };
}

/** venture.routines.set { routine } (approve, app only): the owner sets or changes a routine. */
export async function routinesSetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ routine: RoutineView }> {
  requireAppChannel(ctx, 'venture.routines.set');
  const body = exactPayload(payload, ['routine'], ['routine']);
  const { state, venture } = readAs(deps, ctx, 'approve');
  const input = checkInput(state, venture, body.routine, deps.clock().getTime());
  // 4J7 (K7): a routine is switched on only for an AI connection Check connections has looked at (its runs go to it).
  const route = chatRoute(deps.models.status(ctx));
  if (input.on && route&&!input.recordReport) requireConnectorChecked(state, venture.id, `model:${route.presetId}`);
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

// ---------------------------------------------------------------------------
// Ready routines from the plan (one-shot C4 task 32)
// ---------------------------------------------------------------------------

/** A step that names its own rhythm, and the schedule code gives it: the 1st of each month, Mondays, or weekdays, at 09:00. */
const RHYTHMS: readonly { words: RegExp; schedule: (timeZone: string) => RoutineSchedule }[] = Object.freeze([
  { words: /\b(?:monthly|every month|each month|month-end|month end)\b/i, schedule: timeZone => ({ kind: 'monthly', day: 1, time: '09:00', timeZone }) },
  { words: /\b(?:weekly|every week|each week)\b/i, schedule: timeZone => ({ kind: 'calendar', weekdays: [1], time: '09:00', timeZone }) },
  { words: /\b(?:daily|every day|each day)\b/i, schedule: timeZone => ({ kind: 'calendar', weekdays: [1, 2, 3, 4, 5], time: '09:00', timeZone }) },
]);
/** At most this many ready routines are offered. */
const SUGGESTIONS_MAX = 2;

/**
 * Up to two routines the business's accepted plan already names: each step whose title says its rhythm ("Draft the
 * monthly report for review"), with the agent the playbook gives that step and the schedule code reads from the words.
 * Code only; none when the plan names no recurring step, and none for a step a routine of that name already covers.
 * Nothing is stored: the owner adds one through the form and saves it, and each run waits on Today as every routine does.
 */
export function routineSuggestions(state: State, venture: VentureRecord): RoutineSuggestion[] {
  const plan = acceptedBlueprintOrNull(state, venture);
  if (!plan) return [];
  const steps = plan.flagshipSteps
    ? plan.flagshipSteps.filter(step => step.doneBy !== 'person').map(step => ({ id: step.id, title: step.title.value }))
    : plan.deliverySteps.map(step => ({ id: step.id, title: step.title.value }));
  const timeZone = ventureTimeZone(venture.country ?? { code: 'XX' });
  const team = teamAgents(state, venture).map(agent => agent.id);
  const roleOf = teamFlagship(state, venture)?.roleOf ?? {};
  const taken = new Set(liveRoutines(state, venture.id).map(routine => routine.name.toLowerCase()));
  const found: RoutineSuggestion[] = [];
  for (const step of steps) {
    if (found.length >= SUGGESTIONS_MAX) break;
    const rhythm = RHYTHMS.find(item => item.words.test(step.title));
    const name = step.title.trim().slice(0, MAX_NAME);
    if (!rhythm || taken.has(name.toLowerCase())) continue;
    const owner = roleOf[step.id];
    const agent = owner && team.includes(owner) ? owner : team.includes(AGENT_ID) ? AGENT_ID : null;
    const schedule = rhythm.schedule(timeZone);
    const prompt = checkPrompt(`${name.replace(/[.\s]+$/, '')} for this business, from its own records and plan. Keep it as a draft for my approval.`);
    found.push({ name, agent, prompt, schedule, when: whenWords(schedule, venture), step: step.title });
    taken.add(name.toLowerCase());
  }
  return found;
}

/** venture.routines.suggestions {} (read): the ready routines from the plan, at most two; writes nothing. */
export async function routinesSuggestionsHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RoutineSuggestionsView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return { suggestions: routineSuggestions(state, venture) };
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
