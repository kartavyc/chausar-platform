import type { HostedRequest } from './http.ts';

/** A signed-in desktop install. Every account-scoped route authenticates through `Authenticator`. */
export type Principal = { accountId: string; deviceId: string; sessionId: string };
export type Authenticator = (request: HostedRequest) => Promise<Principal>;

export type Plan = 'free' | 'paid';
/** What an account may use now. Billing derives it; every hosted service checks it. */
export type Entitlements = {
  plan: Plan;
  relay: boolean;          // WhatsApp and Telegram relay (mail relay too); free users use their own mail from the desktop
  backup: boolean;
  backupQuotaBytes: number;
  backupKeep: number;      // versions kept per account
  allowance: boolean;
  allowanceMonthlyPaise: string; // whole paise as a string; '0' only with allowance false (no grant): read it through allowanceGrant
  worker: boolean;
  monthlyMessages: number; // the message budget: 30
};
export type EntitlementSource = (accountId: string) => Promise<Entitlements>;
export const FREE_ENTITLEMENTS: Entitlements = Object.freeze({ plan: 'free', relay: false, backup: false, backupQuotaBytes: 0, backupKeep: 0, allowance: false, allowanceMonthlyPaise: '0', worker: false, monthlyMessages: 30 }) as Entitlements;

export type AllowanceGrantState = 'set' | 'not-set' | 'not-included';
/** How a plan's allowance grant reads to a person: missing is words, never a grant of '0'. */
export function allowanceGrant(entitlements: Entitlements): { paise: string | null; state: AllowanceGrantState } {
  if (entitlements.allowance) return { paise: entitlements.allowanceMonthlyPaise, state: 'set' };
  return { paise: null, state: entitlements.plan === 'paid' ? 'not-set' : 'not-included' };
}
