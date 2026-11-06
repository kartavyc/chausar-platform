export {};
// Chausar flagship playbook, social media agency: calendar slots made by code. The offer sets how many posts each
// channel gets in a month and the owner picks the weekdays; code spreads the posts evenly over those days. The agent
// only fills topics and hooks into the slots, so dates and counts never come from a model.
function check(condition:unknown,code:string,message:string):asserts condition { if(!condition)throw Object.assign(new Error(message),{code}); }
type IsoDate = string;
import { SOCIAL_CHANNELS, type SocialChannel } from './channel-ids.ts';

export type CalendarSlot = { id: string; channel: SocialChannel; date: IsoDate };
/** weekdays are ISO numbers: 1 is Monday, 7 is Sunday. */
export type CalendarInput = { month: string; channels: SocialChannel[]; postsPerChannel: number; weekdays: number[] };

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Slots for one month: for each channel, postsPerChannel dates picked from the allowed weekdays, spread evenly
 * (slot i takes posting day floor(i * days / posts)). More posts than posting days is refused, never doubled up.
 */
export function planCalendar(input: CalendarInput): CalendarSlot[] {
  const match = /^(\d{4})-(\d{2})$/.exec(input.month);
  const month = match ? Number(match[2]) : 0;
  check(match && month >= 1 && month <= 12, 'INVALID_VENTURE_REQUEST', 'Give the month like 2026-11.');
  const year = Number(match[1]);
  check(Array.isArray(input.channels) && input.channels.length > 0 && new Set(input.channels).size === input.channels.length
    && input.channels.every(channel => (SOCIAL_CHANNELS as readonly string[]).includes(channel)), 'INVALID_VENTURE_REQUEST', 'Pick one or more channels, each once.');
  check(Number.isInteger(input.postsPerChannel) && input.postsPerChannel >= 1 && input.postsPerChannel <= 31, 'INVALID_VENTURE_REQUEST', 'Posts per channel is a whole number from one to thirty-one.');
  check(Array.isArray(input.weekdays) && input.weekdays.length > 0 && new Set(input.weekdays).size === input.weekdays.length
    && input.weekdays.every(day => Number.isInteger(day) && day >= 1 && day <= 7), 'INVALID_VENTURE_REQUEST', 'Pick posting weekdays from Monday (1) to Sunday (7), each once.');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days: IsoDate[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const iso = ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
    if (input.weekdays.includes(iso)) days.push(`${year}-${pad(month)}-${pad(day)}`);
  }
  check(input.postsPerChannel <= days.length, 'INVALID_VENTURE_REQUEST',
    `${input.month} has ${days.length} posting days on the weekdays you picked, fewer than the posts per channel. Add a weekday or post less.`);
  const slots: CalendarSlot[] = [];
  for (const channel of input.channels) {
    for (let index = 0; index < input.postsPerChannel; index += 1) {
      slots.push({ id: `${channel}-${index + 1}`, channel, date: days[Math.floor((index * days.length) / input.postsPerChannel)]! });
    }
  }
  return slots;
}
