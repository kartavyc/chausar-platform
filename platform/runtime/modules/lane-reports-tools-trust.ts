import type { EngineModule } from './types.ts';
import { reportsMethods } from '../reports-ext/methods.ts';
import { trustCoreMethods } from '../trust-ext/methods-core.ts';
import { trustToolsMethods } from '../trust-ext/methods-tools.ts';
import { purgeLane, tickLane } from '../trust-ext/lifecycle.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const reportsToolsTrustModule: EngineModule = {
  id: 'reports-tools-trust',
  methods: { ...reportsMethods, ...trustCoreMethods, ...trustToolsMethods },
  purge: purgeLane,
  tick: tickLane,
};
