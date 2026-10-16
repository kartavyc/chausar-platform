// Chausar hosted tier: one business's engine. Each business is its own Engine over its own encrypted vault, in a folder
// named by its business id inside its tenant's folder. Both runtime adapters use this class: the local runtime keeps
// many of them awake in one process; a Rivet actor would keep one in its per-instance vars.
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { check, type Context } from '../../contracts.ts';
import { Engine, type EngineOptions } from '../../engine.ts';
import { checkKey, type ActorCreateInput, type ActorCreated, type ActorEvent, type ActorKey } from './contract.ts';

export type EngineFactoryOptions = Omit<EngineOptions, 'directory'>;
export type BusinessEngineOptions = {
  /** The folder holding every tenant's folder. */
  root: string;
  /** Engine options for one business: storage, demo flag, the hosted model and GitHub transports. */
  engineOptions: (key: ActorKey) => EngineFactoryOptions;
};

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
    check(extra.storage === 'experimental-file' ? extra.demo === true : extra.storage === 'postgres', 'HOSTED_STORAGE_INVALID', 'Hosted businesses use experimental file storage in demo mode, or PostgreSQL.');
    return new Engine({ ...extra, directory });
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
