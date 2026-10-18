// Chausar venture launcher: the host that serves every venture method to the engine.
// Owned by package P6. The engine reaches this file only through a dynamic import at request time.
//
// Rules this file keeps:
// - It imports no venture package statically. Each package loads on the first use of a method it owns,
//   so one broken or half-written package fails only its own methods.
// - The constructor stores references only: it never throws, never loads a package, never calls a
//   transport factory and never touches the network or the disk.
// - Secrets live on a memory-only shelf that close() empties; the engine closes the host on lock and attach.
import { readFile } from 'node:fs/promises';
import { ChausarError, type Context, type StateStore } from '../contracts.ts';
import { DRAFT_METHODS, METHOD_OWNERS, PRE_VAULT_METHODS, VENTURE_METHODS } from './contracts.ts';
import type {
  CountryProfile, GitHubFixture, GitHubRequest, GitHubResponse, GitHubTransport, ModelPort, ModelPortOptions, ModelPreset,
  ModelPresetId, ModelReplayFixture, ModelStatusView, ModelTask, ModelTransport, PlanPreview, SecretName, SecretShelf,
  VentureDeps, VentureEngineServices, VentureHandlerTable, VentureHostOptions, VentureMethod, VenturePackageId, VentureStorage,
} from './contracts.ts';
import { requireAppChannel } from './records.ts';

const NOT_BUILT_MESSAGE = 'This part of Chausar is not built yet.';
const notBuilt = (message = NOT_BUILT_MESSAGE) => new ChausarError('NOT_BUILT_YET', message);

/** A memory-only secret shelf. Nothing on it is ever written to state, a log or the renderer. */
export function createSecretShelf(): SecretShelf {
  const shelf = new Map<SecretName, string>();
  return Object.freeze({
    get: (name: SecretName) => shelf.get(name) ?? null,
    set: (name: SecretName, value: string) => { shelf.set(name, value); },
    delete: (name: SecretName) => { shelf.delete(name); },
    has: (name: SecretName) => shelf.has(name),
    clear: () => { shelf.clear(); },
  });
}

export type VenturePackageModule = { handlers: VentureHandlerTable } & Record<string, unknown>;
type PackageLoaders = Readonly<Record<VenturePackageId, () => Promise<VenturePackageModule>>>;

/** One loader per package, each a literal dynamic import, so no package loads before one of its methods is used. */
export const PACKAGE_LOADERS: PackageLoaders = Object.freeze({
  core: () => import('./core/index.ts') as Promise<VenturePackageModule>,
  models: () => import('./models/index.ts') as Promise<VenturePackageModule>,
  money: () => import('./money/index.ts') as Promise<VenturePackageModule>,
  build: () => import('./build/index.ts') as Promise<VenturePackageModule>,
  delivery: () => import('./delivery/index.ts') as Promise<VenturePackageModule>,
});

function ownsHandler(table: VentureHandlerTable | undefined, method: VentureMethod): boolean {
  return !!table && typeof table === 'object' && Object.hasOwn(table, method) && typeof (table as Record<string, unknown>)[method] === 'function';
}

/** Answered outside the package tables: the two pre-vault methods, and the nine draft methods the engine's draft desk answers. */
export function outsideTables(method: string): boolean {
  return (PRE_VAULT_METHODS as readonly string[]).includes(method) || (DRAFT_METHODS as readonly string[]).includes(method);
}

/** Methods with no handler in their owner's table. The pre-vault and draft methods are answered outside the tables. */
export function missingHandlers(tables: Partial<Record<VenturePackageId, VentureHandlerTable>>): VentureMethod[] {
  return VENTURE_METHODS.filter(method => !outsideTables(method) && !ownsHandler(tables[METHOD_OWNERS[method]], method));
}

/** Calls a loader once. A synchronous throw and a module without a handler table both count as a failed load. */
function loadPackage(loader: () => Promise<VenturePackageModule>): Promise<VenturePackageModule> {
  return Promise.resolve().then(loader).then(module => {
    if (!module || typeof module !== 'object' || !module.handlers || typeof module.handlers !== 'object') throw notBuilt();
    return module;
  });
}

// The pre-vault methods load core at module level: memoized, and a failure is forgotten so the next call tries again.
let corePending: Promise<VenturePackageModule> | null = null;
function loadCore(): Promise<VenturePackageModule> {
  const pending = corePending ??= loadPackage(PACKAGE_LOADERS.core);
  pending.catch(() => { if (corePending === pending) corePending = null; });
  return pending.catch(() => { throw notBuilt(); });
}

function coreFunction(core: VenturePackageModule, name: 'listCountries' | 'previewPlan'): (...args: unknown[]) => unknown {
  const value = core[name];
  if (typeof value !== 'function') throw notBuilt();
  return value as (...args: unknown[]) => unknown;
}

/** venture.countries, answered before any vault: no state, no model, no write. */
export async function ventureCountries(): Promise<CountryProfile[]> {
  return coreFunction(await loadCore(), 'listCountries')() as CountryProfile[];
}

/** venture.preview, answered before any vault: template words only, nothing stored. */
export async function venturePreview(payload: unknown): Promise<PlanPreview> {
  return coreFunction(await loadCore(), 'previewPlan')(payload) as PlanPreview;
}

/** Reads a synthetic recording from disk. A missing or broken file becomes one plain error. */
async function readRecording(path: string, code: string, message: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new ChausarError(code, message); }
}

/** The newest stored brief id, for the GitHub recording's {{briefId}} placeholder. '' when there is none. */
function latestBriefId(store: StateStore): string {
  const briefs = store.read().conversations.filter(record => record?.kind === 'venture-brief');
  const latest = briefs[briefs.length - 1];
  return typeof latest?.briefId === 'string' ? latest.briefId : '';
}

type HostOptions = VentureHostOptions & { demo: boolean; storage: VentureStorage };
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;

export class VentureHost {
  #store: StateStore;
  #options: HostOptions;
  #loaders: PackageLoaders;
  #packages = new Map<VenturePackageId, Promise<VenturePackageModule>>();
  #secrets: SecretShelf;
  #port: ModelPort | null = null;
  #portPending: Promise<void> | null = null;
  #portFailure = NOT_BUILT_MESSAGE;
  #github: GitHubTransport | null = null;
  #githubPending: Promise<GitHubTransport> | null = null;
  #deps: VentureDeps;
  #closed = false;

  constructor(store: StateStore, services: VentureEngineServices, options: HostOptions, loaders: PackageLoaders = PACKAGE_LOADERS) {
    this.#store = store;
    this.#options = options;
    this.#loaders = loaders;
    this.#secrets = createSecretShelf();
    this.#deps = Object.freeze({
      store,
      clock: options.clock ?? (() => new Date()),
      models: this.#modelsProxy(),
      services,
      github: this.#githubProxy(),
      secrets: this.#secrets,
      host: options.host ?? 'test',
      demo: options.demo,
      storage: options.storage,
      claudeCodeTerms: options.claudeCodeTerms === 'accepted' ? 'accepted' : 'pending',
      ...(options.sandbox ? { sandbox: options.sandbox } : {}),
      ...(options.draft ? { draft: options.draft } : {}),
    });
  }

  /** Routes one venture method to the package that owns it. The pre-vault and draft methods never come here. */
  async request(ctx: Context, method: string, payload: unknown): Promise<unknown> {
    if (!(VENTURE_METHODS as readonly string[]).includes(method) || outsideTables(method)) {
      throw new ChausarError('INVALID_VENTURE_REQUEST', 'This venture request is not supported.');
    }
    const name = method as VentureMethod;
    requireAppChannel(ctx, name);
    if (this.#closed) throw new ChausarError('VAULT_LOCKED', 'Open your workspace first.');
    const module = await this.#load(METHOD_OWNERS[name]);
    if (!ownsHandler(module.handlers, name)) throw notBuilt();
    const handler = (module.handlers as Record<string, Handler>)[name];
    await this.#modelsReady();
    return handler(this.#deps, ctx, payload ?? {});
  }

  /** Empties the secret shelf and drops the model port. The engine calls it on lock and on attach. */
  close(): void {
    this.#closed = true;
    this.#secrets.clear();
    this.#port = null;
    this.#portPending = null;
    this.#github = null;
    this.#githubPending = null;
  }

  #load(id: VenturePackageId): Promise<VenturePackageModule> {
    let pending = this.#packages.get(id);
    if (!pending) {
      const started = loadPackage(this.#loaders[id]);
      this.#packages.set(id, started);
      started.catch(() => { if (this.#packages.get(id) === started) this.#packages.delete(id); });
      pending = started;
    }
    return pending.catch(() => { throw notBuilt(); });
  }

  // ---------------------------------------------------------------------------
  // Models: one port per host, built on first use. A failure is forgotten and tried again on the next request.
  // ---------------------------------------------------------------------------

  async #modelsReady(): Promise<void> {
    if (this.#port || this.#closed) return;
    const pending = this.#portPending ??= this.#buildPort();
    try { await pending; }
    catch { /* Swallowed: deps.models answers NOT_BUILT_YET, so only the calls that need a model fail. */ }
    finally { if (this.#portPending === pending && !this.#port) this.#portPending = null; }
  }

  async #buildPort(): Promise<void> {
    this.#portFailure = NOT_BUILT_MESSAGE;
    const models = await this.#load('models');
    const options = this.#options;
    let transport: ModelTransport;
    if (options.modelTransport) transport = options.modelTransport;
    else if (options.modelReplayPath) {
      const replay = models.createReplayTransport;
      if (typeof replay !== 'function') throw notBuilt();
      const message = 'The model recording could not be read, so model calls are off.';
      const fixture = await readRecording(options.modelReplayPath, 'NOT_BUILT_YET', message)
        .catch(error => { this.#portFailure = message; throw error; });
      transport = (replay as (fixture: ModelReplayFixture) => ModelTransport)(fixture as ModelReplayFixture);
    } else {
      const real = models.defaultModelTransport;
      if (typeof real !== 'function') throw notBuilt();
      transport = (real as (options: { hostProcess?: (request: any) => Promise<any> }) => ModelTransport)(options.hostProcess ? { hostProcess: options.hostProcess } : {});
    }
    const create = models.createModelPort;
    if (typeof create !== 'function') throw notBuilt();
    const portOptions: ModelPortOptions = {
      store: this.#store, clock: this.#deps.clock, transport, secrets: this.#secrets, host: this.#deps.host, demo: this.#deps.demo,
      ...(options.codexCli !== undefined ? { codexCli: options.codexCli } : {}),
      claudeCodeTerms: this.#deps.claudeCodeTerms ?? 'pending',
    };
    const port = (create as (options: ModelPortOptions) => ModelPort)(portOptions);
    if (!port || typeof port !== 'object') throw notBuilt();
    if (!this.#closed) this.#port = port;
  }

  /** deps.models: forwards to the port once it exists. Before that, and after a failed load, every method throws NOT_BUILT_YET. */
  #modelsProxy(): ModelPort {
    const port = (): ModelPort => {
      if (!this.#port) throw notBuilt(this.#portFailure);
      return this.#port;
    };
    return Object.freeze({
      status(ctx: Context): ModelStatusView { return port().status(ctx); },
      presets(): ModelPreset[] { return port().presets(); },
      async checkCli(presetId: ModelPresetId): Promise<void> { return port().checkCli(presetId); },
      async generate<T>(ctx: Context, task: ModelTask<T>) { return port().generate(ctx, task); },
      async preview<T>(ctx: Context, task: ModelTask<T>) { return port().preview(ctx, task); },
      async runPreview<T>(ctx: Context, callId: string, approvedDigest: string, validate: (raw: unknown) => T) {
        return port().runPreview(ctx, callId, approvedDigest, validate);
      },
    });
  }

  // ---------------------------------------------------------------------------
  // GitHub: one transport per host, chosen on first use.
  // ---------------------------------------------------------------------------

  #githubProxy(): GitHubTransport {
    const read = (request: GitHubRequest) => this.#githubRead(request);
    const kind = () => this.#githubKind();
    return Object.freeze({
      read(request: GitHubRequest): Promise<GitHubResponse> { return read(request); },
      get kind(): GitHubTransport['kind'] { return kind(); },
    });
  }

  async #githubRead(request: GitHubRequest): Promise<GitHubResponse> {
    return (await this.#githubTransport()).read(request);
  }

  /** The loaded transport's kind. Before the first read: an injected transport's own kind, else 'fixture' for a replay path, else 'github-api'. */
  #githubKind(): GitHubTransport['kind'] {
    if (this.#github) return this.#github.kind;
    const injected = this.#options.githubTransport;
    if (typeof injected === 'function') {
      try {
        const transport = injected(this.#store);
        if (!this.#closed) this.#github = transport;
        return transport.kind;
      } catch { return 'github-api'; }
    }
    if (injected) return injected.kind;
    return this.#options.githubReplayPath ? 'fixture' : 'github-api';
  }

  async #githubTransport(): Promise<GitHubTransport> {
    if (this.#github) return this.#github;
    const pending = this.#githubPending ??= this.#resolveGitHub();
    try {
      const transport = await pending;
      if (!this.#closed) this.#github = transport;
      return transport;
    } finally {
      if (this.#githubPending === pending) this.#githubPending = null;
    }
  }

  async #resolveGitHub(): Promise<GitHubTransport> {
    const options = this.#options;
    const injected = options.githubTransport;
    if (injected) return typeof injected === 'function' ? injected(this.#store) : injected;
    const build = await this.#load('build');
    if (options.githubReplayPath) {
      const create = build.createFixtureGitHubTransport;
      if (typeof create !== 'function') throw notBuilt();
      const fixture = await readRecording(options.githubReplayPath, 'GITHUB_READ_FAILED', 'The GitHub recording could not be read.');
      const store = this.#store;
      return (create as (fixture: GitHubFixture, vars: () => Record<string, string>) => GitHubTransport)(fixture as GitHubFixture, () => ({ briefId: latestBriefId(store) }));
    }
    const real = build.defaultGitHubTransport;
    if (typeof real !== 'function') throw notBuilt();
    return (real as () => GitHubTransport)();
  }
}
