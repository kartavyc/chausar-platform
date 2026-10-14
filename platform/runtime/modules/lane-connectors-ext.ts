import type { EngineModule } from './types.ts';
import { handlers } from '../connectors-ext/service.ts';
import { purgeSources } from '../connectors-ext/state.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const connectorsExtModule: EngineModule = {
  id: 'connectors-ext',
  methods: {
    'connectorsx.systems': { permission: 'read', handler: handlers.systems },
    'connectorsx.recipes': { permission: 'read', handler: handlers.recipes },
    'connectorsx.connections': { permission: 'read', handler: handlers.connections },
    'connectorsx.connect': { permission: 'admin', handler: handlers.connect },
    'connectorsx.pause': { permission: 'admin', handler: handlers.pause },
    'connectorsx.disconnect': { permission: 'admin', handler: handlers.disconnect },
    'connectorsx.signIn': { permission: 'admin', handler: handlers.signIn },
    'connectorsx.signInComplete': { permission: 'admin', external: true, handler: handlers.signInComplete },
    'connectorsx.read': { permission: 'prepare', external: true, handler: handlers.read },
    'connectorsx.importPreview': { permission: 'prepare', handler: handlers.importPreview },
    'connectorsx.importCommit': { permission: 'prepare', handler: handlers.importCommit },
    'connectorsx.discard': { permission: 'prepare', handler: handlers.discard },
    'connectorsx.envelopes': { permission: 'read', handler: handlers.envelopes },
    'connectorsx.freshness': { permission: 'read', handler: handlers.freshness },
    'connectorsx.gstMatch': { permission: 'read', handler: handlers.gstMatch },
    'connectorsx.plainDb.tables': { permission: 'admin', external: true, handler: handlers.plainDbTables },
    'connectorsx.plainDb.read': { permission: 'prepare', external: true, handler: handlers.plainDbRead },
    'connectorsx.unmapped': { permission: 'read', handler: handlers.unmapped },
  },
  purge: (state, reason) => purgeSources(state, reason.sourceIds),
};
