import { DRAFT_DESK_METHODS } from '../method-registry.ts';

import { check, ChausarError } from '../contracts.ts';

import type { EngineInternals } from './internals.ts';
import { type Handler } from './admission.ts';
export const METHODS: Record<string, Handler> = {
...Object.fromEntries(DRAFT_DESK_METHODS.map(method => [method, async (internals: EngineInternals, payload: any) => (await internals.privateDraftDesk()).request(internals.context, method, payload)])),
"venture.ai.setup.trust": async (internals, payload) => {
const method = "venture.ai.setup.trust";
throw new ChausarError('APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
},
"venture.ai.claude.install": async (internals, payload) => {
const method = "venture.ai.claude.install";
throw new ChausarError('APP_APPROVAL_REQUIRED', 'Do this inside the Chausar app.');
},
"venture.ai.claude.progress": async (internals, payload) => {
const method = "venture.ai.claude.progress";

      check(Object.keys(payload).length === 0, 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
      return internals.privateClaudeProgress;
    
}
};
