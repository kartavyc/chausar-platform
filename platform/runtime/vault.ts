import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID, scrypt } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, mkdir, lstat, realpath, rename, unlink, link, readdir, rmdir } from 'node:fs/promises';
import { dirname, basename, isAbsolute, parse, resolve, join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ChausarError, hash, initialState, type State, type StateStore } from './contracts.ts';
import { acquireProcessLock, type ProcessLock } from './process-lock.ts';
import { invoiceRestoreNeedsCustody } from './vault-invoice-custody.ts';
import { mapCustodyFiles } from './custody-file-reads.ts';

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
  /** Trusted deletion scope: admit the complete retained ciphertext and hold
   * native custody through every awaited purge and the authority deletion. */
  withDeletionAdmission?<T>(expected: VaultEnvelope, work: () => Promise<T>): Promise<T>;
  /** Ciphertext-only atomic ownership CAS. Required for PostgreSQL bootstrap;
   * compare the entire original envelope and revision/Vault identity under the
   * same slot transaction. Mismatch preserves the occupant. Never read/delete.
   */
  deleteIfCurrent?(expected: VaultEnvelope): Promise<'deleted' | 'absent' | 'mismatch'>;
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
export type VaultEncryptedCustodyBudgets = { maxEntryBytes: number; maxTotalEntryBytes: number; maxArtifacts: number };
export type VaultEncryptedCustodyCapture = {
  vaultId: string; state: State; authority: Uint8Array;
  artifacts: { ref: PrivateArtifactRef; bytes: Uint8Array }[];
  storageKind: 'experimental-file' | 'postgres';
  authorityKind: 'exact-file-bytes' | 'adapter-issued-envelope'; keychainHookPresent: boolean;
};
type PrivateArtifactEnvelope = { format: 'chausar.private-artifact.v1'; vaultId: string; id: string; purpose: PrivateArtifactPurpose; valueDigest: string; ciphertext: Ciphertext };
function artifactIdentity(id: string, purpose: PrivateArtifactPurpose) {
  if (!['private-trial', 'workspace-interchange'].includes(purpose) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(id)) fail('ARTIFACT_ID_INVALID', 'Use an opaque managed artifact identity.');
}
/** Trusted host admission, held through the actual authority commit. No RPC port. */
export type VaultWriterGuard = <T>(input: { state: State; vaultId: string },
  work: (assertCurrent: () => void) => Promise<{ result: T; committedState: State; rollback?: () => void }>) => Promise<T>;
/** Trusted application cleanup only; the Vault owns storage and private paths. */
export type VaultDeletionCleanup = (input: { privateArtifactPaths: readonly string[]; assertCurrent: () => void }) => Promise<void>;
type Common = { directory: string; storage: Storage; keychain?: KeychainHook; writerGuard?: VaultWriterGuard };
export type CreateVaultOptions = Common & { passphrase: string; name: string; demo?: boolean };
export type VaultBootstrapBudgets = { maxStateBytes: number; maxJsonDepth: number; maxJsonNodes: number; maxRecords: number };
/** Trusted constructor capability only: State must come from validated WorkspaceActivationHost publication. */
export type CreateBootstrapVaultOptions = Common & {
  passphrase: string; state: State; expectedStateDigest: string; expectedWorkspaceId: string; expectedOwnerId: string;
  budgets: VaultBootstrapBudgets;
};
export type OpenVaultOptions = Common & { passphrase: string };
export type RecoverVaultOptions = Common & { recoveryCode: string; newPassphrase: string };
export type VaultRestoreDescriptor = { vaultId: string; workspaceId: string; backupRevision: number };
export type RestoreVaultOptions = Common & {
  backupFile: string;
  /** Trusted host capability only. Runs before publication and invoice recovery;
   * archive/RPC input must never supply this callback or its current custody. */
  prepareRestoredState?: (state: State, descriptor: Readonly<VaultRestoreDescriptor>) => void | Promise<void>;
} & ({ passphrase: string } | { recoveryCode: string; newPassphrase: string });

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
const stateCollections = ['facts', 'imports', 'receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins',
  'modelReceipts', 'activity', 'conflicts', 'merges', 'tombstones', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules', 'sourceRules'] as const;
const inertBootstrapCollections = ['receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts',
  'activity', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules'] as const;
const bootstrapId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
function bootstrapExact(value: unknown, keys: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length
    || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')
    || !Object.values(Object.getOwnPropertyDescriptors(value)).every(item => item.enumerable && 'value' in item))
    fail('BOOTSTRAP_STATE_INVALID', 'Fresh bootstrap requires exact reviewed lossless fields.');
}
/** Bounded lossless JSON in ORIGINAL insertion order, which is part of the activation State hash. */
function bootstrapJson(value: unknown, budget: VaultBootstrapBudgets): string {
  let nodes = 0, bytes = 0; const parts: string[] = [], active = new Set<object>();
  const append = (text: string) => {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > budget.maxStateBytes) fail('BOOTSTRAP_LIMIT', 'Fresh bootstrap exceeds its explicit State byte budget.'); parts.push(text);
  };
  const string = (text: string) => {
    if (Buffer.byteLength(text, 'utf8') > budget.maxStateBytes - bytes) fail('BOOTSTRAP_LIMIT', 'A bootstrap string exceeds its remaining byte budget.');
    append(JSON.stringify(text));
  };
  const visit = (item: unknown, depth: number) => {
    if (++nodes > budget.maxJsonNodes || depth > budget.maxJsonDepth) fail('BOOTSTRAP_LIMIT', 'Fresh bootstrap exceeds its explicit JSON node or depth budget.');
    if (typeof item === 'string') { string(item); return; }
    if (item === null || typeof item === 'boolean') { append(JSON.stringify(item)); return; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0)) fail('BOOTSTRAP_STATE_INVALID', 'Fresh bootstrap numbers must survive JSON without loss.');
      append(JSON.stringify(item)); return;
    }
    if (typeof item !== 'object' || !item || active.has(item)) fail('BOOTSTRAP_STATE_INVALID', 'Fresh bootstrap requires acyclic complete JSON values.');
    active.add(item);
    if (Array.isArray(item)) {
      if (item.length > budget.maxJsonNodes - nodes) fail('BOOTSTRAP_LIMIT', 'A bootstrap array exceeds its remaining node budget.');
      if (Object.getPrototypeOf(item) !== Array.prototype || Reflect.ownKeys(item).length !== item.length + 1 || Object.keys(item).length !== item.length
        || !Object.entries(Object.getOwnPropertyDescriptors(item)).every(([key, field]) => key === 'length' || field.enumerable && 'value' in field))
        fail('BOOTSTRAP_STATE_INVALID', 'Sparse, extended or accessor-backed bootstrap arrays are refused.');
      append('['); item.forEach((child, index) => { if (index) append(','); visit(child, depth + 1); }); append(']');
    } else {
      const keys = Object.keys(item), fields = Object.getOwnPropertyDescriptors(item);
      if (keys.length > budget.maxJsonNodes - nodes) fail('BOOTSTRAP_LIMIT', 'A bootstrap object exceeds its remaining node budget.');
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item)) || Reflect.ownKeys(item).length !== keys.length
        || !Object.values(fields).every(field => field.enumerable && 'value' in field)) fail('BOOTSTRAP_STATE_INVALID', 'Hidden, prototype or accessor-backed bootstrap fields are refused.');
      append('{'); keys.forEach((key, index) => { if (index) append(','); string(key); append(':'); visit(fields[key].value, depth + 1); }); append('}');
    }
    active.delete(item);
  };
  visit(value, 0); return parts.join('');
}
function freshBootstrapState(options: CreateBootstrapVaultOptions): State {
  const budget = options.budgets;
  bootstrapExact(budget, ['maxStateBytes', 'maxJsonDepth', 'maxJsonNodes', 'maxRecords']);
  if (!Object.values(budget).every(value => Number.isSafeInteger(value) && value > 0)
    || budget.maxStateBytes > MAX_BYTES / 2 || budget.maxJsonDepth > 256)
    fail('BOOTSTRAP_LIMIT', 'Supply explicit positive bounded bootstrap byte, JSON and record budgets.');
  if (!bootstrapId(options.expectedWorkspaceId) || !bootstrapId(options.expectedOwnerId)
    || typeof options.expectedStateDigest !== 'string' || !/^[a-f0-9]{64}$/.test(options.expectedStateDigest))
    fail('BOOTSTRAP_PIN_REQUIRED', 'Use independently reviewed constructor State, workspace and fresh owner pins.');
  const text = bootstrapJson(options.state, budget);
  if (hash(text) !== options.expectedStateDigest) fail('BOOTSTRAP_STATE_CHANGED', 'The exact ordered State differs from its independently reviewed digest.');
  const state = JSON.parse(text) as State;
  bootstrapExact(state, ['schemaVersion', 'revision', 'workspace', 'members', 'policy', 'ontology', ...stateCollections]);
  bootstrapExact(state.workspace, ['id', 'name', 'currency', 'demo', 'createdAt']);
  if (state.schemaVersion !== 1 || state.revision !== 0 || state.workspace.demo !== true || state.workspace.id !== options.expectedWorkspaceId
    || typeof state.workspace.name !== 'string' || !state.workspace.name.trim() || state.workspace.name.length > 200
    || typeof state.workspace.currency !== 'string' || !state.workspace.currency || state.workspace.currency.length > 32 || /[\x00-\x1f]/.test(state.workspace.currency)
    || typeof state.workspace.createdAt !== 'string' || state.workspace.createdAt.length > 64 || !Number.isFinite(Date.parse(state.workspace.createdAt)))
    fail('BOOTSTRAP_STATE_INVALID', 'Fresh bootstrap requires exact synthetic schema-one revision-zero workspace authority.');
  if (!Array.isArray(state.members) || state.members.length !== 1) fail('BOOTSTRAP_OWNER_INVALID', 'Fresh bootstrap requires one independently allocated owner.');
  const owner = state.members[0]; bootstrapExact(owner, ['id', 'name', 'role', 'active', 'epoch', 'branches']);
  if (owner.id !== options.expectedOwnerId || owner.role !== 'owner' || owner.active !== true || !Number.isSafeInteger(owner.epoch) || owner.epoch <= 0
    || typeof owner.name !== 'string' || !owner.name.trim() || owner.name.length > 200 || !Array.isArray(owner.branches)
    || owner.branches.length !== 1 || owner.branches[0] !== '*') fail('BOOTSTRAP_OWNER_INVALID', 'Fresh bootstrap must retain the exact fresh unrestricted active owner pin.');
  bootstrapExact(state.policy, ['send', 'autonomy', 'allowedSources', 'retentionDays', 'sharing']);
  const allowed = state.policy.allowedSources;
  if (state.policy.send !== 'nothing' || state.policy.autonomy !== false || state.policy.sharing !== false
    || !Number.isInteger(state.policy.retentionDays) || state.policy.retentionDays < 1 || state.policy.retentionDays > 3650
    || !Array.isArray(allowed) || !allowed.length || !allowed.every(bootstrapId) || allowed.includes('*') || new Set(allowed).size !== allowed.length)
    fail('BOOTSTRAP_POLICY_INVALID', 'Fresh bootstrap requires no-send, no-autonomy, no-sharing and explicit distinct source grants.');
  let records = 1;
  for (const name of stateCollections) {
    if (!Array.isArray(state[name])) fail('BOOTSTRAP_STATE_INVALID', 'Every fresh bootstrap store must be an explicit JSON array.');
    records += state[name].length;
    if (!Number.isSafeInteger(records) || records > budget.maxRecords) fail('BOOTSTRAP_LIMIT', 'Fresh bootstrap exceeds its explicit complete record budget.');
  }
  if (inertBootstrapCollections.some(name => state[name].length !== 0)) fail('BOOTSTRAP_RUNTIME_AUTHORITY', 'Historical runtime authority collections must be empty in fresh bootstrap.');
  return state;
}
/** Artifact envelopes have only two object levels and string leaves; reject ambiguous duplicate JSON fields. */
function archivedEnvelopeJson(text: string) {
  let offset = 0, fields = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[offset] ?? '\0')) offset++; };
  const string = () => {
    if (text[offset] !== '"') throw new Error('Artifact string required'); const start = offset++;
    while (offset < text.length) { const token = text[offset++]; if (token === '\\') offset++; else if (token === '"') return JSON.parse(text.slice(start, offset)) as string; }
    throw new Error('Incomplete artifact string');
  };
  const object = (depth: number) => {
    if (depth > 1 || text[offset++] !== '{') throw new Error('Artifact object required');
    whitespace(); const keys = new Set<string>();
    if (text[offset] === '}') { offset++; return; }
    while (true) {
      const key = string();
      if (keys.has(key) || ++fields > 9) throw new Error('Duplicate or unbounded artifact fields'); keys.add(key);
      whitespace(); if (text[offset++] !== ':') throw new Error('Artifact field separator required'); whitespace();
      if (text[offset] === '{') object(depth + 1); else string(); whitespace();
      const end = text[offset++]; if (end === '}') return; if (end !== ',') throw new Error('Artifact object separator required'); whitespace();
    }
  };
  try {
    whitespace(); object(0); whitespace(); if (offset !== text.length) throw new Error('Trailing artifact bytes');
    const value = JSON.parse(text);
    if (Object.keys(value).sort().join(',') !== 'ciphertext,format,id,purpose,valueDigest,vaultId'
      || !value.ciphertext || typeof value.ciphertext !== 'object' || Array.isArray(value.ciphertext)
      || Object.keys(value.ciphertext).sort().join(',') !== 'data,nonce,tag') throw new Error('Unreviewed artifact envelope fields');
  } catch { fail('ARTIFACT_AUTHENTICATION_FAILED', 'Archived artifact JSON requires complete unique exact envelope fields.'); }
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
async function readBounded(path: string, exactSize?: number): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Absolute path required');
  path = join(await safeDirectory(dirname(path)), basename(path));
  if (exactSize === undefined && !(await existingRegular(path))) throw new Error('Missing file');
  const before = exactSize === undefined ? undefined : await lstat(path, { bigint: true });
  if (before && (!before.isFile() || before.isSymbolicLink()))
    fail('UNSAFE_PATH', 'Expected a regular file without symbolic links.');
  if (before && before.size !== BigInt(exactSize!))
    fail('ARTIFACT_LIMIT', 'Encrypted artifact changed after capture budget preflight.');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    if (!before) { if ((await handle.stat()).size > MAX_BYTES) throw new Error('Oversized envelope'); return await handle.readFile('utf8'); }
    const unchanged = (stat: typeof before) => stat.dev === before.dev && stat.ino === before.ino
      && stat.birthtimeNs === before.birthtimeNs && stat.size === before.size
      && stat.mtimeNs === before.mtimeNs && stat.ctimeNs === before.ctimeNs;
    if (!unchanged(await handle.stat({ bigint: true }))) fail('ARTIFACT_LIMIT', 'Encrypted artifact changed before bounded capture.');
    const chunks: Buffer[] = []; let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(1024 * 1024, exactSize! + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > exactSize!) fail('ARTIFACT_LIMIT', 'Encrypted artifact grew beyond its reserved capture size.');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    if (size !== exactSize || !unchanged(after) || !unchanged(current) || !current.isFile() || current.isSymbolicLink())
      fail('ARTIFACT_LIMIT', 'Encrypted artifact changed during bounded capture.');
    return Buffer.concat(chunks).toString('utf8');
  }
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
  /** Constructor-only fresh authority from an independently validated activation publication. Never an RPC State input. */
  static async createBootstrap(options: CreateBootstrapVaultOptions): Promise<{ vault: Vault; recoveryCode: string }> {
    const secret = options.passphrase, storage = options.storage, keychain = options.keychain, writerGuard = options.writerGuard;
    let state: State, directory: string, adapter: EncryptedSnapshotAdapter, lock: Lock;
    try {
      passphrase(secret); state = freshBootstrapState(options);
      directory = await safeDirectory(options.directory, true);
      if ((await readdir(directory)).length) fail('BOOTSTRAP_TARGET_NOT_EMPTY', 'Fresh bootstrap requires an explicitly empty target directory.');
      adapter = adapterFor(directory, storage);
      if (adapter.kind === 'postgres' && typeof adapter.deleteIfCurrent !== 'function')
        fail('BOOTSTRAP_STORAGE_CUSTODY_REQUIRED', 'PostgreSQL bootstrap requires atomic exact-owned cleanup custody.');
      lock = await takeLock(directory);
    } catch (error) { await closeTransferred(storage); throw error; }
    let key: Buffer | undefined, committed = false, publicationAttempted = false,
      id: string | undefined, envelope: VaultEnvelope | undefined, publicationCalls = 0;
    try {
      if ((await readdir(directory)).some(name => name !== 'writer.lock') || await adapter.load())
        fail('BOOTSTRAP_TARGET_NOT_EMPTY', 'Fresh bootstrap requires zero target authority and no unrelated entries.');
      key = randomBytes(32); id = randomUUID();
      const recoveryCode = `CHR-${randomBytes(32).toString('base64url')}`;
      const [primary, recovery] = await Promise.all([wrap(secret, key, id, 'passphrase'), wrap(recoveryCode, key, id, 'recovery')]);
      envelope = encodeSnapshot(state, { format: FORMAT, id, revision: 0, passphrase: primary, recovery }, key);
      const publish = async (assertCurrent: () => void) => {
        if (++publicationCalls !== 1 || typeof assertCurrent !== 'function') fail('BOOTSTRAP_GUARD', 'Root must execute one held fresh bootstrap publication.');
        if ((await readdir(directory)).some(name => name !== 'writer.lock')) fail('BOOTSTRAP_TARGET_NOT_EMPTY', 'Fresh target acquired an unrelated entry before publication.');
        const admission = () => { const result: unknown = assertCurrent(); if (result !== undefined) fail('BOOTSTRAP_GUARD', 'Fresh publication admission must assert synchronously without a deferred result.'); };
        admission(); let acknowledgementFailure: unknown;
        publicationAttempted = true;
        try { await adapter.commit(envelope!, null); } catch (error) { acknowledgementFailure = error; }
        const actual = await adapter.load();
        if (!actual || JSON.stringify(actual) !== JSON.stringify(envelope) || hash(decodeSnapshot(actual, key!)) !== hash(state)) {
          if (acknowledgementFailure) throw acknowledgementFailure;
          fail('BOOTSTRAP_READBACK', 'Fresh authority did not read back as the exact independently pinned revision-zero State.');
        }
        committed = true; admission(); return { result: undefined, committedState: structuredClone(state) };
      };
      if (writerGuard) await writerGuard({ state: structuredClone(state), vaultId: id }, publish);
      else await publish(() => {});
      if (!committed || publicationCalls !== 1) fail('BOOTSTRAP_READBACK', 'Root did not publish and read back the exact fresh authority.');
      if (keychain) await keychain.store(id, Uint8Array.from(key));
      return { vault: new Vault(directory, adapter, lock, key, envelope, state, keychain, writerGuard), recoveryCode };
    } catch (error) {
      try {
        if (committed) {
          if (adapter.kind === 'postgres') {
            let outcome: 'deleted' | 'absent' | 'mismatch';
            try { outcome = await adapter.deleteIfCurrent!(structuredClone(envelope!)); }
            catch { return fail('BOOTSTRAP_CLEANUP_REQUIRED', 'Atomic bootstrap cleanup is unresolved; inspect the exact operation without replay or deletion.'); }
            if (outcome !== 'deleted' && outcome !== 'absent')
              fail('BOOTSTRAP_CLEANUP_REQUIRED', 'Bootstrap target ownership changed; retain the occupant for explicit inspection.');
          } else {
            const actual = await adapter.load();
            if (!actual || JSON.stringify(actual) !== JSON.stringify(envelope)) fail('BOOTSTRAP_CLEANUP_REQUIRED', 'Failed bootstrap authority changed and cannot be removed automatically.');
            await adapter.delete();
            if (await adapter.load()) fail('BOOTSTRAP_CLEANUP_REQUIRED', 'Failed bootstrap retains unresolved fresh authority custody.');
          }
        } else if (publicationAttempted && adapter.kind === 'postgres') {
          fail('BOOTSTRAP_COMMIT_UNKNOWN', 'PostgreSQL bootstrap was attempted without exact acknowledged readback. Inspect its target identity; do not retry, adopt or delete it.');
        }
      } finally {
        key?.fill(0);
        if (id) await keychain?.remove(id).catch(() => {});
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
  /** Constructor-only authentication under an already held native custody fence.
   * This decrypts the existing envelope without opening a writer or transferring
   * storage ownership. It never returns the key, changes wrappers or publishes.
   * The root must retain native exclusion through both guard calls and the read.
   */
  static async inspectPostgresSnapshot(options: {
    passphrase: string; loadHeldEnvelope(): Promise<VaultEnvelope | null>; assertHeld(): Promise<void>;
  }): Promise<{ vaultId: string; revision: number; state: State; authorityCiphertextBytes: number }> {
    passphrase(options.passphrase);
    if (typeof options.loadHeldEnvelope !== 'function' || typeof options.assertHeld !== 'function')
      fail('POSTGRES_CUSTODY_REQUIRED', 'Retain actual native custody while authenticating the encrypted snapshot.');
    if (await options.assertHeld() !== undefined) fail('POSTGRES_CUSTODY_REQUIRED', 'Native custody guards must complete.');
    const envelope = await options.loadHeldEnvelope(); validateEnvelope(envelope);
    const encoded = JSON.stringify(envelope);
    if (Buffer.byteLength(encoded) > MAX_BYTES) fail('ARTIFACT_LIMIT', 'Encrypted authority exceeds the snapshot byte budget.');
    let key: Buffer | undefined;
    try {
      key = await unwrap(options.passphrase, envelope.passphrase, envelope.id, 'passphrase');
      const state = decodeSnapshot(envelope, key);
      if (await options.assertHeld() !== undefined) fail('POSTGRES_CUSTODY_REQUIRED', 'Native custody guards must complete.');
      if (JSON.stringify(await options.loadHeldEnvelope()) !== encoded)
        fail('POSTGRES_AUTHORITY_CHANGED', 'Held encrypted authority changed during authentication.');
      return { vaultId: envelope.id, revision: envelope.revision, state,
        authorityCiphertextBytes: Buffer.byteLength(encoded) };
    } finally { key?.fill(0); }
  }
  static async restore(options: RestoreVaultOptions): Promise<Vault> {
    let envelope: VaultEnvelope, state: State, key: Buffer | undefined;
    let descriptor: VaultRestoreDescriptor;
    try {
      const backup = JSON.parse(await readBounded(options.backupFile));
      if (backup.backupFormat !== 'chausar.backup.v1') throw new Error('Invalid backup');
      envelope = backup.envelope; validateEnvelope(envelope);
      const recovering = 'recoveryCode' in options;
      key = await unwrap(recovering ? options.recoveryCode : options.passphrase, recovering ? envelope.recovery : envelope.passphrase, envelope.id, recovering ? 'recovery' : 'passphrase');
      state = decodeSnapshot(envelope, key);
      descriptor = { vaultId: envelope.id, workspaceId: state.workspace.id, backupRevision: state.revision };
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
      if (!options.prepareRestoredState && invoiceRestoreNeedsCustody(state))
        fail('INVOICE_RESTORE_CUSTODY_REQUIRED', 'Invoice restore requires trusted current custody from this workspace and vault.');
      if (options.prepareRestoredState) {
        const draft = structuredClone(state), before = JSON.stringify(draft);
        await options.prepareRestoredState(draft, Object.freeze({ ...descriptor! }));
        validateState(draft);
        if (draft.workspace.id !== state.workspace.id || draft.revision !== state.revision)
          fail('RESTORE_STATE_IDENTITY_CHANGED', 'Restore preparation cannot replace workspace identity or revision.');
        if (JSON.stringify(draft) !== before) {
          draft.revision++;
          envelope = encodeSnapshot(draft, { ...envelope, revision: draft.revision }, key!);
          state = draft;
        }
      }
      await adapter.commit(envelope, null);
      if (options.keychain) await options.keychain.store(envelope.id, Uint8Array.from(key!));
      return new Vault(directory, adapter, lock, key!, envelope, state, options.keychain, options.writerGuard);
    } catch (error) { key!.fill(0); await lock.release(); await adapter.close?.(); throw error; }
  }
  #ready() { if (this.#closed || this.#closing) fail('VAULT_CLOSED', 'The vault is closed.'); }
  read(): State { this.#ready(); return structuredClone(this.#state); }
  /** Fresh identity metadata for trusted custody checks, without cloning State. */
  readIdentity(): Readonly<{ vaultId: string; workspaceId: string; revision: number }> {
    this.#ready();
    return { vaultId: this.#envelope.id, workspaceId: this.#state.workspace.id, revision: this.#state.revision };
  }
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
  async #readArtifactRaw(input: { id: string; purpose: PrivateArtifactPurpose }, exactSize?: number): Promise<PrivateArtifactRef & { value: unknown; bytes: Uint8Array }> {
    artifactIdentity(input.id, input.purpose);
    // readBounded revalidates every parent component immediately before opening.
    const path = join(this.directory, 'private-artifacts', input.purpose, `${input.id}.encrypted.json`);
    let raw: string;
    try { raw = await readBounded(path, exactSize); }
    catch (error: any) { if (error.code === 'ENOENT' || error.message === 'Missing file') fail('ARTIFACT_NOT_FOUND', 'The managed artifact is absent.'); throw error; }
    return this.#authenticateArtifactRaw(raw, input);
  }
  #authenticateArtifactRaw(raw: string, input: { id: string; purpose: PrivateArtifactPurpose }): PrivateArtifactRef & { value: unknown; bytes: Uint8Array } {
    artifactIdentity(input.id, input.purpose);
    const key = this.#artifactKey(input.purpose, input.id);
    let plaintext: Buffer | undefined;
    try {
      const envelope: PrivateArtifactEnvelope = JSON.parse(raw);
      if (Object.keys(envelope).sort().join(',') !== 'ciphertext,format,id,purpose,valueDigest,vaultId' || envelope.format !== 'chausar.private-artifact.v1' || envelope.vaultId !== this.#envelope.id || envelope.id !== input.id || envelope.purpose !== input.purpose || !/^[a-f0-9]{64}$/.test(envelope.valueDigest)) throw new Error('Artifact identity mismatch');
      plaintext = unseal(key, envelope.ciphertext, `${envelope.format}:${envelope.vaultId}:${envelope.purpose}:${envelope.id}:${envelope.valueDigest}`);
      const value = JSON.parse(plaintext.toString('utf8'));
      if (hash(JSON.stringify(value)) !== envelope.valueDigest) throw new Error('Artifact payload mismatch');
      return { ...input, valueDigest: envelope.valueDigest, diskBytes: Buffer.byteLength(raw), value, bytes: Buffer.from(raw, 'utf8') };
    } catch { return fail('ARTIFACT_AUTHENTICATION_FAILED', 'The managed artifact is not authentic for this workspace and purpose.'); }
    finally { key.fill(0); plaintext?.fill(0); }
  }
  async #readArtifact(input: { id: string; purpose: PrivateArtifactPurpose }): Promise<PrivateArtifactRef & { value: unknown }> {
    const { bytes: encryptedBytes, ...result } = await this.#readArtifactRaw(input);
    return result;
  }
  #custodyBudgets(budget: VaultEncryptedCustodyBudgets) {
    if (!budget || Object.keys(budget).sort().join(',') !== 'maxArtifacts,maxEntryBytes,maxTotalEntryBytes'
      || !Object.values(budget).every(value => Number.isSafeInteger(value) && value > 0)
      || budget.maxEntryBytes > MAX_BYTES || budget.maxEntryBytes > budget.maxTotalEntryBytes || budget.maxArtifacts > 8192)
      fail('ARTIFACT_LIMIT', 'Supply explicit bounded encrypted custody byte and artifact budgets.');
    if (!this.#snapshotScope.getStore()) fail('CUSTODY_SNAPSHOT_REQUIRED', 'Hold the trusted Vault snapshot fence before capturing or authenticating encrypted custody.');
    this.#ready();
  }
  /** Root-only writer admission held through inert filesystem custody publication. */
  withCustodyWriterAdmission<T>(work: (assertCurrent: () => void) => Promise<T>): Promise<T> {
    if (!this.#snapshotScope.getStore()) return Promise.reject(new ChausarError('CUSTODY_SNAPSHOT_REQUIRED', 'Hold the trusted Vault snapshot fence for custody writer admission.'));
    this.#ready();
    return this.guarded(async assertCurrent => {
      assertCurrent(); const result = await work(assertCurrent); assertCurrent();
      return { result, committedState: structuredClone(this.#state) };
    });
  }
  /** Trusted host only: exact encrypted evidence, never a key or public RPC port. */
  async captureEncryptedCustody(budget: VaultEncryptedCustodyBudgets): Promise<VaultEncryptedCustodyCapture> {
    this.#custodyBudgets(budget);
    if (this.storageKind === 'experimental-file') {
      const size = (await lstat(join(this.directory, 'authority.encrypted.json'))).size;
      if (size > budget.maxEntryBytes || size > budget.maxTotalEntryBytes)
        fail('ARTIFACT_LIMIT', 'Encrypted authority exceeds its explicit capture budget.');
    }
    const raw = this.storageKind === 'experimental-file'
      ? await readBounded(join(this.directory, 'authority.encrypted.json'))
      : JSON.stringify(await this.#adapter.load());
    const authority = Buffer.from(raw, 'utf8');
    if (authority.byteLength > budget.maxEntryBytes || authority.byteLength > budget.maxTotalEntryBytes)
      fail('ARTIFACT_LIMIT', 'Encrypted authority exceeds its explicit capture budget.');
    const envelope = JSON.parse(raw); validateEnvelope(envelope);
    if (JSON.stringify(envelope) !== JSON.stringify(this.#envelope)
      || hash(decodeSnapshot(envelope, this.#key)) !== hash(this.#state))
      fail('REVISION_CONFLICT', 'Persisted authority differs from the held source snapshot.');
    const entries: { id: string; purpose: PrivateArtifactPurpose; size: number }[] = []; let totalBytes = authority.byteLength;
    const root = join(this.directory, 'private-artifacts');
    try {
      await safeDirectory(root);
      const namespaces = await readdir(root);
      if (namespaces.some(name => !['private-trial', 'workspace-interchange'].includes(name)))
        fail('ARTIFACT_INVENTORY_INCOMPLETE', 'Unclassified private namespaces prevent complete encrypted custody.');
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    for (const purpose of ['private-trial', 'workspace-interchange'] as const) {
      const directory = await this.#artifactDirectory(purpose); if (!directory) continue;
      const names = (await readdir(directory)).sort();
      if (names.length > budget.maxArtifacts - entries.length) fail('ARTIFACT_LIMIT', 'Encrypted artifact count exceeds its explicit capture budget.');
      for (const name of names) {
        if (!/^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name)) fail('ARTIFACT_INVENTORY_INCOMPLETE', 'Unclassified entries prevent complete encrypted custody.');
        const path = join(directory, name), stat = await lstat(path), size = stat.size;
        if (!stat.isFile() || stat.isSymbolicLink()) fail('UNSAFE_PATH', 'Expected a regular file without symbolic links.');
        if (!Number.isSafeInteger(size) || size < 0 || size > budget.maxEntryBytes || size > budget.maxTotalEntryBytes - totalBytes)
          fail('ARTIFACT_LIMIT', 'Encrypted artifact bytes exceed their remaining capture budget.');
        totalBytes += size; entries.push({ id: name.slice(0, -15), purpose, size });
      }
    }
    // Reserve the entire operation before concurrent read-only leaves; every
    // read is capped at its own exact measured size, never a shared remainder.
    const artifacts = await mapCustodyFiles(entries, async ({ id, purpose, size }) => {
      const { value: plaintextValue, bytes, ...ref } = await this.#readArtifactRaw({ id, purpose }, size);
      if (bytes.byteLength !== size) fail('ARTIFACT_LIMIT', 'Encrypted artifact changed after capture preflight.');
      return { ref, bytes };
    });
    return { vaultId: this.#envelope.id, state: structuredClone(this.#state), authority, artifacts,
      storageKind: this.storageKind, authorityKind: this.storageKind === 'experimental-file' ? 'exact-file-bytes' : 'adapter-issued-envelope',
      keychainHookPresent: !!this.#keychain };
  }
  /** Authenticate inert historical ciphertext with the unlocked source; never mount its authority. */
  async authenticateEncryptedCustody(input: { authority: Uint8Array; artifacts: { ref: PrivateArtifactRef; bytes: Uint8Array }[];
    source: { vaultId: string; workspaceId: string; revision: number } }, budget: VaultEncryptedCustodyBudgets): Promise<State> {
    this.#custodyBudgets(budget);
    if (!input || !(input.authority instanceof Uint8Array) || !Array.isArray(input.artifacts)
      || input.artifacts.length > budget.maxArtifacts || input.source?.vaultId !== this.#envelope.id
      || input.source.workspaceId !== this.#state.workspace.id || !Number.isSafeInteger(input.source.revision))
      fail('ARTIFACT_AUTHENTICATION_FAILED', 'Encrypted custody identity or count differs from this unlocked source.');
    let totalBytes = input.authority.byteLength;
    if (!totalBytes || totalBytes > budget.maxEntryBytes || totalBytes > budget.maxTotalEntryBytes)
      fail('ARTIFACT_LIMIT', 'Encrypted authority exceeds its authentication budget.');
    let state: State;
    try {
      const bytes = Buffer.from(input.authority), text = bytes.toString('utf8');
      if (!Buffer.from(text).equals(bytes)) throw new Error('Invalid UTF-8');
      const envelope = JSON.parse(text); validateEnvelope(envelope);
      if (envelope.id !== input.source.vaultId || envelope.revision !== input.source.revision) throw new Error('Source mismatch');
      state = decodeSnapshot(envelope, this.#key);
      if (state.workspace.id !== input.source.workspaceId) throw new Error('Workspace mismatch');
    } catch { return fail('ARTIFACT_AUTHENTICATION_FAILED', 'The retained authority is not authentic for this source.'); }
    const identities = new Set<string>();
    for (const item of input.artifacts) {
      if (!item || !item.ref || !['private-trial', 'workspace-interchange'].includes(item.ref.purpose)
        || typeof item.ref.id !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(item.ref.id)
        || !/^[a-f0-9]{64}$/.test(item.ref.valueDigest) || !Number.isSafeInteger(item.ref.diskBytes) || item.ref.diskBytes <= 0)
        fail('ARTIFACT_AUTHENTICATION_FAILED', 'A retained artifact reference has invalid identity or size.');
      if (!(item.bytes instanceof Uint8Array) || !item.bytes.byteLength || item.bytes.byteLength > budget.maxEntryBytes
        || item.bytes.byteLength > budget.maxTotalEntryBytes - totalBytes) fail('ARTIFACT_LIMIT', 'Encrypted artifacts exceed their authentication budget.');
      const identity = `${item.ref.purpose}:${item.ref.id}`;
      if (identities.has(identity)) fail('ARTIFACT_INVENTORY_INCOMPLETE', 'Duplicate retained artifact identities are refused.'); identities.add(identity);
      const bytes = Buffer.from(item.bytes), text = bytes.toString('utf8');
      if (!Buffer.from(text).equals(bytes)) fail('ARTIFACT_AUTHENTICATION_FAILED', 'Retained artifact UTF-8 bytes differ.');
      const authenticated = this.#authenticateArtifactRaw(text, item.ref);
      if (authenticated.diskBytes !== item.ref.diskBytes || authenticated.valueDigest !== item.ref.valueDigest)
        fail('ARTIFACT_AUTHENTICATION_FAILED', 'Retained ciphertext differs from its independently issued artifact reference.');
      totalBytes += bytes.byteLength;
    }
    return structuredClone(state);
  }
  /** Snapshot-only cryptographic authentication of exact archived bytes, even after their original files are removed. */
  async authenticateArchivedArtifacts(input: { sourceVaultId: string; artifacts: { ref: PrivateArtifactRef; bytes: Uint8Array }[] },
    budget: VaultEncryptedCustodyBudgets): Promise<(PrivateArtifactRef & { value: unknown })[]> {
    this.#custodyBudgets(budget);
    const exact = (value: unknown, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
      && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length
      && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')
      && Object.values(Object.getOwnPropertyDescriptors(value)).every(field => field.enumerable && 'value' in field);
    if (!exact(input, ['sourceVaultId', 'artifacts'])
      || input.sourceVaultId !== this.#envelope.id || !Array.isArray(input.artifacts) || input.artifacts.length === 0)
      fail('ARTIFACT_AUTHENTICATION_FAILED', 'Supply exact archived artifact bytes bound to this unlocked source Vault.');
    if (input.artifacts.length > budget.maxArtifacts) fail('ARTIFACT_LIMIT', 'Archived artifact count exceeds its explicit budget.');
    if (Object.getPrototypeOf(input.artifacts) !== Array.prototype || Object.keys(input.artifacts).length !== input.artifacts.length
      || Reflect.ownKeys(input.artifacts).length !== input.artifacts.length + 1
      || !Object.entries(Object.getOwnPropertyDescriptors(input.artifacts)).every(([key, field]) => key === 'length' || field.enumerable && 'value' in field))
      fail('ARTIFACT_AUTHENTICATION_FAILED', 'Archived artifact entries require a complete ordinary array without hidden or accessor fields.');
    const result: (PrivateArtifactRef & { value: unknown })[] = [], identities = new Set<string>(); let total = 0;
    for (const item of input.artifacts) {
      if (!exact(item, ['ref', 'bytes']) || !exact(item.ref, ['id', 'purpose', 'valueDigest', 'diskBytes'])
        || !['private-trial', 'workspace-interchange'].includes(item.ref.purpose) || typeof item.ref.id !== 'string'
        || !/^[A-Za-z0-9_-]{1,180}$/.test(item.ref.id) || !/^[a-f0-9]{64}$/.test(item.ref.valueDigest)
        || !Number.isSafeInteger(item.ref.diskBytes) || item.ref.diskBytes <= 0)
        fail('ARTIFACT_AUTHENTICATION_FAILED', 'Archived artifact references require exact typed identity, digest and byte fields.');
      const id = `${item.ref.purpose}/${item.ref.id}`.toLowerCase();
      if (identities.has(id)) fail('ARTIFACT_INVENTORY_INCOMPLETE', 'Duplicate or filesystem-case-alias archived artifact identities are refused.'); identities.add(id);
      if (!(item.bytes instanceof Uint8Array) || !item.bytes.byteLength || item.bytes.byteLength > budget.maxEntryBytes
        || item.bytes.byteLength > budget.maxTotalEntryBytes - total) fail('ARTIFACT_LIMIT', 'Archived artifacts exceed their explicit entry or total byte budget.');
      const bytes = Buffer.from(item.bytes), text = bytes.toString('utf8');
      if (!Buffer.from(text, 'utf8').equals(bytes) || bytes.byteLength !== item.ref.diskBytes)
        fail('ARTIFACT_AUTHENTICATION_FAILED', 'Archived artifact UTF-8 bytes or exact disk measurement differ.');
      archivedEnvelopeJson(text);
      const authenticated = this.#authenticateArtifactRaw(text, item.ref);
      if (authenticated.diskBytes !== item.ref.diskBytes || authenticated.valueDigest !== item.ref.valueDigest)
        fail('ARTIFACT_AUTHENTICATION_FAILED', 'Archived ciphertext differs from its independently supplied encrypted reference.');
      const { bytes: encryptedBytes, ...value } = authenticated; result.push(value); total += bytes.byteLength;
    }
    return result;
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
      const { files } = await this.#managedArtifactInventory();
      for (const file of files) { assertCurrent(); await unlink(join(file.directory, file.name)); }
      for (const directory of new Set(files.map(file => file.directory))) await syncDirectory(directory);
      return { result: files.map(file => `private-artifacts/${file.purpose}/${file.name}`), committedState: structuredClone(this.#state) };
    }));
  }
  async #managedArtifactInventory() {
    const directories: string[] = [], files: { purpose: PrivateArtifactPurpose; directory: string; name: string }[] = [];
    for (const purpose of ['private-trial', 'workspace-interchange'] as const) {
      const directory = await this.#artifactDirectory(purpose); if (!directory) continue;
      directories.push(directory);
      const names = await readdir(directory);
      if (names.length > 4096) fail('ARTIFACT_LIMIT', 'Managed artifact inventory exceeds its bound.');
      for (const name of names) {
        if (!/^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/.test(name)) fail('ARTIFACT_INVENTORY_INCOMPLETE', 'Unclassified entries prevent managed copy cleanup.');
        await this.#readArtifact({ id: name.slice(0, -15), purpose }); files.push({ purpose, directory, name });
      }
    }
    return { directories, files };
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
  async delete(cleanup?: VaultDeletionCleanup): Promise<void> {
    if (this.#transaction.getStore()) fail('REENTRANT_TRANSACTION', 'A vault cannot be deleted from inside a transaction.');
    this.#ready(); this.#closing = true;
    this.#shutdown = (async () => {
      await this.#chain;
      try {
        const work = () => this.guarded(async assertCurrent => {
          // Only this typed encrypted namespace is managed here; never recursively delete user paths.
          const { directories, files } = await this.#managedArtifactInventory();
          for (const file of files) { assertCurrent(); await unlink(join(file.directory, file.name)); }
          for (const directory of directories) { assertCurrent(); await rmdir(directory); }
          await cleanup?.({ privateArtifactPaths: Object.freeze(files.map(file => `private-artifacts/${file.purpose}/${file.name}`)), assertCurrent });
          assertCurrent(); await this.#adapter.delete();
          return { result: undefined, committedState: structuredClone(this.#state) };
        });
        if (this.storageKind === 'postgres') {
          if (!this.#adapter.withDeletionAdmission) fail('POSTGRES_DELETION_CUSTODY_REQUIRED', 'PostgreSQL deletion requires held admission from the actual Vault storage.');
          await this.#adapter.withDeletionAdmission(structuredClone(this.#envelope), work);
        } else await work();
        await this.#keychain?.remove(this.#envelope.id);
      }
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
