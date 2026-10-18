// Chausar hosted tier: accounts, sign-in and sessions. No passwords exist anywhere.
// - Email links: a random token, stored only as its SHA-256, single use, fifteen minutes, and bound to the browser
//   that asked for it (a random value in an HttpOnly cookie), so a link forwarded to someone else signs nobody in.
// - Passkeys: added from a fresh session, then used for sign-in without typing an email.
// - Sessions: a random token in an HttpOnly cookie, stored only as its SHA-256, with idle and absolute expiry.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { check, newId } from '../contracts.ts';
import { newTenantId, type HostedCustody } from './custody.ts';
import type { DirectoryState, HostedDirectory, HostedPasskey, HostedSessionRecord, HostedUser } from './directory.ts';
import { RateLimiter, type HostedLimits } from './limits.ts';
import type { Mailer } from './mailer.ts';
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
export type SignedIn = { token: string; session: SessionView; user: UserView; created: boolean };
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

  constructor(options: AccountOptions) {
    this.directory = options.directory; this.rp = options.rp; this.#mailer = options.mailer; this.#limits = options.limits;
    this.#clock = options.clock ?? (() => new Date());
    const ms = () => this.#clock().getTime();
    this.#magicByEmail = new RateLimiter('magic-link-email', options.limits.magicLinkPerEmail, ms);
    this.#magicByAddress = new RateLimiter('magic-link-address', options.limits.magicLinkPerAddress, ms);
    this.#attempts = new RateLimiter('auth-attempts', options.limits.authAttemptsPerAddress, ms);
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
    return this.directory.update(state => {
      const now = this.#now().getTime();
      const link = state.magicLinks.find(item => sameHex(item.tokenHash, digest));
      check(link && !link.consumedAt && Date.parse(link.expiresAt) > now, 'MAGIC_LINK_INVALID', 'This sign-in link expired or was used. Ask for a new one.');
      check(sameHex(link.browserHash, bindingHash), 'MAGIC_LINK_OTHER_BROWSER', 'Open the link in the browser where you asked for it.');
      link.consumedAt = this.#iso();
      let user = state.users.find(item => item.email === link.email);
      const created = !user;
      if (!user) {
        user = { id: newId('huser'), tenantId: newTenantId(), email: link.email, userHandle: randomBytes(16).toString('base64url'), createdAt: this.#iso(), verifiedAt: this.#iso(), status: 'active', passkeys: [], businesses: [] };
        state.users.push(user);
      }
      check(user.status === 'active', 'ACCOUNT_DISABLED', 'This account is turned off.');
      const session = this.#newSession(state, user, sessionToken, 'magic-link');
      return { token: sessionToken, session: sessionView(session), user: userView(user), created };
    });
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

  async passkeyLoginVerify(input: unknown, browser: Browser): Promise<SignedIn> {
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
    return this.directory.update(state => {
      const user = state.users.find(item => item.passkeys.some(p => p.id === identity.id));
      check(user, 'PASSKEY_UNKNOWN', 'This passkey is not on any Chausar account. Sign in with an email link.');
      check(user.status === 'active', 'ACCOUNT_DISABLED', 'This account is turned off.');
      const passkey = user.passkeys.find(p => p.id === identity.id) as HostedPasskey;
      const result = verifyAuthentication(this.rp, input, { challenge, passkey, userHandle: user.userHandle });
      passkey.signCount = result.signCount; passkey.backedUp = result.backedUp; passkey.lastUsedAt = this.#iso();
      const session = this.#newSession(state, user, sessionToken, 'passkey');
      return { token: sessionToken, session: sessionView(session), user: userView(user), created: false };
    });
  }

  /** Adding a passkey needs a session younger than fifteen minutes, so a stolen old session can't plant its own key. */
  async passkeyRegisterOptions(auth: Authenticated) {
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
    for (const old of mine.slice(0, Math.max(0, mine.length - this.#limits.sessionsPerAccount + 1))) old.revokedAt = this.#iso();
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
    check(session && !session.revokedAt && Date.parse(session.expiresAt) > now && now - Date.parse(session.lastSeenAt) <= SESSION_IDLE_MS, 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
    const user = state.users.find(u => u.id === session.userId);
    check(user && user.status === 'active', 'UNAUTHENTICATED', 'Your session ended. Sign in again.');
    if (now - Date.parse(session.lastSeenAt) > TOUCH_EVERY_MS) {
      void this.directory.update(draft => { const s = draft.sessions.find(item => item.id === session.id); if (s) s.lastSeenAt = this.#iso(); }).catch(() => {});
    }
    return { session, user };
  }

  async signOut(auth: Authenticated, everywhere = false): Promise<{ signedOut: number }> {
    return this.directory.update(state => {
      let count = 0;
      for (const s of state.sessions) if (!s.revokedAt && (everywhere ? s.userId === auth.user.id : s.id === auth.session.id)) { s.revokedAt = this.#iso(); count++; }
      return { signedOut: count };
    });
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
}

/** Exact keys on a plain object, like the venture payload checks. */
export function exact(value: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'INVALID_REQUEST', 'Send one request object.');
  const record = value as Record<string, unknown>;
  check(Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key)), 'INVALID_REQUEST', 'Send the required fields and nothing else.');
  return record;
}

