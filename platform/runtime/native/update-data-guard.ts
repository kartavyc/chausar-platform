import { isAbsolute, join } from 'node:path';
import { check } from '../contracts.ts';
import { compareVersions } from '../updater.ts';
import { safeDirectory } from '../vault.ts';
import { acquireProcessLock } from '../process-lock.ts';
import { exactKeys, hashRegularFile, isoTimestamp, readJsonFile, writeJsonAtomic } from './update-files.ts';

export const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000, MAX_SCHEMA = 1000;
export type DataSchemaMarker = Readonly<{ dataSchemaVersion:number; writtenBy:string; at:string }>;
export type BackupEvidence = { path:string; sha256:string };
export type BackupCheck = Readonly<{ backupRequired:boolean; fromSchema:number; toSchema:number; backup:Readonly<{ path:string; sha256:string; size:number }>|null }>;
const schema = (value:unknown):value is number => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_SCHEMA;

/**
 * Release-level data guard: `<appData>/release/data-schema.json` records the highest data schema any app wrote.
 * An older app refuses a newer vault, and a schema bump needs a fresh, hash-pinned vault copy first.
 */
export class DataGuard {
  #directory:string; #now:()=>number;
  constructor(options:{ appDataDirectory:string; now?:()=>number }) {
    check(typeof options.appDataDirectory === 'string' && isAbsolute(options.appDataDirectory), 'UNSAFE_UPDATE_PATH', 'Choose an absolute application data directory.');
    this.#directory = options.appDataDirectory; this.#now = options.now ?? Date.now;
  }
  async #release() { return safeDirectory(join(await safeDirectory(this.#directory, true), 'release'), true); }
  async marker():Promise<DataSchemaMarker|null> {
    const value:any = await readJsonFile(join(await this.#release(), 'data-schema.json'), 4096, 'DATA_SCHEMA_MARKER_INVALID');
    if (value === undefined) return null;
    let version = false; try { compareVersions(value.writtenBy, value.writtenBy); version = true; } catch {}
    check(exactKeys(value, ['dataSchemaVersion','writtenBy','at']) && schema(value.dataSchemaVersion) && version && isoTimestamp(value.at), 'DATA_SCHEMA_MARKER_INVALID', 'The data schema marker is invalid.');
    return Object.freeze(value);
  }
  /** Refuses VAULT_NEWER_THAN_APP when a newer app has already written a higher data schema. */
  async assertAppCanOpen(appDataSchemaVersion:number):Promise<DataSchemaMarker|null> {
    check(schema(appDataSchemaVersion), 'INVALID_DATA_SCHEMA', 'The data schema version must be a positive integer.');
    const marker = await this.marker();
    check(!marker || marker.dataSchemaVersion <= appDataSchemaVersion, 'VAULT_NEWER_THAN_APP', 'This vault was written by a newer Chausar. Install that version or restore an older backup.');
    return marker;
  }
  /** A schema bump needs a regular backup file made within the last hour whose bytes match the pinned SHA-256. */
  async requireBackupBeforeSchemaChange(input:{ fromSchema:number; toSchema:number; backup?:BackupEvidence|null }):Promise<BackupCheck> {
    check(schema(input.fromSchema) && schema(input.toSchema), 'INVALID_DATA_SCHEMA', 'The data schema version must be a positive integer.');
    check(input.toSchema >= input.fromSchema, 'SCHEMA_DOWNGRADE_REFUSED', 'An update cannot lower the data schema.');
    const required = input.toSchema > input.fromSchema, backup = input.backup ?? null;
    if (!required && !backup) return Object.freeze({ backupRequired: false, fromSchema: input.fromSchema, toSchema: input.toSchema, backup: null });
    check(backup && typeof backup.path === 'string' && isAbsolute(backup.path) && typeof backup.sha256 === 'string' && /^[a-f0-9]{64}$/.test(backup.sha256), 'BACKUP_REQUIRED', 'Make a vault backup before this update changes the data schema.');
    const file = await hashRegularFile(backup.path, 'BACKUP_REQUIRED', 'The vault backup is missing or is not a regular file.');
    check(file.size > 0 && file.sha256 === backup.sha256, 'BACKUP_REQUIRED', 'The vault backup differs from its recorded digest.');
    const now = this.#now(), times = [file.mtimeMs, ...(file.birthtimeMs > 0 ? [file.birthtimeMs] : [])];
    check(times.every(time => time >= now - BACKUP_MAX_AGE_MS && time <= now + CLOCK_SKEW_MS), 'BACKUP_REQUIRED', 'The vault backup must be made within the last hour.');
    return Object.freeze({ backupRequired: required, fromSchema: input.fromSchema, toSchema: input.toSchema, backup: Object.freeze({ path: backup.path, sha256: file.sha256, size: file.size }) });
  }
  /** Records the data schema atomically. It never lowers the marker; the same value is a no-op. */
  async recordSchema(dataSchemaVersion:number, appVersion:string):Promise<DataSchemaMarker> {
    check(schema(dataSchemaVersion), 'INVALID_DATA_SCHEMA', 'The data schema version must be a positive integer.');
    compareVersions(appVersion, appVersion);
    const directory = await this.#release(), lock = await acquireProcessLock(join(directory, 'data-schema.lock'), { busyCode: 'UPDATE_BUSY', changedCode: 'UPDATE_LOCK_CHANGED', unsafeCode: 'UNSAFE_UPDATE_PATH' });
    try {
      const marker = await this.marker();
      check(!marker || marker.dataSchemaVersion <= dataSchemaVersion, 'SCHEMA_DOWNGRADE_REFUSED', 'The recorded data schema is never lowered.');
      if (marker && marker.dataSchemaVersion === dataSchemaVersion) return marker;
      const next = Object.freeze({ dataSchemaVersion, writtenBy: appVersion, at: new Date(this.#now()).toISOString() });
      await writeJsonAtomic(join(directory, 'data-schema.json'), next);
      return next;
    } finally { await lock.release(); }
  }
}
