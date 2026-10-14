/**
 * The week's cash in the Simple view (TD-02): seven bars, the last one today.
 *
 * Not entered: today's bar is open (an outline), so a day with no cash entry never reads
 * as a day with no sales. Entered: the bar fills with the figure the owner said, with
 * its own receipt; the row beside the field says "told by owner". Nothing is added up or
 * converted here: a supplied figure is placed as it came.
 */

import { isFigure, type ChartValue, type ColumnsChart } from '../../app/presentation.ts';
import type { TodayData } from './TodayData.ts';

export function cashWeek(cash: NonNullable<TodayData['cash']>): ColumnsChart {
  const values = cash.week.values;
  const last = values[values.length - 1];
  if (last === undefined) return cash.week;
  const { outline: _open, ...filled } = last;
  let today: ChartValue;
  if (cash.entered !== undefined) today = isFigure(last.value) ? filled : { ...filled, value: cash.entered };
  else today = isFigure(last.value) ? filled : { ...filled, outline: true };
  return { ...cash.week, values: [...values.slice(0, -1), today] };
}
