import type { EngineModule } from './types.ts';
import { jobsMethods } from '../jobs-ext/methods.ts';
import { autonomyMethods } from '../jobs-ext/autonomy-methods.ts';
import { procedureMethods } from '../procedures/methods.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const jobsExtModule: EngineModule = {
  id: 'jobs-ext',
  methods: { ...jobsMethods, ...autonomyMethods, ...procedureMethods },
};
