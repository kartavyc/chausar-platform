/**
 * C5 task 2: the quick dates for being away, from the owner's own today ('YYYY-MM-DD' in their zone, never the
 * computer's): Tomorrow; This weekend (the coming Saturday and Sunday, or what is left of it); Next week (Monday to
 * Sunday after this one). Date arithmetic on calendar days only.
 */
export type QuickDates = { id: 'tomorrow' | 'weekend' | 'nextWeek'; from: string; to: string };

const DAY_MS = 86_400_000;
const plus = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** 0 Sunday to 6 Saturday, of a calendar day. */
const weekday = (day: string) => new Date(`${day}T00:00:00.000Z`).getUTCDay();

export function quickDates(today: string): QuickDates[] {
  const w = weekday(today);
  const saturday = w === 6 ? today : w === 0 ? null : plus(today, 6 - w);
  const weekend = saturday ? { from: saturday, to: plus(saturday, 1) } : { from: today, to: today };
  const nextMonday = plus(today, w === 0 ? 1 : 8 - w);
  return [
    { id: 'tomorrow', from: plus(today, 1), to: plus(today, 1) },
    { id: 'weekend', ...weekend },
    { id: 'nextWeek', from: nextMonday, to: plus(nextMonday, 6) },
  ];
}
