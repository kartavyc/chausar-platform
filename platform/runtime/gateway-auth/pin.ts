import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { closeSync, constants, existsSync, openSync, readSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { check } from '../contracts.ts';
import { safeDirectory, type KeychainHook, type Vault, type VaultKeychainProvider } from '../vault.ts';
import { privateDirectory, readPrivateFile, readSecretBeforeUnlock, SecretStore, secretsBacking, writePrivateFile } from './secret-store.ts';

/**
 * PIN quick unlock (SH-02, TR-12). The vault key is wrapped on this device only, under
 * HKDF-SHA256(scrypt(PIN, salt), salt = a 32-byte device secret from the secret store, info = chausar.pin.v1:<vaultId>),
 * with the vault id and folder as AES-GCM associated data. With a native keychain the device secret's store key lives in
 * the keychain, so a copied record is useless off this device. The PIN is never stored. Each wrong PIN is counted in the
 * record before the answer; after the third a wait starts (30 s, doubling); after the fifth the wrapped key is deleted and
 * only the passphrase unlocks. Changing the passphrase (recovery) or deleting the vault removes the record.
 */
export const PIN_LIMIT = 5;
const WAIT_AFTER = 3, WAIT_MS = 30_000;
const FOLDER = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const DIGITS = /^[0-9]{6,12}$/;
const KDF = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DEVICE_SECRET = 'device.pin-unlock';
type PinRecord = {
  version: 1; vaultId: string; binding: string; deviceBound: 'keychain' | 'file'; kdf: { name: 'scrypt'; N: number; r: number; p: number };
  salt: string; iv: string; tag: string; wrapped: string; failures: number; waitUntil: string | null; createdAt: string;
};
type Tombstone = { version: 1; vaultId: string; disabled: 'too-many-tries'; at: string };
export type PinStatus = { enabled: boolean; failuresLeft: number | null; waitUntil: string | null; disabledReason: 'too-many-tries' | null; deviceBound: 'keychain' | 'file' };

export function checkPinFolder(folder: unknown): string {
  check(typeof folder === 'string' && FOLDER.test(folder), 'INVALID_PATH', 'Use a short workspace folder name without path separators.');
  return folder;
}
export function checkPinRule(pin: unknown): string {
  check(typeof pin === 'string' && DIGITS.test(pin), 'PIN_INVALID', 'Use a PIN of 6 to 12 digits.');
  check(!/^(\d)\1+$/.test(pin) && !'01234567890123456789'.includes(pin) && !'98765432109876543210'.includes(pin), 'PIN_TOO_SIMPLE', 'Choose a PIN that is not one repeated digit or a simple run.');
  return pin;
}
const recordPath = (directory: string, folder: string) => join(resolve(directory), 'pin-unlock', `${Buffer.from(folder).toString('base64url')}.json`);
const b64 = (value: unknown, length?: number) => typeof value === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value) && (length === undefined || Buffer.from(value, 'base64').length === length);
function readRecord(directory: string, folder: string): PinRecord | Tombstone | null {
  const path = recordPath(directory, folder);
  if (!existsSync(path)) return null;
  let value: any;
  try { value = JSON.parse(readPrivateFile(path, 4096, 'PIN_RECORD_INVALID').toString('utf8')); } catch { value = null; }
  const ok = value && value.version === 1 && typeof value.vaultId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value.vaultId) && (value.disabled === 'too-many-tries'
    ? typeof value.at === 'string'
    : typeof value.binding === 'string' && ['keychain', 'file'].includes(value.deviceBound) && value.kdf?.name === 'scrypt' && value.kdf.N === KDF.N && value.kdf.r === KDF.r && value.kdf.p === KDF.p
      && b64(value.salt, 32) && b64(value.iv, 12) && b64(value.tag, 16) && b64(value.wrapped, 32) && Number.isSafeInteger(value.failures) && value.failures >= 0 && value.failures < PIN_LIMIT
      && (value.waitUntil === null || Number.isFinite(Date.parse(value.waitUntil))) && typeof value.createdAt === 'string');
  check(ok, 'PIN_RECORD_INVALID', 'The quick unlock record is damaged. Unlock with your passphrase and set the PIN again.');
  return value;
}
function writeRecord(directory: string, folder: string, record: PinRecord | Tombstone): void {
  const path = recordPath(directory, folder); privateDirectory(dirname(path), 'PIN_RECORD_INVALID'); writePrivateFile(path, JSON.stringify(record));
}
export function removePinRecord(directory: string, folder: string): boolean {
  if (typeof folder !== 'string' || !FOLDER.test(folder)) return false;
  const path = recordPath(directory, folder), had = existsSync(path); rmSync(path, { force: true }); return had;
}
function scrypt(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((accept, reject) => scryptCallback(pin, salt, 32, KDF, (error, key) => error ? reject(error) : accept(key)));
}
async function wrappingKey(pin: string, salt: Buffer, device: Buffer, vaultId: string): Promise<Buffer> {
  const stretched = await scrypt(pin, salt);
  try { return Buffer.from(hkdfSync('sha256', stretched, device, Buffer.from(`chausar.pin.v1:${vaultId}`), 32)); } finally { stretched.fill(0); }
}
const aad = (vaultId: string, folder: string) => Buffer.from(`chausar.pin.v1|${vaultId}|${folder}`);

/** The open vault's folder: a direct child of the app directory, or a refusal. */
export async function openVaultFolder(directory: string, vault: Vault): Promise<string> {
  const root = await safeDirectory(resolve(directory)), folder = basename(vault.directory);
  check(dirname(vault.directory) === root && FOLDER.test(folder), 'PIN_FOLDER_UNSUPPORTED', 'Quick unlock works only for a workspace kept in this app\'s own folder.');
  return folder;
}

/** Wrap the open vault's key under the PIN, after the passphrase verifies. False when the passphrase is wrong. */
export async function enrolPin(input: { directory: string; folder: string; pin: string; passphrase: string; vault: Vault; allowFile?: boolean }): Promise<boolean> {
  const pin = checkPinRule(input.pin), folder = checkPinFolder(input.folder), vault = input.vault;
  if (typeof input.passphrase !== 'string' || input.passphrase.length < 1 || input.passphrase.length > 1024) return false;
  const vaultId = vault.vaultId, binding = vault.passphraseBinding();
  return vault.registerKeyWithPassphrase(input.passphrase, {
    store: async (id, key) => {
      check(id === vaultId && key.byteLength === 32, 'PIN_RECORD_INVALID', 'The workspace changed while quick unlock was being set.');
      const secrets = new SecretStore(input.directory);
      let device = await secrets.get(DEVICE_SECRET);
      if (!device || device.length !== 32) { device?.fill(0); device = randomBytes(32); await secrets.set(DEVICE_SECRET, device); }
      // The device secret must really be held by the keychain, unless the trusted host allowed the weaker file store.
      if (!input.allowFile && secretsBacking(input.directory) !== 'keychain') { device.fill(0); check(false, 'PIN_NEEDS_KEYCHAIN', 'Quick unlock needs this computer\u2019s keychain. Use your passphrase.'); }
      const salt = randomBytes(32), iv = randomBytes(12);
      let wrap: Buffer | undefined;
      try {
        wrap = await wrappingKey(pin, salt, device, vaultId);
        const cipher = createCipheriv('aes-256-gcm', wrap, iv); cipher.setAAD(aad(vaultId, folder));
        const wrapped = Buffer.concat([cipher.update(key), cipher.final()]);
        writeRecord(input.directory, folder, { version: 1, vaultId, binding, deviceBound: secretsBacking(input.directory), kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p },
          salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), wrapped: wrapped.toString('base64'),
          failures: 0, waitUntil: null, createdAt: new Date().toISOString() });
        wrapped.fill(0);
      } finally { device.fill(0); wrap?.fill(0); }
    },
    remove: async () => {},
  });
}

/**
 * Native-custody shape for one PIN attempt. `retrieve` unwraps once (counting a wrong PIN before answering); `store`
 * delegates to the native keychain if any; `remove` (vault deletion) deletes the PIN record and delegates.
 */
class PinCustody implements VaultKeychainProvider {
  readonly #directory: string; readonly #folder: string; readonly #native?: KeychainHook;
  #pin: string; #device: Buffer | undefined;
  constructor(directory: string, folder: string, pin: string, device: Buffer, native?: KeychainHook) {
    this.#directory = directory; this.#folder = folder; this.#pin = pin; this.#device = device; this.#native = native;
    // An open that fails before asking still drops the PIN and device secret soon.
    setTimeout(() => { this.#pin = ''; this.#device?.fill(0); this.#device = undefined; }, 60_000).unref();
  }
  async retrieve(vaultId: string): Promise<Uint8Array | null> {
    const pin = this.#pin, device = this.#device; this.#pin = ''; this.#device = undefined; // one attempt per unlock
    try {
      if (!pin || !device) return null;
      const record = readRecord(this.#directory, this.#folder);
      if (!record || 'disabled' in record || record.vaultId !== vaultId || (record.waitUntil && Date.parse(record.waitUntil) > Date.now())) return null;
      const failures = record.failures + 1;
      writeRecord(this.#directory, this.#folder, { ...record, failures }); // counted before the answer
      let key: Buffer | null = null, wrap: Buffer | undefined;
      try {
        wrap = await wrappingKey(pin, Buffer.from(record.salt, 'base64'), device, vaultId);
        const decipher = createDecipheriv('aes-256-gcm', wrap, Buffer.from(record.iv, 'base64')); decipher.setAAD(aad(vaultId, this.#folder)); decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
        key = Buffer.concat([decipher.update(Buffer.from(record.wrapped, 'base64')), decipher.final()]);
      } catch { key = null; } finally { wrap?.fill(0); }
      if (key) { // the Vault clears it
        try { writeRecord(this.#directory, this.#folder, { ...record, failures: 0, waitUntil: null }); } catch (error) { key.fill(0); throw error; }
        return key;
      }
      if (failures >= PIN_LIMIT) writeRecord(this.#directory, this.#folder, { version: 1, vaultId, disabled: 'too-many-tries', at: new Date().toISOString() });
      else writeRecord(this.#directory, this.#folder, { ...record, failures,
        waitUntil: failures >= WAIT_AFTER ? new Date(Date.now() + WAIT_MS * 2 ** (failures - WAIT_AFTER)).toISOString() : null });
      return null;
    } finally { device?.fill(0); }
  }
  async store(vaultId: string, key: Uint8Array): Promise<void> { await this.#native?.store(vaultId, key); }
  async remove(vaultId: string): Promise<void> { removePinRecord(this.#directory, this.#folder); await this.#native?.remove(vaultId); }
}

/**
 * Engine use only, before `Vault.openWithKeychain`: refuse a missing, disabled or waiting PIN with a typed code, read the
 * device secret, and hand back single-use custody. A wrong PIN then fails as the vault's generic UNLOCK_FAILED.
 */
export async function pinUnlockCustody(input: { directory: string; folder: unknown; pin: unknown; keychain?: KeychainHook }): Promise<VaultKeychainProvider> {
  const folder = checkPinFolder(input.folder);
  check(typeof input.pin === 'string' && DIGITS.test(input.pin), 'PIN_INVALID', 'Use a PIN of 6 to 12 digits.');
  const record = readRecord(input.directory, folder);
  check(record, 'PIN_NOT_SET', 'Quick unlock is not set on this computer. Use your passphrase.');
  check(!('disabled' in record), 'PIN_DISABLED', 'Too many wrong PINs. Use your passphrase.');
  check(!record.waitUntil || Date.parse(record.waitUntil) <= Date.now(), 'PIN_WAIT', 'Too many tries. Wait, then try again.');
  const device = await readSecretBeforeUnlock(input.directory, DEVICE_SECRET, input.keychain);
  if (!device || device.length !== 32) { device?.fill(0); removePinRecord(input.directory, folder); check(false, 'PIN_NOT_SET', 'Quick unlock is not set on this computer. Use your passphrase.'); }
  return new PinCustody(resolve(input.directory), folder, input.pin, device!, input.keychain);
}

/** The public face of a PIN record. Reveals nothing else. `currentVaultId` undefined means "cannot tell". */
export function pinStatus(directory: string, folder: string, currentVaultId?: string | null): PinStatus {
  const off = { enabled: false, failuresLeft: null, waitUntil: null, disabledReason: null, deviceBound: secretsBacking(directory) } as PinStatus;
  let record: PinRecord | Tombstone | null;
  try { record = readRecord(directory, checkPinFolder(folder)); } catch (error) { if ((error as any)?.code === 'PIN_RECORD_INVALID') return off; throw error; }
  const vaultId = currentVaultId === undefined ? peekVaultId(directory, folder) : currentVaultId;
  if (!record || (vaultId !== undefined && record.vaultId !== vaultId)) return off;
  if ('disabled' in record) return { ...off, failuresLeft: 0, disabledReason: 'too-many-tries' };
  const wait = record.waitUntil && Date.parse(record.waitUntil) > Date.now() ? record.waitUntil : null;
  return { enabled: true, failuresLeft: PIN_LIMIT - record.failures, waitUntil: wait, disabledReason: null, deviceBound: record.deviceBound };
}
/** The vault id from the public head of a file-stored envelope, without decrypting anything; undefined when it cannot tell. */
function peekVaultId(directory: string, folder: string): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(join(resolve(directory), folder, 'authority.encrypted.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const head = Buffer.alloc(256), n = readSync(fd, head, 0, head.length, 0);
    return /^\{"format":"chausar\.vault\.v1","id":"([a-zA-Z0-9_-]{1,100})"/.exec(head.subarray(0, n).toString('utf8'))?.[1];
  } catch { return undefined; } finally { if (fd !== undefined) closeSync(fd); }
}

const attached = new Map<string, { folder: string; vaultId: string; authority: string | null }>();
/** After a vault attaches: drop a record for another vault, or one made before the passphrase changed (recovery). */
export async function pinVaultAttached(directory: string, vault: Vault): Promise<void> {
  const root = resolve(directory); attached.delete(root);
  let folder: string; try { folder = await openVaultFolder(directory, vault); } catch { return; }
  attached.set(root, { folder, vaultId: vault.vaultId, authority: vault.storageKind === 'experimental-file' ? join(vault.directory, 'authority.encrypted.json') : null });
  let record: PinRecord | Tombstone | null;
  try { record = readRecord(directory, folder); } catch { removePinRecord(directory, folder); return; }
  if (record && (record.vaultId !== vault.vaultId || (!('disabled' in record) && record.binding !== vault.passphraseBinding()))) removePinRecord(directory, folder);
}
/** After the vault closes: a deleted vault takes its PIN record with it. */
export function pinVaultClosed(directory: string): void {
  const root = resolve(directory), seen = attached.get(root); attached.delete(root);
  if (!seen?.authority || existsSync(seen.authority)) return;
  try { if (readRecord(directory, seen.folder)?.vaultId === seen.vaultId) removePinRecord(directory, seen.folder); } catch { removePinRecord(directory, seen.folder); }
}
