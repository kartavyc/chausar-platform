// Browser-safe settings and arithmetic shared by the engine and its UI fake.
import { check } from '../../portable.ts';
import { daysBetween } from './followups.ts';
import type { PipelineCaps, OutreachLane } from '../../../contract/venture/network/followup-input.ts';

export const OUTREACH_LANES: readonly OutreachLane[] = Object.freeze(['linkedin-note', 'linkedin-message', 'whatsapp', 'email']);
export const HOUSE_CAPS: Readonly<Record<OutreachLane, { day: number; week: number | null }>> = Object.freeze({
  'linkedin-note': { day: 10, week: 50 }, 'linkedin-message': { day: 20, week: null }, whatsapp: { day: 20, week: null }, email: { day: 30, week: null },
});
export const WARMUP_PERCENT: readonly number[] = Object.freeze([25, 40, 60, 80, 100]);
export const LANE_WORDS: Readonly<Record<OutreachLane, readonly [string, string]>> = Object.freeze({
  'linkedin-note': ['LinkedIn note', 'LinkedIn notes'], 'linkedin-message': ['LinkedIn message', 'LinkedIn messages'], whatsapp: ['WhatsApp message', 'WhatsApp messages'], email: ['email', 'emails'],
});

export function limitsObject(value: unknown, fields: readonly string[]): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'INVALID_VENTURE_REQUEST', 'Send one request object.');
  check(Object.keys(value).every(key => fields.includes(key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return value as Record<string, unknown>;
}

export function channelCapsInput(value: unknown): Partial<Record<OutreachLane, number>> {
  const given = limitsObject(value, OUTREACH_LANES), caps: Partial<Record<OutreachLane, number>> = {};
  for (const lane of OUTREACH_LANES) {
    const cap = given[lane];
    if (cap === undefined) continue;
    check(Number.isSafeInteger(cap) && (cap as number) >= 1, 'INVALID_VENTURE_REQUEST', `A daily limit for ${LANE_WORDS[lane][1]} is a whole number from 1.`);
    caps[lane] = cap as number;
  }
  return caps;
}

export function channelWeeksInput(value: unknown): Partial<Record<OutreachLane, number | null>> {
  const given = limitsObject(value, OUTREACH_LANES), caps: Partial<Record<OutreachLane, number | null>> = {};
  for (const lane of OUTREACH_LANES) {
    const cap = given[lane];
    if (cap === undefined) continue;
    check(cap === null || (Number.isSafeInteger(cap) && (cap as number) >= 1), 'INVALID_VENTURE_REQUEST', `A weekly limit for ${LANE_WORDS[lane][1]} is a whole number from 1, or no limit.`);
    caps[lane] = cap as number | null;
  }
  return caps;
}

export function warmupInput(value: unknown): number[] {
  check(Array.isArray(value) && value.length === 5 && value.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 100 && (i === 0 || n >= value[i - 1])),
    'INVALID_VENTURE_REQUEST', 'Choose five weekly percentages from 1 to 100, each at least the week before.');
  return [...value] as number[];
}

export function pipelineCapsInput(value: unknown): Partial<PipelineCaps> {
  const raw = limitsObject(value, ['newPerDay', 'perWeek', 'channels', 'channelWeeks', 'warmupPercent']);
  const caps: Partial<PipelineCaps> = {};
  for (const key of ['newPerDay', 'perWeek'] as const) {
    if (raw[key] === undefined) continue;
    check(Number.isSafeInteger(raw[key]) && (raw[key] as number) >= 1, 'INVALID_VENTURE_REQUEST', `${key === 'newPerDay' ? 'People a day' : 'People a week'} must be a whole number from 1 to ${Number.MAX_SAFE_INTEGER}.`);
    caps[key] = raw[key] as number;
  }
  if (raw.channels !== undefined) caps.channels = channelCapsInput(raw.channels);
  if (raw.channelWeeks !== undefined) caps.channelWeeks = channelWeeksInput(raw.channelWeeks);
  if (raw.warmupPercent !== undefined) caps.warmupPercent = warmupInput(raw.warmupPercent);
  return caps;
}

export function warmupPercent(firstOn: string | null, today: string, schedule: readonly number[] = WARMUP_PERCENT): number {
  const week = firstOn ? Math.floor(Math.max(0, daysBetween(firstOn, today)) / 7) : 0;
  return schedule[Math.min(week, schedule.length - 1)]!;
}

export type LaneLimits = { day: number; week: number | null; percent: number; house: { day: number; week: number | null }; owner: number | null };
export function effectiveLaneLimits(settings: PipelineCaps, lane: OutreachLane, firstOn: string | null, today: string): LaneLimits {
  const house = HOUSE_CAPS[lane], owner = settings.channels?.[lane] ?? null;
  const percent = warmupPercent(firstOn, today, settings.warmupPercent);
  const share = (cap: number) => Math.max(1, Number((BigInt(cap) * BigInt(percent)) / 100n));
  const setWeek = settings.channelWeeks?.[lane];
  const week = setWeek === undefined ? house.week : setWeek;
  return { day: share(owner ?? house.day), week: week === null ? null : share(week), percent, house: { ...house }, owner };
}
