import type { RunSummary } from '../engine/types';

/** Active or waiting jobs can be stopped unless a stop is already in progress. */
export const stoppable = (run: RunSummary) => (run.state === 'active' || run.state === 'waiting') && !run.stop;
