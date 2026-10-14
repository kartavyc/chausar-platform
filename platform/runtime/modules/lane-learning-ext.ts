import type { EngineModule } from './types.ts';
import { logMethods } from '../learning-ext/log-methods.ts';
import { purgeLog } from '../learning-ext/log.ts';
import { sharingMethods, purgeSharing } from '../learning-ext/sharing.ts';
import { recipeMethods, purgeRecipes } from '../learning-ext/recipes.ts';
import { accountsMethods, purgeAccounts } from '../learning-ext/accounts.ts';
import { dictionaryMethods, purgeDictionary, dictionaryTick } from '../learning-ext/dictionary.ts';
import { dictionaryMcpTools } from '../learning-ext/dictionary-layers.ts';
import { registerMcpReadTools } from '../mcp.ts';

// The dictionary's three read-only layers join the existing verified-numbers MCP server.
registerMcpReadTools(dictionaryMcpTools);

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
  /**
   * The installed app opens sharing only when its environment names the reviewed intake
   * (`CHAUSAR_LEARNING_INTAKE_URL`); demo launches never do. `CHAUSAR_LEARNING_FOUNDER_SWITCH=1`
   * shows the two closed boxes, which still refuse until the consent text is reviewed.
   */
  hostOptions({ demo, env }) {
    const url = env.CHAUSAR_LEARNING_INTAKE_URL?.trim();
    return { ...(!demo && url ? { intake: { url } } : {}), ...(env.CHAUSAR_LEARNING_FOUNDER_SWITCH === '1' ? { founderSwitch: true } : {}) };
  },
};
