// C5 task 20: what came just before each backup, for the backup's row: the newest decision or journal line at or before
// its time. Worked out from the open vault each time it is read, so no label ever sits outside the vault.
import type { State } from '../../contracts.ts';
import { currentVenture } from '../records.ts';
import { decisionViews } from './decisions.ts';
import { journalEntries } from './list.ts';

const SHORT = 90;
const clean = (line: string) => {
  const one = line.replace(/\s+/g, ' ').trim();
  const short = one.length > SHORT ? `${one.slice(0, SHORT - 1).trimEnd()}...` : one;
  return short.replace(/^You /, 'you ');
};

/** For each backup time, the line that came just before it, or null. reader: the member reading, whose own decisions say "you". */
export function backupLabels(state: State, times: readonly string[], reader: string | null): (string | null)[] {
  const venture = currentVenture(state);
  if (!venture) return times.map(() => null);
  const lines = [
    ...decisionViews(state, venture, reader).map(item => ({ at: item.at, line: item.line })),
    ...journalEntries(state, 500).map(item => ({ at: item.at, line: `${item.action}: ${item.line}` })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return times.map(at => {
    let low = 0, high = lines.length;
    while (low < high) { const middle = (low + high) >> 1; if (lines[middle]!.at <= at) low = middle + 1; else high = middle; }
    return low ? clean(lines[low - 1]!.line) : null;
  });
}
