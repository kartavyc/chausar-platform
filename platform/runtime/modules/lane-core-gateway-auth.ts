import type { EngineModule } from './types.ts';

/** The core-gateway-auth lane: model gateway, second ask, member secrets, PIN unlock and the secret store. New RPC methods for core work live here, so core lanes never
 *  edit the engine's request switch at the same time. Only the owning lane edits this file. */
export const coreGatewayAuthModule: EngineModule = { id: 'core-gateway-auth', methods: {} };
