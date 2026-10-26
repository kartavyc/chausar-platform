// Chausar hosted tier: one business's engine. Each business is its own Engine over its own encrypted vault, with a
// folder named by its business id inside its tenant's folder. The vault is either an experimental file in that folder,
// or one PostgreSQL row whose slot is made from the tenant and business ids; the folder then holds only the vault's
// writer lock. Both runtime adapters use this class: the local runtime keeps many of them awake in one process; a Rivet
// actor would keep one in its per-instance vars.
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { check, type Context } from '../../contracts.ts';
import { Engine, type EngineOptions } from '../../engine.ts';
import { PostgresSnapshotAdapter, type PostgresPool } from '../../postgres.ts';
import { ExperimentalFileSnapshotAdapter, type EncryptedSnapshotAdapter, type VaultEnvelope } from '../../vault.ts';
import { TRIAL_FULL_LINE } from '../../venture/records.ts';
import { checkKey, type ActorCreateInput, type ActorCreated, type ActorEvent, type ActorKey } from './contract.ts';

export type EngineFactoryOptions = Omit<EngineOptions, 'directory'>;
export type BusinessEngineOptions = {
  /** The folder holding every tenant's folder. */
  root: string;
  /** Engine options for one business: storage, demo flag, the hosted model and GitHub transports. */
  engineOptions: (key: ActorKey) => EngineFactoryOptions;
  /** The server's PostgreSQL pool. With it, every business vault is a row in it (engine storage 'postgres'). */
  postgres?: PostgresPool;
  /**
   * Ink v2 wave 4 (4J23): the most a business's vault may hold as stored, in bytes, asked at each write; null for no
   * cap. The hosted app answers a temporary business's cap (limits.trialVaultBytes).
   */
  vaultCap?: (key: ActorKey) => number | null;
};

/**
 * Where one business's vault lives in PostgreSQL. Made from the ids alone, so it stays the same on any server and for
 * any data folder, and can never be a desktop slot (those are hex digests with no dots).
 */
export function hostedVaultSlot(key: ActorKey): string {
  checkKey(key);
  return `hosted.${key[0]}.${key[1]}`;
}

/** <root>/<tenantId>, created on demand, refused if the ids could ever leave root. */
export async function tenantDirectory(root: string, key: ActorKey): Promise<string> {
  checkKey(key);
  const base = resolve(root), path = resolve(base, key[0]);
  const rel = relative(base, path);
  check(rel === key[0] && !rel.startsWith('..') && !isAbsolute(rel), 'INVALID_ACTOR_KEY', 'A tenant folder must sit inside the hosted data folder.');
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}

export class BusinessEngine {
  readonly key: ActorKey;
  lastSeq = 0;
  #engine: Engine;
  #ctx: Context;
  #closed = false;

  private constructor(key: ActorKey, engine: Engine) {
    this.key = key; this.#engine = engine;
    this.#ctx = { ...engine.bootstrapContext(), channel: 'web' };
  }

  static #engineFor(options: BusinessEngineOptions, key: ActorKey, directory: string): Engine {
    const extra = options.engineOptions(key);
    const pool = options.postgres;
    // Every write of the vault, whoever makes it, passes the size cap of a temporary business (4J23) in its store.
    const cap = () => options.vaultCap?.(key) ?? null;
    if (!pool) {
      check(extra.storage === 'experimental-file' && extra.demo === true && extra.vaultStorage === undefined, 'HOSTED_STORAGE_INVALID', 'Hosted businesses use experimental file storage in demo mode, or PostgreSQL through the server pool.');
      return new Engine({ ...extra, directory, vaultStorage: async folder => {
        check(folder === key[1], 'INVALID_ACTOR_KEY', 'A business opens only its own vault.');
        return cappedSnapshotAdapter(new ExperimentalFileSnapshotAdapter(join(directory, folder)), cap);
      } });
    }
    check(extra.storage === 'postgres' && extra.postgresUrl === undefined && extra.vaultStorage === undefined, 'HOSTED_STORAGE_INVALID', 'With the server pool, every hosted business vault is in PostgreSQL.');
    const slot = hostedVaultSlot(key);
    return new Engine({ ...extra, directory, vaultStorage: async folder => {
      check(folder === key[1], 'INVALID_ACTOR_KEY', 'A business opens only its own vault.');
      return cappedSnapshotAdapter(await PostgresSnapshotAdapter.fromPool(pool, slot), cap);
    } });
  }

  /** Makes the business's vault. The recovery code comes back once, here, and is never stored by the server. */
  static async create(options: BusinessEngineOptions, key: ActorKey, input: ActorCreateInput): Promise<{ business: BusinessEngine; created: ActorCreated }> {
    const directory = await tenantDirectory(options.root, key);
    const folder = join(directory, key[1]);
    const existed = await stat(folder).then(() => true, () => false);
    check(!existed, 'BUSINESS_EXISTS', 'This business already has a vault.');
    const engine = BusinessEngine.#engineFor(options, key, directory);
    try {
      const result = await engine.request('workspace.create', { name: input.name, passphrase: input.passphrase, pack: 'services', folder: key[1] });
      const business = new BusinessEngine(key, engine);
      return { business, created: { workspace: result.workspace, recoveryCode: result.recoveryCode } };
    } catch (error) {
      await engine.close().catch(() => {});
      await rm(folder, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  static async open(options: BusinessEngineOptions, key: ActorKey, passphrase: string): Promise<BusinessEngine> {
    const directory = await tenantDirectory(options.root, key);
    // On PostgreSQL the vault may have been made by another server, so this one may not have the lock folder yet.
    if (options.postgres) await mkdir(join(directory, key[1]), { recursive: true, mode: 0o700 });
    const engine = BusinessEngine.#engineFor(options, key, directory);
    try {
      await engine.request('workspace.open', { folder: key[1], passphrase });
      const business = new BusinessEngine(key, engine);
      business.lastSeq = await business.#currentSeq();
      return business;
    } catch (error) {
      await engine.close().catch(() => {});
      throw error;
    }
  }

  async #currentSeq(): Promise<number> {
    try { return ((await this.#engine.requestAs(this.#ctx, 'venture.events', { limit: 1 })) as { lastSeq: number }).lastSeq; }
    catch { return 0; }
  }

  request(method: string, payload: unknown): Promise<unknown> {
    check(!this.#closed, 'ACTOR_ASLEEP', 'This business is asleep. Try again.');
    return this.#engine.requestAs(this.#ctx, method, payload ?? {});
  }

  /** The client share page (Engine.ventureShareLink): reads a link by its token, or records the client's answer. */
  shareLink(op: 'page' | 'decide' | 'comment' | 'upload', token: string, input: unknown = {}): Promise<unknown> {
    check(!this.#closed, 'ACTOR_ASLEEP', 'This business is asleep. Try again.');
    return this.#engine.ventureShareLink(this.#ctx, op, token, input);
  }

  /** Hosted sessions that signed out or were revoked (Ink v2 wave 4, 4G3): their phone alert subscriptions end. */
  endPushSessions(hashes: readonly string[]): Promise<number> {
    check(!this.#closed, 'ACTOR_ASLEEP', 'This business is asleep. Try again.');
    return this.#engine.ventureEndPushSessions(this.#ctx, hashes);
  }

  /** Work the engine started outside its requests, a phone alert under way (4G3): ends with it; null when there is none. */
  outsideWork(): Promise<void> | null {
    return this.#closed ? null : this.#engine.ventureOutsideWork();
  }

  /** The engine's tick (Ink v2 wave 4, 4G1 and 4G3): the journal sweep and the notification centre's look at Today. */
  async tick(): Promise<void> {
    if (this.#closed) return;
    await this.#engine.tick();
  }

  /** Events after lastSeq, oldest first, and lastSeq moved past them. Nothing before the business has a venture. */
  async newEvents(): Promise<ActorEvent[]> {
    if (this.#closed) return [];
    let page: { events: { seq: number; name: string; data: unknown; at: string }[] };
    try { page = await this.#engine.requestAs(this.#ctx, 'venture.events', { afterSeq: this.lastSeq, limit: 100 }); }
    catch { return []; }
    const events = page.events.map(event => ({ seq: event.seq, name: event.name, data: event.data, at: event.at }));
    if (events.length) this.lastSeq = events[events.length - 1].seq;
    return events;
  }

  /** Deletes the vault (the desktop's workspace.delete, with the same typed name) and the business folder. */
  async delete(root: string, confirmation: string): Promise<void> {
    check(!this.#closed, 'ACTOR_ASLEEP', 'This business is asleep. Try again.');
    await this.#engine.requestAs(this.#ctx, 'workspace.delete', { confirmation });
    this.#closed = true;
    await this.#engine.close().catch(() => {});
    const directory = await tenantDirectory(root, this.key);
    await rm(join(directory, this.key[1]), { recursive: true, force: true });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#engine.close();
  }
}

/**
 * The vault store with a size cap (Ink v2 wave 4, 4J23): every commit of the vault's encrypted envelope, from any writer
 * (a venture action, the model port's call records, the engine's own writes), is measured as stored. One that would
 * grow the vault past the cap is refused (TRIAL_LIMIT) and nothing is written; one that keeps it the same size or
 * shrinks it always passes, so a full vault can still be tidied. The cap is asked at each commit; null means none.
 */
export function cappedSnapshotAdapter(inner: EncryptedSnapshotAdapter, cap: () => number | null): EncryptedSnapshotAdapter {
  let stored = 0;
  const sizeOf = (envelope: VaultEnvelope | null) => envelope ? Buffer.byteLength(JSON.stringify(envelope), 'utf8') : 0;
  return {
    kind: inner.kind,
    async load() { const envelope = await inner.load(); stored = sizeOf(envelope); return envelope; },
    async commit(envelope, expectedRevision) {
      const bytes = sizeOf(envelope), limit = cap();
      if (limit !== null) check(bytes <= limit || bytes <= stored, 'TRIAL_LIMIT', TRIAL_FULL_LINE);
      await inner.commit(envelope, expectedRevision);
      stored = bytes;
    },
    async delete() { await inner.delete(); stored = 0; },
    ...(inner.close ? { close: () => inner.close!() } : {}),
  };
}
