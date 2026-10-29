import {clearSessionMemory} from './core/session-cleanup.ts';
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
import { ChausarError, type Context, type State, type StateStore } from '../contracts.ts';
import { DRAFT_METHODS, METHOD_OWNERS, PRE_VAULT_METHODS, VENTURE_METHODS, VENTURE_RUN_EVENT_TYPES } from './contracts.ts';
import type {
  CountryProfile, GitHubFixture, GitHubRequest, GitHubResponse, GitHubTransport, ModelPort, ModelPortOptions, ModelPreset,
  ModelPresetId, ModelReplayFixture, ModelStatusView, ModelTask, ModelTransport, PlanPreview, SecretName, SecretShelf,
  VentureDeps, VentureEngineServices, VentureEventRecord, VentureHandlerTable, VentureHostOptions, VentureMethod, VenturePackageId,
  VentureRunEvent, VentureRunEventType, VentureStorage, WaysView,
} from './contracts.ts';
import { requireAppChannel } from './records.ts';
import { endSessionAllowances } from './policy/allow-session.ts';

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
  views: () => import('./views/index.ts') as Promise<VenturePackageModule>,
  // Ink v2 wave 4 (package 4-0): agents (4B, 4J13, 4J17, 4J18), chief (4C), network (4D, 4E), notify (4G).
  agents: () => import('./agents/index.ts') as Promise<VenturePackageModule>,
  chief: () => import('./chief/index.ts') as Promise<VenturePackageModule>,
  network: () => import('./network/index.ts') as Promise<VenturePackageModule>,
  notify: () => import('./notify/index.ts') as Promise<VenturePackageModule>,
  // Ink v2 wave 5 (package 5-0): playbooks (the kit's methods, the CA firm's new ones and every business's desk).
  playbooks: () => import('./playbooks/index.ts') as Promise<VenturePackageModule>,
});

function ownsHandler(table: VentureHandlerTable | undefined, method: VentureMethod): boolean {
  return !!table && typeof table === 'object' && Object.hasOwn(table, method) && typeof (table as Record<string, unknown>)[method] === 'function';
}

/** Answered outside the package tables: the pre-vault methods, and the nine draft methods the engine's draft desk answers. */
export function outsideTables(method: string): boolean {
  return (PRE_VAULT_METHODS as readonly string[]).includes(method) || (DRAFT_METHODS as readonly string[]).includes(method);
}

/** The methods that save a settings form (core/settings-drafts.ts SETTINGS_FORMS, which a test keeps the same). */
export const SETTINGS_SAVE_METHODS: ReadonlySet<string> = new Set([
  'venture.spend.policy.set', 'venture.owner.set', 'venture.notify.settings', 'venture.goals.set', 'venture.posting.limits.set', 'venture.pipeline.settings',
]);

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

function coreFunction(core: VenturePackageModule, name: 'listCountries' | 'previewPlan' | 'listWays' | 'openWayBusiness'): (...args: unknown[]) => unknown {
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

/**
 * venture.playbooks.list (Ink v2 wave 4, 4J8), answered before any vault by core's listWays: the ways to earn, no
 * model, no write. open: trusted host composition, never from the payload. While a vault is open the engine passes its
 * state (only read) and folder id, so the open business's way says "You run this"; the hosted web app, whose vaults
 * live in business actors, passes the session's open business as it read it (its id, name and playbook).
 */
export async function venturePlaybooks(
  payload: unknown,
  open: { state: State; businessId: string } | { business: { businessId: string; name: string; playbook: string | null } } | null = null,
  // 4J6: the other businesses on this computer whose saved summaries name their playbook, from trusted host composition.
  others: readonly { businessId: string; name: string; playbook: string | null }[] = [],
): Promise<WaysView> {
  const core = await loadCore();
  const list = coreFunction(core, 'listWays');
  const business = !open ? null : 'business' in open ? open.business : coreFunction(core, 'openWayBusiness')(open.state, open.businessId);
  return list(payload, [...(business ? [business] : []), ...others]) as WaysView;
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
    // The network's forgotten-list key (4D1): derived from the vault's own key, held on the shelf while it is open. A
    // store that cannot derive one leaves the shelf without it, and Forget says it could not keep the check.
    const derive = (store as StateStore & { derivedKey?: (purpose: 'network-forget' | 'receipt-signing' | 'journal-head') => Buffer }).derivedKey;
    try { if (typeof derive === 'function') this.#secrets.set('network:forget', derive.call(store, 'network-forget').toString('hex')); } catch { /* never throws */ }
    // 4J10: the receipt signing key's seed and the journal head's HMAC key, the same way, never in a record, export or backup.
    try { if (typeof derive === 'function') this.#secrets.set('receipt:signing', derive.call(store, 'receipt-signing').toString('hex')); } catch { /* never throws */ }
    try { if (typeof derive === 'function') this.#secrets.set('journal:head', derive.call(store, 'journal-head').toString('hex')); } catch { /* never throws */ }
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
      ...(options.delegate ? { delegate: options.delegate } : {}),
      ...(options.draft ? { draft: options.draft } : {}),
      ...(options.workspace ? { workspace: options.workspace } : {}),
      // A folder on this computer: never on the hosted web server.
      ...(options.siteFolder && options.host !== 'hosted-web' ? { siteFolder: options.siteFolder } : {}),
      // The public origin for client share links: only on the hosted web server.
      ...(options.publicUrl && options.host === 'hosted-web' ? { publicUrl: options.publicUrl } : {}),
      ...(options.notify ? { publish: (records: VentureEventRecord[]) => this.#publish(records) } : {}),
      // A transcript made on this computer: the ffmpeg port, and how the engine stops it when the workspace closes.
      ...(options.ffmpeg && options.host !== 'hosted-web' ? { ffmpeg: options.ffmpeg } : {}),
      ...(options.closing ? { closing: options.closing } : {}),
      // Ink v2 wave 4 (4G1): when the owner last had Chausar open, for the alert rules of notify/centre.ts.
      ...(options.watching ? { watching: options.watching } : {}),
      // Ink v2 wave 4 (4G3): the web push key for phone alerts, only on the hosted web server.
      ...(options.push && options.host === 'hosted-web' ? { push: options.push } : {}),
      // The owner's own context inside the app, for phone alerts sent under the owner's standing setting (4G3).
      ...(options.ownerContext ? { ownerContext: options.ownerContext } : {}),
      // Sessions the hosted account lists as signed out or revoked: their browsers get nothing (4G3).
      ...(options.endedSessions && options.host === 'hosted-web' ? { endedSessions: options.endedSessions } : {}),
      // The network guard's lookup and sender, when a test injects them (the real ones otherwise).
      ...(options.net ? { net: options.net } : {}),
      // Ink v2 wave 4 (4J23): whether this business is temporary (no real money, nothing sent), only on the hosted web server.
      ...(options.trial && options.host === 'hosted-web' ? { trial: options.trial } : {}),
      // Ink v2 wave 5 (5A5): the desktop's report printer; never on the hosted web server.
      ...(options.print && options.host !== 'hosted-web' ? { print: options.print } : {}),
    });
  }

  /** A commit changed Today since the notification centre last looked (4G1). */
  #noticesDue = false;

  /**
   * The run events among what one venture action committed, for the desktop push and /api/events. Each frame carries
   * its seq (its place in the business's log, so a client that reconnects replays the gap) and, on notify.new alone,
   * the count. A commit with queue.changed or run.waiting makes the centre due for a look (4G1).
   */
  #publish(records: VentureEventRecord[]): void {
    const notify = this.#options.notify;
    const runs = records.filter(record => (VENTURE_RUN_EVENT_TYPES as readonly string[]).includes(record.name));
    if (runs.some(record => record.name === 'queue.changed' || record.name === 'run.waiting')) this.#noticesDue = true;
    if (!notify || !runs.length) return;
    // The business is the workspace folder, the id workspace.list and the queue rows use.
    let businessId: string;
    try { businessId = this.#options.workspace?.current().id ?? this.#store.read().workspace.id; } catch { return; }
    const whole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
    notify(runs.map((record): VentureRunEvent => {
      const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data) ? record.data : {};
      const runId = data.runId;
      const count = record.name === 'notify.new' && whole(data.count) ? data.count : undefined;
      return {
        type: record.name as VentureRunEventType, businessId, ...(typeof runId === 'string' ? { runId } : {}), at: record.at,
        ...(whole(record.seq) ? { seq: record.seq } : {}), ...(count !== undefined ? { count } : {}),
      };
    }));
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
    try {
      const answer = await handler(this.#deps, ctx, payload ?? {});
      // 4J2 (O22): a settings form's autosaved draft is cleared once its real method succeeded with the same values.
      if (SETTINGS_SAVE_METHODS.has(name)) await import('./core/settings-drafts.ts').then(drafts => drafts.clearSavedDraft(this.#deps, ctx, name, payload ?? {})).catch(() => false);
      return answer;
    } finally {
      // The centre looks at Today before the request answers, so a screen that reads it next sees what changed.
      if (this.#noticesDue) await this.#refreshNotices(ctx);
    }
  }

  /** The notification centre's looks, one at a time: each waits for the one before it. */
  #looking: Promise<unknown> = Promise.resolve();

  /**
   * The notification centre's chokepoint (notify/centre.ts notifyRefresh), one look at a time, so two looks never
   * plan from the same view of Today. Never throws: a refresh that fails leaves the centre as it was, and the next
   * commit or tick looks again. Answers true when it ran, false without a business, null when it could not run.
   */
  #refreshNotices(ctx: Context): Promise<boolean | null> {
    const look = this.#looking.then(() => this.#lookOnce(ctx));
    this.#looking = look.catch(() => {});
    return look;
  }

  async #lookOnce(ctx: Context): Promise<boolean | null> {
    this.#noticesDue = false;
    if (this.#closed) return null;
    try {
      if (!this.#store.read().conversations.some(record => record?.kind === 'venture-record')) return false;
      const notify = await this.#load('notify');
      this.#notify = notify;
      const refresh = notify.notifyRefresh;
      if (typeof refresh !== 'function') return null;
      await (refresh as (deps: VentureDeps, ctx: Context) => Promise<unknown>)(this.#deps, ctx);
      return true;
    } catch {
      return null;
    }
  }

  /**
   * The engine's tick (4G1): the notification centre looks at Today, so time alone can bring an alert (quiet hours that
   * ended, the wait between alerts, the digest's hour). Never throws; the answers of #refreshNotices.
   */
  async notifyTick(ctx: Context): Promise<boolean | null> {
    return this.#refreshNotices(ctx);
  }

  /** The notify package once a look has loaded it (4G3), for the work its looks started outside them. */
  #notify: VenturePackageModule | null = null;

  /**
   * Work the notification centre started outside its looks for this business, phone alerts under way (4G3): a promise
   * that ends with it, or null when there is none. The hosted runtime keeps the business awake until it ends.
   */
  outsideWork(): Promise<void> | null {
    const pending = this.#notify?.outsidePending;
    return typeof pending === 'function' ? (pending as (store: object) => Promise<void> | null)(this.#store) : null;
  }

  /** Before the business closes (lock, switch, quit): waits for that work to end, at most timeoutMs. Never throws. */
  async settle(timeoutMs = 12_000): Promise<void> {
    const work = this.outsideWork();
    if (!work) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); })]); }
    catch { /* The work catches its own failures. */ }
    finally { if (timer) clearTimeout(timer); }
  }

  /**
   * Trusted host only (the hosted server, 4G3): hosted sessions that signed out or were revoked, as hashes of their ids;
   * their phone alert subscriptions are deleted. No RPC method reaches this. Answers how many went.
   */
  async endPushSessions(ctx: Context, hashes: readonly string[]): Promise<number> {
    if (this.#closed) throw new ChausarError('VAULT_LOCKED', 'Open your workspace first.');
    if (!this.#store.read().conversations.some(record => record?.kind === 'venture-record')) return 0;
    const notify = await this.#load('notify');
    this.#notify = notify;
    const end = notify.endPushSessions;
    if (typeof end !== 'function') throw notBuilt();
    return await (end as (deps: VentureDeps, ctx: Context, hashes: readonly string[]) => Promise<number>)(this.#deps, ctx, hashes);
  }

  /**
   * The hosted /share/<token> page (build/share-links.ts): 'page' reads the link a token opens (input.preview: the
   * owner's own look, which never counts as viewed), 'decide' records the client's answer through it, 'comment' the
   * client's comment on one item (4J7). 'upload' is the /share/<token>/upload page's step (build/file-requests.ts, 4J7).
   * Trusted host only: no RPC method reaches this, and the token never leaves the call. Answers null when the token
   * opens nothing.
   */
  async shareLink(ctx: Context, op: 'page' | 'decide' | 'comment' | 'upload', token: string, input: unknown = {}): Promise<unknown> {
    if (this.#closed) throw new ChausarError('VAULT_LOCKED', 'Open your workspace first.');
    const module = await this.#load('build');
    const page = module.sharePage, decide = module.shareDecide, comment = module.shareComment, upload = module.fileRequestEntry;
    if (typeof page !== 'function' || typeof decide !== 'function' || typeof comment !== 'function' || typeof upload !== 'function') throw notBuilt();
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    type Entry = (deps: VentureDeps, ctx: Context, token: string, input: Record<string, unknown>) => Promise<unknown>;
    if(body.storefront===true){const entry=(await this.#load('playbooks')).storefrontEntry;const {storefront:_flag,...fields}=body;return typeof entry==='function'?(entry as Entry)(this.#deps,ctx,token,fields):null;}
    if (body.siteForm === true) {
      const capture = (await this.#load('playbooks')).siteFormEntry;
      const {siteForm:_flag,...fields}=body;
      return typeof capture === 'function' ? (capture as Entry)(this.#deps,ctx,token,fields) : null;
    }
    // 5G: a rating token never falls through to a client draft link, and carries no transcript.
    if (body.supportRating === true) {
      const rating = (await this.#load('playbooks')).supportRatingEntry;
      return typeof rating === 'function' ? (rating as Entry)(this.#deps, ctx, token, { operation: op === 'page' ? 'page' : 'rate', score: body.score }) : null;
    }
    if (op === 'page') {
      const found = await (page as Entry)(this.#deps, ctx, token, { preview: body.preview === true });
      if (found !== null) return found;
      // Ink v2 wave 5 (5A5): a client report's link (playbooks/kit/report/share.ts), read only, opens on the same page.
      const report = (await this.#load('playbooks')).reportSharePage;
      return typeof report === 'function' ? (report as Entry)(this.#deps, ctx, token, { preview: body.preview === true }) : null;
    }
    if (op === 'comment') return (comment as Entry)(this.#deps, ctx, token, body);
    if (op === 'upload') return (upload as Entry)(this.#deps, ctx, token, body);
    return (decide as Entry)(this.#deps, ctx, token, body);
  }

  /**
   * Sweeps the action journal of the open business (build/journal-sweep.ts): a claim older than claimLimitMs becomes
   * outcome_unknown and is never run again; a run-out approval or proposal is rejected. The engine calls it when a vault
   * opens (nothing of this process is in flight then, so any claim counts) and on its scheduler tick. Never throws:
   * answers how many entries moved, 0 for a vault without a business, or null when the sweep could not run.
   */
  async sweepJournal(ctx: Context, claimLimitMs?: number): Promise<number | null> {
    if (this.#closed) return null;
    try {
      if (!this.#store.read().conversations.some(record => record?.kind === 'venture-record')) return 0;
      const build = await this.#load('build');
      const sweep = build.sweepWholeJournal;
      if (typeof sweep !== 'function') return null;
      const moved = await (sweep as (deps: VentureDeps, ctx: Context, limit?: number) => Promise<unknown[]>)(this.#deps, ctx, claimLimitMs);
      return moved.length;
    } catch {
      return null;
    }
  }

  /**
   * The open business's summary for the other businesses on this computer (money/across.ts businessSnapshot, 4J6): its
   * totals with their receipt ids and its counts, never a client's words, and the addresses its blocklist keeps out.
   * The engine calls it at most once a minute while the business changes and on lock. Never throws: null without a
   * business, or when it could not be made.
   */
  async snapshot(ctx: Context): Promise<{ snapshot: Record<string, unknown>; neverContact: string[] } | null> {
    if (this.#closed) return null;
    try {
      if (!this.#store.read().conversations.some(record => record?.kind === 'venture-record')) return null;
      const money = await this.#load('money');
      const made = money.businessSnapshot;
      if (typeof made !== 'function') return null;
      return await (made as (deps: VentureDeps, ctx: Context) => Promise<{ snapshot: Record<string, unknown>; neverContact: string[] } | null>)(this.#deps, ctx);
    } catch {
      return null;
    }
  }

  /** Empties the secret shelf and drops the model port. The engine calls it on lock and on attach. */
  close(): void {
    // 4J1: this vault's "allow for this session" ends first, before anything that could throw; other businesses open in
    // this process keep theirs (policy/allow-session.ts).
    endSessionAllowances(this.#store);
    clearSessionMemory(this.#secrets);
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
      // Ink v2 wave 4 (4H1): a look at the owner's Claude Code or Codex for venture.models.cli.status ({ fresh } on "Check again").
      async inspectCli(...args: Parameters<NonNullable<ModelPort['inspectCli']>>) {
        const real = port();
        if (!real.inspectCli) throw notBuilt();
        return real.inspectCli(...args);
      },
      async generate<T>(ctx: Context, task: ModelTask<T>) { return port().generate(ctx, task); },
      async preview<T>(ctx: Context, task: ModelTask<T>) { return port().preview(ctx, task); },
      async runPreview<T>(ctx: Context, callId: string, approvedDigest: string, validate: (raw: unknown) => T, options?: { consent?: 'standing-judge' | 'owner-file-drop'; beforeDispatch?: () => void }) {
        return port().runPreview(ctx, callId, approvedDigest, validate, options);
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
