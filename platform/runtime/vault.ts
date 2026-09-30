import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, mkdir, lstat, realpath, rename, unlink, link } from 'node:fs/promises';
import { dirname, basename, isAbsolute, parse, resolve, join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ChausarError, initialState, type State, type StateStore } from './contracts.ts';
import { acquireProcessLock, type ProcessLock } from './process-lock.ts';

const FORMAT = 'chausar.vault.v1';
const MAX_BYTES = 64 * 1024 * 1024;
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
type Ciphertext = { nonce: string; tag: string; data: string };
type KeyWrapper = { salt: string; kdf: 'scrypt-32768-8-1'; ciphertext: Ciphertext };
export type VaultEnvelope = { format: typeof FORMAT; id: string; revision: number; passphrase: KeyWrapper; recovery: KeyWrapper; snapshot: Ciphertext };
/** This interface receives ciphertext only. It must atomically compare the stored revision. */
export interface EncryptedSnapshotAdapter {
  kind: 'postgres' | 'experimental-file';
  load(): Promise<VaultEnvelope | null>;
  commit(envelope: VaultEnvelope, expectedRevision: number | null): Promise<void>;
  delete(): Promise<void>;
  close?(): Promise<void>;
}
/** Only trusted engine code supplies a hook. No OS keychain is assumed or certified. */
export interface KeychainHook {
  store(vaultId: string, key: Uint8Array): Promise<void>;
  remove(vaultId: string): Promise<void>;
}
type Storage = 'experimental-file' | EncryptedSnapshotAdapter;
type Common = { directory: string; storage: Storage; keychain?: KeychainHook };
export type CreateVaultOptions = Common & { passphrase: string; name: string; demo?: boolean };
export type OpenVaultOptions = Common & { passphrase: string };
export type RecoverVaultOptions = Common & { recoveryCode: string; newPassphrase: string };
export type RestoreVaultOptions = Common & { backupFile: string } & ({ passphrase: string } | { recoveryCode: string; newPassphrase: string });

function fail(code: string, message: string): never { throw new ChausarError(code, message); }
function passphrase(value: string) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 1024) fail('WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
}
function from64(value: string, length?: number): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid ciphertext encoding');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (length !== undefined && bytes.length !== length)) throw new Error('Invalid ciphertext size');
  return bytes;
}
function seal(key: Uint8Array, plaintext: Uint8Array, aad: string): Ciphertext {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64url');
  return { nonce: nonce.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data };
}
function unseal(key: Uint8Array, data: Ciphertext, aad: string): Buffer {
  const cipher = createDecipheriv('aes-256-gcm', key, from64(data.nonce, 12));
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(from64(data.tag, 16));
  return Buffer.concat([cipher.update(from64(data.data)), cipher.final()]);
}
async function derive(secret: string, salt: string): Promise<Buffer> {
  return new Promise((accept, reject) => scrypt(secret, from64(salt, 16), 32, KDF, (error, key) => error ? reject(error) : accept(key)));
}
async function wrap(secret: string, key: Uint8Array, id: string, purpose: string): Promise<KeyWrapper> {
  const salt = randomBytes(16).toString('base64url');
  const wrapping = await derive(secret, salt);
  try { return { salt, kdf: 'scrypt-32768-8-1', ciphertext: seal(wrapping, key, `${FORMAT}:${id}:${purpose}`) }; }
  finally { wrapping.fill(0); }
}
async function unwrap(secret: string, wrapper: KeyWrapper, id: string, purpose: string): Promise<Buffer> {
  if (typeof secret !== 'string' || !secret.length || secret.length > 1024) throw new Error('Invalid credential');
  if (wrapper?.kdf !== 'scrypt-32768-8-1') throw new Error('Unsupported key derivation');
  const wrapping = await derive(secret, wrapper.salt);
  try { const key = unseal(wrapping, wrapper.ciphertext, `${FORMAT}:${id}:${purpose}`); if (key.length !== 32) throw new Error('Invalid key'); return key; }
  finally { wrapping.fill(0); }
}
function aad(envelope: Omit<VaultEnvelope, 'snapshot'>): string {
  return JSON.stringify({ format: envelope.format, id: envelope.id, revision: envelope.revision, passphrase: envelope.passphrase, recovery: envelope.recovery });
}
function validateEnvelope(value: any): asserts value is VaultEnvelope {
  if (!value || value.format !== FORMAT || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.passphrase || !value.recovery || !value.snapshot) throw new Error('Invalid envelope');
}
function validateState(value: any): asserts value is State {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.workspace?.id !== 'string' || typeof value.workspace?.name !== 'string' || !Array.isArray(value.members) || !value.policy) throw new Error('Invalid authority snapshot');
  for (const name of ['facts','imports','receipts','answers','decisions','actions','jobs','learning','plugins','modelReceipts','activity','conflicts','merges','tombstones','conversations','routes','sessions','unsupported','schedules','sourceRules']) if (!Array.isArray(value[name])) throw new Error('Invalid authority collection');
}
function encodeSnapshot(state: State, envelope: Omit<VaultEnvelope, 'snapshot'>, key: Uint8Array): VaultEnvelope {
  validateState(state);
  const plaintext = Buffer.from(JSON.stringify(state));
  if (plaintext.length > MAX_BYTES / 2) fail('VAULT_TOO_LARGE', 'The workspace exceeds the snapshot storage limit.');
  try { return { ...envelope, snapshot: seal(key, plaintext, aad(envelope)) }; }
  finally { plaintext.fill(0); }
}
function decodeSnapshot(envelope: VaultEnvelope, key: Uint8Array): State {
  validateEnvelope(envelope);
  const plaintext = unseal(key, envelope.snapshot, aad(envelope));
  try { const state = JSON.parse(plaintext.toString('utf8')); validateState(state); if (state.revision !== envelope.revision) throw new Error('Revision mismatch'); return state; }
  finally { plaintext.fill(0); }
}

async function existingRegular(path: string): Promise<boolean> {
  try { const s = await lstat(path); if (!s.isFile() || s.isSymbolicLink()) fail('UNSAFE_PATH', 'Expected a regular file without symbolic links.'); return true; }
  catch (error: any) { if (error.code === 'ENOENT') return false; throw error; }
}
/** Reject roots, relative paths, and symbolic links at every existing directory component. */
export async function safeDirectory(path: string, create = false): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) === parse(resolve(path)).root) fail('UNSAFE_PATH', 'Choose an explicit non-root absolute directory.');
  const target = resolve(path), root = parse(target).root;
  let current = root;
  for (const component of target.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, component);
    try { const s = await lstat(current); if (s.isSymbolicLink() || !s.isDirectory()) fail('UNSAFE_PATH', 'Vault paths cannot traverse symbolic links or files.'); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; if (!create) throw error; await mkdir(current, { mode: 0o700 }); }
  }
  return realpath(target);
}
async function syncDirectory(path: string) {
  let handle;
  try { handle = await open(path, constants.O_RDONLY); await handle.sync(); }
  catch (error: any) { if (process.platform !== 'win32' || !['EISDIR','EPERM','EACCES','EINVAL','EBADF'].includes(error.code)) throw error; }
  finally { await handle?.close(); }
}
async function atomicWrite(path: string, content: string, replace: boolean) {
  if (!isAbsolute(path)) fail('UNSAFE_PATH', 'Choose an absolute output file.');
  const parent = await safeDirectory(dirname(path));
  const target = join(parent, basename(path));
  if (await existingRegular(target) && !replace) fail('OUTPUT_EXISTS', 'The output file already exists.');
  const temp = join(parent, `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(content, 'utf8'); await handle.sync(); await handle.close();
    if (replace) { await existingRegular(target); await rename(temp, target); }
    else { await link(temp, target); await unlink(temp); }
    await syncDirectory(parent);
  } catch (error) { await handle.close().catch(() => {}); await unlink(temp).catch(() => {}); throw error; }
}
async function readBounded(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Absolute path required');
  await safeDirectory(dirname(path));
  if (!(await existingRegular(path))) throw new Error('Missing file');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { if ((await handle.stat()).size > MAX_BYTES) throw new Error('Oversized envelope'); return await handle.readFile('utf8'); }
  finally { await handle.close(); }
}

/** Explicit experimental/demo adapter. Production callers must select PostgreSQL. */
export class ExperimentalFileSnapshotAdapter implements EncryptedSnapshotAdapter {
  kind = 'experimental-file' as const;
  file: string;
  constructor(directory: string) { this.file = join(directory, 'authority.encrypted.json'); }
  async load(): Promise<VaultEnvelope | null> { if (!(await existingRegular(this.file))) return null; return JSON.parse(await readBounded(this.file)); }
  async commit(envelope: VaultEnvelope, expectedRevision: number | null) {
    const current = await this.load();
    if ((current?.revision ?? null) !== expectedRevision) fail('REVISION_CONFLICT', 'The workspace changed in another writer.');
    await atomicWrite(this.file, JSON.stringify(envelope), expectedRevision !== null);
  }
  async delete() { if (await existingRegular(this.file)) await unlink(this.file); await syncDirectory(dirname(this.file)); }
}
type Lock = ProcessLock;
async function takeLock(directory: string): Promise<Lock> {
  return acquireProcessLock(join(directory,'writer.lock'),{busyCode:'VAULT_BUSY',busyMessage:'This vault is already open, or its writer cannot be verified.',changedCode:'LOCK_CHANGED',changedMessage:'The writer lock changed.'});
}
function adapterFor(directory: string, storage: Storage): EncryptedSnapshotAdapter {
  if (storage === 'experimental-file') return new ExperimentalFileSnapshotAdapter(directory);
  if (!storage || !['postgres','experimental-file'].includes(storage.kind) || typeof storage.commit !== 'function') fail('STORAGE_REQUIRED', 'Select a PostgreSQL storage adapter or explicitly choose experimental-file.');
  return storage;
}
async function closeTransferred(storage: Storage) { if (storage && typeof storage === 'object') await storage.close?.(); }

export class Vault implements StateStore {
  #state: State;
  #key: Buffer;
  #envelope: VaultEnvelope;
  #adapter: EncryptedSnapshotAdapter;
  #lock: Lock;
  #chain: Promise<unknown> = Promise.resolve();
  #closed = false;
  #closing = false;
  #shutdown?: Promise<void>;
  #transaction = new AsyncLocalStorage<boolean>();
  #keychain?: KeychainHook;
  readonly directory: string;
  readonly storageKind: 'postgres' | 'experimental-file';
  private constructor(directory: string, adapter: EncryptedSnapshotAdapter, lock: Lock, key: Buffer, envelope: VaultEnvelope, state: State, keychain?: KeychainHook) {
    this.directory = directory; this.storageKind = adapter.kind; this.#adapter = adapter; this.#lock = lock; this.#key = key; this.#envelope = envelope; this.#state = state; this.#keychain = keychain;
  }
  static async create(options: CreateVaultOptions): Promise<{ vault: Vault; recoveryCode: string }> {
    let directory: string, adapter: EncryptedSnapshotAdapter, lock: Lock;
    try {
      passphrase(options.passphrase);
      if (typeof options.name !== 'string' || !options.name.trim() || options.name.length > 200) fail('INVALID_NAME', 'Choose a workspace name.');
      directory = await safeDirectory(options.directory, true); adapter = adapterFor(directory, options.storage); lock = await takeLock(directory);
    } catch (error) { await closeTransferred(options.storage); throw error; }
    let key: Buffer | undefined, committed = false, id: string | undefined;
    try {
      if (await adapter.load()) fail('VAULT_EXISTS', 'A vault already exists in this location.');
      key = randomBytes(32);
      id = randomUUID(); const recoveryCode = `CHR-${randomBytes(32).toString('base64url')}`;
      const [primary, recovery] = await Promise.all([wrap(options.passphrase, key, id, 'passphrase'), wrap(recoveryCode, key, id, 'recovery')]);
      const state = initialState(options.name, options.demo ?? false);
      const envelope = encodeSnapshot(state, { format: FORMAT, id, revision: 0, passphrase: primary, recovery }, key);
      await adapter.commit(envelope, null);
      committed = true;
      if (options.keychain) await options.keychain.store(id, Uint8Array.from(key));
      return { vault: new Vault(directory, adapter, lock, key, envelope, state, options.keychain), recoveryCode };
    } catch (error) {
      key?.fill(0);
      try { if (committed) await adapter.delete(); }
      finally {
        if (id) await options.keychain?.remove(id).catch(() => {});
        try { await lock.release(); } finally { await adapter.close?.(); }
      }
      throw error;
    }
  }
  static async open(options: OpenVaultOptions): Promise<Vault> { return Vault.unlock(options, options.passphrase, false); }
  static async recover(options: RecoverVaultOptions): Promise<Vault> {
    try { passphrase(options.newPassphrase); } catch (error) { await closeTransferred(options.storage); throw error; }
    const vault = await Vault.unlock(options, options.recoveryCode, true);
    try {
      const wrapper = await wrap(options.newPassphrase, vault.#key, vault.#envelope.id, 'passphrase');
      const draft = structuredClone(vault.#state); draft.revision++;
      const envelope = encodeSnapshot(draft, { ...vault.#envelope, passphrase: wrapper, revision: draft.revision }, vault.#key);
      await vault.#adapter.commit(envelope, vault.#state.revision);
      vault.#state = draft; vault.#envelope = envelope;
      return vault;
    } catch (error) { await vault.close(); throw error; }
  }
  private static async unlock(options: Common, secret: string, recovery: boolean): Promise<Vault> {
    let directory: string, adapter: EncryptedSnapshotAdapter;
    try { directory = await safeDirectory(options.directory); adapter = adapterFor(directory, options.storage); }
    catch { await closeTransferred(options.storage); return fail('UNLOCK_FAILED', 'Unable to unlock vault. Check your credential or restore a valid backup.'); }
    let lock: Lock;
    try { lock = await takeLock(directory); } catch (error) { await adapter.close?.(); throw error; }
    let key: Buffer | undefined;
    try {
      const envelope = await adapter.load(); validateEnvelope(envelope);
      key = await unwrap(secret, recovery ? envelope.recovery : envelope.passphrase, envelope.id, recovery ? 'recovery' : 'passphrase');
      const state = decodeSnapshot(envelope, key);
      return new Vault(directory, adapter, lock, key, envelope, state, options.keychain);
    } catch { key?.fill(0); await lock.release(); await adapter.close?.(); return fail('UNLOCK_FAILED', 'Unable to unlock vault. Check your credential or restore a valid backup.'); }
  }
  static async restore(options: RestoreVaultOptions): Promise<Vault> {
    let envelope: VaultEnvelope, state: State, key: Buffer | undefined;
    try {
      const backup = JSON.parse(await readBounded(options.backupFile));
      if (backup.backupFormat !== 'chausar.backup.v1') throw new Error('Invalid backup');
      envelope = backup.envelope; validateEnvelope(envelope);
      const recovering = 'recoveryCode' in options;
      key = await unwrap(recovering ? options.recoveryCode : options.passphrase, recovering ? envelope.recovery : envelope.passphrase, envelope.id, recovering ? 'recovery' : 'passphrase');
      state = decodeSnapshot(envelope, key);
      if (recovering) {
        passphrase(options.newPassphrase);
        const wrapper = await wrap(options.newPassphrase, key, envelope.id, 'passphrase');
        state.revision++;
        envelope = encodeSnapshot(state, { ...envelope, passphrase: wrapper, revision: state.revision }, key);
      }
    } catch { key?.fill(0); await closeTransferred(options.storage); return fail('UNLOCK_FAILED', 'Unable to unlock backup. Check your credential or use a valid backup.'); }
    let directory: string, adapter: EncryptedSnapshotAdapter, lock: Lock;
    try { directory = await safeDirectory(options.directory, true); adapter = adapterFor(directory, options.storage); lock = await takeLock(directory); }
    catch (error) { key!.fill(0); await closeTransferred(options.storage); throw error; }
    try {
      if (await adapter.load()) fail('VAULT_EXISTS', 'Restore requires an empty vault location.');
      await adapter.commit(envelope, null);
      if (options.keychain) await options.keychain.store(envelope.id, Uint8Array.from(key!));
      return new Vault(directory, adapter, lock, key!, envelope, state, options.keychain);
    } catch (error) { key!.fill(0); await lock.release(); await adapter.close?.(); throw error; }
  }
  #ready() { if (this.#closed || this.#closing) fail('VAULT_CLOSED', 'The vault is closed.'); }
  read(): State { this.#ready(); return structuredClone(this.#state); }
  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return Promise.reject(new ChausarError('REENTRANT_TRANSACTION', 'Nested vault operations are not supported.'));
    this.#ready();
    const pending = this.#chain.then(work); this.#chain = pending.catch(() => {}); return pending;
  }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return Promise.reject(new ChausarError('REENTRANT_TRANSACTION', 'Nested vault transactions are not supported.'));
    return this.#enqueue(() => this.#transaction.run(true, async () => {
      const draft = structuredClone(this.#state), result = await change(draft);
      if (draft.workspace.id !== this.#state.workspace.id) fail('INVALID_STATE', 'A transaction cannot change workspace identity.');
      draft.revision = this.#state.revision + 1;
      const envelope = encodeSnapshot(draft, { ...this.#envelope, revision: draft.revision }, this.#key);
      await this.#adapter.commit(envelope, this.#state.revision);
      this.#state = structuredClone(draft); this.#envelope = envelope;
      return result;
    }));
  }
  backup(target: string): Promise<string> {
    return this.#enqueue(async () => { await atomicWrite(target, JSON.stringify({ backupFormat: 'chausar.backup.v1', envelope: this.#envelope }), false); return target; });
  }
  export(target: string, options: { plaintext?: boolean } = {}): Promise<string> {
    if (!options.plaintext) return this.backup(target);
    return this.#enqueue(async () => { await atomicWrite(target, JSON.stringify(this.#state, null, 2), false); return target; });
  }
  async delete(): Promise<void> {
    if (this.#transaction.getStore()) fail('REENTRANT_TRANSACTION', 'A vault cannot be deleted from inside a transaction.');
    this.#ready(); this.#closing = true;
    this.#shutdown = (async () => {
      await this.#chain;
      try { await this.#adapter.delete(); await this.#keychain?.remove(this.#envelope.id); }
      finally { await this.#finish(); }
    })();
    return this.#shutdown;
  }
  async close(): Promise<void> {
    if (this.#transaction.getStore()) fail('REENTRANT_TRANSACTION', 'A vault cannot be closed from inside a transaction.');
    if (this.#shutdown) return this.#shutdown;
    if (this.#closed) return;
    this.#closing = true;
    this.#shutdown = (async () => { await this.#chain; await this.#finish(); })();
    return this.#shutdown;
  }
  async #finish() {
    this.#key.fill(0); this.#state = undefined as unknown as State; this.#closed = true;
    try { await this.#adapter.close?.(); } finally { await this.#lock.release(); }
  }
}
