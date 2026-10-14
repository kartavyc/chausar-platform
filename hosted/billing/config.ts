import { check } from '../shared/errors.ts';
import type { Env, Fetch } from '../shared/module.ts';
import { UnconfiguredPaymentPartner, type PaymentPartner } from './partner.ts';
import { RazorpayPartner } from './razorpay.ts';

export type BillingConfig = {
  /** Whole paise per month for the paid plan; null when the price is not set yet (never zero). */
  paidPricePaise: string | null;
  backupQuotaBytes: number;
  backupKeep: number;
  /** Monthly model allowance grant in whole paise. '0' means no grant is set, so the allowance stays off. */
  allowanceMonthlyPaise: string;
  graceMs: number;
};
export const DEFAULT_BACKUP_QUOTA_BYTES = 2 * 1024 ** 3;
export const BACKUP_KEEP = 14;
export const PAST_DUE_GRACE_MS = 7 * 24 * 3600000;

const paise = (value: string, name: string) => {
  check(/^(0|[1-9][0-9]{0,15})$/.test(value), 'SERVER_MISCONFIGURED', `${name} must be whole paise.`, 500);
  return BigInt(value).toString();
};

/**
 * BILLING_PAID_PRICE_PAISE (positive whole paise; absent means the price is not set),
 * BACKUP_QUOTA_BYTES (default 2 GiB), ALLOWANCE_MONTHLY_PAISE (default '0': no grant set).
 * RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_PLAN_ID: all four or none.
 */
export function billingConfig(env: Env, fetch: Fetch): { config: BillingConfig; partner: PaymentPartner } {
  const text = (name: string) => env[name]?.trim() || undefined;
  const price = text('BILLING_PAID_PRICE_PAISE');
  const paidPricePaise = price === undefined ? null : paise(price, 'BILLING_PAID_PRICE_PAISE');
  check(paidPricePaise === null || BigInt(paidPricePaise) > 0n, 'SERVER_MISCONFIGURED', 'BILLING_PAID_PRICE_PAISE must be more than zero.', 500);
  const quota = text('BACKUP_QUOTA_BYTES');
  check(quota === undefined || (/^[1-9][0-9]{0,15}$/.test(quota) && Number.isSafeInteger(Number(quota))), 'SERVER_MISCONFIGURED', 'BACKUP_QUOTA_BYTES must be a whole number of bytes.', 500);
  const config: BillingConfig = {
    paidPricePaise, backupQuotaBytes: quota === undefined ? DEFAULT_BACKUP_QUOTA_BYTES : Number(quota), backupKeep: BACKUP_KEEP,
    allowanceMonthlyPaise: paise(text('ALLOWANCE_MONTHLY_PAISE') ?? '0', 'ALLOWANCE_MONTHLY_PAISE'), graceMs: PAST_DUE_GRACE_MS,
  };
  const keys = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'RAZORPAY_PLAN_ID'].map(text);
  const given = keys.filter(Boolean).length;
  if (given === 0) return { config, partner: new UnconfiguredPaymentPartner() };
  check(given === 4, 'SERVER_MISCONFIGURED', 'Set all four Razorpay settings or none.', 500);
  const [keyId, keySecret, webhookSecret, planId] = keys as string[];
  return { config, partner: new RazorpayPartner(fetch, { keyId, keySecret, webhookSecret, planId }) };
}
