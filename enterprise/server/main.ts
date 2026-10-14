import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { check } from '../../platform/runtime/contracts.ts';
import { Engine } from '../../platform/runtime/engine.ts';
import { engineJobOptions } from '../../platform/runtime/engine-jobs.ts';
import { loadCodexCliHostGateway } from '../../platform/runtime/codex-cli-host.ts';
import { loadEngineKeychain } from '../../platform/runtime/engine-keychain-host.ts';
import { loadEnterpriseConfig, readDatabaseCa, readSecretFile, type EnterpriseConfig } from './config.ts';
import { createEnterpriseServer, type EnterpriseServer } from './server.ts';
import { PostgresEnterpriseStore, type EnterpriseStoreConnection } from './state-store.ts';

/** The database URL carries a password, so a file path is preferred over the plain variable. */
async function postgresUrl(environment: NodeJS.ProcessEnv): Promise<string> {
  const file = environment.CHAUSAR_POSTGRES_URL_FILE;
  check(!(file && environment.CHAUSAR_POSTGRES_URL), 'ENTERPRISE_CONFIG_INVALID', 'Set the database URL once, either as a file or as a variable.');
  const url = file ? await readSecretFile(file) : environment.CHAUSAR_POSTGRES_URL;
  check(typeof url === 'string' && url.length > 0, 'DATABASE_REQUIRED', 'Set CHAUSAR_POSTGRES_URL_FILE or CHAUSAR_POSTGRES_URL for the enterprise server.');
  return url;
}
/** The database URL and, when configured, the pinned TLS settings. A database on another host must use TLS. */
export async function enterpriseDatabase(config: EnterpriseConfig, environment: NodeJS.ProcessEnv = process.env): Promise<EnterpriseStoreConnection> {
  const url = await postgresUrl(environment);
  check(URL.canParse(url) && ['postgres:', 'postgresql:'].includes(new URL(url).protocol), 'INVALID_POSTGRES_CONFIG', 'Use a PostgreSQL connection URL.');
  const host = new URL(url).hostname.replace(/^\[|\]$/g, ''); const ca = await readDatabaseCa(config);
  check(ca !== undefined || ['127.0.0.1', '::1'].includes(host), 'POSTGRES_TLS_REQUIRED', 'A database on another host needs database.caFile for verified TLS.');
  return { url, ...(ca ? { tls: { ca, ...(config.database?.servername ? { servername: config.database.servername } : {}) } } : {}) };
}
/** Production engine: the owner server's options (never demo, always PostgreSQL) plus the enterprise storage mode. */
export async function createEnterpriseEngine(config: EnterpriseConfig, environment: NodeJS.ProcessEnv = process.env, database?: EnterpriseStoreConnection): Promise<Engine> {
  const { url, tls } = database ?? await enterpriseDatabase(config, environment);
  return new Engine({ directory: resolve(config.workspace.directory), demo: false, storage: 'postgres', postgresUrl: url, pythonExecutable: environment.CHAUSAR_PYTHON,
    updatePublicKey: environment.CHAUSAR_UPDATE_PUBLIC_KEY, durableJobs: engineJobOptions(environment), gateway: await loadCodexCliHostGateway(environment, {}),
    keychain: await loadEngineKeychain(environment, {}, false), storageMode: 'enterprise-server', ...(tls ? { postgresTls: tls } : {}) });
}
export async function openWorkspace(engine: Engine, config: EnterpriseConfig) {
  const unlock = config.workspace.unlock;
  const payload = unlock === 'keychain' ? { folder: config.workspace.folder, unlock: 'keychain' } : { folder: config.workspace.folder, passphrase: await readSecretFile(unlock.passphraseFile) };
  return engine.requestAs(engine.bootstrapContext(), 'workspace.open', payload);
}
/** Operator-only first run: creates the workspace locally, never over HTTP. */
export async function initWorkspace(engine: Engine, config: EnterpriseConfig, name: string) {
  check(config.workspace.unlock !== 'keychain', 'ENTERPRISE_INIT_PASSPHRASE_REQUIRED', 'Create the enterprise workspace with a passphrase file.');
  const passphrase = await readSecretFile(config.workspace.unlock.passphraseFile);
  return engine.requestAs(engine.bootstrapContext(), 'workspace.create', { name, passphrase, folder: config.workspace.folder });
}
export async function startEnterprise(environment: NodeJS.ProcessEnv = process.env): Promise<{ engine: Engine; app: EnterpriseServer; store: PostgresEnterpriseStore }> {
  const config = await loadEnterpriseConfig(environment.CHAUSAR_ENTERPRISE_CONFIG);
  const database = await enterpriseDatabase(config, environment);
  const engine = await createEnterpriseEngine(config, environment, database);
  let store: PostgresEnterpriseStore | undefined;
  try {
    await openWorkspace(engine, config);
    store = await PostgresEnterpriseStore.connect(database);
    const app = await createEnterpriseServer(engine, config, { store });
    await app.listen(); return { engine, app, store };
  } catch (error) { await engine.shutdown(5000).catch(() => {}); await store?.close().catch(() => {}); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fail = (error: unknown) => { const code = (error as { code?: unknown })?.code; process.stderr.write(`Chausar enterprise server stopped: ${typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : 'START_FAILED'}\n`); process.exit(1); };
  const init = process.argv.indexOf('--init-workspace');
  if (init >= 0) {
    try {
      const name = process.argv[init + 1]; check(typeof name === 'string' && name.trim().length >= 2, 'INVALID_NAME', 'Give your business a name.');
      const config = await loadEnterpriseConfig(process.env.CHAUSAR_ENTERPRISE_CONFIG); const engine = await createEnterpriseEngine(config);
      const created = await initWorkspace(engine, config, name);
      process.stdout.write(`Workspace created. Record this recovery code offline now; it is shown once:\n${created.recoveryCode}\n`);
      await engine.shutdown(10000); process.exit(0);
    } catch (error) { fail(error); }
  } else {
    let started: Awaited<ReturnType<typeof startEnterprise>>;
    try { started = await startEnterprise(); } catch (error) { fail(error); throw error; }
    const { engine, app, store } = started;
    console.log('Chausar enterprise server is listening over HTTPS.');
    const scheduler = setInterval(() => { void engine.tick().catch(() => {}); }, 30000); scheduler.unref();
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { clearInterval(scheduler); void app.close(60000).catch(() => {}).finally(() => store.close().catch(() => {}).finally(() => process.exit(0))); });
  }
}
