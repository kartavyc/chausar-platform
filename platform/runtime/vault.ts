import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, mkdir, lstat, realpath, rename, unlink, link, readdir, rmdir } from 'node:fs/promises';
import { dirname, basename, isAbsolute, parse, resolve, join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ChausarError, hash, initialState, type State, type StateStore } from './contracts.ts';
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
export type PrivateArtifactPurpose = 'private-trial' | 'workspace-interchange';
export type PrivateArtifactRef = { id: string; purpose: PrivateArtifactPurpose; valueDigest: string; diskBytes: number };
type PrivateArtifactEnvelope = { format: 'chausar.private-artifact.v1'; vaultId: string; id: string; purpose: PrivateArtifactPurpose; valueDigest: string; ciphertext: Ciphertext };
function artifactIdentity(id: string, purpose: PrivateArtifactPurpose) {
  if (!['private-trial', 'workspace-interchange'].includes(purpose) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(id)) fail('ARTIFACT_ID_INVALID', 'Use an opaque managed artifact identity.');
}
/** Trusted host admission, held through the actual authority commit. No RPC port. */
export type VaultWriterGuard = <T>(input: { state: State; vaultId: string },
  work: (assertCurrent: () => void) => Promise<{ result: T; committedState: State; rollback?: () => void }>) => Promise<T>;
type Common = { directory: string; storage: Storage; keychain?: KeychainHook; writerGuard?: VaultWriterGuard };
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
  #snapshotScope = new AsyncLocalStorage<boolean>();
  #keychain?: KeychainHook;
  #writerGuard?: VaultWriterGuard;
  readonly directory: string;
  readonly storageKind: 'postgres' | 'experimental-file';
  private constructor(directory: string, adapter: EncryptedSnapshotAdapter, lock: Lock, key: Buffer, envelope: VaultEnvelope, state: State, keychain?: KeychainHook, writerGuard?: VaultWriterGuard) {
    this.directory = directory; this.storageKind = adapter.kind; this.#adapter = adapter; this.#lock = lock; this.#key = key; this.#envelope = envelope; this.#state = state; this.#keychain = keychain; this.#writerGuard = writerGuard;
  }
  /** Public identity metadata only; keys and encrypted wrappers stay private. */
  get vaultId(): string { this.#ready(); return this.#envelope.id; }
  private async guarded<T>(work: (assertCurrent: () => void) => Promise<{ result: T; committedState: State }>): Promise<T> {
    return this.#writerGuard ? this.#writerGuard({ state: structuredClone(this.#state), vaultId: this.#envelope.id }, work) : (await work(() => {})).result;
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
      return { vault: new Vault(directory, adapter, lock, key, envelope, state, options.keychain, options.writerGuard), recoveryCode };
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
      await vault.guarded(async assertCurrent => {
        const draft = structuredClone(vault.#state); draft.revision++;
        const envelope = encodeSnapshot(draft, { ...vault.#envelope, passphrase: wrapper, revision: draft.revision }, vault.#key);
        assertCurrent(); await vault.#adapter.commit(envelope, vault.#state.revision);
        vault.#state = draft; vault.#envelope = envelope;
        return { result: undefined, committedState: vault.read() };
      });
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
      return new Vault(directory, adapter, lock, key, envelope, state, options.keychain, options.writerGuard);
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
      return new Vault(directory, adapter, lock, key!, envelope, state, options.keychain, options.writerGuard);
    } catch (error) { key!.fill(0); await lock.release(); await adapter.close?.(); throw error; }
  }
  #ready() { if (this.#closed || this.#closing) fail('VAULT_CLOSED', 'The vault is closed.'); }
  read(): State { this.#ready(); return structuredClone(this.#state); }
  /** Trusted host snapshot fence. It cannot update the authority or export its key. */
  snapshot<T>(work: (state: State) => Promise<T>): Promise<T> {
    return this.#enqueue(() => this.#transaction.run(true, () => this.#snapshotScope.run(true, () => work(structuredClone(this.#state)))));
  }
  #artifactOperation<T>(work: () => Promise<T>): Promise<T> {
    // Trusted snapshot custody may persist inert artifacts while retaining its authority fence.
    // Authority transactions still refuse nested custody/authority operations.
    return this.#snapshotScope.getStore() ? work() : this.#enqueue(work);
  }
  async #artifactDirectory(purpose: PrivateArtifactPurpose, create = false): Promise<string | null> {
    artifactIdentity('namespace', purpose);
    try { return await safeDirectory(join(this.directory, 'private-artifacts', purpose), create); }
    catch (error: any) { if (!create && error.code === 'ENOENT') return null; throw error; }
  }
  #artifactKey(purpose: PrivateArtifactPurpose, id: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.#key, Buffer.from(this.#envelope.id), Buffer.from(`chausar.private-artifact.v1:${purpose}:${id}`), 32));
  }
  async #readArtifact(input: { id: string; purpose: PrivateArtifactPurpose }): Promise<PrivateArtifactRef & { value: unknown }> {
    artifactIdentity(input.id, input.purpose);
    const directory = await this.#artifactDirectory(input.purpose);
    if (!directory) fail('ARTIFACT_NOT_FOUND', 'The managed artifact is absent.');
    const path = join(directory, `${input.id}.encrypted.json`);
    let raw: string;
    try { raw = await readBounded(path); }
    catch (error: any) { if (error.code === 'ENOENT' || error.message === 'Missing file') fail('ARTIFACT_NOT_FOUND', 'The managed artifact is absent.'); throw error; }
    const key = this.#artifactKey(input.purpose, input.id);
    let plaintext: Buffer | undefined;
    try {
      const envelope: PrivateArtifactEnvelope = JSON.parse(raw);
      if (Object.keys(envelope).sort().join(',') !== 'ciphertext,format,id,purpose,valueDigest,vaultId' || envelope.format !== 'chausar.private-artifact.v1' || envelope.vaultId !== this.#envelope.id || envelope.id !== input.id || envelope.purpose !== input.purpose || !/^[a-f0-9]{64}$/.test(envelope.valueDigest)) throw new Error('Artifact identity mismatch');
      plaintext = unseal(key, envelope.ciphertext, `${envelope.format}:${envelope.vaultId}:${envelope.purpose}:${envelope.id}:${envelope.valueDigest}`);
      const value = JSON.parse(plaintext.toString('utf8'));
      if (hash(JSON.stringify(value)) !== envelope.valueDigest) throw new Error('Artifact payload mismatch');
      return { ...input, valueDigest: envelope.valueDigest, diskBytes: Buffer.byteLength(raw), value };
    } catch { return fail('ARTIFACT_AUTHENTICATION_FAILED', 'The managed artifact is not authentic for this workspace and purpose.'); }
    finally { key.fill(0); plaintext?.fill(0); }
  }
  /** Host-only encrypted custody. This API is never an RPC or renderer key port. */
  readArtifact(input: { id: string; purpose: PrivateArtifactPurpose }): Promise<PrivateArtifactRef & { value: unknown }> {
    return this.#artifactOperation(() => this.#readArtifact(input));
  }
  writeArtifact(input: { id: string; purpose: PrivateArtifactPurpose; value: unknown; expectedDigest: string | null }): Promise<PrivateArtifactRef> {
    artifactIdentity(input.id, input.purpose);
    if (!(input.expectedDigest === null || /^[a-f0-9]{64}$/.test(input.expectedDigest))) fail('ARTIFACT_REVISION_REQUIRED', 'Supply the exact previous artifact digest or create-only admission.');
    const text = JSON.stringify(input.value);
    if (typeof text !== 'string' || Buffer.byteLength(text) > 40 * 1024 * 1024) fail('ARTIFACT_LIMIT', 'Managed artifact payload exceeds its bounded size.');
    const value = JSON.parse(text), valueDigest = hash(JSON.stringify(value));
    return this.#artifactOperation(() => this.guarded(async assertCurrent => {
      const directory = await this.#artifactDirectory(input.purpose, true);
      const path = join(directory!, `${input.id}.encrypted.json`);
      const exists = await existingRegular(path);
      const prior = exists ? await this.#readArtifact(input) : null;
      if ((prior?.valueDigest ?? null) !== input.expectedDigest) fail('ARTIFACT_REVISION_CONFLICT', 'The managed artifact changed or already exists.');
      const key = this.#artifactKey(input.purpose, input.id);
      const plaintext = Buffer.from(text);
      let raw: string;
      try {
        const format = 'chausar.private-artifact.v1' as const, vaultId = this.#envelope.id;
        const ciphertext = seal(key, plaintext, `${format}:${vaultId}:${input.purpose}:${input.id}:${valueDigest}`);
        raw = JSON.stringify({ format, vaultId, id: input.id, purpose: input.purpose, valueDigest, ciphertext });
      } finally { key.fill(0); plaintext.fill(0); }
      if (Buffer.byteLength(raw!) > MAX_BYTES) fail('ARTIFACT_LIMIT', 'Encrypted artifact exceeds its bounded size.');
      assertCurrent(); await atomicWrite(path, raw!, exists);
      return { result: { id: input.id, purpose: input.purpose, valueDigest, diskBytes: Buffer.byteLength(raw!) }, committedState: structuredClone(this.#state) };
    }));
  }
  listArtifacts(input: { purpose: PrivateArtifactPurpose }): Promise<PrivateArtifactRef[]> {
    return this.#artifactOperation(async () => {
      const directory = await this.#artifactDirectory(input.purpose);
      if (!directory) return [];
      const names = (await readdir(directory)).sort();
      if (names.length > 4096) fail('ARTIFACT_LIMIT', 'Managed artifact inventory exceeds its bound.');
      const result: PrivateArtifactRef[] = [];
      for (const name of names) {
        if (!/^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name)) fail('ARTIFACT_INVENTORY_INCOMPLETE', 'Unclassified entries prevent complete managed custody.');
        const { value: ignored, ...ref } = await this.#readArtifact({ id: name.slice(0, -15), purpose: input.purpose });
        result.push(ref);
      }
      return result;
    });
  }
  removeArtifact(input: { id: string; purpose: PrivateArtifactPurpose; expectedDigest: string }): Promise<{ removed: boolean; diskBytes: number }> {
    artifactIdentity(input.id, input.purpose);
    if (!/^[a-f0-9]{64}$/.test(input.expectedDigest)) fail('ARTIFACT_REVISION_REQUIRED', 'Supply the exact retained artifact digest before discard.');
    return this.#artifactOperation(() => this.guarded<{ removed: boolean; diskBytes: number }>(async assertCurrent => {
      let ref: PrivateArtifactRef;
      try { ref = await this.#readArtifact(input); }
      catch (error: any) { if (error.code === 'ARTIFACT_NOT_FOUND') return { result: { removed: false, diskBytes: 0 }, committedState: structuredClone(this.#state) }; throw error; }
      if (ref.valueDigest !== input.expectedDigest) fail('ARTIFACT_REVISION_CONFLICT', 'The managed artifact changed before discard.');
      const directory = await this.#artifactDirectory(input.purpose);
      assertCurrent(); await unlink(join(directory!, `${input.id}.encrypted.json`)); await syncDirectory(directory!);
      return { result: { removed: true, diskBytes: ref.diskBytes }, committedState: structuredClone(this.#state) };
    }));
  }
  /** Purge whole-workspace artifact copies when the owning retention/delete flow revokes them. */
  purgeArtifacts(): Promise<string[]> {
    return this.#artifactOperation(() => this.guarded(async assertCurrent => {
      const files: { purpose: PrivateArtifactPurpose; directory: string; name: string }[] = [];
      for (const purpose of ['private-trial', 'workspace-interchange'] as const) {
        const directory = await this.#artifactDirectory(purpose); if (!directory) continue;
        const names = await readdir(directory);
        if (names.length > 4096) fail('ARTIFACT_LIMIT', 'Managed artifact inventory exceeds its bound.');
        for (const name of names) {
          if (!/^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name)) fail('ARTIFACT_INVENTORY_INCOMPLETE', 'Unclassified entries prevent managed copy cleanup.');
          await this.#readArtifact({ id: name.slice(0, -15), purpose }); files.push({ purpose, directory, name });
        }
      }
      for (const file of files) { assertCurrent(); await unlink(join(file.directory, file.name)); }
      for (const directory of new Set(files.map(file => file.directory))) await syncDirectory(directory);
      return { result: files.map(file => `private-artifacts/${file.purpose}/${file.name}`), committedState: structuredClone(this.#state) };
    }));
  }
  async #assertSnapshotOnlyBackup() {
    for (const purpose of ['private-trial', 'workspace-interchange'] as const) {
      const directory = await this.#artifactDirectory(purpose);
      if (directory && (await readdir(directory)).length) fail('ARTIFACT_BACKUP_REQUIRED', 'Snapshot-only backup cannot omit managed private artifacts. Complete archive backup remains required.');
    }
  }
  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return Promise.reject(new ChausarError('REENTRANT_TRANSACTION', 'Nested vault operations are not supported.'));
    this.#ready();
    const pending = this.#chain.then(work); this.#chain = pending.catch(() => {}); return pending;
  }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return Promise.reject(new ChausarError('REENTRANT_TRANSACTION', 'Nested vault transactions are not supported.'));
    return this.#enqueue(() => this.#transaction.run(true, () => this.guarded(async assertCurrent => {
      const draft = structuredClone(this.#state), result = await change(draft);
      if (draft.workspace.id !== this.#state.workspace.id) fail('INVALID_STATE', 'A transaction cannot change workspace identity.');
      draft.revision = this.#state.revision + 1;
      const envelope = encodeSnapshot(draft, { ...this.#envelope, revision: draft.revision }, this.#key);
      assertCurrent(); await this.#adapter.commit(envelope, this.#state.revision);
      this.#state = structuredClone(draft); this.#envelope = envelope;
      // close/delete mark the handle closing before draining already accepted updates.
      // The committed authority remains available internally while public reads are shut.
      return { result, committedState: structuredClone(this.#state) };
    })));
  }
  backup(target: string): Promise<string> {
    return this.#enqueue(async () => { await this.#assertSnapshotOnlyBackup(); await atomicWrite(target, JSON.stringify({ backupFormat: 'chausar.backup.v1', envelope: this.#envelope }), false); return target; });
  }
  export(target: string, options: { plaintext?: boolean } = {}): Promise<string> {
    if (!options.plaintext) return this.backup(target);
    return this.#enqueue(async () => { await this.#assertSnapshotOnlyBackup(); await atomicWrite(target, JSON.stringify(this.#state, null, 2), false); return target; });
  }
  async delete(): Promise<void> {
    if (this.#transaction.getStore()) fail('REENTRANT_TRANSACTION', 'A vault cannot be deleted from inside a transaction.');
    this.#ready(); this.#closing = true;
    this.#shutdown = (async () => {
      await this.#chain;
      try { await this.guarded(async assertCurrent => {
        // Only this typed encrypted namespace is managed here; never recursively delete user paths.
        for (const purpose of ['private-trial', 'workspace-interchange'] as const) {
          const directory = await this.#artifactDirectory(purpose);
          if (!directory) continue;
          const names = await readdir(directory);
          for (const name of names) {
            if (!/^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name)) fail('ARTIFACT_INVENTORY_INCOMPLETE', 'Unclassified custody entries require review before deletion.');
            await this.#readArtifact({ id: name.slice(0, -15), purpose });
          }
          for (const name of names) { assertCurrent(); await unlink(join(directory, name)); }
          await rmdir(directory);
        }
        assertCurrent(); await this.#adapter.delete(); await this.#keychain?.remove(this.#envelope.id);
        return { result: undefined, committedState: structuredClone(this.#state) };
      }); }
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
