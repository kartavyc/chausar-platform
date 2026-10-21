// Chausar hosted tier: the application behind the HTTP server. It signs people in, keeps each business's vault key in
// custody, and routes every request to the business actor its session has open. The tenant always comes from the
// session; a request can name a business only from its own user's list.
import { createHash } from 'node:crypto';
import { check } from '../contracts.ts';
import type { PostgresPool } from '../postgres.ts';
import type { ModelTransport, VentureHostOptions } from '../venture/contracts.ts';
import { AccountService, exact, userView, type Authenticated } from './accounts.ts';
import { HostedCustody, isBusinessId, newBusinessId } from './custody.ts';
import type { HostedDirectory, HostedShareLink } from './directory.ts';
import { ConcurrencyGate, RateLimiter, type HostedLimits } from './limits.ts';
import type { Mailer } from './mailer.ts';
import { hostedModelTransport, usageFromCalls } from './models.ts';
import { ACTOR_ACTIONS, ACTOR_EVENTS, type ActorEvent, type ActorKey, type VentureRuntime } from './runtime/contract.ts';
import { LocalVentureRuntime } from './runtime/local.ts';
import type { RelyingParty } from './webauthn.ts';

const WEB = Object.freeze({ channel: 'web' as const });
const GITHUB_ACTIONS = new Set(['venture.build.link', 'venture.build.sync']);
/** Every method a hosted page may send to /api/rpc. Everything else answers HOSTED_NOT_AVAILABLE. */
export const HOSTED_METHODS: readonly string[] = Object.freeze([
  'venture.countries', 'venture.preview',
  'workspace.status', 'workspace.create', 'workspace.open', 'workspace.lock', 'workspace.delete',
  ...ACTOR_ACTIONS.filter(method => method !== 'workspace.status'),
]);
const NOT_HOSTED = 'This part runs in the Chausar desktop app for now. The hosted web app has the launch places only.';
/** The client share page (/share/<token>): thirty reads or answers at once from one address, one more every two seconds. */
const SHARE_PAGE_RATE = Object.freeze({ capacity: 30, refillEveryMs: 2_000 });
/** A share link's token: 24 random bytes as base64url (venture/build/share-links.ts). */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** The token at the end of a share address made on this server, or null. */
function shareTokenOf(url: string): string | null {
  const match = /\/share\/([A-Za-z0-9_-]{32})$/.exec(url);
  return match ? match[1] : null;
}
/** What the share page shows (SharePage in venture/build/share-links.ts). Text only; the page escapes every field. */
export type SharePageView = {
  businessName: string; title: string; text: string; expires: string; digest: string;
  decision: { decision: 'approved' | 'changes'; comment: string | null } | null;
};

export type HostedAppOptions = {
  root: string; // tenants live in <root>/tenants
  rp: RelyingParty;
  directory: HostedDirectory;
  custody: HostedCustody;
  mailer: Mailer;
  limits: HostedLimits;
  version: string;
  /** The model transport each business's gate wraps: the real HTTPS one, or a synthetic recording. */
  modelTransport: ModelTransport;
  githubTransport: VentureHostOptions['githubTransport'];
  /** The server's PostgreSQL pool. With it, business vaults are PostgreSQL rows; without it, experimental files. */
  postgres?: PostgresPool;
  clock?: () => Date;
  /** CHAUSAR_PUBLIC_URL (config.publicUrl): the origin client share links use. Absent: links get no address. */
  publicUrl?: string | null;
  /** Tests may pass a runtime built over the same directory and custody. */
  runtime?: (options: { root: string; passphrase: (key: ActorKey) => Promise<string>; engineOptions: (key: ActorKey) => any; postgres?: PostgresPool }) => VentureRuntime;
};

export class HostedApp {
  readonly accounts: AccountService;
  readonly runtime: VentureRuntime;
  readonly options: HostedAppOptions;
  #clock: () => Date;
  #rpcRate: RateLimiter;
  #modelRate: RateLimiter;
  #githubRate: RateLimiter;
  #shareRate: RateLimiter;
  #modelGate: ConcurrencyGate;
  #dirty = new Set<string>();
  #sleeper: ReturnType<typeof setInterval> | null = null;

  constructor(options: HostedAppOptions) {
    this.options = options;
    this.#clock = options.clock ?? (() => new Date());
    const ms = () => this.#clock().getTime();
    this.accounts = new AccountService({ directory: options.directory, custody: options.custody, mailer: options.mailer, rp: options.rp, limits: options.limits, clock: this.#clock });
    this.#rpcRate = new RateLimiter('rpc-session', options.limits.rpcPerSession, ms);
    this.#modelRate = new RateLimiter('model-tenant', options.limits.modelCallsPerTenant, ms);
    this.#githubRate = new RateLimiter('github-tenant', options.limits.githubSyncsPerTenant, ms);
    this.#shareRate = new RateLimiter('share-address', SHARE_PAGE_RATE, ms);
    this.#modelGate = new ConcurrencyGate(options.limits.modelConcurrencyPerTenant);
    const root = `${options.root.replace(/[\\/]+$/, '')}/tenants`;
    const runtimeOptions = { root, passphrase: (key: ActorKey) => this.#passphrase(key), engineOptions: (key: ActorKey) => this.#engineOptions(key), postgres: options.postgres };
    this.runtime = options.runtime ? options.runtime(runtimeOptions)
      : new LocalVentureRuntime({ ...runtimeOptions, idleMs: options.limits.actorIdleMs, maxAwake: options.limits.awakeActors, clock: ms });
  }

  /** Puts idle businesses to sleep once a minute. The timer does not keep the process alive. */
  startHousekeeping() {
    if (this.#sleeper) return;
    this.#sleeper = setInterval(() => { void this.runtime.sleepIdle().catch(() => {}); }, 60_000);
    this.#sleeper.unref();
  }

  async close() {
    if (this.#sleeper) clearInterval(this.#sleeper);
    this.#sleeper = null;
    try { await this.runtime.dispose(); }
    finally { await this.options.directory.close(); }
  }

  async #passphrase(key: ActorKey): Promise<string> {
    const user = this.options.directory.read().users.find(item => item.tenantId === key[0]);
    const business = user?.businesses.find(item => item.id === key[1]);
    check(user && business, 'BUSINESS_NOT_FOUND', 'That business is not on your account.');
    return this.options.custody.unwrapPassphrase(key[0], key[1], business.sealedPassphrase);
  }

  #engineOptions(key: ActorKey) {
    const id = `${key[0]}/${key[1]}`;
    const modelTransport = hostedModelTransport({
      tenantId: key[0], inner: this.options.modelTransport,
      usage: () => this.options.directory.read().usage[key[0]] ?? [],
      ceilingMicros: this.options.limits.monthlyModelCeilingMicros,
      rate: this.#modelRate, gate: this.#modelGate, clock: this.#clock,
      dispatched: () => { this.#dirty.add(id); },
    });
    const venture: VentureHostOptions = { host: 'hosted-web', modelTransport, githubTransport: this.options.githubTransport, clock: this.#clock,
      ...(this.options.publicUrl ? { publicUrl: this.options.publicUrl } : {}) };
    // The engine keeps its preview profile (demo) on both stores: exact integer arithmetic, labelled experimental.
    return { demo: true, storage: this.#storage(), version: this.options.version, venture };
  }

  #storage() { return this.options.postgres ? 'postgres' as const : 'experimental-file' as const; }

  #key(auth: Authenticated, businessId = auth.session.businessId): ActorKey {
    check(businessId && auth.user.businesses.some(item => item.id === businessId), 'VAULT_LOCKED', 'Choose one of your businesses first.');
    return [auth.user.tenantId, businessId];
  }

  /** What the page needs about the signed-in person. */
  me(auth: Authenticated) {
    return {
      user: userView(auth.user), businessId: auth.session.businessId, method: auth.session.method,
      sessionCreatedAt: auth.session.createdAt, mail: { kind: this.accounts.mailer.kind, delivers: this.accounts.mailer.delivers },
      limits: { businesses: this.options.limits.businessesPerAccount, passkeys: this.options.limits.passkeysPerAccount },
      runtime: { adapter: this.runtime.descriptor.adapter, capabilities: this.runtime.descriptor.capabilities },
      experimental: true,
    };
  }

  async select(auth: Authenticated, input: unknown) {
    const body = exact(input, ['businessId'], ['businessId']);
    check(body.businessId === null || isBusinessId(body.businessId), 'BUSINESS_NOT_FOUND', 'That business is not on your account.');
    return this.accounts.selectBusiness(auth, body.businessId as string | null);
  }

  /** The one RPC route the renderer uses. */
  async rpc(auth: Authenticated, method: unknown, payload: unknown): Promise<unknown> {
    check(typeof method === 'string' && method.length <= 80, 'INVALID_REQUEST', 'Use a named request.');
    this.#rpcRate.take(auth.session.id);
    check(HOSTED_METHODS.includes(method), 'HOSTED_NOT_AVAILABLE', NOT_HOSTED);
    const input = payload ?? {};
    switch (method) {
      case 'venture.countries': return (await import('../venture/host.ts')).ventureCountries();
      case 'venture.preview': return (await import('../venture/host.ts')).venturePreview(input);
      case 'workspace.status': return this.#status(auth);
      case 'workspace.create': return this.#createBusiness(auth, input);
      case 'workspace.open': {
        const body = exact(input, ['businessId'], ['businessId']);
        check(isBusinessId(body.businessId), 'BUSINESS_NOT_FOUND', 'That business is not on your account.');
        await this.accounts.selectBusiness(auth, body.businessId);
        return { workspace: (await this.runtime.get(this.#key(auth, body.businessId)).action('workspace.status', {}, WEB) as any).workspace };
      }
      case 'workspace.lock': await this.accounts.selectBusiness(auth, null); return { locked: true };
      case 'workspace.delete': return this.#deleteBusiness(auth, input);
    }
    const key = this.#key(auth);
    if (GITHUB_ACTIONS.has(method)) this.#githubRate.take(auth.user.tenantId, 'This account checked GitHub many times in the last few minutes. Wait a little.');
    let result: unknown;
    try { result = await this.runtime.get(key).action(method, input, WEB); }
    finally { await this.#syncUsage(key).catch(() => {}); }
    if (method === 'venture.share.create') await this.#indexShare(key, result);
    if (method === 'venture.share.revoke') await this.#unindexShare(key, result);
    return result;
  }

  /**
   * After venture.share.create: notes where the new link's token leads, so /share/<token> finds the business without the
   * owner's session. Only the token's sha256 is kept. A link made without an address (no CHAUSAR_PUBLIC_URL) is not noted.
   */
  async #indexShare(key: ActorKey, result: unknown) {
    const view = result as { id?: unknown; url?: unknown; expiresAt?: unknown } | null;
    if (!view || typeof view.url !== 'string' || typeof view.id !== 'string' || typeof view.expiresAt !== 'string') return;
    const token = shareTokenOf(view.url);
    check(token, 'SHARE_LINK_REFUSED', 'The share link came back without its address.');
    const entry: HostedShareLink = { tokenHash: sha256(token), tenantId: key[0], businessId: key[1], linkId: view.id, expiresAt: view.expiresAt };
    await this.options.directory.update(state => { (state.shareLinks ??= []).push(entry); });
  }

  /** After venture.share.revoke: the link no longer leads anywhere. The vault refuses it too. */
  async #unindexShare(key: ActorKey, result: unknown) {
    const id = (result as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') return;
    await this.options.directory.update(state => {
      state.shareLinks = (state.shareLinks ?? []).filter(link => !(link.tenantId === key[0] && link.businessId === key[1] && link.linkId === id));
    });
  }

  /**
   * The client share page: a read of the link a token opens, or with an answer, the client's decision. No session: the
   * token is the only key, checked again inside the business's vault. Every miss (unknown, ended, taken back, a business
   * that is gone) answers null alike, so the page says only that nothing is here. Limited per address.
   */
  async sharePage(token: string, address: string, answer?: { decision: unknown; comment?: unknown; digest: unknown }): Promise<SharePageView | null> {
    this.#shareRate.take(address, 'Too many tries from here. Wait a minute and try again.');
    if (!SHARE_TOKEN_PATTERN.test(token)) return null;
    const hash = sha256(token);
    const nowMs = this.#clock().getTime();
    const directory = this.options.directory.read();
    const found = (directory.shareLinks ?? []).find(link => link.tokenHash === hash && Date.parse(link.expiresAt) > nowMs);
    if (!found) return null;
    const owner = directory.users.find(user => user.tenantId === found.tenantId && user.status === 'active');
    if (!owner?.businesses.some(business => business.id === found.businessId)) return null;
    const handle = this.runtime.get([found.tenantId, found.businessId]);
    if (typeof handle.shareLink !== 'function') return null;
    return await handle.shareLink(answer ? 'decide' : 'page', token, answer ?? {}) as SharePageView | null;
  }

  async #status(auth: Authenticated) {
    const hosted = { email: auth.user.email, businessId: auth.session.businessId, businesses: userView(auth.user).businesses, experimental: true };
    if (!auth.session.businessId || !auth.user.businesses.some(item => item.id === auth.session.businessId)) {
      return { open: false, storage: this.#storage(), experimental: true, version: this.options.version, hosted };
    }
    const status = await this.runtime.get(this.#key(auth)).action('workspace.status', {}, WEB) as Record<string, unknown>;
    return { ...status, experimental: true, hosted };
  }

  async #createBusiness(auth: Authenticated, input: unknown) {
    const body = exact(input, ['name', 'pack'], ['name']);
    check(body.pack === undefined || body.pack === 'services', 'UNKNOWN_PACK', 'The hosted app starts service businesses.');
    check(typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.length <= 100 && !/[\u0000-\u001f\u007f]/.test(body.name), 'INVALID_NAME', 'Give your business a name.');
    const name = body.name.trim();
    const { custody, directory, limits } = this.options;
    const businessId = newBusinessId();
    const key: ActorKey = [auth.user.tenantId, businessId];
    const passphrase = custody.newVaultPassphrase();
    const sealedPassphrase = custody.wrapPassphrase(key[0], key[1], passphrase);
    // The sealed key is recorded first, so a vault never exists that the server can't open.
    await directory.update(state => {
      const user = state.users.find(item => item.id === auth.user.id);
      check(user && user.status === 'active', 'UNAUTHENTICATED', 'Sign in again.');
      check(user.businesses.length < limits.businessesPerAccount, 'LIMIT_REACHED', `An account can keep ${limits.businessesPerAccount} businesses on this server for now.`);
      user.businesses.push({ id: businessId, name, createdAt: this.#clock().toISOString(), sealedPassphrase, workspaceId: null });
    });
    let created;
    try { created = await this.runtime.create(key, { name, passphrase }); }
    catch (error) {
      await directory.update(state => {
        const user = state.users.find(item => item.id === auth.user.id);
        if (user) user.businesses = user.businesses.filter(item => item.id !== businessId);
      }).catch(() => {});
      throw error;
    }
    await directory.update(state => {
      const user = state.users.find(item => item.id === auth.user.id);
      const business = user?.businesses.find(item => item.id === businessId);
      if (business) business.workspaceId = created.workspace.id;
      const session = state.sessions.find(item => item.id === auth.session.id);
      if (session) session.businessId = businessId;
    });
    return { workspace: created.workspace, recoveryCode: created.recoveryCode, recoveryKit: created.recoveryCode, experimental: true, businessId };
  }

  async #deleteBusiness(auth: Authenticated, input: unknown) {
    const body = exact(input, ['confirmation'], ['confirmation']);
    check(typeof body.confirmation === 'string', 'CONFIRMATION_REQUIRED', 'Type the business name to delete it.');
    const key = this.#key(auth);
    await this.runtime.destroy(key, body.confirmation);
    await this.options.directory.update(state => {
      for (const user of state.users) if (user.tenantId === key[0]) user.businesses = user.businesses.filter(item => item.id !== key[1]);
      for (const session of state.sessions) if (session.businessId === key[1]) session.businessId = null;
      if (state.shareLinks) state.shareLinks = state.shareLinks.filter(link => !(link.tenantId === key[0] && link.businessId === key[1]));
    });
    return { deleted: true, copiesRemoved: 0, externalCopies: 'Copies made outside Chausar must be removed by their owner.' };
  }

  /** After an action that sent a model call, copy the recorded costs into the account's ledger for the ceiling. */
  async #syncUsage(key: ActorKey) {
    const id = `${key[0]}/${key[1]}`;
    if (!this.#dirty.delete(id)) return;
    const calls = await this.runtime.get(key).action('venture.models.calls', { limit: 100 }, WEB) as { id: string; at: string; status: string; costMicros: string | null }[];
    const known = this.options.directory.read().usage[key[0]] ?? [];
    const entries = usageFromCalls(key[1], calls, known);
    if (!entries.length) return;
    await this.options.directory.update(state => {
      const list = state.usage[key[0]] ??= [];
      for (const entry of entries) if (!list.some(item => item.callId === entry.callId)) list.push(entry);
    });
  }

  /** Every declared event of the open business, for the page's event stream. */
  subscribe(auth: Authenticated, listener: (event: ActorEvent) => void): () => void {
    const handle = this.runtime.get(this.#key(auth));
    const offs = ACTOR_EVENTS.map(name => handle.on(name, listener));
    return () => { for (const off of offs) off(); };
  }
}

