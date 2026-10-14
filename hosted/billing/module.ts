import type { Sql } from '../db/sql.ts';
import type { Clock } from '../shared/clock.ts';
import { FREE_ENTITLEMENTS, allowanceGrant, type EntitlementSource, type Entitlements } from '../shared/auth.ts';
import type { HostedDeps, HostedModule } from '../shared/module.ts';
import { check } from '../shared/errors.ts';
import { fields, json, ok, type Router } from '../shared/http.ts';
import { UnconfiguredPaymentPartner, isPartnerRef, type PartnerEvent, type PaymentPartner } from './partner.ts';
import type { BillingConfig } from './config.ts';

type SubscriptionRow = { account_id: string; partner: string; status: 'pending' | 'active' | 'past_due' | 'cancelled'; checkout_id: string | null; subscription_ref: string | null; current_period_end: Date | null; past_due_since: Date | null };
const isoOf = (value: Date | null) => value === null ? null : new Date(value).toISOString();
const isKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);

/** A paid plan has the allowance exactly when a grant is set; `allowanceMonthlyPaise` is '0' only alongside `allowance: false`. */
export function paidEntitlements(config: BillingConfig): Entitlements {
  return {
    plan: 'paid', relay: true, backup: true, backupQuotaBytes: config.backupQuotaBytes, backupKeep: config.backupKeep,
    allowance: config.allowanceMonthlyPaise !== null, allowanceMonthlyPaise: config.allowanceMonthlyPaise ?? '0', worker: true, monthlyMessages: 30,
  };
}
/** The plans reply: the allowance line carries a state word, and null where the grant is not set or not included. */
const planIncludes = (entitlements: Entitlements) => {
  const grant = allowanceGrant(entitlements);
  return { ...entitlements, allowanceMonthlyPaise: grant.paise, allowanceMonthlyState: grant.state };
};
/** Paid while active, or while past due within the grace period. Pending and cancelled are free. */
export function isPaid(row: Pick<SubscriptionRow, 'status' | 'past_due_since'> | undefined, at: Date, graceMs: number): boolean {
  if (!row) return false;
  if (row.status === 'active') return true;
  return row.status === 'past_due' && row.past_due_since !== null && new Date(row.past_due_since).getTime() + graceMs > at.getTime();
}
export function billingEntitlements(sql: Sql, clock: Clock, config: BillingConfig): EntitlementSource {
  return async accountId => {
    const { rows: [row] } = await sql.query<SubscriptionRow>('SELECT status, past_due_since FROM billing_subscriptions WHERE account_id = $1', [accountId]);
    return isPaid(row, clock(), config.graceMs) ? paidEntitlements(config) : { ...FREE_ENTITLEMENTS };
  };
}

export function createBillingModule(deps: HostedDeps, options: { partner: PaymentPartner; config: BillingConfig }): HostedModule {
  const { sql, clock } = deps, { partner, config } = options;
  const subscription = async (accountId: string, tx: Sql = sql, lock = false) =>
    (await tx.query<SubscriptionRow>(`SELECT * FROM billing_subscriptions WHERE account_id = $1${lock ? ' FOR UPDATE' : ''}`, [accountId])).rows[0];

  /**
   * Cancels a partner subscription Chausar no longer tracks, once. Called inside the event's transaction, so a failed
   * partner call rolls the event back and the partner's retry tries again.
   */
  async function cancelAtPartner(tx: Sql, accountId: string, ref: string, reason: 'superseded' | 'cancelled') {
    const { rows: [done] } = await tx.query('SELECT 1 FROM billing_cancelled_refs WHERE partner = $1 AND subscription_ref = $2', [partner.id, ref]);
    if (done) return;
    await partner.cancel(ref);
    await tx.query('INSERT INTO billing_cancelled_refs (partner, subscription_ref, account_id, reason, cancelled_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [partner.id, ref, accountId, reason, clock().toISOString()]);
  }
  /** The partner subscription a pending checkout already created, if any. */
  async function checkoutRef(tx: Sql, checkoutId: string | null): Promise<string | null> {
    if (!checkoutId) return null;
    const { rows: [row] } = await tx.query('SELECT subscription_ref FROM billing_checkouts WHERE checkout_id = $1 AND partner = $2', [checkoutId, partner.id]);
    return row?.subscription_ref ?? null;
  }

  /**
   * Applies one verified event once. Events for another (older) subscription of the account change nothing, except that
   * a second subscription that starts or charges beside the current one, or a pending checkout a paid one replaces, is
   * cancelled at the partner so nothing untracked keeps charging.
   */
  async function apply(event: PartnerEvent) {
    await sql.transaction(async tx => {
      const at = clock().toISOString();
      const { rowCount } = await tx.query('INSERT INTO billing_events (partner, event_id, type, received_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [partner.id, event.eventId, event.type, at]);
      if (rowCount === 0) return;
      let accountId: string | undefined;
      if (event.checkoutId) accountId = (await tx.query('SELECT account_id FROM billing_checkouts WHERE checkout_id = $1 AND partner = $2', [event.checkoutId, partner.id])).rows[0]?.account_id;
      if (!accountId && event.subscriptionRef) accountId = (await tx.query('SELECT account_id FROM billing_subscriptions WHERE subscription_ref = $1 AND partner = $2', [event.subscriptionRef, partner.id])).rows[0]?.account_id;
      if (!accountId) return;
      await tx.query('UPDATE billing_events SET account_id = $3 WHERE partner = $1 AND event_id = $2', [partner.id, event.eventId, accountId]);
      const row = await subscription(accountId, tx, true), ref = (event.subscriptionRef ?? event.checkoutId)!;
      const end = event.currentPeriodEnd, same = row?.subscription_ref === ref;
      const current = row && (row.status === 'active' || row.status === 'past_due');
      if ((event.type === 'activated' || event.type === 'charged') && current && !same) { await cancelAtPartner(tx, accountId, ref, 'superseded'); return; }
      if (event.type === 'activated') {
        if (same && row.status === 'cancelled') return;
        const refs = [ref, await checkoutRef(tx, event.checkoutId)].filter(Boolean);
        const { rows: [stopped] } = await tx.query('SELECT 1 FROM billing_cancelled_refs WHERE partner = $1 AND subscription_ref = ANY($2::text[])', [partner.id, refs]);
        if (stopped) return; // a subscription or checkout Chausar already cancelled does not come back
        if (row?.status === 'pending' && row.checkout_id !== event.checkoutId) {
          const superseded = await checkoutRef(tx, row.checkout_id);
          if (superseded && superseded !== ref) await cancelAtPartner(tx, accountId, superseded, 'superseded');
        }
        await tx.query(
          `INSERT INTO billing_subscriptions (account_id, partner, plan, status, checkout_id, subscription_ref, current_period_end, updated_at)
           VALUES ($1, $2, 'paid', 'active', $3, $4, $5, $6)
           ON CONFLICT (account_id) DO UPDATE SET partner = $2, status = 'active', checkout_id = COALESCE($3, billing_subscriptions.checkout_id), subscription_ref = $4,
             current_period_end = COALESCE($5, billing_subscriptions.current_period_end), past_due_since = NULL, cancelled_at = NULL, updated_at = $6`,
          [accountId, partner.id, event.checkoutId, ref, end, at]);
        return;
      }
      if (!same || row.status === 'cancelled') return;
      if (event.type === 'charged')
        await tx.query(`UPDATE billing_subscriptions SET status = 'active', current_period_end = COALESCE($2, current_period_end), past_due_since = NULL, updated_at = $3 WHERE account_id = $1`, [accountId, end, at]);
      else if (event.type === 'past_due' && row.status === 'active')
        await tx.query(`UPDATE billing_subscriptions SET status = 'past_due', past_due_since = $2, current_period_end = COALESCE($3, current_period_end), updated_at = $2 WHERE account_id = $1`, [accountId, at, end]);
      else if (event.type === 'cancelled')
        await tx.query(`UPDATE billing_subscriptions SET status = 'cancelled', cancelled_at = $2, past_due_since = NULL, updated_at = $2 WHERE account_id = $1`, [accountId, at]);
    });
  }

  return {
    id: 'billing',
    routes(router: Router) {
      router.add('GET', '/v1/billing/plans', async request => {
        await deps.authenticate(request);
        const paid = config.paidPricePaise;
        return ok({ plans: [
          { plan: 'free', pricePaise: '0', priceState: 'set', period: 'month', includes: planIncludes(FREE_ENTITLEMENTS) },
          { plan: 'paid', pricePaise: paid, priceState: paid === null ? 'not-set' : 'set', period: 'month', includes: planIncludes(paidEntitlements(config)) },
        ] });
      });

      router.add('GET', '/v1/billing/subscription', async request => {
        const principal = await deps.authenticate(request);
        const row = await subscription(principal.accountId);
        const { plan } = await deps.entitlements(principal.accountId);
        return ok({ plan, status: row?.status ?? 'none', currentPeriodEnd: isoOf(row?.current_period_end ?? null), partner: row?.partner ?? null });
      });

      router.add('POST', '/v1/billing/checkout', async request => {
        const principal = await deps.authenticate(request);
        const body = fields<{ plan: unknown; idempotencyKey: unknown }>(json(request), ['plan', 'idempotencyKey']);
        check(body.plan === 'paid', 'PLAN_INVALID', 'Only the paid plan can be bought.');
        check(isKey(body.idempotencyKey), 'INVALID_REQUEST', 'The idempotency key must be 16 to 128 letters, digits, dashes or underscores.');
        check(!(partner instanceof UnconfiguredPaymentPartner), 'PAYMENT_PARTNER_NOT_CONFIGURED', 'Payments are not set up on this server.', 503);
        check(config.paidPricePaise !== null, 'PRICE_NOT_SET', 'The price of the paid plan is not set yet.', 503);
        const accountId = principal.accountId, key = body.idempotencyKey;
        const row = await subscription(accountId);
        check(!row || row.status === 'pending' || row.status === 'cancelled', 'SUBSCRIPTION_EXISTS', 'This account already has a subscription.', 409);
        const known = (await sql.query('SELECT checkout_id, checkout_url FROM billing_checkouts WHERE account_id = $1 AND idempotency_key = $2', [accountId, key])).rows[0];
        if (known) return ok({ checkoutId: known.checkout_id, checkoutUrl: known.checkout_url, status: 'pending' });
        const made = await partner.createCheckout({ accountId, plan: 'paid', idempotencyKey: key });
        check(isPartnerRef(made.checkoutId) && typeof made.checkoutUrl === 'string' && made.checkoutUrl.startsWith('https://') && made.checkoutUrl.length <= 2048,
          'PAYMENT_PARTNER_FAILED', 'The payment partner did not complete the request.', 502);
        const madeRef = made.subscriptionRef ?? null;
        check(madeRef === null || isPartnerRef(madeRef), 'PAYMENT_PARTNER_FAILED', 'The payment partner did not complete the request.', 502);
        const saved = await sql.transaction(async tx => {
          const at = clock().toISOString();
          const before = await subscription(accountId, tx, true);
          await tx.query(`INSERT INTO billing_checkouts (checkout_id, account_id, partner, plan, idempotency_key, checkout_url, subscription_ref, created_at) VALUES ($1, $2, $3, 'paid', $4, $5, $6, $7)
            ON CONFLICT (account_id, idempotency_key) DO NOTHING`, [made.checkoutId, accountId, partner.id, key, made.checkoutUrl, madeRef, at]);
          const { rows: [winner] } = await tx.query('SELECT checkout_id, checkout_url FROM billing_checkouts WHERE account_id = $1 AND idempotency_key = $2', [accountId, key]);
          // The earlier checkout this one replaces is cancelled at the partner, so its link can no longer start a second subscription.
          if (before?.status === 'pending' && before.checkout_id && before.checkout_id !== winner.checkout_id) {
            const superseded = await checkoutRef(tx, before.checkout_id);
            if (superseded && superseded !== madeRef) await cancelAtPartner(tx, accountId, superseded, 'superseded');
          }
          await tx.query(`INSERT INTO billing_subscriptions (account_id, partner, plan, status, checkout_id, updated_at) VALUES ($1, $2, 'paid', 'pending', $3, $4)
            ON CONFLICT (account_id) DO UPDATE SET partner = $2, status = 'pending', checkout_id = $3, subscription_ref = NULL, current_period_end = NULL,
              past_due_since = NULL, cancelled_at = NULL, updated_at = $4 WHERE billing_subscriptions.status IN ('pending', 'cancelled')`,
            [accountId, partner.id, winner.checkout_id, at]);
          return winner;
        });
        return ok({ checkoutId: saved.checkout_id, checkoutUrl: saved.checkout_url, status: 'pending' });
      }, { maxBody: 4096 });

      router.add('POST', '/v1/billing/cancel', async request => {
        const principal = await deps.authenticate(request);
        fields(json(request), []);
        const row = await subscription(principal.accountId);
        check(row && row.status !== 'cancelled', 'NO_SUBSCRIPTION', 'There is no subscription to cancel.', 409);
        if (row.status !== 'pending') {
          check(row.partner === partner.id, 'PAYMENT_PARTNER_CHANGED', 'This subscription belongs to a payment partner this server no longer uses.', 409);
          await partner.cancel(row.subscription_ref!);
          await sql.query('INSERT INTO billing_cancelled_refs (partner, subscription_ref, account_id, reason, cancelled_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
            [partner.id, row.subscription_ref, principal.accountId, 'cancelled', clock().toISOString()]);
        }
        const at = clock().toISOString();
        const { rowCount } = await sql.query(`UPDATE billing_subscriptions SET status = 'cancelled', cancelled_at = $3, past_due_since = NULL, updated_at = $3 WHERE account_id = $1 AND status = $2`,
          [principal.accountId, row.status, at]);
        check(rowCount === 1, 'SUBSCRIPTION_CHANGED', 'The subscription changed meanwhile. Look again.', 409);
        return ok({ status: 'cancelled', currentPeriodEnd: isoOf(row.current_period_end) });
      }, { maxBody: 1024 });

      router.add('POST', '/v1/billing/webhooks/:partner', async request => {
        check(request.params.partner === partner.id, 'NOT_FOUND', 'Nothing is here.', 404);
        const event = partner.verifyWebhook(request.body, request.headers);
        if (event) await apply(event);
        return ok({ received: true });
      }, { maxBody: 128 * 1024 });
    },
  };
}
