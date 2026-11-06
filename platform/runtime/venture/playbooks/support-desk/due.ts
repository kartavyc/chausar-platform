// Business-hour arithmetic and paused clocks. ResolveHQ (source-available) supplied ideas only; original code.
import { check } from '../../../contracts.ts';
import type { SupportTicketBody } from './records.ts';
export type ShopHours = { timeZone: string; hours: readonly { day: number; start: string; end: string }[]; holidays: readonly string[] };
const MINUTE = 60000;
/** Parse an owner response duration, including fractional business hours, never money. */
export function responseHours(value:unknown):number{check(typeof value==='number'||typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value),'SUPPORT_HOURS_INVALID','Choose a positive response target within a year.');const hours=Number(value);check(Number.isFinite(hours)&&hours>0&&hours<=24*365,'SUPPORT_HOURS_INVALID','Choose a positive response target within a year.');return hours;}
function localParts(instant: number, timeZone: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}
function wallTime(day: string, minute: number, zone: string): number {
  const target = Date.parse(`${day}T00:00:00.000Z`) + minute * MINUTE;
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(candidate, zone);
    const observed = Date.parse(`${p.day}T00:00:00.000Z`) + p.minute * MINUTE;
    const delta = target - observed;
    if (delta === 0) return candidate;
    candidate += delta;
  }
  check(false, 'SUPPORT_HOURS_INVALID', 'The shop hours fall in a clock change. Choose another time.');
}
function minuteOf(value: string): number {
  check(/^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'SUPPORT_HOURS_INVALID', 'Shop hours use a valid local time.');
  const [h,m] = value.split(':').map(Number); return h! * 60 + m!;
}
/** Adds real open-window time in the shop timezone, with holidays; unset policy is always open. */
export function dueAt(start: string, hours: number, policy?: ShopHours): string {
  let cursor = Date.parse(start), remaining = hours * 3600000;
  check(Number.isFinite(cursor) && Number.isFinite(hours) && hours > 0 && hours <= 24 * 365, 'SUPPORT_HOURS_INVALID', 'Choose a positive response target within a year.');
  if (!policy) return new Date(cursor + remaining).toISOString();
  check(policy.hours.length > 0 && policy.hours.length <= 21, 'SUPPORT_HOURS_INVALID', 'Choose shop opening hours or leave hours unset for always open.');
  try { localParts(cursor, policy.timeZone); } catch { check(false, 'SUPPORT_HOURS_INVALID', 'Choose a valid shop timezone.'); }
  const windows = policy.hours.map(w => {
    const begin = minuteOf(w.start), end = minuteOf(w.end);
    check(Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 && end > begin, 'SUPPORT_HOURS_INVALID', 'Opening time must precede closing time on the same day.');
    return { ...w, begin, finish: end };
  });
  for (const day of new Set(windows.map(w => w.day))) {
    const ordered = windows.filter(w => w.day === day).sort((a,b) => a.begin-b.begin);
    check(ordered.every((w,i) => !i || ordered[i-1]!.finish <= w.begin), 'SUPPORT_HOURS_INVALID', 'Shop windows cannot overlap.');
  }
  let day = localParts(cursor, policy.timeZone).day;
  for (let scanned = 0; scanned < 366; scanned++) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (!policy.holidays.includes(day)) {
      for (const w of windows.filter(w => w.day === weekday).sort((a,b) => a.begin-b.begin)) {
        const begin = Math.max(cursor, wallTime(day, w.begin, policy.timeZone));
        const end = wallTime(day, w.finish, policy.timeZone);
        if (end <= begin) continue;
        if (remaining <= end-begin) return new Date(begin + remaining).toISOString();
        remaining -= end-begin;
      }
    }
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  }
  check(false, 'SUPPORT_HOURS_INVALID', 'No due time fits the shop calendar within a year.');
}
/** Owner snooze pauses both targets, with a reason and future wake time. */
export function snoozeTicket<T extends SupportTicketBody>(ticket: T, now: string, until: string, reason: string): T {
  check(typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 500, 'SUPPORT_SNOOZE_REASON', 'Say why this ticket should wait.');
  check(!ticket.snoozedAt && Number.isFinite(Date.parse(until)) && Date.parse(until) > Date.parse(now) && ticket.status !== 'closed', 'SUPPORT_SNOOZE_INVALID', 'Choose a future time for an open ticket.');
  return { ...ticket, snoozedAt: now, snoozeUntil: until, snoozeReason: reason.trim(), revision: ticket.revision + 1 };
}
/** Wakes on the agreed time or an early customer reply, shifting targets by the actual pause. */
export function wakeTicket<T extends SupportTicketBody>(ticket: T, now: string, customerReply = false): T {
  if (!ticket.snoozedAt || (!customerReply && Date.parse(now) < Date.parse(ticket.snoozeUntil!))) return ticket;
  const resumedAt = Math.min(Date.parse(now), Date.parse(ticket.snoozeUntil!));
  const pause = Math.max(0, resumedAt-Date.parse(ticket.snoozedAt));
  const shift = (at: string | null) => at ? new Date(Date.parse(at)+pause).toISOString() : null;
  return { ...ticket, dueAt: shift(ticket.dueAt), resolutionDueAt: shift(ticket.resolutionDueAt), snoozedAt: null, snoozeUntil: null, snoozeReason: null, revision: ticket.revision+1 };
}
/** No badge is shown for an answered, sleeping or terminal ticket. Figures are computed here. */
export function dueBadge(ticket: Pick<SupportTicketBody,'dueAt'|'resolutionDueAt'|'sentAt'|'snoozedAt'|'status'>, now: string): string {
  const target = ticket.sentAt ? ticket.resolutionDueAt : ticket.dueAt;
  if (!target || ticket.snoozedAt || ['resolved','closed'].includes(ticket.status)) return '';
  const ms = Date.parse(target)-Date.parse(now);
  if (!Number.isFinite(ms)) return '';
  const h = Math.ceil(Math.abs(ms)/3600000);
  return ms < 0 ? `Overdue by ${h}h` : `Due in ${h}h`;
}
/** Overdue, due soon, open, waiting; stable time and id ordering is applied by the desk. */
export function queueRank(ticket: SupportTicketBody, now: string): number {
  if (ticket.snoozedAt || ['resolved','closed'].includes(ticket.status)) return 4;
  const target = ticket.sentAt ? ticket.resolutionDueAt : ticket.dueAt;
  if (target) { const d=Date.parse(target)-Date.parse(now); if(d<0)return 0; if(d<=4*3600000)return 1; }
  return ticket.status === 'waiting-customer' ? 3 : 2;
}

/** Owner intake text, such as Mon-Sat 10:00-19:00; unknown schedules refuse instead of guessing. */
export function supportHours(fields:Readonly<Record<string,unknown>>):ShopHours|undefined {
 const raw=fields.shopHours;
 if(raw===undefined||raw===null||raw==='')return undefined;
 check(typeof raw==='string'&&raw.length<=1000,'SUPPORT_HOURS_INVALID','Give opening days and local times.');
 const names:Record<string,number>={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,'रवि':0,'सोम':1,'मंगल':2,'बुध':3,'गुरु':4,'शुक्र':5,'शनि':6};
 const hours:ShopHours['hours'][number][]=[];
 for(const line of raw.split(';')){
  const match=/^\s*([\p{L}\p{M}, -]+)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$/u.exec(line);
  check(match,'SUPPORT_HOURS_INVALID','Use opening days and times, such as Mon-Sat 10:00-19:00.');
  for(const part of match[1]!.trim().toLowerCase().split(/\s*,\s*/)){
   const range=part.split(/\s*-\s*/);const first=names[range[0]!],last=names[range[1]??range[0]!];
   check(first!==undefined&&last!==undefined&&range.length<=2,'SUPPORT_HOURS_INVALID','Use known opening days, such as Mon-Sat.');
   let day=first;for(let i=0;i<7;i++){hours.push({day,start:match[2]!,end:match[3]!});if(day===last)break;day=(day+1)%7;}
  }
 }
 const timeZone=fields.timeZone===undefined||fields.timeZone===''?'Asia/Kolkata':fields.timeZone;
 check(typeof timeZone==='string','SUPPORT_HOURS_INVALID','Choose a valid shop timezone.');
 const holidays=fields.holidays??[];
 check(Array.isArray(holidays)&&holidays.length<=366&&holidays.every(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),'SUPPORT_HOURS_INVALID','Holidays are valid local dates.');
 return {timeZone,hours,holidays:holidays as string[]};
}
