// Chausar hosted tier: the account directory. Emails, passkeys, sessions, sealed vault keys and usage live in one
// value, sealed with the custody key and written whole on every change (temp file, flush, rename), by one process that
// holds a lock. This is the experimental single-server store; a deploy needs the PostgreSQL store docs/venture/hosted.md
// describes. Business records never live here: each business is its own encrypted vault.
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { check } from '../contracts.ts';
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
  readonly kind: 'experimental-file' | 'memory';
  /** A copy: changing it changes nothing. */
  read(): DirectoryState;
  /** One change at a time, on a draft. A throw discards the draft; a return commits it once. */
  update<T>(change: (state: DirectoryState) => T | Promise<T>): Promise<T>;
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
