import type { EngineModule } from './types.ts';
import { jobsMethods, jobsTick, jobsPurge } from '../jobs-ext/methods.ts';
import { autonomyMethods, autonomyTick } from '../jobs-ext/autonomy-methods.ts';
import { procedureMethods } from '../procedures/methods.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const jobsExtModule: EngineModule = {
  id: 'jobs-ext',
  methods: { ...jobsMethods, ...autonomyMethods, ...procedureMethods },
  purge: (state, reason) => jobsPurge(state, reason),
  // Lane jobs prepare actions first; the autonomy switch then runs only the safe, undoable ones.
  tick: async (ctx, host, scheduler) => [...await jobsTick(ctx, host, scheduler), ...await autonomyTick(ctx, host)],
};
