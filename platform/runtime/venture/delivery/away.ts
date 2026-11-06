// Chausar venture launcher, delivery (Ink v2 wave 4, package 4F1; catalogue O4): Away. The owner says which days they
// will be away and Chausar lists, from records only: the promises falling due between those days (client payments due
// on issued invoices, posts planned on a content calendar), what keeps running (the engine's own Keeper jobs that ran),
// how many approvals will wait, and an auto-reply for the owner to paste into their own mail app, with their real
// response time when Chausar has measured it on at least three orders. Chausar sends nothing. While the owner is away,
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

/** The longest time away Chausar plans for, in days. */
const MAX_AWAY_DAYS = 90;
/** How long after the last day away the owner still sees "Since you left". */
const SINCE_DAYS = 7;
/** Orders a response time is read from, newest first, and how many it needs. */
const RESPONSE_ORDERS = 10;
const RESPONSE_NEEDED = 3;
const DAY_MS = 86_400_000;

/** The Keeper's jobs, in the owner's words. They are Chausar's own code: none of them starts work for an agent. */
const KEEPER_WORDS: Readonly<Record<KeeperJobId, string>> = Object.freeze({
  backups: 'Backups of this business', 'journal-sweep': 'The check of actions whose outcome is unknown', 'connection-checks': 'Connection checks',
  'rule-freshness': 'Dates on the platform rules', 'rate-tables': 'Dates on the tax rate tables', 'posting-steps': 'Checks of the posting steps',
  'network-strength': 'Relationship strength updates', probes: 'Checks for what needs you', 'calendar-feed': 'Reading your calendar feed',
  monitors: 'Looking at the pages you watch', // 5A6
});

/** A calendar day plus whole days, by date arithmetic only. */
function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The owner's usual response time in whole days: for the newest orders that got a reviewed draft, the days from the
 * order coming in to the owner accepting or editing its draft, the middle value. Null below three orders.
 */
function responseDays(state: State, ventureId: string): number | null {
  const orders = new Map(listRecords(state, 'venture-order', ventureId).map(order => [order.id, order]));
  const first = new Map<string, string>();
  for (const run of listRecords(state, 'venture-delivery-run', ventureId)) {
    if (!run.verdict || run.verdict.choice === 'rejected' || !orders.has(run.orderId)) continue;
    const known = first.get(run.orderId);
    if (!known || run.verdict.at < known) first.set(run.orderId, run.verdict.at);
  }
  const days = [...first.entries()]
    .sort((a, b) => (orders.get(b[0])!.at).localeCompare(orders.get(a[0])!.at))
    .slice(0, RESPONSE_ORDERS)
    .map(([orderId, at]) => Math.max(1, Math.ceil((Date.parse(at) - Date.parse(orders.get(orderId)!.at)) / DAY_MS)))
    .sort((a, b) => a - b);
  return days.length < RESPONSE_NEEDED ? null : days[Math.floor(days.length / 2)];
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
  const days = responseDays(state, venture.id);
  const autoReply = `Thank you for your message. I am away from ${say(live.from)} to ${say(live.to)} and back on ${say(back)}. ${days === null
    ? 'I will reply after I am back.'
    : `I usually reply within ${days === 1 ? '1 day' : `${days} days`}, so you can expect my answer by ${say(addDays(back, days))}.`}\n\n${venture.workingName}`;
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

/**
 * venture.away.set { from, to } (approve, app only): the days the owner will be away, at most 90, ending today or
 * later. Returns the code-built list; Chausar sends nothing.
 */
export async function awaySetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AwayView> {
  requireAppChannel(ctx, 'venture.away.set');
  const body = exactPayload(payload, ['from', 'to'], ['from', 'to']);
  const from = isoDate(body.from, 'The first day away');
  const to = isoDate(body.to, 'The last day away');
  check(from <= to, 'INVALID_VENTURE_REQUEST', 'The first day away comes before the last.');
  const { venture } = readAs(deps, ctx, 'approve');
  check(to >= ownerToday(deps.clock, venture.country ?? { code: 'XX' }), 'INVALID_VENTURE_REQUEST', 'The last day away is already past.');
  check(Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`) < MAX_AWAY_DAYS * DAY_MS, 'INVALID_VENTURE_REQUEST', `Chausar plans for at most ${MAX_AWAY_DAYS} days away at a time.`);
  const record = await ventureAction(deps, ctx, 'approve', 'away.set', tx => tx.put<AwayRecord>({ ...tx.base('venture-away'), from, to, by: ctx.memberId, clearedAt: null }));
  const after = readAs(deps, ctx, 'read');
  return awayView(deps, ctx, after.state, after.venture, record);
}

/** venture.away.get {} (read): the owner's time away and its list, built from records now; away is null when none. */
export async function awayGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AwayView> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return awayView(deps, ctx, state, venture, latestAway(state, venture.id));
}
