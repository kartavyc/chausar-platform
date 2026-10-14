import type { EngineModule } from './types.ts';
import { jobsMethods, jobsTick, jobsPurge } from '../jobs-ext/methods.ts';
import { autonomyMethods, autonomyTick } from '../jobs-ext/autonomy-methods.ts';
import { procedureMethods } from '../procedures/methods.ts';
import { isLaneJob } from '../jobs-ext/state.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const jobsExtModule: EngineModule = {
  id: 'jobs-ext',
  methods: { ...jobsMethods, ...autonomyMethods, ...procedureMethods },
  purge: (state, reason) => jobsPurge(state, reason),
  // jobsx-* mandates are run by this module's tick; the core scheduler leaves them alone.
  ownsJob: job => isLaneJob(job),
  // The installed app (not demo) uses the live model-gateway agent whenever the owner has an enabled route.
  hostOptions: ({ demo }) => demo ? {} : { liveAgent: 'model-gateway' },
  // Lane jobs prepare actions first; the autonomy switch then runs only the safe, undoable ones.
  tick: async (ctx, host, scheduler) => [...await jobsTick(ctx, host, scheduler), ...await autonomyTick(ctx, host)],
};
