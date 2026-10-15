/**
 * Daily closing (TD-01 "Close today: cash, bank, entries"). Whether it is on is a workspace
 * preference kept in this module's state, off by default. Each part's state comes from what
 * the engine holds for the business day:
 *
 * - cash: today's cash as the owner told it (`todayx.cash.save`, cash.ts). Told: `done`.
 *   Not told yet: `not-loaded-yet`.
 * - bank: visible bank statement imports. None: `not-loaded-yet`. One read today and
 *   reconciled against its own totals: `done`. Otherwise `not-done`.
 * - entries: every other visible source. None: `not-loaded-yet`. One read today: `done`.
 *   Otherwise `not-done`.
 */
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { businessToday, frameOf } from './frame.ts';

export type ClosingPart = 'done' | 'not-done' | 'not-loaded-yet';
export type ClosingReply = { on: boolean; day: string; parts: { cash: ClosingPart; bank: ClosingPart; entries: ClosingPart } };

type Rec = Record<string, any>;
const readOn = (record: Rec, day: string) => typeof record.at === 'string' && record.at.startsWith(day);

export async function closing(_ctx: Context, host: ModuleHost): Promise<ClosingReply> {
  const state = host.store.read(), day = businessToday(state);
  let sources: Rec[] = [];
  try { const listed = await host.call('sources.list', {}); if (Array.isArray(listed)) sources = listed.filter(item => item && typeof item === 'object'); } catch { sources = []; }
  const bank = sources.filter(item => item.format === 'bank-csv'), entries = sources.filter(item => item.format !== 'bank-csv');
  const bankState: ClosingPart = bank.length === 0 ? 'not-loaded-yet'
    : bank.some(item => readOn(item, day) && item.coverage?.reconciled === true) ? 'done' : 'not-done';
  const entriesState: ClosingPart = entries.length === 0 ? 'not-loaded-yet' : entries.some(item => readOn(item, day)) ? 'done' : 'not-done';
  const cash: ClosingPart = Object.hasOwn(frameOf(state).cash ?? {}, day) ? 'done' : 'not-loaded-yet';
  return { on: frameOf(state).dailyClosing === true, day, parts: { cash, bank: bankState, entries: entriesState } };
}
