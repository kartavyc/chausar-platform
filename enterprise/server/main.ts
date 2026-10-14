import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { check } from '../../platform/runtime/contracts.ts';
import type { Engine } from '../../platform/runtime/engine.ts';
import { createServerEngine } from '../../platform/runtime/server.ts';
import { loadEnterpriseConfig, readSecretFile, type EnterpriseConfig } from './config.ts';
import { createEnterpriseServer, type EnterpriseServer } from './server.ts';

/** The database URL carries a password, so a file path is preferred over the plain variable. */
async function postgresUrl(environment: NodeJS.ProcessEnv): Promise<string> {
  const file = environment.CHAUSAR_POSTGRES_URL_FILE;
  check(!(file && environment.CHAUSAR_POSTGRES_URL), 'ENTERPRISE_CONFIG_INVALID', 'Set the database URL once, either as a file or as a variable.');
  const url = file ? await readSecretFile(file) : environment.CHAUSAR_POSTGRES_URL;
  check(typeof url === 'string' && url.length > 0, 'DATABASE_REQUIRED', 'Set CHAUSAR_POSTGRES_URL_FILE or CHAUSAR_POSTGRES_URL for the enterprise server.');
  return url;
}
/** Production engine: the same constructor as the owner server, never demo, always PostgreSQL. */
export async function createEnterpriseEngine(config: EnterpriseConfig, environment: NodeJS.ProcessEnv = process.env): Promise<Engine> {
  const url = await postgresUrl(environment);
  return createServerEngine({ ...environment, CHAUSAR_VAULT_DIRECTORY: config.workspace.directory, CHAUSAR_POSTGRES_URL: url }, []);
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
export async function startEnterprise(environment: NodeJS.ProcessEnv = process.env): Promise<{ engine: Engine; app: EnterpriseServer }> {
  const config = await loadEnterpriseConfig(environment.CHAUSAR_ENTERPRISE_CONFIG);
  const engine = await createEnterpriseEngine(config, environment);
  try {
    await openWorkspace(engine, config);
    const app = await createEnterpriseServer(engine, config);
    await app.listen(); return { engine, app };
  } catch (error) { await engine.shutdown(5000).catch(() => {}); throw error; }
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
    let started: { engine: Engine; app: EnterpriseServer };
    try { started = await startEnterprise(); } catch (error) { fail(error); throw error; }
    const { engine, app } = started;
    console.log('Chausar enterprise server is listening over HTTPS.');
    const scheduler = setInterval(() => { void engine.tick().catch(() => {}); }, 30000); scheduler.unref();
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { clearInterval(scheduler); void app.close(60000).catch(() => {}).finally(() => process.exit(0)); });
  }
}
