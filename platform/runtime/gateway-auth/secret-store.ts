import { createCipheriv, createDecipheriv, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { check, ChausarError } from '../contracts.ts';
import type { KeychainHook, VaultKeychainProvider } from '../vault.ts';

/**
 * The general secret store (SH-02: keys and connector tokens are usable only while unlocked).
 *
 * Each store directory under the app directory is sealed with one 32-byte store key. With a native keychain provider the key
 * lives in the keychain under a random UUID recorded in `.keychain-id`; without one it is the `.key` file beside the sealed
 * files, protected by file permissions only (as before). `secretCustody` holds keychain-backed keys in memory only while a
 * workspace is open and zeroes them on lock. Once a store is enrolled in the keychain it never falls back to its file.
 * Enrolment is lazy: an existing `.key` moves into the keychain when the workspace opens, and a first-ever save seals with a
 * fresh file key that moves into the keychain straight after, so the synchronous credential API keeps working.
 */
export const STORE_NAMES = ['connector-credentials', 'secrets'] as const;
export type StoreName = typeof STORE_NAMES[number];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const NAME = /^[a-z][a-z0-9._-]{0,99}$/;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const MAX_SECRET = 64 * 1024;
const locked = () => new ChausarError('SECRET_STORE_LOCKED', 'Open your workspace to use stored keys and sign-ins.');
const unavailable = () => new ChausarError('KEYCHAIN_UNAVAILABLE', 'The system keychain did not give back a stored key. Unlock the keychain, then lock and open the workspace again.');

/** Read a private regular file through one descriptor, so the checked file is the file read. */
export function readPrivateFile(path: string, maxBytes: number, code = 'SECRET_STORE_INVALID'): Buffer {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | NOFOLLOW); } catch { throw new ChausarError(code, 'A secret file could not be read.'); } // never echo a path
  try {
    const info = fstatSync(fd);
    check(info.isFile() && info.size <= maxBytes && (process.platform === 'win32' || (info.mode & 0o077) === 0), code, 'A secret file is not a private regular file.');
    const buffer = Buffer.alloc(info.size); let read = 0;
    while (read < info.size) { const n = readSync(fd, buffer, read, info.size - read, read); if (n === 0) break; read += n; }
    return buffer.subarray(0, read);
  } finally { closeSync(fd); }
}
/** A fresh, randomly named temporary file opened exclusively, then renamed over the target: an existing link is never followed. */
export function writePrivateFile(path: string, data: string | Uint8Array): void {
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  try { writeFileSync(temp, data, { mode: 0o600, flag: 'wx' }); renameSync(temp, path); }
  catch { rmSync(temp, { force: true }); throw new ChausarError('SECRET_STORE_INVALID', 'A secret file could not be written.'); } // never echo a path
}
export function privateDirectory(path: string, code = 'SECRET_STORE_INVALID'): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  check(info.isDirectory() && !info.isSymbolicLink(), code, 'The secret store is not a private directory.');
  if (process.platform !== 'win32') chmodSync(path, 0o700);
}
export function isKeychainProvider(value: unknown): value is VaultKeychainProvider {
  return !!value && ['store', 'retrieve', 'remove'].every(name => typeof (value as any)[name] === 'function');
}
function readKeychainId(directory: string): string {
  const id = readPrivateFile(join(directory, '.keychain-id'), 64).toString('utf8');
  check(UUID.test(id), 'SECRET_STORE_INVALID', 'The secret store keychain record is damaged.');
  return id;
}
function readFileKey(directory: string): Buffer {
  const key = readPrivateFile(join(directory, '.key'), 32);
  check(key.length === 32, 'SECRET_STORE_INVALID', 'The secret store key is not a regular private file.');
  return key;
}
async function retrieveKey(keychain: VaultKeychainProvider, id: string): Promise<Buffer> {
  let got: Uint8Array | null;
  try { got = await keychain.retrieve(id); } catch { throw unavailable(); }
  try { check(got instanceof Uint8Array && got.byteLength === 32, 'KEYCHAIN_UNAVAILABLE', 'The system keychain did not give back a stored key.'); return Buffer.from(got); }
  finally { if (got instanceof Uint8Array) got.fill(0); }
}

type Session = {
  directory: string; keychain?: VaultKeychainProvider; live: () => boolean;
  keys: Map<string, Buffer>; failed: Set<string>; enrolling: Map<string, Promise<Buffer | null>>;
};

class SecretCustody {
  #sessions = new Map<string, Session>();
  #stores = new Map<string, Session>();
  /** Open custody for one app directory after its vault attached. Never throws for a keychain failure: the affected store
   *  refuses with KEYCHAIN_UNAVAILABLE instead, so a workspace still opens. Demo launches stay on the file store. */
  async open(input: { directory: string; keychain?: KeychainHook; demo?: boolean; live?: () => boolean }): Promise<void> {
    const directory = resolve(input.directory); this.close(directory);
    const keychain = !input.demo && isKeychainProvider(input.keychain) ? input.keychain : undefined;
    const session: Session = { directory, keychain, live: input.live ?? (() => true), keys: new Map(), failed: new Set(), enrolling: new Map() };
    this.#sessions.set(directory, session);
    for (const name of STORE_NAMES) this.#stores.set(join(directory, name), session);
    if (keychain) for (const name of STORE_NAMES) await this.#load(session, join(directory, name));
  }
  /** Zero and drop every key held for the app directory (or all of them). */
  close(directory?: string): void {
    const target = directory === undefined ? undefined : resolve(directory);
    for (const [path, session] of [...this.#sessions]) {
      if (target !== undefined && path !== target) continue;
      for (const key of session.keys.values()) key.fill(0);
      session.keys.clear(); this.#sessions.delete(path);
      for (const [store, owner] of [...this.#stores]) if (owner === session) this.#stores.delete(store);
    }
  }
  /** Wait for background keychain enrolments (tests and orderly shutdown). */
  async settled(directory: string): Promise<void> {
    const session = this.#sessions.get(resolve(directory));
    if (session) await Promise.all([...session.enrolling.values()]);
  }
  #session(storeDirectory: string): Session | undefined {
    const session = this.#stores.get(storeDirectory);
    if (session && !session.live()) { this.close(session.directory); return undefined; }
    return session;
  }
  /**
   * Synchronous key for ConnectorCredentialStore. Returns the borrowed in-memory key (never modify it) in keychain mode,
   * `undefined` when the caller should keep its own file behaviour, and throws SECRET_STORE_LOCKED for an enrolled store
   * while no workspace is open.
   */
  key(storeDirectory: string, create: boolean): Buffer | null | undefined {
    const directory = resolve(storeDirectory), session = this.#session(directory);
    if (!session) { if (existsSync(join(directory, '.keychain-id'))) throw locked(); return undefined; }
    if (!session.keychain) { if (existsSync(join(directory, '.keychain-id'))) throw unavailable(); return undefined; }
    const key = session.keys.get(directory); if (key) return key;
    if (session.failed.has(directory)) throw unavailable();
    if (existsSync(join(directory, '.keychain-id'))) throw locked();
    // First-ever save: the caller seals with a fresh file key; it moves into the keychain right after this call returns.
    if (create && !session.enrolling.has(directory)) this.#track(session, directory, new Promise<void>(accept => setImmediate(accept)).then(() => this.#enrol(session, directory, false)));
    return undefined;
  }
  /** The store key for async callers (SecretStore), in either mode. Requires an open workspace. */
  async storeKey(storeDirectory: string, create: boolean): Promise<Buffer | null> {
    const directory = resolve(storeDirectory), session = this.#session(directory);
    if (!session) throw locked();
    const have = session.keys.get(directory); if (have) return have;
    if (session.keychain) {
      if (session.failed.has(directory)) throw unavailable();
      check(!existsSync(join(directory, '.keychain-id')), 'SECRET_STORE_LOCKED', 'Open your workspace to use stored keys and sign-ins.');
      const pending = session.enrolling.get(directory);
      if (pending) { await pending; const key = session.keys.get(directory); if (key || !create) return key ?? null; }
      return this.#track(session, directory, this.#enrol(session, directory, create));
    }
    if (existsSync(join(directory, '.keychain-id'))) throw unavailable(); // enrolled: never re-keyed from a file
    if (!existsSync(join(directory, '.key'))) {
      if (!create) return null;
      privateDirectory(directory);
      try { writeFileSync(join(directory, '.key'), randomBytes(32), { mode: 0o600, flag: 'wx' }); }
      catch (error) { if ((error as any)?.code !== 'EEXIST') throw new ChausarError('SECRET_STORE_INVALID', 'The secret store key could not be written.'); }
    }
    const key = readFileKey(directory);
    if (this.#stores.get(directory) !== session) { key.fill(0); throw locked(); }
    session.keys.get(directory)?.fill(0); session.keys.set(directory, key); return key;
  }
  /** The key held right now, read synchronously just before use, so a lock between an await and the use can never hand
   *  over a zeroed key. */
  heldKey(storeDirectory: string): Buffer {
    const key = this.#session(resolve(storeDirectory))?.keys.get(resolve(storeDirectory));
    if (!key) throw locked();
    return key;
  }
  /** Throws SECRET_STORE_LOCKED unless the store's workspace is open. */
  assertOpen(storeDirectory: string): void { if (!this.#session(resolve(storeDirectory))) throw locked(); }
  /** Key-free description for `secrets.status`. */
  status(directory: string) {
    const root = resolve(directory), session = this.#sessions.has(root) ? this.#session(join(root, STORE_NAMES[0])) : undefined;
    return { backing: session?.keychain ? 'keychain' as const : 'file' as const, unlocked: !!session,
      stores: STORE_NAMES.map(name => {
        const store = join(root, name), enrolled = existsSync(join(store, '.keychain-id'));
        return { name, backing: enrolled ? 'keychain' as const : 'file' as const, present: enrolled || existsSync(join(store, '.key')),
          available: !!session && !session.failed.has(store) && (!enrolled || session.keys.has(store)) };
      }) };
  }
  /** One enrolment per store at a time; the tracked copy never rejects, so a dropped result is never an unhandled rejection. */
  #track(session: Session, directory: string, work: Promise<Buffer | null>): Promise<Buffer | null> {
    const quiet = work.then(key => key, () => null);
    session.enrolling.set(directory, quiet);
    void quiet.then(() => { if (session.enrolling.get(directory) === quiet) session.enrolling.delete(directory); });
    return work;
  }
  async #load(session: Session, directory: string): Promise<void> {
    try {
      if (existsSync(join(directory, '.keychain-id'))) {
        const key = await retrieveKey(session.keychain!, readKeychainId(directory));
        if (this.#stores.get(directory) !== session) { key.fill(0); return; }
        session.keys.set(directory, key);
        // A migration interrupted after recording the keychain id: drop the file key only when it is the same key.
        if (existsSync(join(directory, '.key'))) try { const legacy = readFileKey(directory); try { if (timingSafeEqual(legacy, key)) rmSync(join(directory, '.key'), { force: true }); } finally { legacy.fill(0); } } catch {}
      } else if (existsSync(join(directory, '.key'))) await this.#track(session, directory, this.#enrol(session, directory, false)).catch(() => null);
    } catch { if (existsSync(join(directory, '.keychain-id'))) session.failed.add(directory); }
  }
  /** Move the file key (or a fresh key when `create`) into the keychain: store, read back and compare, record the id, then
   *  delete the file key. Any failure before the id is recorded leaves the file store exactly as it was. */
  async #enrol(session: Session, directory: string, create: boolean): Promise<Buffer | null> {
    const keychain = session.keychain!, keyPath = join(directory, '.key'), idPath = join(directory, '.keychain-id');
    if (existsSync(idPath)) return session.keys.get(directory) ?? null;
    const migrating = existsSync(keyPath);
    if (!migrating && !create) return null;
    const key = migrating ? readFileKey(directory) : randomBytes(32), id = randomUUID();
    let stored = false;
    try {
      const lent = Uint8Array.from(key);
      try { await keychain.store(id, lent); } catch { throw unavailable(); } finally { lent.fill(0); }
      stored = true;
      const back = await retrieveKey(keychain, id);
      try { check(timingSafeEqual(back, key), 'KEYCHAIN_UNAVAILABLE', 'The system keychain gave back a different key.'); } finally { back.fill(0); }
      if (this.#stores.get(directory) !== session) throw locked();
      if (!migrating) { check(!existsSync(keyPath), 'SECRET_STORE_INVALID', 'The secret store changed while it was being set up.'); privateDirectory(directory); }
      writePrivateFile(idPath, id);
    } catch (error) { key.fill(0); if (stored) await keychain.remove(id).catch(() => {}); throw error; }
    session.keys.set(directory, key);
    try { rmSync(keyPath, { force: true }); } catch {} // the next open removes a leftover equal file key
    return key;
  }
}

/** Process-wide custody, keyed by app directory. */
export const secretCustody = new SecretCustody();

function seal(key: Buffer, name: string, value: Buffer): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(`chausar.secret.v1:${name}`));
  const sealed = Buffer.concat([cipher.update(value), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), sealed: sealed.toString('base64') });
}
function unseal(key: Buffer, name: string, content: Buffer): Buffer {
  try {
    const record = JSON.parse(content.toString('utf8'));
    if (record?.version !== 1) throw new Error('version');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64')); decipher.setAAD(Buffer.from(`chausar.secret.v1:${name}`)); decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(record.sealed, 'base64')), decipher.final()]);
  } catch { throw new ChausarError('SECRET_STORE_INVALID', 'A stored secret could not be opened.'); }
}
const secretFile = (directory: string, name: string) => { check(typeof name === 'string' && NAME.test(name), 'SECRET_NAME_INVALID', 'Use a short lower-case secret name.'); return join(directory, `${name}.secret`); };

/** This lane's own secrets under `<appDir>/secrets`, sealed with AES-256-GCM (name as AAD) under the custody key. */
export class SecretStore {
  readonly #directory: string;
  constructor(appDirectory: string) { this.#directory = join(resolve(appDirectory), 'secrets'); }
  async set(name: string, value: Uint8Array | string): Promise<void> {
    const path = secretFile(this.#directory, name), bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    try {
      check(bytes.length >= 1 && bytes.length <= MAX_SECRET, 'SECRET_VALUE_INVALID', 'A secret must be between 1 byte and 64 KB.');
      await secretCustody.storeKey(this.#directory, true);
      privateDirectory(this.#directory); writePrivateFile(path, seal(secretCustody.heldKey(this.#directory), name, bytes));
    } finally { bytes.fill(0); }
  }
  /** The secret's bytes, or null. The caller zeroes the buffer when done. */
  async get(name: string): Promise<Buffer | null> {
    const path = secretFile(this.#directory, name);
    secretCustody.assertOpen(this.#directory);
    if (!existsSync(path)) return null;
    check(await secretCustody.storeKey(this.#directory, false), 'SECRET_STORE_INVALID', 'The secret store key is missing.');
    const content = readPrivateFile(path, MAX_SECRET * 2 + 1024);
    return unseal(secretCustody.heldKey(this.#directory), name, content);
  }
  async has(name: string): Promise<boolean> { const path = secretFile(this.#directory, name); secretCustody.assertOpen(this.#directory); return existsSync(path); }
  async remove(name: string): Promise<boolean> { const path = secretFile(this.#directory, name); secretCustody.assertOpen(this.#directory); const had = existsSync(path); rmSync(path, { force: true }); return had; }
}

/**
 * Trusted engine use only (PIN quick unlock, before any workspace is open): read one secret with a store key fetched for
 * this call and zeroed straight after. Uses the open custody when there is one.
 */
export async function readSecretBeforeUnlock(appDirectory: string, name: string, keychain?: KeychainHook): Promise<Buffer | null> {
  const directory = join(resolve(appDirectory), 'secrets'), path = secretFile(directory, name);
  try { secretCustody.assertOpen(directory); return await new SecretStore(appDirectory).get(name); } catch (error) { if ((error as any)?.code !== 'SECRET_STORE_LOCKED') throw error; }
  if (!existsSync(path)) return null;
  let key: Buffer;
  if (existsSync(join(directory, '.keychain-id'))) {
    check(isKeychainProvider(keychain), 'KEYCHAIN_UNAVAILABLE', 'The system keychain is not available on this launch.');
    key = await retrieveKey(keychain, readKeychainId(directory));
  } else if (existsSync(join(directory, '.key'))) key = readFileKey(directory);
  else return null;
  try { return unseal(key, name, readPrivateFile(path, MAX_SECRET * 2 + 1024)); } finally { key.fill(0); }
}
/** Which backing protects the secrets store on disk now. */
export function secretsBacking(appDirectory: string): 'keychain' | 'file' {
  return existsSync(join(resolve(appDirectory), 'secrets', '.keychain-id')) ? 'keychain' : 'file';
}
