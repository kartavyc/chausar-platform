// Chausar hosted tier: accounts, sign-in and sessions. No passwords exist anywhere.
// - Email links: a random token, stored only as its SHA-256, single use, fifteen minutes, and bound to the browser
//   that asked for it (a random value in an HttpOnly cookie), so a link forwarded to someone else signs nobody in.
// - Passkeys: added from a fresh session, then used for sign-in without typing an email.
// - Sessions: a random token in an HttpOnly cookie, stored only as its SHA-256, with idle and absolute expiry.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { check, newId } from '../contracts.ts';
import { newTenantId, type HostedCustody } from './custody.ts';
import type { DirectoryState, HostedDirectory, HostedPasskey, HostedSessionRecord, HostedUser } from './directory.ts';
import { RateLimiter, addressKey, type HostedLimits } from './limits.ts';
import type { Mailer } from './mailer.ts';
import { NOT_A_TRIAL_LINE, TRIAL_ENDED_LINE, TRIAL_PASSKEY_LINE, claimLinksLine, claimTrial, countClaimLink, liveTrial, slideTrial, type Claimed } from './trial.ts';
import { assertionIdentity, authenticationOptions, registrationOptions, verifyAuthentication, verifyRegistration, type RelyingParty } from './webauthn.ts';

const MINUTE = 60_000, DAY = 86_400_000;
export const MAGIC_LINK_TTL_MS = 15 * MINUTE;
export const CHALLENGE_TTL_MS = 5 * MINUTE;
export const SESSION_TTL_MS = 14 * DAY;
export const SESSION_IDLE_MS = 3 * DAY;
export const FRESH_SESSION_MS = 15 * MINUTE;
const TOUCH_EVERY_MS = 5 * MINUTE;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const token = () => randomBytes(32).toString('base64url');
const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Lower case, trimmed, one @, a dot in the domain, no spaces or control characters, at most 254 characters. */
export function normalizeEmail(value: unknown): string {
  check(typeof value === 'string', 'INVALID_EMAIL', 'Enter your email address.');
  const email = value.trim().toLowerCase();
  check(email.length >= 6 && email.length <= 254 && /^[^\s@\u0000-\u001f\u007f]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email),
    'INVALID_EMAIL', 'Enter an email address like you@example.com.');
  return email;
}

/** What the browser brings to every sign-in step: its binding value and the network address the server saw. */
export type Browser = { binding: string; address: string };
/** claimed (Ink v2 wave 4, 4J23): this sign-in kept a temporary business on the account; the session has it open. */
export type SignedIn = { token: string; session: SessionView; user: UserView; created: boolean; claimed?: true };
export type SessionView = { id: string; createdAt: string; expiresAt: string; method: HostedSessionRecord['method']; businessId: string | null };
export type UserView = {
  id: string; email: string; createdAt: string;
  passkeys: { id: string; name: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean }[];
  businesses: { id: string; name: string; createdAt: string }[];
};
export type Authenticated = { session: HostedSessionRecord; user: HostedUser };

export function userView(user: HostedUser): UserView {
  return {
    id: user.id, email: user.email, createdAt: user.createdAt,
    passkeys: user.passkeys.map(p => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt, backedUp: p.backedUp })),
    businesses: user.businesses.map(b => ({ id: b.id, name: b.name, createdAt: b.createdAt })),
  };
}
const sessionView = (s: HostedSessionRecord): SessionView => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, method: s.method, businessId: s.businessId });

export type AccountOptions = {
  directory: HostedDirectory; custody: HostedCustody; mailer: Mailer; rp: RelyingParty;
  limits: HostedLimits; clock?: () => Date;
  /**
   * Ink v2 wave 4 (4G3): told, once the change is saved, which sessions were signed out or revoked (never ones that
   * idled or expired), so their phone alert subscriptions end. A listener's failure is its own.
   */
  sessionsEnded?: (userId: string, sessionIds: readonly string[]) => void;
};

export class AccountService {
  readonly directory: HostedDirectory;
  readonly rp: RelyingParty;
  #mailer: Mailer;
  #limits: HostedLimits;
  #clock: () => Date;
  #magicByEmail: RateLimiter;
  #magicByAddress: RateLimiter;
  #attempts: RateLimiter;
  #trialStarts: RateLimiter;
  #sessionsEnded: AccountOptions['sessionsEnded'];
  /** Sessions signed out or revoked by a change not yet saved (4G3). */
  #ended: { userId: string; sessionId: string }[] = [];

  constructor(options: AccountOptions) {
    this.directory = options.directory; this.rp = options.rp; this.#mailer = options.mailer; this.#limits = options.limits;
    this.#clock = options.clock ?? (() => new Date());
    this.#sessionsEnded = options.sessionsEnded;
    const ms = () => this.#clock().getTime();
    this.#magicByEmail = new RateLimiter('magic-link-email', options.limits.magicLinkPerEmail, ms);
    this.#magicByAddress = new RateLimiter('magic-link-address', options.limits.magicLinkPerAddress, ms);
    this.#attempts = new RateLimiter('auth-attempts', options.limits.authAttemptsPerAddress, ms);
    this.#trialStarts = new RateLimiter('trial-start-address', options.limits.trialStartsPerAddress, ms);
  }

  get mailer(): Mailer { return this.#mailer; }
  #now() { return this.#clock(); }
  #iso(offsetMs = 0) { return new Date(this.#now().getTime() + offsetMs).toISOString(); }

  static checkBinding(binding: unknown): string {
    check(typeof binding === 'string' && TOKEN.test(binding), 'SIGN_IN_RESTART', 'Start signing in again from this browser.');
    return binding;
  }

  // -------------------------------------------------------------------------------------------
  // Email links
  // -------------------------------------------------------------------------------------------

  /** Always answers the same way whether or not the email has an account, so the answer says nothing about it. */
  async requestMagicLink(input: unknown, browser: Browser): Promise<{ sent: true; delivers: boolean }> {
    const body = exact(input, ['email'], ['email']);
    const email = normalizeEmail(body.email);
    const binding = AccountService.checkBinding(browser.binding);
    this.#magicByAddress.take(browser.address, 'Too many sign-in emails from this network. Wait a few minutes.');
    this.#magicByEmail.take(sha256(email), 'Too many sign-in emails for this address. Wait a few minutes.');
    const secret = token();
    await this.directory.update(state => {
      state.magicLinks.push({ id: newId('magic'), tokenHash: sha256(secret), email, browserHash: sha256(binding), createdAt: this.#iso(), expiresAt: this.#iso(MAGIC_LINK_TTL_MS), consumedAt: null });
    });
    const link = `${this.rp.origin}/#signin=${secret}`;
    await this.#mailer.send({
      kind: 'magic-link', to: email, subject: 'Your Chausar sign-in link', link,
      text: `Open this link in the same browser to sign in to Chausar. It works once, for fifteen minutes.\n\n${link}\n\nIf you didn't ask for it, ignore this email.`,
    });
    return { sent: true, delivers: this.#mailer.delivers };
  }

  async verifyMagicLink(input: unknown, browser: Browser): Promise<SignedIn> {
    const body = exact(input, ['token'], ['token']);
    this.#attempts.take(browser.address, 'Too many sign-in attempts from this network. Wait a few minutes.');
    check(typeof body.token === 'string' && TOKEN.test(body.token), 'MAGIC_LINK_INVALID', 'This sign-in link is not valid. Ask for a new one.');
    const binding = AccountService.checkBinding(browser.binding);
    const digest = sha256(body.token), bindingHash = sha256(binding);
    const sessionToken = token();
    return this.#thenTellEnded(this.directory.update(state => {
      const now = this.#now().getTime();
      const link = state.magicLinks.find(item => sameHex(item.tokenHash, digest));
      check(link && !link.consumedAt && Date.parse(link.expiresAt) > now, 'MAGIC_LINK_INVALID', 'This sign-in link expired or was used. Ask for a new one.');
      check(sameHex(link.browserHash, bindingHash), 'MAGIC_LINK_OTHER_BROWSER', 'Open the link in the browser where you asked for it.');
      link.consumedAt = this.#iso();
      let user = state.users.find(item => item.email === link.email);
      // Ink v2 wave 4 (4J23): a link asked for from a temporary business keeps that business on this email's account.
      const claim = link.claimUserId ? claimTrial(state, link.claimUserId, link.email, user ?? null, this.#limits, now) : null;
      if (claim) user = claim.user;
      const created = !user || claim?.created === true;
      if (!user) {
        user = { id: newId('huser'), tenantId: newTenantId(), email: link.email, userHandle: randomBytes(16).toString('base64url'), createdAt: this.#iso(), verifiedAt: this.#iso(), status: 'active', passkeys: [], businesses: [] };
        state.users.push(user);
      }
      check(user.status === 'active', 'ACCOUNT_DISABLED', 'This account is turned off.');
      const session = this.#newSession(state, user, sessionToken, 'magic-link');
      if (claim) this.#claimed(claim, session);
      return { token: sessionToken, session: sessionView(session), user: userView(user), created, ...(claim ? { claimed: true as const } : {}) };
    }));
  }

  // -------------------------------------------------------------------------------------------
  // Passkeys
  // -------------------------------------------------------------------------------------------

  async passkeyLoginOptions(browser: Browser) {
    const binding = AccountService.checkBinding(browser.binding);
    this.#attempts.take(browser.address, 'Too many sign-in attempts from this network. Wait a few minutes.');
    const challenge = token();
    await this.directory.update(state => {
      state.challenges = state.challenges.filter(item => !(item.purpose === 'login' && sameHex(item.browserHash, sha256(binding))));
      state.challenges.push({ id: newId('challenge'), challenge, purpose: 'login', userId: null, browserHash: sha256(binding), expiresAt: this.#iso(CHALLENGE_TTL_MS) });
    });
    return authenticationOptions(this.rp, challenge);
  }

  /** claimUserId (4J23): the temporary business's account this sign-in keeps on the passkey's account (/api/hosted/trial/claim/passkey). */
  async passkeyLoginVerify(input: unknown, browser: Browser, claimUserId?: string): Promise<SignedIn> {
    const binding = AccountService.checkBinding(browser.binding);
    this.#attempts.take(browser.address, 'Too many sign-in attempts from this network. Wait a few minutes.');
    const identity = assertionIdentity(input);
    const sessionToken = token();
    // The challenge is spent by any attempt, so a failed answer can't be retried against it.
    const challenge = await this.directory.update(state => {
      const found = state.challenges.find(item => item.purpose === 'login' && sameHex(item.browserHash, sha256(binding)) && Date.parse(item.expiresAt) > this.#now().getTime());
      state.challenges = state.challenges.filter(item => item !== found);
      return found?.challenge ?? null;
    });
    check(challenge, 'PASSKEY_CHALLENGE_MISMATCH', 'This passkey request expired. Try again.');
    return this.#thenTellEnded(this.directory.update(state => {
      const user = state.users.find(item => item.passkeys.some(p => p.id === identity.id));
      check(user, 'PASSKEY_UNKNOWN', 'This passkey is not on any Chausar account. Sign in with an email link.');
      check(user.status === 'active', 'ACCOUNT_DISABLED', 'This account is turned off.');
      const passkey = user.passkeys.find(p => p.id === identity.id) as HostedPasskey;
      const result = verifyAuthentication(this.rp, input, { challenge, passkey, userHandle: user.userHandle });
      passkey.signCount = result.signCount; passkey.backedUp = result.backedUp; passkey.lastUsedAt = this.#iso();
      const claim = claimUserId === undefined ? null : claimTrial(state, claimUserId, user.email, user, this.#limits, this.#now().getTime());
      const session = this.#newSession(state, user, sessionToken, 'passkey');
      if (claim) this.#claimed(claim, session);
      return { token: sessionToken, session: sessionView(session), user: userView(user), created: false, ...(claim ? { claimed: true as const } : {}) };
    }));
  }

  /** Adding a passkey needs a session younger than fifteen minutes, so a stolen old session can't plant its own key. */
  async passkeyRegisterOptions(auth: Authenticated) {
    check(!auth.user.trial, 'TRIAL_LIMIT', TRIAL_PASSKEY_LINE);
    this.#requireFresh(auth);
    check(auth.user.passkeys.length < this.#limits.passkeysPerAccount, 'LIMIT_REACHED', `An account can keep ${this.#limits.passkeysPerAccount} passkeys. Remove one first.`);
    const challenge = token();
    await this.directory.update(state => {
      state.challenges = state.challenges.filter(item => !(item.purpose === 'register' && item.userId === auth.user.id));
      state.challenges.push({ id: newId('challenge'), challenge, purpose: 'register', userId: auth.user.id, browserHash: '', expiresAt: this.#iso(CHALLENGE_TTL_MS) });
    });
    return registrationOptions(this.rp, { handle: auth.user.userHandle, email: auth.user.email }, challenge, auth.user.passkeys.map(p => p.id));
  }

  async passkeyRegisterVerify(auth: Authenticated, input: unknown): Promise<UserView> {
    check(!auth.user.trial, 'TRIAL_LIMIT', TRIAL_PASSKEY_LINE);
    this.#requireFresh(auth);
    const body = exact(input, ['credential', 'name'], ['credential']);
    const name = body.name === undefined ? 'Passkey' : String(body.name).trim().slice(0, 60) || 'Passkey';
    check(!/[\u0000-\u001f\u007f]/.test(name), 'INVALID_REQUEST', 'Name the passkey with plain words.');
    const challenge = await this.directory.update(state => {
      const found = state.challenges.find(item => item.purpose === 'register' && item.userId === auth.user.id && Date.parse(item.expiresAt) > this.#now().getTime());
      state.challenges = state.challenges.filter(item => item !== found);
      return found?.challenge ?? null;
    });
    check(challenge, 'PASSKEY_CHALLENGE_MISMATCH', 'This passkey request expired. Try again.');
    const stored = verifyRegistration(this.rp, body.credential, { challenge });
    return this.directory.update(state => {
      check(!state.users.some(item => item.passkeys.some(p => p.id === stored.id)), 'PASSKEY_EXISTS', 'This passkey is already on an account.');
      const user = state.users.find(item => item.id === auth.user.id);
      check(user && user.status === 'active', 'UNAUTHENTICATED', 'Sign in again.');
      check(user.passkeys.length < this.#limits.passkeysPerAccount, 'LIMIT_REACHED', `An account can keep ${this.#limits.passkeysPerAccount} passkeys. Remove one first.`);
      user.passkeys.push({ ...stored, name, createdAt: this.#iso(), lastUsedAt: null });
      return userView(user);
    });
  }

  async removePasskey(auth: Authenticated, input: unknown): Promise<UserView> {
    const body = exact(input, ['id'], ['id']);
    return this.directory.update(state => {
      const user = state.users.find(item => item.id === auth.user.id);
      check(user, 'UNAUTHENTICATED', 'Sign in again.');
      const before = user.passkeys.length;
      user.passkeys = user.passkeys.filter(p => p.id !== body.id);
      check(user.passkeys.length < before, 'PASSKEY_UNKNOWN', 'That passkey is not on this account.');
      return userView(user);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------------------------

  #newSession(state: DirectoryState, user: HostedUser, secret: string, method: HostedSessionRecord['method']): HostedSessionRecord {
    const mine = state.sessions.filter(s => s.userId === user.id && !s.revokedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const old of mine.slice(0, Math.max(0, mine.length - this.#limits.sessionsPerAccount + 1))) { old.revokedAt = this.#iso(); this.#ended.push({ userId: user.id, sessionId: old.id }); }
    const session: HostedSessionRecord = {
      id: newId('hsession'), tokenHash: sha256(secret), userId: user.id, createdAt: this.#iso(), expiresAt: this.#iso(SESSION_TTL_MS),
      lastSeenAt: this.#iso(), revokedAt: null, method, businessId: null,
    };
    state.sessions.push(session);
    return session;
  }

  #requireFresh(auth: Authenticated) {
    check(this.#now().getTime() - Date.parse(auth.session.createdAt) <= FRESH_SESSION_MS, 'REAUTHENTICATE', 'For safety, sign in again before adding a passkey.');
  }

  /** The session behind a cookie token, or UNAUTHENTICATED. Refreshes the idle clock at most every five minutes. */
  authenticate(secret: unknown): Authenticated {
    check(typeof secret === 'string' && TOKEN.test(secret), 'UNAUTHENTICATED', 'Sign in to continue.');
    const state = this.directory.read();
    const digest = sha256(secret), now = this.#now().getTime();
    const session = state.sessions.find(s => sameHex(s.tokenHash, digest));
    // A temporary business's session lasts as long as the business: 7 days from its last use (4J23).
    const idleMs = session?.method === 'trial' ? this.#limits.trialIdleMs : SESSION_IDLE_MS;
    check(session && !session.revokedAt && Date.parse(session.expiresAt) > now && now - Date.parse(session.lastSeenAt) <= idleMs, 'UNAUTHENTICATED',
      session?.method === 'trial' ? TRIAL_ENDED_LINE : 'Your session ended. Sign in again.');
    const user = state.users.find(u => u.id === session.userId);
    check(user && user.status === 'active', 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
    check(!user.trial || liveTrial(user, now), 'UNAUTHENTICATED', TRIAL_ENDED_LINE);
    if (now - Date.parse(session.lastSeenAt) > TOUCH_EVERY_MS) {
      void this.directory.update(draft => {
        const s = draft.sessions.find(item => item.id === session.id); if (s) s.lastSeenAt = this.#iso();
        // Each use of a temporary business moves its end on (4J23).
        if (user.trial) slideTrial(draft, user.id, this.#now().getTime(), this.#limits);
      }).catch(() => {});
    }
    return { session, user };
  }

  async signOut(auth: Authenticated, everywhere = false): Promise<{ signedOut: number }> {
    return this.#thenTellEnded(this.directory.update(state => {
      let count = 0;
      for (const s of state.sessions) if (!s.revokedAt && (everywhere ? s.userId === auth.user.id : s.id === auth.session.id)) {
        s.revokedAt = this.#iso(); count++;
        this.#ended.push({ userId: s.userId, sessionId: s.id });
      }
      return { signedOut: count };
    }));
  }

  /**
   * After a change that signed sessions out or revoked them is saved, tells sessionsEnded (4G3); a change that failed
   * revoked nothing, so what it noted is dropped. Never lets a listener's failure reach the caller.
   */
  async #thenTellEnded<T>(change: Promise<T>): Promise<T> {
    let result: T;
    try { result = await change; } catch (error) { this.#ended.length = 0; throw error; }
    const ended = this.#ended.splice(0);
    if (ended.length && this.#sessionsEnded) {
      const byUser = new Map<string, Set<string>>();
      for (const item of ended) byUser.set(item.userId, (byUser.get(item.userId) ?? new Set()).add(item.sessionId));
      for (const [userId, ids] of byUser) { try { this.#sessionsEnded(userId, [...ids]); } catch { /* the listener's own */ } }
    }
    return result;
  }

  /** Points the session at one of its own user's businesses, or at none. Never another user's. */
  async selectBusiness(auth: Authenticated, businessId: string | null): Promise<SessionView> {
    return this.directory.update(state => {
      const session = state.sessions.find(s => s.id === auth.session.id && !s.revokedAt);
      const user = state.users.find(u => u.id === auth.user.id);
      check(session && user, 'UNAUTHENTICATED', 'Sign in again.');
      check(businessId === null || user.businesses.some(b => b.id === businessId), 'BUSINESS_NOT_FOUND', 'That business is not on your account.');
      session.businessId = businessId;
      return sessionView(session);
    });
  }

  /** Deletes the account once it has no businesses left. Every session ends with it. */
  async deleteAccount(auth: Authenticated, input: unknown): Promise<{ deleted: true }> {
    const body = exact(input, ['email'], ['email']);
    check(normalizeEmail(body.email) === auth.user.email, 'CONFIRMATION_REQUIRED', 'Type your email address to delete your account.');
    return this.directory.update(state => {
      const user = state.users.find(u => u.id === auth.user.id);
      check(user, 'UNAUTHENTICATED', 'Sign in again.');
      check(user.businesses.length === 0, 'BUSINESSES_REMAIN', 'Delete your businesses first.');
      state.users = state.users.filter(u => u.id !== user.id);
      state.sessions = state.sessions.filter(s => s.userId !== user.id);
      state.challenges = state.challenges.filter(c => c.userId !== user.id);
      state.magicLinks = state.magicLinks.filter(link => link.email !== user.email);
      delete state.usage[user.tenantId];
      return { deleted: true as const };
    });
  }

  // -------------------------------------------------------------------------------------------
  // Starting without an account (Ink v2 wave 4, 4J23; trial.ts)
  // -------------------------------------------------------------------------------------------

  /**
   * A temporary business's account: no email, its own tenant and one session, deleted with its vault 7 days after its
   * last use unless claimed. A browser whose cookie holds a live trial gets that same trial back; a signed-in account
   * starts businesses from the account. Limited per network address and in number on the server.
   */
  async startTrial(browser: Browser, current: unknown): Promise<SignedIn> {
    AccountService.checkBinding(browser.binding);
    let signedIn: Authenticated | null = null;
    try { signedIn = typeof current === 'string' && current ? this.authenticate(current) : null; }
    catch (error) { if (!(error instanceof Error && (error as { code?: unknown }).code === 'UNAUTHENTICATED')) throw error; }
    if (signedIn) {
      check(signedIn.user.trial, 'ALREADY_SIGNED_IN', 'You are signed in. Start the business from your account.');
      return { token: current as string, session: sessionView(signedIn.session), user: userView(signedIn.user), created: false };
    }
    // The server's room first, so a full server spends nobody's start; then the network's start, by its /64 for IPv6.
    const room = (state: DirectoryState, now: number) => check(state.users.filter(user => liveTrial(user, now)).length < this.#limits.trialsLive, 'HOSTED_BUSY',
      'Many people are trying Chausar right now. Sign in with your email to start a business.');
    room(this.directory.read(), this.#now().getTime());
    this.#trialStarts.take(addressKey(browser.address), 'Too many temporary businesses were started from this network. Wait a little, or sign in with your email.');
    const sessionToken = token();
    return this.#thenTellEnded(this.directory.update(state => {
      const now = this.#now().getTime();
      room(state, now);
      // Without a business yet it lasts an hour from its last use; its one business gives it 7 days (trial.ts).
      const expiresAt = this.#iso(this.#limits.trialEmptyMs);
      const user: HostedUser = {
        id: newId('huser'), tenantId: newTenantId(), email: '', userHandle: randomBytes(16).toString('base64url'), createdAt: this.#iso(), verifiedAt: '',
        status: 'active', passkeys: [], businesses: [], trial: { startedAt: this.#iso(), lastUsedAt: this.#iso(), expiresAt },
      };
      state.users.push(user);
      const session = this.#newSession(state, user, sessionToken, 'trial');
      session.expiresAt = expiresAt;
      return { token: sessionToken, session: sessionView(session), user: userView(user), created: true };
    }));
  }

  /**
   * "Add your email" on a temporary business: a link to that address which keeps the business. It is a sign-in link in
   * every way (single use, fifteen minutes, this browser only, the same answer whether or not the email has an account);
   * opening it signs in and claims the business (verifyMagicLink, trial.ts claimTrial).
   */
  async requestClaimLink(auth: Authenticated, input: unknown, browser: Browser): Promise<{ sent: true; delivers: boolean }> {
    check(liveTrial(auth.user, this.#now().getTime()), 'NOT_A_TRIAL', NOT_A_TRIAL_LINE);
    // At most trialClaimLinks in all (4J23): checked here so a refused one spends no email token, counted below.
    check((auth.user.trial?.claimLinks ?? 0) < this.#limits.trialClaimLinks, 'LIMIT_REACHED', claimLinksLine(this.#limits));
    const body = exact(input, ['email'], ['email']);
    const email = normalizeEmail(body.email);
    const binding = AccountService.checkBinding(browser.binding);
    this.#magicByAddress.take(browser.address, 'Too many sign-in emails from this network. Wait a few minutes.');
    this.#magicByEmail.take(sha256(email), 'Too many sign-in emails for this address. Wait a few minutes.');
    const secret = token();
    await this.directory.update(state => {
      countClaimLink(state, auth.user.id, this.#now().getTime(), this.#limits);
      state.magicLinks.push({ id: newId('magic'), tokenHash: sha256(secret), email, browserHash: sha256(binding), createdAt: this.#iso(), expiresAt: this.#iso(MAGIC_LINK_TTL_MS), consumedAt: null, claimUserId: auth.user.id });
    });
    const link = `${this.rp.origin}/#signin=${secret}`;
    await this.#mailer.send({
      kind: 'magic-link', to: email, subject: 'Keep your Chausar business', link,
      text: `Open this link in the same browser to keep the business you started on Chausar. It works once, for fifteen minutes.\n\n${link}\n\nIf you didn't ask for it, ignore this email.`,
    });
    return { sent: true, delivers: this.#mailer.delivers };
  }

  /**
   * A claim inside a sign-in's change (4J23): the new session opens the kept business, and the trial's own sessions,
   * which the claim ended, are told to sessionsEnded once the change is saved, so their phone alerts end (4G3).
   */
  #claimed(claim: Claimed, session: HostedSessionRecord) {
    session.businessId = claim.businessId;
    for (const sessionId of claim.endedSessions) this.#ended.push({ userId: claim.user.id, sessionId });
  }

  /** Housekeeping (app.ts): forgets every email, network and attempt bucket that has filled up again. */
  sweepLimits(): number {
    return [this.#magicByEmail, this.#magicByAddress, this.#attempts, this.#trialStarts].reduce((swept, limiter) => swept + limiter.sweep(), 0);
  }
}

/** Exact keys on a plain object, like the venture payload checks. */
export function exact(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'INVALID_REQUEST', 'Send one request object.');
  const record = value as Record<string, unknown>;
  check(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)), 'INVALID_REQUEST', 'Send the required fields and nothing else.');
  return record;
}

