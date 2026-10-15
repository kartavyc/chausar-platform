/**
 * This computer's own device files, outside any workspace (TR-07, FR-14). They live in `<app data>/.chausar-device/`,
 * which no workspace folder name can collide with:
 *
 * - `identity.json`: the device id, its name and its Ed25519 public key;
 * - `signing-key.pem`: the private signing key, readable by this user only (0600). The OS keychain is not used yet:
 *   the general secret store belongs to core-gateway-auth, and this file moves there when it exists;
 * - `enrolment.json`: which workspace and vault this computer syncs, through which shared folder, and whether the
 *   owner turned sync on. `worker.ts` reads it at start (`desktopSyncOptions`);
 * - `pen-floor.json`: the highest pen sequence this computer has seen for the enrolled workspace, so an older copy in
 *   which this computer still held the pen can never write again;
 * - `join.json`: a join request this computer made and is waiting on.
 *
 * Every record is canonical JSON, read with a size bound and written atomically.
 */
import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { KeyObject } from 'node:crypto';
import { check, ChausarError } from '../contracts.ts';

export const DEVICE_FOLDER = '.chausar-device';
const MAX_RECORD = 16384;
export type DeviceIdentity = { format: 'chausar.device.v1'; deviceId: string; name: string; publicKey: string; createdAt: string };
export type SyncFolder = { kind: 'folder'; directory: string } | { kind: 'drive' };
export type Enrolment = { format: 'chausar.device-enrolment.v1'; workspaceId: string; vaultId: string; deviceId: string; transport: SyncFolder; syncOn: boolean; enrolledAt: string };
export type PenFloor = { format: 'chausar.pen-floor.v1'; workspaceId: string; vaultId: string; deviceId: string; seq: number };
export type PendingJoin = { format: 'chausar.device-join.v1'; requestId: string; directory: string; code: string; expiresAt: string };

export const DEVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,59}$/u;
export const ID = /^[a-z][a-z0-9_-]{2,80}$/;
export const deviceName = (value: unknown, fallback = 'This computer') => {
  const name = value === undefined ? fallback : value;
  check(typeof name === 'string' && DEVICE_NAME.test(name.trim()), 'INVALID_DEVICE_REQUEST', 'Name this computer in a few plain words.');
  return (name as string).trim();
};
export const fingerprint = (publicKey: string) => createHash('sha256').update(createPublicKey(publicKey).export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 16);

export function deviceDirectory(directory: string) { return join(resolve(directory), DEVICE_FOLDER); }
async function ensureDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path); check(stat.isDirectory() && !stat.isSymbolicLink(), 'DEVICE_FILES_UNSAFE', 'The device folder must be a real folder.');
}
export async function readRecord<T>(path: string): Promise<T | null> {
  let stat; try { stat = await lstat(path); } catch (error: any) { if (error.code === 'ENOENT') return null; throw error; }
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= MAX_RECORD, 'DEVICE_FILES_UNSAFE', 'A device record is not a small regular file.');
  const raw = await readFile(path, 'utf8'); let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ChausarError('DEVICE_FILES_CORRUPT', 'A device record is not valid.'); }
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value) === raw, 'DEVICE_FILES_CORRUPT', 'A device record is not valid.');
  return value as T;
}
export async function writeRecord(path: string, value: unknown, mode = 0o600) {
  const raw = JSON.stringify(value); check(Buffer.byteLength(raw) <= MAX_RECORD, 'DEVICE_FILES_UNSAFE', 'A device record is too large.');
  const temporary = `${path}.${randomUUID()}.tmp`; const file = await open(temporary, 'wx', mode);
  try { await file.writeFile(raw); await file.sync(); await file.close(); await rename(temporary, path); }
  catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
}
export async function removeRecord(path: string) { await unlink(path).catch((error: any) => { if (error.code !== 'ENOENT') throw error; }); }

/** This computer's identity and key, made once. */
export async function deviceIdentity(directory: string, create: { name?: string } | false = false): Promise<{ identity: DeviceIdentity; signingKey: KeyObject } | null> {
  const folder = deviceDirectory(directory), identityPath = join(folder, 'identity.json'), keyPath = join(folder, 'signing-key.pem');
  const existing = await readRecord<DeviceIdentity>(identityPath);
  if (existing) {
    check(existing.format === 'chausar.device.v1' && ID.test(existing.deviceId) && typeof existing.publicKey === 'string' && typeof existing.name === 'string', 'DEVICE_FILES_CORRUPT', 'The device identity is not valid.');
    const stat = await lstat(keyPath).catch(() => null); check(stat?.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_RECORD, 'DEVICE_FILES_CORRUPT', 'The device signing key is missing.');
    const signingKey = createPrivateKey(await readFile(keyPath, 'utf8'));
    check(signingKey.asymmetricKeyType === 'ed25519' && createPublicKey(signingKey).export({ format: 'pem', type: 'spki' }).toString() === existing.publicKey, 'DEVICE_FILES_CORRUPT', 'The device signing key does not match its identity.');
    return { identity: existing, signingKey };
  }
  if (create === false) return null;
  await ensureDirectory(folder);
  const pair = generateKeyPairSync('ed25519');
  const identity: DeviceIdentity = { format: 'chausar.device.v1', deviceId: `device_${randomUUID()}`, name: deviceName(create.name), publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }).toString(), createdAt: new Date().toISOString() };
  const temporary = `${keyPath}.${randomUUID()}.tmp`; const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()); await file.sync(); await file.close(); await rename(temporary, keyPath); }
  catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
  await writeRecord(identityPath, identity);
  return { identity, signingKey: pair.privateKey };
}

function validFolder(value: any): value is SyncFolder {
  return value?.kind === 'drive' && Object.keys(value).length === 1 || value?.kind === 'folder' && Object.keys(value).length === 2 && typeof value.directory === 'string' && isAbsolute(value.directory);
}
export async function readEnrolment(directory: string): Promise<Enrolment | null> {
  const value = await readRecord<Enrolment>(join(deviceDirectory(directory), 'enrolment.json'));
  if (value) check(value.format === 'chausar.device-enrolment.v1' && typeof value.workspaceId === 'string' && typeof value.vaultId === 'string' && ID.test(value.deviceId) && typeof value.syncOn === 'boolean' && validFolder(value.transport), 'DEVICE_FILES_CORRUPT', 'The sync enrolment is not valid.');
  return value;
}
export async function writeEnrolment(directory: string, value: Enrolment) { await ensureDirectory(deviceDirectory(directory)); await writeRecord(join(deviceDirectory(directory), 'enrolment.json'), value); }
export async function removeEnrolment(directory: string) { await removeRecord(join(deviceDirectory(directory), 'enrolment.json')); }

export async function readPendingJoin(directory: string): Promise<PendingJoin | null> {
  const value = await readRecord<PendingJoin>(join(deviceDirectory(directory), 'join.json'));
  if (value) check(value.format === 'chausar.device-join.v1' && ID.test(value.requestId) && isAbsolute(value.directory) && /^\d{6}$/.test(value.code), 'DEVICE_FILES_CORRUPT', 'The join request is not valid.');
  return value;
}
export async function writePendingJoin(directory: string, value: PendingJoin | null) {
  const path = join(deviceDirectory(directory), 'join.json');
  if (value === null) return removeRecord(path);
  await ensureDirectory(deviceDirectory(directory)); await writeRecord(path, value);
}
