// Chausar venture launcher, delivery (Ink v2 wave 4, package 4F1; W3's U6): how long a run usually takes, measured,
// never guessed. Each approved turn adds the time it took to run to its run's working time (delivery/runs.ts); time
// waiting on the owner never counts. Once three runs of the same playbook steps finished, a run of those steps reads
// "Usually 3 to 5 min": the lowest and the highest of the last five, in whole minutes. Fewer than three: nothing.
import type { State } from '../../contracts.ts';
import { listRecords } from '../records.ts';

/** How many finished runs an estimate needs, and how many of the newest it reads. */
const NEEDED = 3;
const READ = 5;

/** A working time in whole minutes, to the nearest, at least 1: a run that took seconds still took part of a minute. */
const wholeMinutes = (ms: number) => Math.max(1, Math.floor((ms + 30_000) / 60_000));

/**
 * "Usually 3 to 5 min" for a run of these playbook steps (its playbook hash), from the last five finished runs of the
 * same steps with a measured working time, or null until three such runs finished.
 */
export function usualDuration(state: State, ventureId: string, playbookHash: string): string | null {
  const finished = listRecords(state, 'venture-delivery-run', ventureId)
    .filter(run => run.playbookHash === playbookHash && run.harness?.phase === 'done' && typeof run.harness.workedMs === 'number')
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, READ);
  if (finished.length < NEEDED) return null;
  const minutes = finished.map(run => wholeMinutes(run.harness!.workedMs!));
  const low = Math.min(...minutes), high = Math.max(...minutes);
  return low === high ? `Usually ${low} min` : `Usually ${low} to ${high} min`;
}
