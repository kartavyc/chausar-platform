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
  allowanceMonthlyPaise: string; // whole paise as a string
  worker: boolean;
  monthlyMessages: number; // the message budget: 30
};
export type EntitlementSource = (accountId: string) => Promise<Entitlements>;
export const FREE_ENTITLEMENTS: Entitlements = Object.freeze({ plan: 'free', relay: false, backup: false, backupQuotaBytes: 0, backupKeep: 0, allowance: false, allowanceMonthlyPaise: '0', worker: false, monthlyMessages: 30 }) as Entitlements;
