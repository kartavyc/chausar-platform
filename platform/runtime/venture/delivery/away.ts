// Chausar venture launcher, delivery (Ink v2 wave 4, package 4F1; catalogue O4): Away. The owner says which days they
// will be away and Chausar lists, from records only: the promises falling due between those days (client payments due
// on issued invoices, posts planned on a content calendar), what keeps running (the engine's own Keeper jobs that ran),
// how many approvals will wait, and a short auto-reply in the owner's words for them to paste into their own mail app
// (one-shot C4 task 40: signed with their first name and the business). Chausar sends nothing. While the owner is away,
// no new work starts on its own (run-guards.ts). Once back, "Since you left" names Today's rows made while away.
// The readiness list follows sealeap's time-away readiness skill (ideas only); this is a rewrite.
import { check, type Context, type State } from '../../contracts.ts';
import { exactPayload, formatVentureDate, isoDate, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import type { AwayRecord, AwayView, KeeperJobId, VentureDeps, VentureRecord } from '../contracts.ts';
import { readAs } from './shared.ts';
import { latestAway } from './run-guards.ts';
import { localDayAt, ownerToday } from '../local-day.ts';
import { calendarSlotsOrNone } from '../playbooks/social/draft-posts.ts';
import { queueListHandler } from '../views/queue.ts';
import { ownerProfileOf } from '../core/owner.ts';
import { billsDue } from '../money/bills.ts';
import { instantAt, occurrencesBetween } from '../agents/routine-time.ts';
import { ventureTimeZone } from '../local-day.ts';

/** The longest time away Chausar plans for, in days. */
const MAX_AWAY_DAYS = 90;
/** How long after the last day away the owner still sees "Since you left". */
const SINCE_DAYS = 7;
const DAY_MS = 86_400_000;

/** The Keeper's jobs, in the owner's words. They are Chausar's own code: none of them starts work for an agent. */
export const KEEPER_WORDS: Readonly<Record<KeeperJobId, string>> = Object.freeze({
  backups: 'Backups of this business', 'journal-sweep': 'Checking anything that may not have gone through', 'connection-checks': 'Connection checks',
  'rule-freshness': 'Dates on the platform rules', 'rate-tables': 'Dates on the tax rate tables', 'posting-steps': 'Checks of the posting steps',
  'network-strength': 'Relationship strength updates', probes: 'Checks for what needs you', 'calendar-feed': 'Reading your calendar feed',
  monitors: 'Looking at the pages you watch', // 5A6
});

/** A calendar day plus whole days, by date arithmetic only. */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * One-shot C4 task 40 (201.w2): a day as a client reads it in the reply, in the country's date order, with the year only
 * when it is not this year ("10 Nov", "2 Jan 2027", "Nov 10"). Calendar parts only, no Date arithmetic.
 */
function replyDay(iso: string, order: VentureRecord['country']['dateOrder'], thisYear: string): string {
  const [year, month, day] = iso.split('-');
  if (order === 'year-month-day') return iso;
  const name = MONTHS[parseInt(month!, 10) - 1];
  const date = day!.replace(/^0/, '');
  const same = year === thisYear;
  if (order === 'month-day-year') return same ? `${name} ${date}` : `${name} ${date}, ${year}`;
  return same ? `${date} ${name}` : `${date} ${name} ${year}`;
}

/** "10 to 12 Nov" inside one month of this year (day first), else both days in full ("30 Oct to 2 Nov"). */
function replyRange(from: string, to: string, order: VentureRecord['country']['dateOrder'], thisYear: string): string {
  const end = replyDay(to, order, thisYear);
  if (order === 'day-month-year' && from.slice(0, 7) === to.slice(0, 7)) return `${from.slice(8, 10).replace(/^0/, '')} to ${end}`;
  return `${replyDay(from, order, thisYear)} to ${end}`;
}

/** Client promises falling due between the two days: payments due on issued invoices, posts planned on a calendar. */
function promisesBetween(state: State, venture: VentureRecord, from: string, to: string): AwayView['promises'] {
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const promises: AwayView['promises'] = [];
  for (const invoice of listRecords(state, 'venture-invoice', venture.id)) {
    if ((invoice.status !== 'issued' && invoice.status !== 'part-paid') || !invoice.dueDate || invoice.dueDate < from || invoice.dueDate > to) continue;
    promises.push({ due: invoice.dueDate, line: `${clients.get(invoice.clientId) ?? 'A client'}'s payment for ${invoice.number ?? 'an invoice'} is due.` });
  }
  for (const order of listRecords(state, 'venture-order', venture.id)) {
    if (order.status !== 'open') continue;
    const byDay = new Map<string, Set<string>>();
    const counts = new Map<string, number>();
    for (const slot of calendarSlotsOrNone(order.intake)) {
      if (slot.date < from || slot.date > to) continue;
      byDay.set(slot.date, (byDay.get(slot.date) ?? new Set()).add(slot.channel));
      counts.set(slot.date, (counts.get(slot.date) ?? 0) + 1);
    }
    for (const [day, channels] of byDay) {
      const count = counts.get(day)!;
      promises.push({ due: day, line: `${count === 1 ? '1 planned post' : `${count} planned posts`} for ${clients.get(order.clientId) ?? 'a client'} (${[...channels].sort().join(', ')}).` });
    }
  }
  return promises.sort((a, b) => a.due.localeCompare(b.due) || a.line.localeCompare(b.line));
}

/** The view of the owner's time away, built from records now. */
async function awayView(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, record: AwayRecord | null): Promise<AwayView> {
  const order = venture.country?.dateOrder ?? 'year-month-day';
  const say = (day: string) => formatVentureDate(day, order);
  const today = ownerToday(deps.clock, venture.country ?? { code: 'XX' });
  const live = record && !record.clearedAt && addDays(record.to, SINCE_DAYS) >= today ? record : null;
  const queue = await queueListHandler(deps, ctx, {});
  // 4J13: routines keep running while the owner is away (only the owner's run); each run still waits on Today.
  const routines = listRecords(state, 'venture-routine', venture.id).filter(routine => routine.on && !routine.removedAt && routine.setBy === 'owner').map(routine => `Routine: ${routine.name}`);
  const keeper = [...[...new Set(listRecords(state, 'venture-keeper-run', venture.id).map(run => run.job))].sort().map(job => KEEPER_WORDS[job] ?? job), ...routines];
  if (!live) {
    return { away: null, promises: [], keepsRunning: keeper, approvalsWaiting: queue.needsYou, autoReply: null, line: 'You are not away. Set the days you will be away and Chausar lists what falls due.' };
  }
  const back = addDays(live.to, 1);
  // C4 task 40 (201.w2): written by code in the owner's own voice, shorter, signed with their first name and the
  // business's name; the year only when it is not this one. Chausar sends nothing: the owner copies it.
  const thisYear = today.slice(0, 4);
  const firstName = ownerProfileOf(state, venture.id).firstName;
  const signature = firstName ? `${firstName}, ${venture.workingName}` : venture.workingName;
  const autoReply = `Thanks for your message! I'm away ${replyRange(live.from, live.to, order, thisYear)} and back on ${replyDay(back, order, thisYear)}. I'll reply then.\n\n${signature}`;
  const waits = `${queue.needsYou} ${queue.needsYou === 1 ? 'thing waits' : 'things wait'} for you.`;
  const started = today >= live.from;
  const rowIds = started
    ? queue.rows.filter(row => { const day = localDayAt(row.createdAt, venture.country ?? { code: 'XX' }); return day >= live.from && day <= live.to; }).map(row => row.id)
    : [];
  const line = today > live.to ? `You were away from ${say(live.from)} to ${say(live.to)}. ${rowIds.length === 1 ? '1 thing' : `${rowIds.length} things`} came in since you left.`
    : started ? `You are away until ${say(live.to)}. ${waits}`
      : `Away from ${say(live.from)} to ${say(live.to)}. ${waits}`;
  return {
    away: { from: live.from, to: live.to }, promises: promisesBetween(state, venture, live.from, live.to), keepsRunning: keeper,
    approvalsWaiting: queue.needsYou, autoReply, line, ...(started ? { since: { from: live.from, to: live.to, rowIds } } : {}),
  };
}

/** The days away, read and checked the same way for the setter and the preview: at most 90 days, ending today or later. */
function awayDays(deps: VentureDeps, venture: VentureRecord, body: Record<string, unknown>): { from: string; to: string } {
  const from = isoDate(body.from, 'The first day away');
  const to = isoDate(body.to, 'The last day away');
  check(from <= to, 'INVALID_VENTURE_REQUEST', 'The first day away comes before the last.');
  check(to >= ownerToday(deps.clock, venture.country ?? { code: 'XX' }), 'INVALID_VENTURE_REQUEST', 'The last day away is already past.');
  check(Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`) < MAX_AWAY_DAYS * DAY_MS, 'INVALID_VENTURE_REQUEST', `Chausar plans for at most ${MAX_AWAY_DAYS} days away at a time.`);
  return { from, to };
}

/**
 * C5 task 2: everything falling due between two days, from records only: the promises (client payments, planned
 * posts), bills to pay, recurring invoices drafted for the owner to check, and the owner's routines that run. Routine
 * runs are counted in the business's own time zone, from the first minute of the first day to the end of the last.
 */
export function dueBetween(state: State, venture: VentureRecord, from: string, to: string): AwayView['promises'] {
  const items = [...promisesBetween(state, venture, from, to)];
  for (const bill of billsDue(state, from, to)) items.push({ due: bill.dueDate, line: `The bill from ${bill.vendor} is due.` });
  const clients = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  for (const schedule of listRecords(state, 'venture-recurring-invoice', venture.id)) {
    if (schedule.stoppedAt || schedule.nextOn === null || schedule.nextOn < from || schedule.nextOn > to) continue;
    items.push({ due: schedule.nextOn, line: `The recurring invoice for ${clients.get(schedule.clientId) ?? 'a client'} is drafted for you to check.` });
  }
  const zone = ventureTimeZone(venture.country);
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const next = addDays(to, 1).split('-').map(Number) as [number, number, number];
  const startMs = instantAt(fy, fm, fd, 0, 0, zone), endMs = instantAt(next[0], next[1], next[2], 0, 0, zone) - 1;
  for (const routine of listRecords(state, 'venture-routine', venture.id)) {
    if (!routine.on || routine.removedAt || routine.setBy !== 'owner') continue;
    const runs = occurrencesBetween(routine.schedule, startMs - 1, endMs);
    if (runs.count === 0) continue;
    const due = runs.count === 1 && runs.latest ? localDayAt(runs.latest, venture.country ?? { code: 'XX' }) : from;
    items.push({ due, line: runs.count === 1 ? `Routine: ${routine.name} runs once. Its result waits on Today.` : `Routine: ${routine.name} runs ${runs.count} times. Each result waits on Today.` });
  }
  return items.sort((a, b) => a.due.localeCompare(b.due) || a.line.localeCompare(b.line));
}

/**
 * venture.away.preview { from, to } (read): what falls due between the two days, before the owner sets them. The same
 * rules as the setter; writes nothing.
 */
export async function awayPreviewHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ from: string; to: string; items: AwayView['promises'] }> {
  const body = exactPayload(payload, ['from', 'to'], ['from', 'to']);
  const { state, venture } = readAs(deps, ctx, 'read');
  const { from, to } = awayDays(deps, venture, body);
  return { from, to, items: dueBetween(state, venture, from, to) };
}

/**
 * venture.away.set { from, to } (approve, app only): the days the owner will be away, at most 90, ending today or
 * later. Returns the code-built list; Chausar sends nothing. C4 task 40: { clear: true } clears the days now (Away
 * ends at once, planned or under way); the record keeps when it was cleared.
 */
export async function awaySetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AwayView> {
  requireAppChannel(ctx, 'venture.away.set');
  if (payload && typeof payload === 'object' && Object.hasOwn(payload, 'clear')) return clearAway(deps, ctx, payload);
  const body = exactPayload(payload, ['from', 'to'], ['from', 'to']);
  const { venture } = readAs(deps, ctx, 'approve');
  const { from, to } = awayDays(deps, venture, body);
  const record = await ventureAction(deps, ctx, 'approve', 'away.set', tx => tx.put<AwayRecord>({ ...tx.base('venture-away'), from, to, by: ctx.memberId, clearedAt: null }));
  const after = readAs(deps, ctx, 'read');
  return awayView(deps, ctx, after.state, after.venture, record);
}

/** { clear: true }: ends the time away now, planned or under way; refused when there is none to clear. */
async function clearAway(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AwayView> {
  const body = exactPayload(payload, ['clear'], ['clear']);
  check(body.clear === true, 'INVALID_VENTURE_REQUEST', 'Send clear: true to clear the days away.');
  await ventureAction(deps, ctx, 'approve', 'away.clear', tx => {
    const venture = tx.venture as VentureRecord;
    const record = latestAway(tx.state, venture.id);
    const today = localDayAt(tx.now, venture.country ?? { code: 'XX' });
    check(record && !record.clearedAt && record.to >= today, 'INVALID_VENTURE_REQUEST', 'You are not away, so there are no days to clear.');
    tx.replace<AwayRecord>({ ...record, clearedAt: tx.now });
  });
  const after = readAs(deps, ctx, 'read');
  return awayView(deps, ctx, after.state, after.venture, latestAway(after.state, after.venture.id));
}

/** venture.away.get {} (read): the owner's time away and its list, built from records now; away is null when none. */
export async function awayGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AwayView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return awayView(deps, ctx, state, venture, latestAway(state, venture.id));
}
