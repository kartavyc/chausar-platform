// Wave 6 money (6D1, 6D2, 6D3): the owner's billing settings. venture.billing.get reads them with the defaults filled in;
// venture.billing.set (app only) changes the default days until due, the payment terms line, the reminder days, the UPI ID,
// the name clients see and the bank details. Where clients pay is the owner's own setting, so neither the AI tool nor the
// phone can change it. Razorpay keys go to the computer's protected storage (the host's credential port) and never into
// the business file; only which account they are for (test or live, the key's last four characters) is kept here.
import { check, type Context } from '../../contracts.ts';
import { exactPayload, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { billingChange, billingWith, DEFAULT_DUE_IN_DAYS, DEFAULT_REMINDER_DAYS } from './billing-rules.ts';
import type { BillingSettings, BillingView, RazorpayAccount } from './billing-types.ts';
import type { VentureDeps, VentureRecord } from '../contracts.ts';

/** The credential name the Razorpay key id and secret are saved under, in the host's protected storage. */
export const RAZORPAY_CREDENTIAL = 'payments:razorpay';
const KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;
const KEY_SECRET = /^[A-Za-z0-9]{12,64}$/;

/** A business's billing settings, defaults filled in. */
export function billingOf(venture: Pick<VentureRecord, 'billing'>): BillingSettings {
  return billingWith(venture.billing);
}

function viewOf(settings: BillingSettings): BillingView {
  return { settings, defaults: { dueInDays: DEFAULT_DUE_IN_DAYS, reminderDays: [...DEFAULT_REMINDER_DAYS] }, razorpayLabel: 'fixture-tested' };
}

/** venture.billing.get (read). */
export async function billingGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BillingView> {
  exactPayload(payload, []);
  const { venture } = readVenture(deps, ctx);
  return viewOf(billingOf(venture));
}

/** The saved Razorpay keys as { keyId, keySecret }, or null when none are saved or storage is unavailable. */
export async function razorpayKeys(deps: VentureDeps, workspaceId: string): Promise<{ keyId: string; keySecret: string } | null> {
  if (!deps.credentials) return null;
  let saved: string | null = null;
  try { saved = await deps.credentials.get(workspaceId, RAZORPAY_CREDENTIAL); } catch { return null; }
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as { keyId?: unknown; keySecret?: unknown };
    return typeof parsed.keyId === 'string' && KEY_ID.test(parsed.keyId) && typeof parsed.keySecret === 'string' && KEY_SECRET.test(parsed.keySecret)
      ? { keyId: parsed.keyId, keySecret: parsed.keySecret } : null;
  } catch { return null; }
}

/**
 * venture.billing.set (approve, app only). { razorpayKeys: { keyId, keySecret } | null } saves or forgets the Razorpay keys
 * in protected storage; every other field changes the settings (billing-rules.ts billingChange). Answers the new view.
 */
export async function billingSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BillingView> {
  requireAppChannel(ctx, 'venture.billing.set');
  const body = exactPayload(payload, ['dueInDays', 'terms', 'reminderDays', 'upiId', 'payeeName', 'bank', 'razorpayKeys']);
  const { razorpayKeys: keys, ...patch } = body;
  let account: RazorpayAccount | null | undefined;
  if (keys !== undefined) {
    check(deps.credentials, 'CREDENTIAL_UNAVAILABLE', 'Protected key storage is unavailable on this computer.');
    const workspaceId = deps.store.read().workspace.id;
    if (keys === null) {
      await deps.credentials.delete(workspaceId, RAZORPAY_CREDENTIAL);
      account = null;
    } else {
      const given = exactPayload(keys, ['keyId', 'keySecret'], ['keyId', 'keySecret']);
      check(typeof given.keyId === 'string' && KEY_ID.test(given.keyId.trim()), 'INVALID_VENTURE_REQUEST', 'Paste the Key Id from your Razorpay dashboard. It starts with rzp_test_ or rzp_live_.');
      check(typeof given.keySecret === 'string' && KEY_SECRET.test(given.keySecret.trim()), 'INVALID_VENTURE_REQUEST', 'Paste the Key Secret from your Razorpay dashboard.');
      const keyId = given.keyId.trim();
      await deps.credentials.set(workspaceId, RAZORPAY_CREDENTIAL, JSON.stringify({ keyId, keySecret: given.keySecret.trim() }));
      account = { mode: keyId.startsWith('rzp_live_') ? 'live' : 'test', keyHint: keyId.slice(-4), savedAt: deps.clock().toISOString() };
    }
  }
  return ventureAction(deps, ctx, 'approve', 'billing.set', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const next = billingChange(billingOf(venture), patch);
    if (account !== undefined) next.razorpay = account;
    tx.touch({ billing: next });
    return viewOf(next);
  });
}
