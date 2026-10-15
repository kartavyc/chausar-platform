/**
 * Today's cash (TD-02, spec `briefs.saveClosing`): the day's cash sales as the owner said them.
 * Kept in this module's state as something told, never as a fact from the books: no source, no
 * row, no receipt. `todayx.cash.save` records one figure for one business day (the last one told
 * for that day stands); `todayx.cash.week` returns the seven days ending today, a day not told as
 * null. The figure is whole paise exactly as told; nothing is added up or converted here.
 * Only the owner or a cofounder tells it (`FORBIDDEN` for any other seat), so `told-by-owner` stays true.
 */
import { audit, check, now, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { addDays, businessToday, frameOf, updateFrame, validDay } from './frame.ts';

export type CashEntry = { id: string; paise: string; memberId: string; at: string };
export type CashWeekReply = { day: string; label: 'told-by-owner'; days: { day: string; paise: string | null; entryId: string | null }[] };
/** How far back a day's cash may still be told. */
export const CASH_BACK_DAYS = 31;
/** Days kept: older entries are dropped on the next save. */
export const CASH_KEEP_DAYS = 400;
const PAISE = /^(0|[1-9][0-9]{0,14})$/;

export function cashWeek(host: ModuleHost): CashWeekReply {
  const state = host.store.read(), today = businessToday(state), cash = frameOf(state).cash ?? {};
  const days = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6)).map(day => {
    const entry = Object.hasOwn(cash, day) ? cash[day]! : null;
    return { day, paise: entry?.paise ?? null, entryId: entry?.id ?? null };
  });
  return { day: today, label: 'told-by-owner', days };
}

export async function cashSave(ctx: Context, payload: Record<string, any>, host: ModuleHost): Promise<CashWeekReply> {
  check(Object.keys(payload).every(key => key === 'day' || key === 'paise'), 'INVALID_TODAYX_REQUEST', 'This request has fields it does not use.');
  check(validDay(payload.day), 'INVALID_TODAYX_REQUEST', 'Give the day as YYYY-MM-DD.');
  check(typeof payload.paise === 'string' && PAISE.test(payload.paise), 'INVALID_TODAYX_REQUEST', 'Give the cash as whole paise.');
  await updateFrame(host, ctx, 'prepare', (frame, state) => {
    check(ctx.role === 'owner' || ctx.role === 'cofounder', 'FORBIDDEN', 'Only the owner or a cofounder tells the day\'s cash.');
    const today = businessToday(state);
    check(payload.day <= today && payload.day >= addDays(today, -CASH_BACK_DAYS), 'INVALID_TODAYX_REQUEST', 'Tell the cash for today or a day in the last month.');
    const cash = frame.cash ??= {};
    const at = now();
    cash[payload.day] = { id: `cash_${payload.day.replaceAll('-', '')}_${Date.parse(at).toString(36)}`, paise: payload.paise, memberId: ctx.memberId, at };
    const oldest = addDays(today, -CASH_KEEP_DAYS);
    for (const day of Object.keys(cash)) if (day < oldest) delete cash[day];
    audit(state, 'cash.told', { memberId: ctx.memberId });
  });
  return cashWeek(host);
}

/** Whether any day in the period has a cash entry. */
export function cashCaptured(host: ModuleHost, from: string, to: string): boolean {
  const cash = frameOf(host.store.read()).cash ?? {};
  return Object.keys(cash).some(day => day >= from && day <= to);
}
/** Cash capture is in use: daily closing is on or some day's cash was told. */
export function cashInUse(host: ModuleHost): boolean {
  const frame = frameOf(host.store.read());
  return frame.dailyClosing === true || Object.keys(frame.cash ?? {}).length > 0;
}
/** Retention: cash entries older than the cutoff (epoch ms) go. */
export function purgeCash(cash: Record<string, CashEntry> | undefined, cutoff: number | undefined): number {
  if (!cash || cutoff === undefined) return 0;
  let removed = 0;
  for (const [day, entry] of Object.entries(cash)) if (Date.parse(entry.at) < cutoff) { delete cash[day]; removed++; }
  return removed;
}
