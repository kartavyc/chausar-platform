// Chausar hosted tier: the account directory. Emails, passkeys, sessions, sealed vault keys and usage live in one
// value, sealed with the custody key and written whole on every change. The file store writes it to disk (temp file,
// flush, rename) from one process that holds a lock. The PostgreSQL store keeps the same sealed value in one row with a
// revision, so more than one server process can share it. Both are experimental until a real deploy has been tested
// (docs/venture/hosted.md). Business records never live here: each business is its own encrypted vault.
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ChausarError, check } from '../contracts.ts';
import { VAULT_TABLE_SQL, type PostgresPool } from '../postgres.ts';
import { acquireProcessLock, type ProcessLock } from '../process-lock.ts';
import type { HostedCustody, Sealed } from './custody.ts';
import type { UsageEntry } from './limits.ts';
import type { StoredPasskey } from './webauthn.ts';

export const DIRECTORY_FORMAT = 'chausar.hosted-directory.v1';

export type HostedPasskey = StoredPasskey & { name: string; createdAt: string; lastUsedAt: string | null };
export type HostedBusiness = { id: string; name: string; createdAt: string; sealedPassphrase: Sealed; workspaceId: string | null };
export type HostedUser = {
  id: string; tenantId: string; email: string; userHandle: string; createdAt: string; verifiedAt: string;
  status: 'active' | 'disabled'; passkeys: HostedPasskey[]; businesses: HostedBusiness[];
};
export type MagicLinkRecord = { id: string; tokenHash: string; email: string; browserHash: string; createdAt: string; expiresAt: string; consumedAt: string | null };
export type ChallengeRecord = { id: string; challenge: string; purpose: 'register' | 'login'; userId: string | null; browserHash: string; expiresAt: string };
export type HostedSessionRecord = {
  id: string; tokenHash: string; userId: string; createdAt: string; expiresAt: string; lastSeenAt: string;
  revokedAt: string | null; method: 'magic-link' | 'passkey'; businessId: string | null;
};
export type DirectoryState = {
  format: typeof DIRECTORY_FORMAT; revision: number;
  users: HostedUser[]; magicLinks: MagicLinkRecord[]; challenges: ChallengeRecord[]; sessions: HostedSessionRecord[];
  usage: Record<string, UsageEntry[]>;
};

export function emptyDirectory(): DirectoryState {
  return { format: DIRECTORY_FORMAT, revision: 0, users: [], magicLinks: [], challenges: [], sessions: [], usage: {} };
}

export interface HostedDirectory {
  readonly kind: 'experimental-file' | 'memory' | 'postgres';
  /** A copy: changing it changes nothing. */
  read(): DirectoryState;
  /**
   * One change at a time, on a draft. A throw discards the draft; a return commits it once. On PostgreSQL a change can
   * run again on newer state when another server process wrote first, so a change only edits its draft.
   */
  update<T>(change: (state: DirectoryState) => T | Promise<T>): Promise<T>;
  /** Catches up with what other server processes wrote. Only the PostgreSQL store has any; the others are always current. */
  refresh?(): Promise<void>;
  close(): Promise<void>;
}

/** Drops what can no longer be used: spent or expired links and challenges, ended sessions, usage older than 13 months. */
export function prune(state: DirectoryState, nowMs: number) {
  const day = 86_400_000;
  state.magicLinks = state.magicLinks.filter(link => Date.parse(link.expiresAt) + day > nowMs);
  state.challenges = state.challenges.filter(item => Date.parse(item.expiresAt) > nowMs);
  state.sessions = state.sessions.filter(session => !session.revokedAt && Date.parse(session.expiresAt) > nowMs);
  const oldest = new Date(nowMs - 400 * day).toISOString().slice(0, 7);
  for (const tenant of Object.keys(state.usage)) {
    state.usage[tenant] = state.usage[tenant].filter(entry => entry.month >= oldest);
    if (!state.usage[tenant].length) delete state.usage[tenant];
  }
}

class Serial {
  #tail: Promise<unknown> = Promise.resolve();
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(work, work);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}

/** For tests and the in-memory development server. Same rules as the file store, no disk. */
export class MemoryDirectory implements HostedDirectory {
  readonly kind = 'memory' as const;
  #state = emptyDirectory();
  #serial = new Serial();
  #clock: () => number;
  constructor(clock: () => number = Date.now) { this.#clock = clock; }
  read(): DirectoryState { return structuredClone(this.#state); }
  update<T>(change: (state: DirectoryState) => T | Promise<T>): Promise<T> {
    return this.#serial.run(async () => {
      const draft = structuredClone(this.#state);
      const result = await change(draft);
      draft.revision = this.#state.revision + 1;
      prune(draft, this.#clock());
      this.#state = draft;
      return structuredClone(result);
    });
  }
  async close() {}
}

/** The sealed file store for one server process. */
export class FileDirectory implements HostedDirectory {
  readonly kind = 'experimental-file' as const;
  #path: string;
  #custody: HostedCustody;
  #lock: ProcessLock;
  #state: DirectoryState;
  #serial = new Serial();
  #clock: () => number;
  #closed = false;

  private constructor(path: string, custody: HostedCustody, lock: ProcessLock, state: DirectoryState, clock: () => number) {
    this.#path = path; this.#custody = custody; this.#lock = lock; this.#state = state; this.#clock = clock;
  }

  static async open(directory: string, custody: HostedCustody, clock: () => number = Date.now): Promise<FileDirectory> {
    const root = resolve(directory);
    await mkdir(root, { recursive: true });
    const lock = await acquireProcessLock(join(root, 'directory.lock'), { busyCode: 'HOSTED_DIRECTORY_BUSY', busyMessage: 'Another Chausar hosted server is using this data folder.' });
    try {
      const path = join(root, 'directory.sealed.json');
      let state = emptyDirectory();
      let raw: string | null = null;
      try { raw = await readFile(path, 'utf8'); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
      if (raw !== null) {
        let sealed: Sealed;
        try { sealed = JSON.parse(raw); } catch { sealed = null as unknown as Sealed; }
        check(sealed, 'HOSTED_DIRECTORY_INVALID', 'The account directory file is damaged.');
        const parsed = JSON.parse(custody.openDirectory(sealed).toString('utf8'));
        check(parsed?.format === DIRECTORY_FORMAT && Number.isSafeInteger(parsed.revision), 'HOSTED_DIRECTORY_INVALID', 'The account directory file is damaged.');
        state = parsed;
      }
      return new FileDirectory(path, custody, lock, state, clock);
    } catch (error) { await lock.release().catch(() => {}); throw error; }
  }

  read(): DirectoryState { return structuredClone(this.#state); }

  update<T>(change: (state: DirectoryState) => T | Promise<T>): Promise<T> {
    return this.#serial.run(async () => {
      check(!this.#closed, 'HOSTED_STOPPING', 'The hosted server is stopping.');
      const draft = structuredClone(this.#state);
      const result = await change(draft);
      draft.revision = this.#state.revision + 1;
      prune(draft, this.#clock());
      await this.#write(draft);
      this.#state = draft;
      return structuredClone(result);
    });
  }

  async #write(state: DirectoryState) {
    const sealed = this.#custody.sealDirectory(Buffer.from(JSON.stringify(state), 'utf8'));
    const temporary = `${this.#path}.${randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(sealed)); await file.sync(); }
    finally { await file.close(); }
    try { await rename(temporary, this.#path); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  }

  async close() {
    if (this.#closed) return;
    await this.#serial.run(async () => { this.#closed = true; });
    await this.#lock.release();
  }
}

/** The statements the PostgreSQL store sends, named so the tests' stand-in answers exactly these and nothing else. */
export const DIRECTORY_SQL = Object.freeze({
  table: `CREATE TABLE IF NOT EXISTS public.chausar_hosted_directory (
      slot TEXT PRIMARY KEY, revision BIGINT NOT NULL CHECK (revision > 0),
      sealed TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  schemaLock: 'SELECT pg_advisory_xact_lock(hashtext($1))',
  load: 'SELECT revision, sealed FROM public.chausar_hosted_directory WHERE slot = $1',
  revision: 'SELECT revision FROM public.chausar_hosted_directory WHERE slot = $1',
  insert: 'INSERT INTO public.chausar_hosted_directory (slot, revision, sealed) VALUES ($1, $2, $3) ON CONFLICT (slot) DO NOTHING',
  swap: 'UPDATE public.chausar_hosted_directory SET revision = $2, sealed = $3, updated_at = CURRENT_TIMESTAMP WHERE slot = $1 AND revision = $4',
});

/** Makes the hosted tables (the directory and the business vaults) once, under a lock, so servers starting together don't race. */
export async function prepareHostedTables(pool: PostgresPool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(DIRECTORY_SQL.schemaLock, ['chausar-hosted-schema']);
    await client.query(DIRECTORY_SQL.table);
    await client.query(VAULT_TABLE_SQL);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

/** A pool or one checked-out client: what the directory runs statements on. */
type Queryable = Pick<PostgresPool, 'query'>;

export type PostgresDirectoryOptions = {
  /** One row per slot. A second deployment sharing the database uses its own slot. */
  slot?: string;
  clock?: () => number;
  /** How many times a change may run before the request gives up, when other servers keep writing first. */
  maxAttempts?: number;
  /** Ends the pool on close. The hosted server sets it: the business vaults share the pool and close first. */
  endPoolOnClose?: boolean;
};

const unavailable = (error: unknown) =>
  Object.assign(new ChausarError('HOSTED_STORAGE_UNAVAILABLE', 'The account store is not reachable. Try again in a moment.'), { cause: error });
const rolledBack = () => new ChausarError('HOSTED_DIRECTORY_INVALID', 'The account store went back to an older copy. Restart the server after a restore.');

/**
 * The sealed directory in one PostgreSQL row, for one or more server processes. The row holds the same sealed value as
 * the file store and its revision. A change commits only while the row still has the revision it started from (compare
 * and set). If another process wrote first, the change runs again on what that process wrote, so no process overwrites
 * another and a sign-in link still works once. read() answers from the last value this process saw; refresh() catches
 * up, and the hosted server calls it at the start of every API request.
 */
export class PostgresDirectory implements HostedDirectory {
  readonly kind = 'postgres' as const;
  #pool: PostgresPool;
  #custody: HostedCustody;
  #slot: string;
  #state: DirectoryState = emptyDirectory();
  #serial = new Serial();
  #clock: () => number;
  #maxAttempts: number;
  #endPool: boolean;
  #refreshing: Promise<void> | null = null;
  #closed = false;

  private constructor(pool: PostgresPool, custody: HostedCustody, slot: string, options: PostgresDirectoryOptions) {
    this.#pool = pool; this.#custody = custody; this.#slot = slot;
    this.#clock = options.clock ?? Date.now; this.#maxAttempts = options.maxAttempts ?? 10; this.#endPool = options.endPoolOnClose === true;
  }

  /** The caller keeps the pool if this throws. */
  static async open(pool: PostgresPool, custody: HostedCustody, options: PostgresDirectoryOptions = {}): Promise<PostgresDirectory> {
    const slot = options.slot ?? 'main';
    check(/^[A-Za-z0-9_.-]{1,100}$/.test(slot), 'INVALID_SLOT', 'Use a named directory slot.');
    const attempts = options.maxAttempts ?? 10;
    check(Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 100, 'INVALID_LIMIT', 'Allow from 1 to 100 attempts per change.');
    try { await prepareHostedTables(pool); } catch (error) { throw unavailable(error); }
    const directory = new PostgresDirectory(pool, custody, slot, options);
    directory.#state = await directory.#load();
    return directory;
  }

  read(): DirectoryState { return structuredClone(this.#state); }

  refresh(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    return this.#refreshing ??= this.#catchUp().finally(() => { this.#refreshing = null; });
  }

  update<T>(change: (state: DirectoryState) => T | Promise<T>): Promise<T> {
    return this.#serial.run(async () => {
      check(!this.#closed, 'HOSTED_STOPPING', 'The hosted server is stopping.');
      for (let attempt = 1; ; attempt++) {
        // Servers take turns: each change holds this slot's lock until it commits, reads the newest row inside it, and
        // writes with compare and set. Without the turn, a server writing back to back starved a slower one until it
        // gave up (seen on a real PostgreSQL 17 server, never on the stand-in). The swap stays as the safety net for a
        // writer that does not take the lock.
        const outcome = await this.#inTurn(async client => {
          const latest = await this.#load(client);
          if (latest.revision < this.#state.revision) throw rolledBack();
          this.#adopt(latest);
          const base = this.#state;
          const draft = structuredClone(base);
          const result = await change(draft);
          draft.revision = base.revision + 1;
          prune(draft, this.#clock());
          const sealed = JSON.stringify(this.#custody.sealDirectory(Buffer.from(JSON.stringify(draft), 'utf8')));
          const written = base.revision === 0
            ? await this.#query(DIRECTORY_SQL.insert, [this.#slot, draft.revision, sealed], client)
            : await this.#query(DIRECTORY_SQL.swap, [this.#slot, draft.revision, sealed, base.revision], client);
          return written.rowCount === 1 ? { draft, result } : null;
        });
        if (outcome) { this.#adopt(outcome.draft); return structuredClone(outcome.result); }
        // Someone wrote without taking the turn. Run the change again on what they wrote.
        check(attempt < this.#maxAttempts, 'HOSTED_BUSY', 'The account store is busy. Try again in a moment.');
      }
    });
  }

  /** Runs work inside one transaction that holds this slot's advisory lock until COMMIT, so changes take turns. */
  async #inTurn<T>(work: (client: Queryable) => Promise<T | null>): Promise<T | null> {
    let client: Awaited<ReturnType<PostgresPool['connect']>>;
    try { client = await this.#pool.connect(); } catch (error) { throw unavailable(error); }
    try {
      await this.#query('BEGIN', [], client);
      await this.#query(DIRECTORY_SQL.schemaLock, [`chausar-hosted-directory:${this.#slot}`], client);
      const outcome = await work(client);
      await this.#query(outcome === null ? 'ROLLBACK' : 'COMMIT', [], client);
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async close() {
    if (this.#closed) return;
    await this.#serial.run(async () => { this.#closed = true; });
    await this.#refreshing?.catch(() => {});
    if (this.#endPool) await this.#pool.end();
  }

  /** Revisions only go forward, so an older value read while a newer one commits never replaces it. */
  #adopt(state: DirectoryState) { if (state.revision >= this.#state.revision) this.#state = state; }

  async #catchUp() {
    // Taken before the query: the row's revision can only be at or past it, unless the table was put back.
    const known = this.#state.revision;
    const result = await this.#query(DIRECTORY_SQL.revision, [this.#slot]);
    const revision = result.rows.length ? Number(result.rows[0].revision) : 0;
    if (revision < known) throw rolledBack();
    if (revision > known) {
      const latest = await this.#load();
      if (latest.revision < revision) throw rolledBack();
      this.#adopt(latest);
    }
  }

  async #load(on: Queryable = this.#pool): Promise<DirectoryState> {
    const result = await this.#query(DIRECTORY_SQL.load, [this.#slot], on);
    if (!result.rows.length) return emptyDirectory();
    const row = result.rows[0];
    let sealed: Sealed | null = null;
    try { sealed = typeof row.sealed === 'string' ? JSON.parse(row.sealed) : null; } catch { sealed = null; }
    check(sealed && typeof sealed === 'object', 'HOSTED_DIRECTORY_INVALID', 'The account directory row is damaged.');
    const parsed = JSON.parse(this.#custody.openDirectory(sealed).toString('utf8'));
    check(parsed?.format === DIRECTORY_FORMAT && Number.isSafeInteger(parsed.revision) && parsed.revision > 0 && String(row.revision) === String(parsed.revision),
      'HOSTED_DIRECTORY_INVALID', 'The account directory row is damaged.');
    return parsed;
  }

  async #query(sql: string, values: unknown[], on: Queryable = this.#pool) {
    try { return await on.query(sql, values); }
    catch (error) { throw unavailable(error); }
  }
}
