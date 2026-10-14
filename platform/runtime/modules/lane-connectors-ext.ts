import type { EngineModule } from './types.ts';
import { join } from 'node:path';
import { handlers, tick } from '../connectors-ext/service.ts';
import { ConnectorCredentialStore, hostCredentialServices, loadOAuthClients } from '../connectors-ext/credentials.ts';
import { boundedHttp } from '../connectors.ts';
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
    'connectorsx.credentials.set': { permission: 'admin', handler: handlers.credentialsSet },
    'connectorsx.credentials.remove': { permission: 'admin', handler: handlers.credentialsRemove },
    'connectorsx.credentials.status': { permission: 'read', handler: handlers.credentialsStatus },
    'connectorsx.schedule': { permission: 'admin', handler: handlers.schedule },
  },
  purge: (state, reason) => purgeSources(state, reason.sourceIds),
  tick,
  /**
   * The installed app wires itself: a sealed local credential store in the app directory, the
   * broker, code exchange and database resolver over it, bounded HTTP, and sign-in apps from a
   * trusted config file (CHAUSAR_OAUTH_CLIENTS_FILE, or oauth-clients.json in the app directory).
   * Demo launches get nothing: every external system stays disabled.
   */
  hostOptions({ directory, demo, env }) {
    if (demo) return {};
    const credentialStore = new ConnectorCredentialStore(join(directory, 'connector-credentials'));
    const clients = loadOAuthClients(env.CHAUSAR_OAUTH_CLIENTS_FILE ?? join(directory, 'oauth-clients.json'));
    const services = hostCredentialServices(credentialStore, { clients });
    return Object.freeze({ credentialStore, http: boundedHttp, credentialBroker: services.credentialBroker, tokenExchange: services.tokenExchange, databaseCredentials: services.databaseCredentials,
      oauthClients: Object.fromEntries(Object.entries(clients).map(([provider, client]) => [provider, { clientId: client.clientId, redirectUri: client.redirectUri }])) });
  },
};
