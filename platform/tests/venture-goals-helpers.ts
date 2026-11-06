// Shared by the goals and next best step tests (Ink v2 wave 4, package 4I1): the views test business
// (venture-views-env.ts) moved to 23 October 2026, 15:30 in Asia/Kolkata, the money handlers beside the views ones, and
// invoices made through the engine's own methods. Every expected amount is worked out by hand in the tests.
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { ClientRecord, InvoiceView, OrderRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { owner, seedBlueprint, setup } from './venture-views-env.ts';

export const DAY = 86_400_000;
/**
 * INR 19,750.00 a month before tax. GST at 18% split CGST and SGST for a client in state 27:
 * 1975000 x 900 / 10000 = 177750 each, tax 355500, total 1975000 + 355500 = 2330500 (INR 23,305.00) a month.
 */
export const PRICE = '1975000';
export const CLIENT = 'Cafe Aroma Demo';

export type GoalEnv = Awaited<ReturnType<typeof goalBusiness>>;

/**
 * The views business with an accepted plan at PRICE a month (or `price`; null leaves the offer without a price), one
 * client in state 27, and money(method) beside call(method).
 */
export async function goalBusiness(options: { taxAssumed?: boolean; price?: string | null } = {}) {
  const env = await setup();
  env.advance(8 * DAY); // 2026-10-23T10:00:00Z: 15:30 on 23 October in Kolkata
  await seedBlueprint(env, { price1: options.price === undefined ? PRICE : options.price, ...(options.taxAssumed ? { taxAssumed: true } : {}) });
  const money = <T = unknown>(method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> => {
    const handler = (moneyHandlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method];
    assert.ok(handler, `no money handler for ${method}`);
    return handler(env.deps, ctx, payload) as Promise<T>;
  };
  const client = await money<ClientRecord>('venture.client.add', { name: CLIENT, email: 'owner@aroma.example', countryCode: 'IN', stateCode: '27' });
  return { ...env, money, client };
}

/** An order of `quantity` months, its invoice drafted with `issueDate` (null: today on the owner's calendar), then issued unless `draft`. */
export async function invoice(env: GoalEnv, quantity: string, issueDate: string | null, draft = false): Promise<InvoiceView> {
  const order = await env.money<OrderRecord>('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', quantity, request: 'Close the month of books.' });
  const prepared = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: order.id, ...(issueDate === null ? {} : { issueDate }) });
  if (draft) return prepared;
  return env.money<InvoiceView>('venture.invoice.issue', { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest });
}
