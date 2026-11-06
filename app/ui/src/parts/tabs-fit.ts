/**
 * Which tabs sit in the row and which go under More (C1 task 1). Pure: it takes the measured widths of the items and
 * of the More button, and the room the row has. These are layout pixels, never money.
 *
 * - `primary` (indexes): only these may sit in the row; the rest are under More at every width.
 * - The current item is always in the row. When it would fall under More, it takes the last place in the row and the
 *   item it displaces goes under More.
 * - Nothing measured (every width zero, as in jsdom) keeps everything in the row except the non-primary items.
 */

export interface FitInput {
  widths: readonly number[];
  room: number;
  moreWidth: number;
  /** The index of the current item, or -1. */
  current: number;
  primary?: readonly number[] | undefined;
  /** The space between two items in the row. */
  gap?: number | undefined;
}

export interface Fit {
  row: number[];
  more: number[];
}

export function fitTabs({ widths, room, moreWidth, current, primary, gap = 0 }: FitInput): Fit {
  const all = widths.map((_, index) => index);
  const allowed = (index: number) => !primary || primary.includes(index) || index === current;
  const candidates = all.filter(allowed);
  const split = (row: number[]): Fit => {
    const sorted = [...row].sort((a, b) => a - b);
    return { row: sorted, more: all.filter((index) => !sorted.includes(index)) };
  };
  const measured = room > 0 && widths.some((width) => width > 0);
  if (!measured) return split(candidates);

  const total = (row: readonly number[]) => row.reduce((sum, index) => sum + (widths[index] ?? 0), 0) + gap * Math.max(0, row.length - 1);
  if (candidates.length === all.length && total(candidates) <= room) return split(candidates);

  const space = room - moreWidth - gap;
  const row: number[] = [];
  for (const index of candidates) {
    if (total([...row, index]) > space) break;
    row.push(index);
  }
  if (current >= 0 && current < widths.length && !row.includes(current)) {
    row.pop();
    while (row.length > 0 && total([...row, current]) > space) row.pop();
    row.push(current);
  }
  return split(row);
}
