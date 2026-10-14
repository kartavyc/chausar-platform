import { isAbsolute } from 'node:path';
import { check } from '../contracts.ts';
import { BundledPostgres, type BundledPostgresOptions, type PostgresState } from './postgres-lifecycle.ts';
import { verifyRuntimeInventory, type InventoryResult } from './runtime-inventory.ts';

/**
 * Desktop start-up of the bundled database, called by app/desktop/main.cjs (non-demo launches only).
 * 1. The installed `runtime-binaries` must match its manifest (runtime-inventory.ts).
 * 2. `BundledPostgres` reads the cluster under `userData/database` (the layout the earlier
 *    scripts/postgres-runtime.mjs start-up used: `cluster/` and `database-password`), recovers a stale
 *    lock and starts on loopback.
 * A cluster from an older PostgreSQL is never upgraded here: the engine starts without a database
 * (`CHAUSAR_DATABASE_STATE=needs-upgrade`), so every database request fails closed, and the person
 * sees why. A cluster from a newer PostgreSQL refuses start-up altogether.
 */
export type DesktopDatabaseOptions = {
  runtimeRoot:string; dataRoot:string; receiptDirectory:string; appVersion:string;
  /** Tests substitute the runner and platform; the desktop passes neither. */
  postgres?:Partial<BundledPostgresOptions>;
};
export type DesktopDatabase =
  | Readonly<{ state:'running'; url:string; inventory:InventoryResult; close():Promise<void> }>
  | Readonly<{ state:'needs-upgrade'; code:'POSTGRES_UPGRADE_REQUIRED'; message:string; inventory:InventoryResult; close():Promise<void> }>;

export async function startDesktopDatabase(options:DesktopDatabaseOptions):Promise<DesktopDatabase> {
  check(isAbsolute(options.runtimeRoot) && isAbsolute(options.dataRoot) && isAbsolute(options.receiptDirectory), 'DATABASE_PATH_INVALID', 'The database folders must be absolute.');
  const inventory = await verifyRuntimeInventory({ runtimeRoot: options.runtimeRoot, appVersion: options.appVersion, receiptDirectory: options.receiptDirectory, platform: options.postgres?.platform });
  const database = new BundledPostgres({ ...options.postgres, runtimeRoot: options.runtimeRoot, dataRoot: options.dataRoot });
  const status = await database.status(), state:PostgresState = status.state;
  check(state !== 'newer-than-app', 'DATABASE_NEWER_THAN_APP', 'This database was written by a newer Chausar. Install that version again; this one will not open it.');
  if (state === 'needs-upgrade') return Object.freeze({ state, code: 'POSTGRES_UPGRADE_REQUIRED', inventory, close: async () => {},
    message: 'The local database was made by an older PostgreSQL and needs an upgrade before Chausar can open it. Nothing was changed; make a vault copy, then run the upgrade from Trust.' });
  check(state !== 'unavailable', status.reason ?? 'POSTGRES_RUNTIME_UNUSABLE', 'The bundled database runtime cannot be used. Reinstall Chausar.');
  await database.start();
  try {
    const url = await database.connectionUrl();
    return Object.freeze({ state: 'running', url, inventory, close: () => database.stop() });
  } catch (error) { await database.stop().catch(() => {}); throw error; }
}
