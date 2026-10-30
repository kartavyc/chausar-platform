// Chausar venture launcher, network (Ink v2 wave 4, package 4E1): follow-ups by date arithmetic in code (catalogue C7).
// Everything here is pure and works on the owner's calendar days ('YYYY-MM-DD'), never the clock: the caller passes the
// day. An intro request is followed up once, 7 days after it was sent, and then the card suggests another path or Not
// now; a first email after 5 days and again 7 days after that; a WhatsApp or LinkedIn message after 4 days and again
// 10 days after that. Each wait counts from the touch before it, and a due day the owner does not send on moves to the
// next day they do. After the last follow-up the card waits 7 more days, then parks as Not now with "Ask again from"
// 30 days on. A reply after the first send stops the sequence. The waits are Chausar's own choices (Happenstance's "wait
// about a week" for intros; the follow-up habits of small sellers), tuned later from the owner's results.
import type {
  CardTouch, DateOrder, FollowupSequence, IsoDate, IsoTime, OutreachChannel, OutreachKind, OutreachSentChannel, PipelineSettingsRecord, PipelineStage,
} from './followup-input.ts';

/** The waits of each sequence, in days, each from the touch before it. */
export const SEQUENCE_STEPS: Readonly<Record<FollowupSequence['kind'], readonly number[]>> = Object.freeze({
  'intro-request': Object.freeze([7]), 'first-email': Object.freeze([5, 7]), message: Object.freeze([4, 10]),
});
/** After the first follow-up, at least this many days between touches to one person. */
export const MIN_TOUCH_GAP_DAYS = 7;
/** Days after the last follow-up before an unanswered card parks as Not now. */
export const PARK_AFTER_DAYS = 7;
/** Days a Not now card waits before the owner can ask again. */
export const ASK_AGAIN_DAYS = 30;
/** Days after an intro request's one follow-up before the card suggests another path. */
export const OTHER_PATH_DAYS = 7;

/** The owner's settings before they change any: Monday to Friday, half past nine, 10 a day and 40 a week. */
export const DEFAULT_PIPELINE_SETTINGS: Readonly<Pick<PipelineSettingsRecord, 'weekdays' | 'sendTime' | 'caps' | 'scoreRules'>> = Object.freeze({
  weekdays: [1, 2, 3, 4, 5], sendTime: '09:30', caps: { newPerDay: 10, perWeek: 40 }, scoreRules: [],
});

const DAY_MS = 86_400_000;
const dayMs = (day: IsoDate) => Date.parse(`${day}T00:00:00.000Z`);

/** A calendar day moved by whole days. */
export function addDays(day: IsoDate, n: number): IsoDate {
  return new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar days from one day to another (negative when to is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** The ISO weekday of a day: 1 is Monday, 7 is Sunday. */
export function isoWeekday(day: IsoDate): number {
  const sunday0 = new Date(dayMs(day)).getUTCDay();
  return sunday0 === 0 ? 7 : sunday0;
}

/** The day itself when the owner sends on it, else the next day they do (weekdays always holds at least one). */
export function nextAllowedDay(day: IsoDate, weekdays: readonly number[]): IsoDate {
  let next = day;
  for (let i = 0; i < 7 && !weekdays.includes(isoWeekday(next)); i += 1) next = addDays(next, 1);
  return next;
}

/** Monday of the week a day falls in. */
export function weekStart(day: IsoDate): IsoDate {
  return addDays(day, 1 - isoWeekday(day));
}

/** The channel a follow-up goes on, from how the first note went. */
export function draftChannelOf(channel: OutreachSentChannel | null): OutreachChannel | null {
  if (channel === 'own-mailbox') return 'email';
  if (channel === 'linkedin' || channel === 'whatsapp') return channel;
  return null;
}

/**
 * The sequence a first send starts, copied from the owner's settings as they are now: an intro request (or a double
 * opt-in) is the intro sequence; a WhatsApp or LinkedIn note the message sequence; anything else, an email or a send
 * whose channel the owner did not say, the first-email sequence.
 */
export function sequenceFor(kind: OutreachKind | null, channel: OutreachSentChannel | null, settings: Pick<PipelineSettingsRecord, 'weekdays' | 'sendTime'>, at: IsoTime): FollowupSequence {
  const sequenceKind: FollowupSequence['kind'] = kind === 'intro-request' || kind === 'double-opt-in' ? 'intro-request'
    : channel === 'whatsapp' || channel === 'linkedin' ? 'message' : 'first-email';
  const follow = draftChannelOf(channel);
  return {
    kind: sequenceKind, steps: SEQUENCE_STEPS[sequenceKind].map(afterDays => ({ afterDays, channel: follow })),
    weekdays: [...settings.weekdays], sendTime: settings.sendTime, copiedAt: at,
  };
}

/**
 * What a card's sequence says comes next: a follow-up (step counts from 0) due on a day; for an intro request after its
 * one follow-up, another path or Not now from a day; after the last follow-up of the others, the day the card parks as
 * Not now and the day the owner may ask again. Null when nothing is scheduled: not at Asked, on the blocklist, no send
 * yet, or a reply came after the first send.
 */
export type FollowupPlan =
  | { kind: 'nudge'; step: number; due: IsoDate; channel: OutreachChannel | null }
  | { kind: 'other-path'; due: IsoDate }
  | { kind: 'park'; on: IsoDate; askAgainFrom: IsoDate };

/**
 * What a plan reads: the card's stage, copied sequence and touches, whether the blocklist covers the person, and
 * lastToPerson, the newest send to the same person on any of their other cards (the 7-day gap counts across cards).
 */
export type PlanInput = { stage: PipelineStage; sequence: FollowupSequence | null; touches: readonly CardTouch[]; blocked: boolean; lastToPerson?: IsoDate | null; holdUntil?: IsoDate | null };

export function followupPlan(input: PlanInput): FollowupPlan | null {
  const { sequence } = input;
  if (input.stage !== 'asked' || input.blocked || !sequence) return null;
  const sends = input.touches.filter(touch => touch.what === 'sent').map(touch => touch.on).sort();
  if (!sends.length) return null;
  if (input.touches.some(touch => touch.what === 'reply' && touch.on >= sends[0]!)) return null;
  const last = sends[sends.length - 1]!;
  const done = sends.length - 1; // follow-ups already sent
  if (done < sequence.steps.length) {
    const step = sequence.steps[done]!;
    let due = addDays(last, step.afterDays);
    if (done > 0) {
      // From the second follow-up on: at least 7 days after the last touch to this person, on this card or another.
      const lastTouch = input.lastToPerson && input.lastToPerson > last ? input.lastToPerson : last;
      const gap = addDays(lastTouch, MIN_TOUCH_GAP_DAYS);
      if (gap > due) due = gap;
    }
    // 4E3: an automatic reply (a week on) or a delivery delay (90 days) holds the next follow-up until its day.
    if (input.holdUntil && input.holdUntil > due) due = input.holdUntil;
    return { kind: 'nudge', step: done, due: nextAllowedDay(due, sequence.weekdays), channel: step.channel };
  }
  const held = (day: IsoDate) => (input.holdUntil && input.holdUntil > day ? input.holdUntil : day);
  if (sequence.kind === 'intro-request') return { kind: 'other-path', due: nextAllowedDay(held(addDays(last, OTHER_PATH_DAYS)), sequence.weekdays) };
  const on = held(addDays(last, PARK_AFTER_DAYS));
  return { kind: 'park', on, askAgainFrom: addDays(on, ASK_AGAIN_DAYS) };
}

/**
 * The day an unanswered card parks as Not now, decided from the touches dated on or before that day: the sends up to
 * the last follow-up give the park day; a send recorded after it does not move it; a reply after the first send and on
 * or before it means no park. Null while a follow-up is still to come, and for an intro request (it suggests another
 * path instead).
 */
export function settledPark(input: PlanInput): { on: IsoDate; askAgainFrom: IsoDate } | null {
  if (input.stage !== 'asked' || input.blocked || !input.sequence || input.sequence.kind === 'intro-request') return null;
  const sends = input.touches.filter(touch => touch.what === 'sent').sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  for (let i = 0; i < sends.length; i += 1) {
    const plan = followupPlan({ ...input, touches: sends.slice(0, i + 1) });
    if (plan?.kind !== 'park') continue;
    if (sends[i + 1] && sends[i + 1]!.on <= plan.on) continue;
    const answered = input.touches.some(touch => touch.what === 'reply' && touch.on >= sends[0]!.on && touch.on <= plan.on);
    return answered ? null : { on: plan.on, askAgainFrom: plan.askAgainFrom };
  }
  return null;
}

/**
 * The days a sequence would reach next if each follow-up went out on its due day: what the card's timeline shows as
 * projected ("about 27 Oct, estimated"). The first entry is the plan itself (scheduled); the rest are projections.
 */
export function projectPlan(input: PlanInput): FollowupPlan[] {
  const out: FollowupPlan[] = [];
  let touches = [...input.touches];
  for (let i = 0; i < 4; i += 1) {
    const plan = followupPlan({ ...input, touches });
    if (!plan) break;
    out.push(plan);
    if (plan.kind !== 'nudge') break;
    touches = [...touches, { what: 'sent', on: plan.due, at: `${plan.due}T00:00:00.000Z`, kind: 'nudge', channel: null, ref: null, by: 'projection' }];
  }
  return out;
}

/** How a thread stands by days since they last wrote: Alive under 7, Cooling 7 to 21, Presumed dead after 21. */
export function threadAge(lastReply: IsoDate, today: IsoDate): { age: 'alive' | 'cooling' | 'presumed-dead'; days: number; line: string } {
  const days = Math.max(0, daysBetween(lastReply, today));
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  if (days < 7) return { age: 'alive', days, line: `Alive: they wrote ${when}.` };
  if (days <= 21) return { age: 'cooling', days, line: `Cooling: they wrote ${when}.` };
  return { age: 'presumed-dead', days, line: `Presumed dead: they wrote ${when}.` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day for a card line: '20 Oct', 'Oct 20' or '2026-10-20', from the country's date order. No year. */
export function shortDay(day: IsoDate, order: DateOrder): string {
  const [, month, date] = day.split('-');
  const name = MONTHS[Number(month) - 1];
  if (order === 'day-month-year') return `${Number(date)} ${name}`;
  if (order === 'month-day-year') return `${name} ${Number(date)}`;
  return day;
}

/** '2 days late', '1 day late', or null when not late. */
export function lateWords(due: IsoDate, today: IsoDate): string | null {
  const late = daysBetween(due, today);
  return late <= 0 ? null : `${late} ${late === 1 ? 'day' : 'days'} late`;
}
