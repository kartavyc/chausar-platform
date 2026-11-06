// Chausar hosted tier: the application behind the HTTP server. It signs people in, keeps each business's vault key in
// custody, and routes every request to the business actor its session has open. The tenant always comes from the
// session; a request can name a business only from its own user's list.
import { createHash } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ChausarError, check } from '../contracts.ts';
import { PostgresSnapshotAdapter, type PostgresPool } from '../postgres.ts';
import type { ModelTransport, VentureHostOptions, WebPushPort } from '../venture/contracts.ts';
import { AccountService, exact, userView, type Authenticated } from './accounts.ts';
import { HostedCustody, isBusinessId, isTenantId, newBusinessId } from './custody.ts';
import type { DirectoryState, HostedDirectory, HostedShareLink, HostedUser } from './directory.ts';
import { ConcurrencyGate, RateLimiter, type HostedLimits } from './limits.ts';
import type { Mailer } from './mailer.ts';
import { OwnerWatch, pushSessionHash } from './notify.ts';
import { hostedModelTransport, usageFromCalls } from './models.ts';
import { ACTOR_ACTIONS, ACTOR_EVENTS, type ActorEvent, type ActorKey, type VentureRuntime } from './runtime/contract.ts';
import { hostedVaultSlot } from './runtime/business.ts';
import { LocalVentureRuntime } from './runtime/local.ts';
import {
  TRIAL_REFUSED_METHODS, forgetTrial, markTrialEnding, trialBusinessGone, trialBusinessStarted, trialDue, trialView, vaultOwner, vaultTenantOf,
  type TrialView,
} from './trial.ts';
import type { RelyingParty } from './webauthn.ts';

const WEB = Object.freeze({ channel: 'web' as const });
const GITHUB_ACTIONS = new Set(['venture.build.link', 'venture.build.sync']);
/** Every method a hosted page may send to /api/rpc. Everything else answers HOSTED_NOT_AVAILABLE. */
export const HOSTED_METHODS: readonly string[] = Object.freeze([
  'venture.countries', 'venture.preview', 'venture.playbooks.list',
  'workspace.status', 'workspace.create', 'workspace.open', 'workspace.lock', 'workspace.delete',
  ...ACTOR_ACTIONS.filter(method => method !== 'workspace.status'),
]);
const NOT_HOSTED = 'This part runs in the Chausar desktop app for now. The hosted web app has the launch places only.';
/** The client share page (/share/<token>): thirty reads or answers at once from one address, one more every two seconds. */
const SHARE_PAGE_RATE = Object.freeze({ capacity: 30, refillEveryMs: 2_000 });
/** A share link's token: 24 random bytes as base64url (venture/build/share-links.ts). */
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
/** The token at the end of a share address made on this server, or a file request's (4J7: '/share/<token>/upload'), or null. */
function shareTokenOf(url: string): string | null {
  const match = /\/share\/([A-Za-z0-9_-]{32})(?:\/upload)?$/.exec(url);
  return match ? match[1] : null;
}
/** What the share page shows (SharePage in venture/build/share-links.ts). Text only; the page escapes every field. */
export type SharePageView = {
  businessName: string; title: string; text: string; expires: string; digest: string;
  decision: { decision: 'approved' | 'changes'; comment: string | null } | null;
  /** 4J7 (O20): what the link shares, whether it may answer now, the posts a comment can name, the comments so far. */
  kind?: 'draft' | 'order-status' | 'statement' | 'books'; canAnswer?: boolean;
  items?: { id: string; name: string; text: string }[]; comments?: { item: string; text: string }[];
};
/** What the file request page shows (FileRequestPage in venture/build/file-requests.ts). Text only. */
export type FileRequestPageView =
  | { open: true; businessName: string; note: string | null; line: string; expires: string; maxBytes: number }
  | { open: false; businessName: string; reason: string };
/** 4J7 (K9): a temporary business never takes a client's file: it publishes and receives nothing from the server. */
export const TRIAL_UPLOAD_LINE = 'This business is temporary, so it takes no files from clients yet. Ask whoever sent the link.';

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
  /** Ink v2 wave 4 (4G3): the web push key for phone alerts (notify.ts hostedPushPort). Absent: the app says they are not set up. */
  push?: WebPushPort | null;
  /** Tests only: the network guard's lookup and sender for every business's engine (VentureHostOptions.net). */
  net?: VentureHostOptions['net'];
  /** Tests may pass a runtime built over the same directory and custody. */
  runtime?: (options: { root: string; passphrase: (key: ActorKey) => Promise<string>; engineOptions: (key: ActorKey) => any; postgres?: PostgresPool; vaultCap?: (key: ActorKey) => number | null }) => VentureRuntime;
  /** Ink v2 wave 4 (4J23): CHAUSAR_HOSTED_TRIALS (config.trials): people may start without an account. Absent: they may not. */
  trials?: boolean;
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
  /** Ink v2 wave 4 (4J23): AI calls of a temporary business, on the owner's own key, and its slower requests. */
  #trialModelRate: RateLimiter;
  #trialRpcRate: RateLimiter;
  #modelGate: ConcurrencyGate;
  #dirty = new Set<string>();
  #sleeper: ReturnType<typeof setInterval> | null = null;
  /** Ink v2 wave 4 (4G1, 4G3): whether each business's owner has an event stream open, for the alert rules. */
  readonly watch: OwnerWatch;

  constructor(options: HostedAppOptions) {
    this.options = options;
    this.#clock = options.clock ?? (() => new Date());
    this.watch = new OwnerWatch(() => this.#clock());
    const ms = () => this.#clock().getTime();
    this.accounts = new AccountService({ directory: options.directory, custody: options.custody, mailer: options.mailer, rp: options.rp, limits: options.limits, clock: this.#clock,
      // Ink v2 wave 4 (4G3): a session signed out or revoked ends its phone alert subscriptions.
      sessionsEnded: (userId, sessionIds) => this.#endPushSessions(userId, sessionIds) });
    this.#rpcRate = new RateLimiter('rpc-session', options.limits.rpcPerSession, ms);
    this.#modelRate = new RateLimiter('model-tenant', options.limits.modelCallsPerTenant, ms);
    this.#githubRate = new RateLimiter('github-tenant', options.limits.githubSyncsPerTenant, ms);
    this.#shareRate = new RateLimiter('share-address', SHARE_PAGE_RATE, ms);
    this.#trialModelRate = new RateLimiter('model-trial', options.limits.trialModelCallsPerTenant, ms);
    this.#trialRpcRate = new RateLimiter('rpc-trial', options.limits.trialRpcPerSession, ms);
    this.#modelGate = new ConcurrencyGate(options.limits.modelConcurrencyPerTenant);
    const root = `${options.root.replace(/[\\/]+$/, '')}/tenants`;
    const runtimeOptions = { root, passphrase: (key: ActorKey) => this.#passphrase(key), engineOptions: (key: ActorKey) => this.#engineOptions(key), postgres: options.postgres,
      // Ink v2 wave 4 (4J23): a temporary business's vault cap, held by its vault store on every write.
      vaultCap: (key: ActorKey) => this.#isTemporary(key) ? this.options.limits.trialVaultBytes : null };
    this.runtime = options.runtime ? options.runtime(runtimeOptions)
      : new LocalVentureRuntime({ ...runtimeOptions, idleMs: options.limits.actorIdleMs, maxAwake: options.limits.awakeActors, clock: ms });
  }

  /** Puts idle businesses to sleep once a minute. The timer does not keep the process alive. */
  startHousekeeping() {
    if (this.#sleeper) return;
    this.#sleeper = setInterval(() => { void this.#housekeeping(); }, 60_000);
    this.#sleeper.unref();
  }

  #tidying = false;
  /**
   * Once a minute: the engine's tick for every awake business first (Ink v2 wave 4, 4G1 and 4G3: the notification
   * centre looks at Today, so quiet hours ending or the wait after the owner left can bring a phone alert), then idle
   * businesses sleep. A sleeping business is not woken for it. One round at a time; never throws.
   */
  async #housekeeping() {
    if (this.#tidying) return;
    this.#tidying = true;
    try {
      await this.runtime.tick?.().catch(() => {});
      // Ink v2 wave 4 (4G3): businesses that could not wake to end a signed-out session's subscriptions try again.
      await this.retryEndedSessions().catch(() => {});
      // Ink v2 wave 4 (4J23): temporary businesses past their end are deleted with their vaults, a few a round; rate
      // buckets that filled up again are forgotten, so no network address is held past its window.
      await this.expireTrials().catch(() => {});
      this.sweepLimits();
      await this.runtime.sleepIdle().catch(() => {});
    } finally { this.#tidying = false; }
  }

  async close() {
    if (this.#sleeper) clearInterval(this.#sleeper);
    this.#sleeper = null;
    // Phone alert subscriptions of sessions that just signed out end first (4G3).
    await this.pushSessionsEnding();
    try { await this.runtime.dispose(); }
    finally { await this.options.directory.close(); }
  }

  async #passphrase(key: ActorKey): Promise<string> {
    // The account holding the vault under this key: its own tenant's, or a kept temporary one's (4J23, vaultTenantId).
    const owner = vaultOwner(this.options.directory.read(), key);
    check(owner, 'BUSINESS_NOT_FOUND', 'That business is not on your account.');
    return this.options.custody.unwrapPassphrase(key[0], key[1], owner.business.sealedPassphrase);
  }

  /** The account a vault's AI spend counts toward: its holder's tenant, which differs from the vault's for a kept trial (4J23). */
  #accountTenant(state: DirectoryState, key: ActorKey): string {
    return vaultOwner(state, key)?.user.tenantId ?? key[0];
  }

  /** Whether each vault is temporary, as of a directory revision, so a vault write asks without copying the directory. */
  #temporaryAt = new Map<string, { revision: number; temporary: boolean }>();

  /**
   * Whether the business under this key is temporary (4J23): asked at every vault write (its size cap), at each write
   * of a refused record and at each AI call. The answer is kept until the directory's revision moves, so most asks
   * copy nothing. A business no account holds counts as temporary, so a gap fails closed.
   */
  #isTemporary(key: ActorKey): boolean {
    const id = `${key[0]}/${key[1]}`;
    const revision = this.options.directory.revision?.();
    const known = this.#temporaryAt.get(id);
    if (known && revision !== undefined && known.revision === revision) return known.temporary;
    const state = this.options.directory.read();
    const owner = vaultOwner(state, key);
    const temporary = !owner || !!owner.user.trial;
    if (revision !== undefined) this.#temporaryAt.set(id, { revision: state.revision, temporary });
    return temporary;
  }

  #engineOptions(key: ActorKey) {
    const id = `${key[0]}/${key[1]}`;
    const modelTransport = hostedModelTransport({
      // The account holding the vault at each call (4J23: a kept trial's vault keeps its own tenant), for the AI rate
      // and the "two at once" gate, as for the ledger.
      tenantId: () => this.#accountTenant(this.options.directory.read(), key), inner: this.options.modelTransport,
      usage: () => { const state = this.options.directory.read(); return state.usage[this.#accountTenant(state, key)] ?? []; },
      ceilingMicros: this.options.limits.monthlyModelCeilingMicros,
      rate: this.#modelRate, gate: this.#modelGate, clock: this.#clock,
      dispatched: () => { this.#dirty.add(id); },
      // Ink v2 wave 4 (4J23): a temporary business calls AI only on the owner's own key, under its own rate and ceiling.
      trial: () => this.#isTemporary(key) ? { rate: this.#trialModelRate, ceilingMicros: this.options.limits.trialModelCeilingMicros } : null,
    });
    const venture: VentureHostOptions = { host: 'hosted-web', modelTransport, githubTransport: this.options.githubTransport, clock: this.#clock,
      ...(this.options.publicUrl ? { publicUrl: this.options.publicUrl } : {}),
      // Ink v2 wave 4 (4G1, 4G3): the owner watching is an open event stream of theirs; the push key for phone alerts.
      watching: () => this.watch.at(id),
      // Browsers of sessions the account lists as signed out or revoked get nothing (4G3).
      endedSessions: () => this.#endedSessions(key),
      ...(this.options.push ? { push: this.options.push } : {}),
      ...(this.options.net ? { net: this.options.net } : {}),
      // Ink v2 wave 4 (4J23): until it is kept, a temporary business issues no invoice, records no payment, and
      // publishes and sends nothing from the server (its size cap is held by its vault store, vaultCap above).
      trial: () => this.#isTemporary(key) };
    // The engine keeps its preview profile (demo) on both stores: exact integer arithmetic, labelled experimental.
    return { demo: true, storage: this.#storage(), version: this.options.version, venture };
  }

  /** Ending phone alert subscriptions under way (4G3), each with its own catch. */
  #ending = new Set<Promise<void>>();

  /**
   * Sessions of one account that signed out or were revoked (4G3): the account keeps them as ended, so their browsers get
   * nothing at once, and each business of the account wakes and deletes the phone alert subscriptions those sessions
   * made. A business that could not wake (a crash, a busy server) is tried again at the next housekeeping round.
   * Sessions that only idle or expire never come here.
   */
  #endPushSessions(userId: string, sessionIds: readonly string[]): void {
    if (!sessionIds.length) return;
    const hashes = sessionIds.map(pushSessionHash);
    const at = this.#clock().toISOString();
    this.#track((async () => {
      await this.options.directory.update(state => {
        const user = state.users.find(item => item.id === userId);
        if (!user || !user.businesses.length) return;
        const known = new Set((user.endedPushSessions ?? []).map(item => item.hash));
        const added = hashes.filter(hash => !known.has(hash)).map(hash => ({ hash, at, pending: user.businesses.map(business => business.id) }));
        user.endedPushSessions = [...(user.endedPushSessions ?? []), ...added].slice(-200);
      });
      await this.#cleanEnded(userId);
    })());
  }

  #track(work: Promise<unknown>): void {
    const ending = work.then(() => undefined, () => undefined);
    this.#ending.add(ending);
    void ending.then(() => { this.#ending.delete(ending); });
  }

  /**
   * Asks each business with ended sessions still pending to delete their subscriptions; what one confirms (or a business
   * that no longer exists) leaves the account's list, and an entry goes once nothing is pending. Never throws.
   */
  async #cleanEnded(userId: string): Promise<void> {
    const user = this.options.directory.read().users.find(item => item.id === userId);
    for (const business of user?.businesses ?? []) {
      const hashes = (user!.endedPushSessions ?? []).filter(item => item.pending.includes(business.id)).map(item => item.hash);
      if (!hashes.length) continue;
      const handle = this.runtime.get([vaultTenantOf(user!, business), business.id]);
      if (typeof handle.endPushSessions !== 'function') continue;
      try { await handle.endPushSessions(hashes); }
      catch (error) { if ((error as { code?: unknown })?.code !== 'BUSINESS_NOT_FOUND') continue; }
      await this.options.directory.update(state => {
        const draft = state.users.find(item => item.id === userId);
        if (!draft?.endedPushSessions) return;
        for (const item of draft.endedPushSessions) if (hashes.includes(item.hash)) item.pending = item.pending.filter(id => id !== business.id);
        draft.endedPushSessions = draft.endedPushSessions.filter(item => item.pending.length > 0);
        if (!draft.endedPushSessions.length) delete draft.endedPushSessions;
      }).catch(() => {});
    }
  }

  /** Housekeeping (4G3): every account with ended sessions still pending tries again. Never throws. */
  async retryEndedSessions(): Promise<void> {
    const users = this.options.directory.read().users.filter(user => user.endedPushSessions?.some(item => item.pending.length));
    for (const user of users) await this.#cleanEnded(user.id).catch(() => {});
  }

  /** Hashes of the sessions of the account holding this business that signed out or were revoked (4G3). */
  #endedSessions(key: ActorKey): string[] {
    return (vaultOwner(this.options.directory.read(), key)?.user.endedPushSessions ?? []).map(item => item.hash);
  }

  /** Resolves once every ending started so far has run (tests, and a server closing). */
  async pushSessionsEnding(): Promise<void> {
    while (this.#ending.size) await Promise.all([...this.#ending]);
  }

  #storage() { return this.options.postgres ? 'postgres' as const : 'experimental-file' as const; }

  #key(auth: Authenticated, businessId = auth.session.businessId): ActorKey {
    const business = businessId ? auth.user.businesses.find(item => item.id === businessId) : undefined;
    check(businessId && business, 'VAULT_LOCKED', 'Choose one of your businesses first.');
    return [vaultTenantOf(auth.user, business), businessId];
  }

  /** A push subscription with the hash of the session asking; a page that names a session itself is refused. */
  #withSession(auth: Authenticated, input: unknown): Record<string, unknown> {
    check(input !== null && typeof input === 'object' && !Array.isArray(input) && !Object.hasOwn(input, 'session'), 'INVALID_REQUEST', "Send the browser's subscription only.");
    return { ...(input as Record<string, unknown>), session: pushSessionHash(auth.session.id) };
  }

  /** What the page needs about the signed-in person. */
  me(auth: Authenticated) {
    return {
      user: userView(auth.user), businessId: auth.session.businessId, method: auth.session.method,
      sessionCreatedAt: auth.session.createdAt, mail: { kind: this.accounts.mailer.kind, delivers: this.accounts.mailer.delivers },
      limits: { businesses: auth.user.trial ? 1 : this.options.limits.businessesPerAccount, passkeys: this.options.limits.passkeysPerAccount },
      runtime: { adapter: this.runtime.descriptor.adapter, capabilities: this.runtime.descriptor.capabilities },
      experimental: true,
      // Ink v2 wave 4 (4J23): "This business is temporary until you add your email.", and the warning in its last day;
      // and whether this server lets people start without an account at all.
      trial: this.trialView(auth),
      trials: this.options.trials === true,
    };
  }

  /** A temporary business's line and end for the session view (4J23); null once it is kept on an account. */
  trialView(auth: Authenticated): TrialView | null {
    return trialView(auth.user, this.#clock().getTime());
  }

  async select(auth: Authenticated, input: unknown) {
    const body = exact(input, ['businessId'], ['businessId']);
    check(body.businessId === null || isBusinessId(body.businessId), 'BUSINESS_NOT_FOUND', 'That business is not on your account.');
    return this.accounts.selectBusiness(auth, body.businessId as string | null);
  }

  /** The one RPC route the renderer uses. */
  async rpc(auth: Authenticated, method: unknown, payload: unknown): Promise<unknown> {
    check(typeof method === 'string' && method.length <= 80, 'INVALID_REQUEST', 'Use a named request.');
    // A temporary business's session asks more slowly than an account's (4J23).
    (auth.user.trial ? this.#trialRpcRate : this.#rpcRate).take(auth.session.id);
    check(HOSTED_METHODS.includes(method), 'HOSTED_NOT_AVAILABLE', NOT_HOSTED);
    // Ink v2 wave 4 (4J23): no real invoice or payment, and nothing published or sent from the server, by a temporary
    // business. This answers before anything is journalled; the engine's own write path refuses the same records on
    // every other way in (venture/records.ts).
    const refused = auth.user.trial ? TRIAL_REFUSED_METHODS.get(method) : undefined;
    check(!refused, 'TRIAL_LIMIT', refused ?? '');
    const input = payload ?? {};
    switch (method) {
      case 'venture.countries': return (await import('../venture/host.ts')).ventureCountries();
      case 'venture.preview': return (await import('../venture/host.ts')).venturePreview(input);
      case 'venture.playbooks.list': return (await import('../venture/host.ts')).venturePlaybooks(input, await this.#openWayBusiness(auth, input));
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
    // A browser's push subscription is tied to the session asking (4G3): the hash comes from here, never from the page.
    const sent = method === 'venture.notify.push.subscribe' ? this.#withSession(auth, input) : input;
    if (GITHUB_ACTIONS.has(method)) this.#githubRate.take(auth.user.tenantId, 'This account checked GitHub many times in the last few minutes. Wait a little.');
    let result: unknown;
    try { result = await this.runtime.get(key).action(method, sent, WEB); }
    finally { await this.#syncUsage(key).catch(() => {}); }
    // 4J7 (K9): a client file request link is noted the same way, so /share/<token>/upload finds the business.
    if (method === 'venture.share.create' || method === 'venture.share.request') await this.#indexShare(key, result);
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
   * that is gone) answers null alike, so the page says only that nothing is here. Limited per address. 4J7 (O20): with
   * a comment, the client's comment on one item; viewer is the browser's session cookie, if it sent one: the owner of
   * the business opening their own link is a preview, which never counts as the client viewing it.
   */
  async sharePage(token: string, address: string, answer?: { decision: unknown; comment?: unknown; digest: unknown }, viewer?: string, comment?: { item: unknown; text: unknown }, head = false): Promise<SharePageView | null> {
    const target = this.#shareTarget(token, address);
    if (!target) return null;
    const { handle, owner } = target;
    if (typeof handle.shareLink !== 'function') return null;
    if (comment) return await handle.shareLink('comment', token, comment) as SharePageView | null;
    if (answer) return await handle.shareLink('decide', token, answer) as SharePageView | null;
    // A HEAD (head) is no one reading the page, so like the owner's own look it never counts as viewed.
    return await handle.shareLink('page', token, { preview: head || this.#isOwner(viewer, owner.user.id) }) as SharePageView | null;
  }

  /** Whether a session cookie is a live session of this account (the owner looking at their own link). Never throws. */
  #isOwner(viewer: string | undefined, userId: string): boolean {
    if (!viewer) return false;
    try { return this.accounts.authenticate(viewer).user.id === userId; } catch { return false; }
  }

  /** The business a share or file request token leads to, with its holder, or null for every miss alike. Rate limited. */
  #shareTarget(token: string, address: string) {
    this.#shareRate.take(address, 'Too many tries from here. Wait a minute and try again.');
    if (!SHARE_TOKEN_PATTERN.test(token)) return null;
    const hash = sha256(token);
    const nowMs = this.#clock().getTime();
    const directory = this.options.directory.read();
    const found = (directory.shareLinks ?? []).find(link => link.tokenHash === hash && Date.parse(link.expiresAt) > nowMs);
    if (!found) return null;
    // The account holding that vault, also when it is a kept temporary business's (4J23).
    const owner = vaultOwner(directory, [found.tenantId, found.businessId]);
    if (!owner || owner.user.status !== 'active') return null;
    return { found, owner, handle: this.runtime.get([found.tenantId, found.businessId]) };
  }

  /**
   * 4J7 (K9): one step of the client's file request page (/share/<token>/upload): 'page', 'claim', 'store' or 'release'
   * (venture/build/file-requests.ts). Like the share page: no session, the token is the only key, every miss is null,
   * limited per address. A temporary business takes no client's file (TRIAL_LIMIT), whatever its vault holds. A used
   * link stays in the index until it ends, so a second try reads "already used" rather than nothing.
   */
  async fileRequest(token: string, address: string, input: { step: 'page' | 'claim' | 'store' | 'release'; [key: string]: unknown }): Promise<unknown> {
    const target = this.#shareTarget(token, address);
    if (!target) return null;
    const { owner, handle } = target;
    check(!owner.user.trial, 'TRIAL_LIMIT', TRIAL_UPLOAD_LINE);
    if (typeof handle.shareLink !== 'function') return null;
    return await handle.shareLink('upload', token, input);
  }

  /**
   * The Start gallery's "You run this" (4J8): the session's open business, read through its actor's own venture.get
   * (its working name and the playbook its idea picks). Null with no business open, a payload the list would refuse
   * anyway, or a business that has no venture yet or cannot be read now.
   */
  async #openWayBusiness(auth: Authenticated, input: unknown): Promise<{ business: { businessId: string; name: string; playbook: string | null } } | null> {
    const businessId = auth.session.businessId;
    if (!businessId || !auth.user.businesses.some(item => item.id === businessId)) return null;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) return null;
    try {
      const view = await this.runtime.get(this.#key(auth)).action('venture.get', {}, WEB) as { venture?: { workingName?: unknown }; playbook?: { id?: unknown } } | null;
      const name = view?.venture?.workingName;
      if (typeof name !== 'string' || !name) return null;
      return { business: { businessId, name, playbook: typeof view?.playbook?.id === 'string' ? view.playbook.id : null } };
    } catch {
      return null;
    }
  }

  async #status(auth: Authenticated) {
    const hosted = { email: auth.user.email, businessId: auth.session.businessId, businesses: userView(auth.user).businesses, experimental: true, trial: this.trialView(auth) };
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
      // Ink v2 wave 4 (4J23): one business per temporary account, ever (a deleted one still counts); 7 days from now.
      if (user.trial) trialBusinessStarted(state, user, this.#clock().getTime(), limits);
      check(user.businesses.length < limits.businessesPerAccount, 'LIMIT_REACHED', `An account can keep ${limits.businessesPerAccount} businesses on this server for now.`);
      user.businesses.push({ id: businessId, name, createdAt: this.#clock().toISOString(), sealedPassphrase, workspaceId: null });
    });
    let created;
    try { created = await this.runtime.create(key, { name, passphrase }); }
    catch (error) {
      await directory.update(state => {
        const user = state.users.find(item => item.id === auth.user.id);
        if (user) user.businesses = user.businesses.filter(item => item.id !== businessId);
        // A trial whose business was never made may still make its one (4J23).
        if (user?.trial) delete user.trial.businessStartedAt;
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
      for (const user of state.users) user.businesses = user.businesses.filter(item => !(item.id === key[1] && vaultTenantOf(user, item) === key[0]));
      // A trial with its one business gone has nothing left to keep: it ends an hour from now (4J23).
      const owner = state.users.find(user => user.id === auth.user.id);
      if (owner?.trial) trialBusinessGone(state, owner, this.#clock().getTime(), this.options.limits);
      for (const session of state.sessions) if (session.businessId === key[1]) session.businessId = null;
      if (state.shareLinks) state.shareLinks = state.shareLinks.filter(link => !(link.tenantId === key[0] && link.businessId === key[1]));
    });
    return { deleted: true, copiesRemoved: 0, externalCopies: 'Copies made outside Chausar must be removed by their owner.' };
  }

  /**
   * Ink v2 wave 4 (4J23): deletes every temporary business past its end (7 days after its last use, an hour without a
   * business), unless it was kept first, with everything it left on this server. Inside the vault, deleted with it:
   * the business and all its records, among them its alerts and the phone's push subscriptions (ended first, the way
   * a revoked session's are). On disk: the vault file (or its PostgreSQL row) and the business and tenant folders. In
   * the directory: the trial's account with the sealed vault keys, its sessions, passkey challenges and claim links,
   * its AI usage ledger and its share link index. In this process: the awake actor and whether its owner was watching.
   * The tenant key is derived from the custody key and was never stored; no email or network address was ever kept.
   * Runs in housekeeping each minute, at most trialEndsPerRound a round; answers how many trials ended. One that could
   * not be deleted now is tried again on a later round.
   */
  async expireTrials(): Promise<number> {
    const nowMs = this.#clock().getTime();
    const due = this.options.directory.read().users.filter(user => trialDue(user, nowMs)).slice(0, this.options.limits.trialEndsPerRound);
    let ended = 0;
    for (const user of due) {
      try { if (await this.#endTrial(user.id)) ended++; }
      catch { /* Tried again on the next round; nothing about the trial is logged. */ }
    }
    return ended;
  }

  /**
   * Codes a vault can't be deleted with now but can on a later round. Any other Chausar code means this vault can't be
   * opened, so it is removed without opening; an error with no Chausar code is never taken to mean that.
   */
  static #AGAIN_LATER = new Set(['VAULT_BUSY', 'HOSTED_BUSY', 'HOSTED_STOPPING', 'HOSTED_STORAGE_UNAVAILABLE', 'ACTOR_ASLEEP', 'RATE_LIMITED', 'CUSTODY_KEY_MISMATCH']);

  /** One trial: marked as ending first, so a claim or a use that lands now can't keep it; then deleted. False if it was kept. */
  async #endTrial(userId: string): Promise<boolean> {
    const nowMs = this.#clock().getTime();
    const user = await this.options.directory.update(state => markTrialEnding(state, userId, nowMs));
    if (!user) return false;
    check(isTenantId(user.tenantId) && user.businesses.every(item => isBusinessId(item.id) && isTenantId(vaultTenantOf(user, item))), 'INVALID_ACTOR_KEY', 'A temporary business has a damaged entry.');
    // Its sessions are over from the mark on: their phone alert subscriptions end the way a revoked session's do (4G3).
    const sessionIds = this.options.directory.read().sessions.filter(session => session.userId === user.id).map(session => session.id);
    this.#endPushSessions(user.id, sessionIds);
    await this.pushSessionsEnding();
    const root = `${this.options.root.replace(/[\\/]+$/, '')}/tenants`;
    for (const business of user.businesses) {
      const key: ActorKey = [vaultTenantOf(user, business), business.id];
      try {
        // Deleting needs the business's own name, as on the desktop: the one inside the vault, which a rename changes.
        const status = await this.runtime.get(key).action('workspace.status', {}, WEB) as { workspace?: { name?: unknown } };
        check(typeof status.workspace?.name === 'string', 'VAULT_LOCKED', 'The temporary business did not open.');
        await this.runtime.destroy(key, status.workspace.name);
      } catch (error) {
        if (!(error instanceof ChausarError) || HostedApp.#AGAIN_LATER.has(error.code)) throw error;
        // A vault that does not open is removed without opening it: its folder, and on PostgreSQL its row by its key.
        // Its sealed key goes below too, so nothing of it could be opened again.
        await rm(join(root, key[0], key[1]), { recursive: true, force: true });
        if (this.options.postgres) await (await PostgresSnapshotAdapter.fromPool(this.options.postgres, hostedVaultSlot(key))).delete();
      }
      this.watch.forget(`${key[0]}/${key[1]}`);
      this.#temporaryAt.delete(`${key[0]}/${key[1]}`);
    }
    await this.options.directory.update(state => { forgetTrial(state, user.id); });
    // The trial's tenant folder, unless a vault of an account still lives there (a trial kept by an account never ends).
    if (!this.options.directory.read().users.some(owner => owner.businesses.some(item => vaultTenantOf(owner, item) === user.tenantId))) {
      const folder = join(root, user.tenantId);
      if (await stat(folder).then(() => true, () => false)) await rm(folder, { recursive: true, force: true });
    }
    return true;
  }

  /** Housekeeping (4J23): every rate bucket that filled up again is forgotten, here and in sign-in. Answers how many. */
  sweepLimits(): number {
    return [this.#rpcRate, this.#modelRate, this.#githubRate, this.#shareRate, this.#trialModelRate, this.#trialRpcRate]
      .reduce((swept, limiter) => swept + limiter.sweep(), this.accounts.sweepLimits());
  }

  /** After an action that sent a model call, copy the recorded costs into the account's ledger for the ceiling. */
  async #syncUsage(key: ActorKey) {
    const id = `${key[0]}/${key[1]}`;
    if (!this.#dirty.delete(id)) return;
    const calls = await this.runtime.get(key).action('venture.models.calls', { limit: 100 }, WEB) as { id: string; at: string; status: string; costMicros: string | null }[];
    // The ledger of the account holding the vault (4J23: a kept temporary business's vault keeps its own tenant).
    const directory = this.options.directory.read();
    const known = directory.usage[this.#accountTenant(directory, key)] ?? [];
    const entries = usageFromCalls(key[1], calls, known);
    if (!entries.length) return;
    await this.options.directory.update(state => {
      const list = state.usage[this.#accountTenant(state, key)] ??= [];
      for (const entry of entries) if (!list.some(item => item.callId === entry.callId)) list.push(entry);
    });
  }

  /** Every declared event of the open business, for the page's event stream, which counts as the owner watching it. */
  subscribe(auth: Authenticated, listener: (event: ActorEvent) => void): () => void {
    const key = this.#key(auth);
    const handle = this.runtime.get(key);
    const offs = ACTOR_EVENTS.map(name => handle.on(name, listener));
    // An open stream is the owner watching this business (4G1, 4G3): alerts outside the app wait while it is open.
    const unwatch = this.watch.open(`${key[0]}/${key[1]}`);
    return () => { for (const off of offs) off(); unwatch(); };
  }
}

