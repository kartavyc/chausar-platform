import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

export type PGliteOwnerCode = `PGLITE_DIRECTORY_${'ARGUMENT_INVALID' | 'PATH_REFUSED' | 'IDENTITY_CHANGED' | 'BUSY' | 'ABORTED' | 'INIT_TIMEOUT' | 'INIT_FAILED' | 'NOT_OPEN' | 'CLOSE_TIMEOUT' | 'CLOSE_FAILED' | 'CLOSE_UNCONFIRMED' | 'OWNER_CHANGED'}`;
export class PGliteDirectoryError extends Error {
  readonly code: PGliteOwnerCode;
  constructor(code: PGliteOwnerCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'PGliteDirectoryError'; this.code = code;
  }
}
export interface PGliteQueries {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
  exec(sql: string): Promise<unknown>;
}
export interface PGliteOwnerClient extends PGliteQueries {
  readonly waitReady: Promise<unknown>;
  readonly closed: boolean;
  transaction<T>(operation: (transaction: PGliteQueries) => Promise<T>): Promise<T>;
  close(): Promise<unknown>;
}
export interface PGliteDirectoryOptions {
  ownedRoot: string;
  directory: string;
  /** Trusted synchronous factory. Do not retain or independently close its client. */
  construct: (canonicalDirectory: string) => PGliteOwnerClient;
  signal?: AbortSignal;
  startupTimeoutMs?: number;
  closeTimeoutMs?: number;
}
type Identity = { path: string; dev: bigint; ino: bigint };
type Claim = { root: Identity; data: Identity; lock: Identity; owner: Identity; bytes: Buffer };
const OWNER_FILE = 'owner.json';
const MARKER_LIMIT = 8192;
const equalPath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
function demand(condition: unknown, code: PGliteOwnerCode, message: string): asserts condition {
  if (!condition) throw new PGliteDirectoryError(code, message);
}
function timeout(value: number | undefined): number {
  const ms = value ?? 5000;
  demand(Number.isSafeInteger(ms) && ms >= 1 && ms <= 60000, 'PGLITE_DIRECTORY_ARGUMENT_INVALID', 'Ownership lifecycle deadlines must be between 1 and 60000 milliseconds.');
  return ms;
}
function aborted(signal?: AbortSignal) {
  demand(!signal?.aborted, 'PGLITE_DIRECTORY_ABORTED', 'Directory admission was aborted.');
}
function bounded<T>(operation: Promise<T>, ms: number, code: PGliteOwnerCode, signal?: AbortSignal): Promise<T> {
  return new Promise((fulfill, reject) => {
    let done = false;
    const finish = (fulfilled: boolean, value: unknown) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      fulfilled ? fulfill(value as T) : reject(value);
    };
    const cancel = () => finish(false, new PGliteDirectoryError('PGLITE_DIRECTORY_ABORTED', 'Directory admission was aborted.'));
    const timer = setTimeout(() => finish(false, new PGliteDirectoryError(code, 'The owned lifecycle deadline expired; exclusion is retained.')), ms);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    operation.then(value => finish(true, value), error => finish(false, error));
  });
}
async function directoryIdentity(path: string): Promise<Identity> {
  const resolved = resolve(path), root = parse(resolved).root;
  let current = root;
  for (const segment of relative(root, resolved).split(sep).filter(Boolean)) {
    current = join(current, segment);
    const entry = await lstat(current, { bigint: true });
    demand(entry.isDirectory() && !entry.isSymbolicLink(), 'PGLITE_DIRECTORY_PATH_REFUSED', 'Directory ownership requires ordinary existing directories.');
  }
  const canonical = await realpath(resolved), entry = await lstat(resolved, { bigint: true });
  demand(entry.isDirectory() && !entry.isSymbolicLink() && equalPath(canonical, resolved), 'PGLITE_DIRECTORY_PATH_REFUSED', 'Directory ownership cannot follow redirected paths.');
  return { path: canonical, dev: entry.dev, ino: entry.ino };
}
async function unchanged(identity: Identity, code: PGliteOwnerCode) {
  try {
    const current = await directoryIdentity(identity.path);
    demand(current.dev === identity.dev && current.ino === identity.ino && equalPath(current.path, identity.path), code, 'The admitted directory identity changed.');
  } catch (error) {
    if (error instanceof PGliteDirectoryError && error.code === code) throw error;
    throw new PGliteDirectoryError(code, 'The admitted directory identity is unavailable or changed.', error);
  }
}
async function acquire(options: PGliteDirectoryOptions): Promise<Claim> {
  for (const path of [options.ownedRoot, options.directory]) {
    demand(typeof path === 'string' && path.length <= 4096 && !path.includes('\0') && isAbsolute(path), 'PGLITE_DIRECTORY_PATH_REFUSED', 'Supply absolute existing filesystem directories.');
  }
  const root = await directoryIdentity(options.ownedRoot), data = await directoryIdentity(options.directory);
  const tail = relative(root.path, data.path);
  demand(tail && tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail), 'PGLITE_DIRECTORY_PATH_REFUSED', 'The database directory must be strictly below the owned root.');
  const lockPath = join(dirname(data.path), basename(data.path) + '.chausar-pglite-owner');
  aborted(options.signal);
  try { await mkdir(lockPath); }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') throw new PGliteDirectoryError('PGLITE_DIRECTORY_BUSY', 'The database directory already has an owner; stale ownership is not reclaimed.');
    throw new PGliteDirectoryError('PGLITE_DIRECTORY_INIT_FAILED', 'The directory claim could not be created.', error);
  }
  // From this point every ambiguous failure leaves the sibling claim occupied.
  const lock = await directoryIdentity(lockPath);
  const bytes = Buffer.from(JSON.stringify({ version: 1, id: randomUUID(), directory: data.path, dev: data.dev.toString(), ino: data.ino.toString() }) + '\n');
  demand(bytes.length <= MARKER_LIMIT, 'PGLITE_DIRECTORY_ARGUMENT_INVALID', 'The ownership marker exceeds its bound.');
  const ownerPath = join(lock.path, OWNER_FILE), handle = await open(ownerPath, 'wx');
  let owner: Identity;
  try {
    await handle.writeFile(bytes); await handle.sync();
    const info = await handle.stat({ bigint: true });
    owner = { path: ownerPath, dev: info.dev, ino: info.ino };
  } finally { await handle.close(); }
  await unchanged(root, 'PGLITE_DIRECTORY_IDENTITY_CHANGED');
  await unchanged(data, 'PGLITE_DIRECTORY_IDENTITY_CHANGED');
  return { root, data, lock, owner: owner!, bytes };
}
async function release(claim: Claim) {
  await unchanged(claim.root, 'PGLITE_DIRECTORY_IDENTITY_CHANGED');
  await unchanged(claim.data, 'PGLITE_DIRECTORY_IDENTITY_CHANGED');
  await unchanged(claim.lock, 'PGLITE_DIRECTORY_OWNER_CHANGED');
  const entries = await readdir(claim.lock.path);
  demand(entries.length === 1 && entries[0] === OWNER_FILE, 'PGLITE_DIRECTORY_OWNER_CHANGED', 'The owner claim is incomplete or contains unexpected entries.');
  const entry = await lstat(claim.owner.path, { bigint: true });
  demand(entry.isFile() && !entry.isSymbolicLink() && entry.dev === claim.owner.dev && entry.ino === claim.owner.ino, 'PGLITE_DIRECTORY_OWNER_CHANGED', 'The owner proof changed.');
  const handle = await open(claim.owner.path, 'r');
  try {
    const info = await handle.stat({ bigint: true });
    demand(info.isFile() && info.dev === claim.owner.dev && info.ino === claim.owner.ino && info.size === BigInt(claim.bytes.length), 'PGLITE_DIRECTORY_OWNER_CHANGED', 'The owner proof changed.');
    const buffer = Buffer.alloc(MARKER_LIMIT + 1), result = await handle.read(buffer, 0, buffer.length, 0);
    demand(result.bytesRead === claim.bytes.length && buffer.subarray(0, result.bytesRead).equals(claim.bytes), 'PGLITE_DIRECTORY_OWNER_CHANGED', 'The owner proof changed.');
  } finally { await handle.close(); }
  // Cooperative actors never replace an occupied claim. No stale takeover,
  // recursive deletion, or delayed retry can remove a successor's claim.
  await unchanged(claim.lock, 'PGLITE_DIRECTORY_OWNER_CHANGED');
  await unlink(claim.owner.path); await rmdir(claim.lock.path);
}

/** Cooperative directory admission, not a product authority adapter or engine fence. */
export class OwnedPGliteDirectory implements PGliteQueries {
  #claim: Claim;
  #client: PGliteOwnerClient;
  #originalClose: () => Promise<unknown>;
  #closeTimeout: number;
  #operations = new Set<Promise<unknown>>();
  #closePromise?: Promise<void>;
  #state: 'open' | 'closing' | 'closed' | 'quarantined' = 'open';
  private constructor(claim: Claim, client: PGliteOwnerClient, closeTimeout: number) {
    this.#claim = claim; this.#client = client; this.#closeTimeout = closeTimeout;
    this.#originalClose = client.close.bind(client);
  }
  get directory() { return this.#claim.data.path; }
  get state() { return this.#state; }
  #run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#state !== 'open') return Promise.reject(new PGliteDirectoryError('PGLITE_DIRECTORY_NOT_OPEN', 'The directory owner is not open for new operations.'));
    const pending = Promise.resolve().then(operation);
    this.#operations.add(pending);
    pending.then(() => this.#operations.delete(pending), () => this.#operations.delete(pending));
    return pending;
  }
  query(sql: string, parameters?: unknown[]) { return this.#run(() => this.#client.query(sql, parameters)); }
  exec(sql: string) { return this.#run(() => this.#client.exec(sql)); }
  transaction<T>(operation: (transaction: PGliteQueries) => Promise<T>): Promise<T> {
    return this.#run(() => this.#client.transaction(async transaction => {
      let accepting = true;
      const admitted: Promise<unknown>[] = [];
      const run = <R>(action: () => Promise<R>): Promise<R> => {
        if (!accepting) return Promise.reject(new PGliteDirectoryError('PGLITE_DIRECTORY_NOT_OPEN', 'The admitted transaction has ended.'));
        const result = Promise.resolve().then(action); admitted.push(result);
        // Retain settled failures too. Detached child work must not convert a
        // failed statement into an acknowledged transaction callback.
        result.catch(() => {}); return result;
      };
      const facade: PGliteQueries = Object.freeze({ query: (sql: string, params?: unknown[]) => run(() => transaction.query(sql, params)), exec: (sql: string) => run(() => transaction.exec(sql)) });
      let value: T;
      try { value = await operation(facade); }
      catch (error) { accepting = false; await Promise.allSettled(admitted); throw error; }
      accepting = false;
      const settled = await Promise.allSettled(admitted);
      const failed = settled.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      return value;
    }));
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#state = 'closing';
    this.#closePromise = this.#finish();
    return this.#closePromise;
  }
  async #finish() {
    try {
      const shutdown = (async () => {
        await Promise.allSettled([...this.#operations]);
        await this.#originalClose();
        demand(this.#client.closed === true, 'PGLITE_DIRECTORY_CLOSE_UNCONFIRMED', 'The database did not confirm closure; exclusion is retained.');
      })();
      await bounded(shutdown, this.#closeTimeout, 'PGLITE_DIRECTORY_CLOSE_TIMEOUT');
      await release(this.#claim); this.#state = 'closed';
    } catch (error) {
      this.#state = 'quarantined';
      if (error instanceof PGliteDirectoryError) throw error;
      throw new PGliteDirectoryError('PGLITE_DIRECTORY_CLOSE_FAILED', 'Close or ownership release failed; exclusion is retained.', error);
    }
  }
  static async open(options: PGliteDirectoryOptions): Promise<OwnedPGliteDirectory> {
    demand(typeof options.construct === 'function', 'PGLITE_DIRECTORY_ARGUMENT_INVALID', 'Supply a trusted synchronous database constructor.');
    const startupTimeout = timeout(options.startupTimeoutMs), closeTimeout = timeout(options.closeTimeoutMs);
    aborted(options.signal);
    let claim: Claim | undefined;
    try {
      claim = await acquire(options); aborted(options.signal);
      const client = options.construct(claim.data.path);
      demand(client && typeof client.close === 'function' && typeof client.query === 'function' && typeof client.exec === 'function' && typeof client.transaction === 'function'
        && client.waitReady && typeof client.waitReady.then === 'function' && client.closed === false,
      'PGLITE_DIRECTORY_INIT_FAILED', 'The constructor did not return an unclosed synchronous lifecycle client.');
      const owner = new OwnedPGliteDirectory(claim, client, closeTimeout);
      await bounded(client.waitReady, startupTimeout, 'PGLITE_DIRECTORY_INIT_TIMEOUT', options.signal);
      await unchanged(claim.root, 'PGLITE_DIRECTORY_IDENTITY_CHANGED');
      await unchanged(claim.data, 'PGLITE_DIRECTORY_IDENTITY_CHANGED');
      demand(client.closed === false, 'PGLITE_DIRECTORY_INIT_FAILED', 'The client closed during initialization.');
      aborted(options.signal);
      return owner;
    } catch (error) {
      // An opaque constructor/readiness failure does not prove a partial engine
      // cannot still access storage. Recovery requires external quiescence.
      if (error instanceof PGliteDirectoryError) throw error;
      throw new PGliteDirectoryError(claim ? 'PGLITE_DIRECTORY_INIT_FAILED' : 'PGLITE_DIRECTORY_PATH_REFUSED', 'Directory initialization failed without admitting a second owner.', error);
    }
  }
}
export const openOwnedPGliteDirectory = (options: PGliteDirectoryOptions) => OwnedPGliteDirectory.open(options);
