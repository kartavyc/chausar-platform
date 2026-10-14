import type { EngineModule } from './types.ts';
import { logMethods } from '../learning-ext/log-methods.ts';
import { purgeLog } from '../learning-ext/log.ts';
import { sharingMethods, purgeSharing } from '../learning-ext/sharing.ts';
import { recipeMethods, purgeRecipes } from '../learning-ext/recipes.ts';
import { accountsMethods, purgeAccounts } from '../learning-ext/accounts.ts';
import { dictionaryMethods, purgeDictionary, dictionaryTick } from '../learning-ext/dictionary.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const learningExtModule: EngineModule = {
  id: 'learning-ext',
  methods: { ...logMethods, ...sharingMethods, ...recipeMethods, ...accountsMethods, ...dictionaryMethods },
  purge(state, reason) {
    // Decisions that point at a purged account set, proposal or edit go with it.
    const collect = new Set<string>(reason.removedIds);
    const derived = purgeAccounts(state, { ...reason, collect }) + purgeDictionary(state, { ...reason, collect });
    return derived + purgeLog(state, { ...reason, removedIds: collect }) + purgeSharing(state, reason) + purgeRecipes(state, reason);
  },
  tick: (ctx, host, scheduler) => dictionaryTick(ctx, host, scheduler),
};
