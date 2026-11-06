// Chausar hosted tier: starting without an account (Ink v2 wave 4, package 4J23; catalogue O25). A trial is an account
// with no email yet: its own tenant, one session in one browser, one business ever, deleted with its vault 7 days after
// its last use (an hour while it has no business; limits.ts) unless claimed first. Until then it issues no invoice,
// records no payment and publishes or sends nothing from the server (TRIAL_LIMIT: the hosted app answers first, the
// engine's own write path holds it, venture/records.ts), its vault has a size cap, and it calls AI only with the owner's
// own key under its own rate and ceiling (models.ts). The server keeps no email and no network address for it.
// Claiming, by an email link or an existing account's passkey, keeps the business on that account and clears the
// expiry. A new email turns the trial into that account where it stands. An account that already existed takes the
// business over: its vault stays where it is, under the trial's tenant (HostedBusiness.vaultTenantId), so nothing is
// copied or moved on disk and one directory change does it all. Either way the trial's session ends, and the phone
// alerts it turned on end with it (4G3: a revoked session's subscriptions go).
import { check } from '../contracts.ts';
import type { DirectoryState, HostedBusiness, HostedUser } from './directory.ts';
import type { HostedLimits } from './limits.ts';
import { TRIAL_MONEY_LINE, TRIAL_SEND_LINE } from '../venture/records.ts';

export { TRIAL_MONEY_LINE, TRIAL_SEND_LINE };

/** The one sentence the session view shows while the business is temporary. */
export const TRIAL_LINE = 'This business is temporary until you add your email.';
/** What it says in the last day before the business is deleted. */
export const TRIAL_ENDING_LINE = 'This business will be deleted within a day unless you add your email.';
export const TRIAL_ENDED_LINE = 'This temporary business has ended. Start again.';
export const TRIAL_ONE_BUSINESS_LINE = 'A temporary business is one business. Add your email to keep it, then start another.';
export const TRIAL_KEY_LINE = 'A temporary business uses AI only with your own key. Connect your key in Connections.';
export const TRIAL_PASSKEY_LINE = 'Add your email first. Then you can add a passkey.';
export const NOT_A_TRIAL_LINE = 'This business is already kept on your account.';
export { TRIAL_FULL_LINE } from '../venture/records.ts';
export const TRIAL_OFF_LINE = 'This server does not start businesses without an account. Sign in with your email.';
const DAY_MS = 86_400_000;

/**
 * The methods a trial may not call, with what it is told: the ones that would issue an invoice or record a payment for
 * real, and the ones that would publish or send from the server. The hosted app refuses them before anything is
 * journalled; the engine refuses the records themselves on every other way in (Today's Issue, bank rows).
 */
export const TRIAL_REFUSED_METHODS: ReadonlyMap<string, string> = new Map([
  ...['venture.invoice.issue', 'venture.payment.record', 'venture.payment.clear', 'venture.credit.issue', 'venture.bills.pay'].map(method => [method, TRIAL_MONEY_LINE] as const),
  ...['venture.share.create', 'venture.share.request', 'venture.bank.alerts.set'].map(method => [method, TRIAL_SEND_LINE] as const),
]);

/** What the session view says about a temporary business; null once it is kept on an account. */
export type TrialView = { temporary: true; line: string; expiresAt: string; endsSoon: boolean; warning: string | null };

/** A trial that has not run out and is not being deleted. */
export function liveTrial(user: HostedUser | null | undefined, nowMs: number): boolean {
  return !!user?.trial && !user.trial.endingAt && Date.parse(user.trial.expiresAt) > nowMs;
}

/** A trial housekeeping should delete now: run out, or already being deleted. */
export function trialDue(user: HostedUser, nowMs: number): boolean {
  return !!user.trial && (!!user.trial.endingAt || Date.parse(user.trial.expiresAt) <= nowMs);
}

/** The trial's view, with the warning in its last day (only while it has a business to lose). */
export function trialView(user: HostedUser, nowMs: number): TrialView | null {
  if (!user.trial) return null;
  const endsSoon = user.businesses.length > 0 && Date.parse(user.trial.expiresAt) - nowMs <= DAY_MS;
  return { temporary: true, line: TRIAL_LINE, expiresAt: user.trial.expiresAt, endsSoon, warning: endsSoon ? TRIAL_ENDING_LINE : null };
}


/** The tenant whose folder and key hold a business's vault. */
export const vaultTenantOf = (user: HostedUser, business: HostedBusiness) => business.vaultTenantId ?? user.tenantId;

/** Who holds the business whose vault is under this key, and its entry; null when nobody does. */
export function vaultOwner(state: DirectoryState, key: readonly [string, string]): { user: HostedUser; business: HostedBusiness } | null {
  for (const user of state.users) {
    const business = user.businesses.find(item => item.id === key[1] && vaultTenantOf(user, item) === key[0]);
    if (business) return { user, business };
  }
  return null;
}

/** Sets a live trial's end: this long from now, for it and its session. */
function endAt(state: DirectoryState, user: HostedUser, nowMs: number, idleMs: number) {
  const trial = user.trial!;
  trial.lastUsedAt = new Date(nowMs).toISOString();
  trial.expiresAt = new Date(nowMs + idleMs).toISOString();
  for (const session of state.sessions) if (session.userId === user.id && session.method === 'trial' && !session.revokedAt) session.expiresAt = trial.expiresAt;
}

/**
 * A use moves the end on (authenticate calls it on its touch): 7 days from now with a business, an hour without one.
 * A trial that ran out or is being deleted stays as it is.
 */
export function slideTrial(state: DirectoryState, userId: string, nowMs: number, limits: HostedLimits) {
  const user = state.users.find(item => item.id === userId);
  if (!user || !liveTrial(user, nowMs)) return;
  endAt(state, user, nowMs, user.businesses.length ? limits.trialIdleMs : limits.trialEmptyMs);
}

/** Its one business was made (app.ts): never another, and 7 days from now. */
export function trialBusinessStarted(state: DirectoryState, user: HostedUser, nowMs: number, limits: HostedLimits) {
  check(!user.trial?.businessStartedAt && user.businesses.length === 0, 'TRIAL_LIMIT', TRIAL_ONE_BUSINESS_LINE);
  user.trial!.businessStartedAt = new Date(nowMs).toISOString();
  endAt(state, user, nowMs, limits.trialIdleMs);
}

/** Its business was deleted (app.ts): with nothing left to keep, it ends an hour from now. */
export function trialBusinessGone(state: DirectoryState, user: HostedUser, nowMs: number, limits: HostedLimits) {
  if (liveTrial(user, nowMs) && user.businesses.length === 0) endAt(state, user, nowMs, limits.trialEmptyMs);
}

/**
 * Housekeeping's first step on a trial (app.ts): inside one directory change, check it is still due and mark it as
 * being deleted, so a claim, a use or a slide that lands after this can't keep it. Answers the trial as it is now, or
 * null when it was claimed, used or is gone.
 */
export function markTrialEnding(state: DirectoryState, userId: string, nowMs: number): HostedUser | null {
  const user = state.users.find(item => item.id === userId);
  if (!user || !trialDue(user, nowMs)) return null;
  user.trial!.endingAt ??= new Date(nowMs).toISOString();
  return structuredClone(user);
}

/** Removes a trial's account (with the sealed keys of its vaults) and what points at it: sessions, challenges, claim links. */
function dropTrialAccount(state: DirectoryState, user: HostedUser) {
  state.users = state.users.filter(item => item.id !== user.id);
  state.sessions = state.sessions.filter(session => session.userId !== user.id);
  state.challenges = state.challenges.filter(challenge => challenge.userId !== user.id);
  state.magicLinks = state.magicLinks.filter(link => link.claimUserId !== user.id);
}

/**
 * After a trial's vaults are deleted (app.ts expireTrials), the directory forgets it: its account and sealed vault keys,
 * sessions, challenges and claim links, its AI usage ledger and the share link index of its vaults. Answers whether it
 * was there.
 */
export function forgetTrial(state: DirectoryState, userId: string): boolean {
  const user = state.users.find(item => item.id === userId && item.trial);
  if (!user) return false;
  dropTrialAccount(state, user);
  delete state.usage[user.tenantId];
  if (state.shareLinks) state.shareLinks = state.shareLinks.filter(link => link.tenantId !== user.tenantId);
  return true;
}

/** "Add your email" links a trial has asked for: at most limits.trialClaimLinks, counted inside the directory change. */
export function countClaimLink(state: DirectoryState, userId: string, nowMs: number, limits: HostedLimits) {
  const user = state.users.find(item => item.id === userId);
  check(user && liveTrial(user, nowMs), 'NOT_A_TRIAL', NOT_A_TRIAL_LINE);
  check((user.trial!.claimLinks ?? 0) < limits.trialClaimLinks, 'LIMIT_REACHED', claimLinksLine(limits));
  user.trial!.claimLinks = (user.trial!.claimLinks ?? 0) + 1;
}

/** What a trial is told once it has asked for all its claim links. */
export const claimLinksLine = (limits: HostedLimits) =>
  `This business has had ${limits.trialClaimLinks} email links already. Open the newest one, or keep it with your account's passkey.`;

/** endedSessions: the trial's sessions this claim ended, for 4G3's phone alert subscriptions (AccountService). */
export type Claimed = { user: HostedUser; created: boolean; businessId: string | null; endedSessions: string[] };

/**
 * Keeps a live trial's business on an account, inside one directory change (verifyMagicLink, passkeyLoginVerify). With
 * no account for the email (account null), the trial becomes that account where it stands: same id, tenant, business
 * and vault, the email set, the expiry gone, its trial session ended. With an account, the business moves to it,
 * keeping its vault under the trial's tenant; the trial's AI usage this month joins the account's ledger so the account
 * ceiling counts it, and the trial's account is removed. An account with no room refuses (LIMIT_REACHED) and nothing
 * changes. Null when the trial is gone, ran out or is being deleted.
 */
export function claimTrial(state: DirectoryState, trialId: string, email: string, account: HostedUser | null, limits: HostedLimits, nowMs: number): Claimed | null {
  const trial = state.users.find(item => item.id === trialId);
  if (!trial || !liveTrial(trial, nowMs)) return null;
  const now = new Date(nowMs).toISOString();
  const endedSessions = state.sessions.filter(session => session.userId === trial.id && session.method === 'trial' && !session.revokedAt).map(session => session.id);
  if (!account) {
    trial.email = email;
    trial.verifiedAt = now;
    delete trial.trial;
    for (const session of state.sessions) if (endedSessions.includes(session.id)) session.revokedAt = now;
    state.magicLinks = state.magicLinks.filter(link => link.claimUserId !== trial.id || link.consumedAt);
    return { user: trial, created: true, businessId: trial.businesses[0]?.id ?? null, endedSessions };
  }
  check(!account.trial, 'NOT_A_TRIAL', NOT_A_TRIAL_LINE);
  const room = limits.businessesPerAccount - account.businesses.length;
  check(trial.businesses.length <= room, 'LIMIT_REACHED',
    `Your account keeps ${limits.businessesPerAccount} businesses already. Delete one, then try again to keep this one.`);
  for (const business of trial.businesses) account.businesses.push({ ...business, vaultTenantId: vaultTenantOf(trial, business) });
  const spent = state.usage[trial.tenantId] ?? [];
  if (spent.length) {
    const list = state.usage[account.tenantId] ??= [];
    for (const entry of spent) if (!list.some(item => item.callId === entry.callId)) list.push(entry);
  }
  delete state.usage[trial.tenantId];
  // Share links stay as they are: they name the vault's tenant, which the business keeps.
  dropTrialAccount(state, trial);
  return { user: account, created: false, businessId: trial.businesses[0]?.id ?? null, endedSessions };
}

/** True for a request that carries an AI provider key: the owner's own, from their vault (the server holds none). */
export function carriesOwnKey(headers: Record<string, string>): boolean {
  const value = (name: string) => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? '';
  return /^\S{8,}$/.test(value('x-api-key')) || /^Bearer \S{8,}$/.test(value('authorization'));
}
