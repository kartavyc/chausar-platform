/**
 * One-shot C4 task 12: a run's time in words. The engine's `elapsed` is the time it worked, without its waits on the
 * owner; `waited` is those waits; `waitingSince` is when the current wait began. The screen only words them.
 */

import { useT, type T } from '../text';
import { useClock } from '../shell/clock';
import { formatAge } from '../../../../platform/runtime/owner-format';
import type { RunSummary } from '../engine/types';

type Times = Pick<RunSummary, 'elapsed' | 'waited' | 'waitingSince'>;

/** "Waiting 6 min" from when the wait began; nothing when the engine sent no start or under a second has passed. */
export function useWaitingWords(): (run: Pick<RunSummary, 'waitingSince'>) => string | undefined {
  const t = useT();
  const now = useClock();
  return (run) => {
    if (!run.waitingSince) return undefined;
    const elapsed = formatAge(run.waitingSince, now().toISOString());
    return elapsed ? t('run.waitingFor', { elapsed }) : undefined;
  };
}

/** A run still going: once it has waited, "Worked 2 min"; otherwise `plain` ("Started 2 min ago"), still true of it. */
export function workedWords(run: Times, t: T, plain: string): string {
  return t(run.waited !== undefined || run.waitingSince ? 'run.workedSoFar' : plain, { elapsed: run.elapsed });
}

/** A finished run: "Took 2 min", with the wait after it when the engine measured one. Never a guess at one. */
export function tookWords(run: Times, t: T, plain: string): string {
  return run.waited !== undefined ? t('run.tookWaited', { elapsed: run.elapsed, waited: run.waited }) : t(plain, { elapsed: run.elapsed });
}
