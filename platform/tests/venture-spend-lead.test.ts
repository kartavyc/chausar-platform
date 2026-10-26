// Ink v2 wave 4, package 4Z3 (founder, 27 Oct): which currency leads AI spend. By the owner's location by default
// (Auto: rupees lead for a business in India once a rupee rate is set), changeable in the spend settings (Rupees
// first, Dollars first). The engine sends the lead with every spend figure, so the screen works out nothing, and a lead
// figure never shows more than two decimals of dollars; the exact figure stays in the receipt. Every amount is worked
// out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AcrossMoneyView, BusinessSnapshot, BusinessSnapshotRead, MoneyOverview, SpendPolicyView, SpendRow, TeamListView } from '../runtime/venture/contracts.ts';
import { dollarsLead, rupeesLead, spendLead } from '../runtime/venture/money/spend.ts';
import { goalBusiness } from './venture-goals-helpers.ts';
import { paidCall } from './venture-money-env.ts';
import { call, code } from './venture-views-env.ts';

const RUPEES = { rate: { perUsd: '835000', setOn: '2026-10-23' }, dateOrder: 'day-month-year' } as const;

test('a lead figure in dollars has two decimals at most, rounded half up in BigInt; a spend above zero never reads as nothing', () => {
  // 719800 micros is USD 0.7198: (719800 + 5000) / 10000 = 72 cents.
  assert.equal(dollarsLead('719800'), 'USD 0.72');
  // 5000 micros is half a cent: rounded up to a cent.
  assert.equal(dollarsLead('5000'), 'USD 0.01');
  assert.equal(dollarsLead('4999'), 'under USD 0.01');
  assert.equal(dollarsLead('0'), 'USD 0.00');
  // 1234567890 micros: 123457 cents.
  assert.equal(dollarsLead('1234567890'), 'USD 1234.57');
});

test('which currency leads: Auto by where the business is, or the owner\'s own choice', () => {
  const india = { code: 'IN' }, us = { code: 'US' };
  assert.equal(rupeesLead('auto', india), true);
  assert.equal(rupeesLead('auto', us), false);
  assert.equal(rupeesLead('inr', us), true);
  assert.equal(rupeesLead('usd', india), false);
});

test('a spend figure as it leads: rupees with dollars beneath, dollars with rupees beneath, or dollars alone without a rate', () => {
  // USD 0.7198 at 83.50: 719800 x 835000 / 10^8 = 6010.83 paise, to the nearest paisa 6010: ₹60.10.
  assert.deepEqual(spendLead('719800', { ...RUPEES, leads: true }), {
    currency: 'INR', figure: '₹60.10', beside: 'USD 0.72 at ₹83.50 per $1', other: 'USD 0.72',
  });
  assert.deepEqual(spendLead('719800', { ...RUPEES, leads: false }, ' this month'), {
    currency: 'USD', figure: 'USD 0.72 this month', beside: '₹60.10 at ₹83.50 per $1', other: '₹60.10',
  });
  assert.deepEqual(spendLead('719800', null), { currency: 'USD', figure: 'USD 0.72' });
});

test('spend settings: Auto by default; the choice is kept, said back with which currency leads, and refused when unknown', async () => {
  const env = await goalBusiness();
  const get = () => env.money<SpendPolicyView>('venture.spend.policy.get');
  // No rate yet: dollars lead whatever the choice.
  assert.deepEqual([(await get()).currencyLead, (await get()).leads], ['auto', 'USD']);
  // A business in India with a rate: Auto leads with rupees.
  const rated = await env.money<SpendPolicyView>('venture.spend.policy.set', { inrPerUsd: '83.50' });
  assert.deepEqual([rated.currencyLead, rated.leads], ['auto', 'INR']);
  const usd = await env.money<SpendPolicyView>('venture.spend.policy.set', { currencyLead: 'usd' });
  assert.deepEqual([usd.currencyLead, usd.leads], ['usd', 'USD']);
  // A field left out keeps it.
  assert.equal((await env.money<SpendPolicyView>('venture.spend.policy.set', { capUsd: '20' })).currencyLead, 'usd');
  const inr = await env.money<SpendPolicyView>('venture.spend.policy.set', { currencyLead: 'inr' });
  assert.deepEqual([inr.currencyLead, inr.leads], ['inr', 'INR']);
  // Rupees first with the rate cleared: nothing to show in rupees, so dollars lead.
  const cleared = await env.money<SpendPolicyView>('venture.spend.policy.set', { inrPerUsd: null });
  assert.deepEqual([cleared.currencyLead, cleared.leads], ['inr', 'USD']);
  await assert.rejects(env.money('venture.spend.policy.set', { currencyLead: 'eur' }), code('INVALID_VENTURE_REQUEST'));
});

test('every view that shows spend sends its lead: Money\'s spend line, the spend page, the businesses page and Team', async () => {
  const env = await goalBusiness();
  await paidCall(env, '719800');
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const rupeesFirst = { currency: 'INR', figure: '₹60.10', beside: 'USD 0.72 at ₹83.50 per $1', other: 'USD 0.72' };

  const overview = await env.money<MoneyOverview>('venture.money.overview');
  assert.deepEqual(overview.lines.find(line => line.id === 'spent')!.lead, rupeesFirst);
  const spend = await env.money<{ rows: SpendRow[]; totalLead?: unknown }>('venture.spend.list');
  assert.deepEqual(spend.totalLead, { ...rupeesFirst, figure: '₹60.10 this month' });
  assert.deepEqual([spend.rows[0]!.reservedLead, spend.rows[0]!.settledLead], [rupeesFirst, rupeesFirst]);
  const across = await env.money<AcrossMoneyView>('venture.money.across');
  assert.deepEqual(across.businesses[0]!.spendLead, rupeesFirst);
  const team = await call<TeamListView>(env, 'venture.team.list');
  assert.deepEqual(team.totals!.spendThisMonth.lead, rupeesFirst);

  // Dollars first: two decimals lead, the rupees beneath.
  await env.money('venture.spend.policy.set', { currencyLead: 'usd' });
  const dollarsFirst = { currency: 'USD', figure: 'USD 0.72', beside: '₹60.10 at ₹83.50 per $1', other: '₹60.10' };
  assert.deepEqual((await env.money<MoneyOverview>('venture.money.overview')).lines.find(line => line.id === 'spent')!.lead, dollarsFirst);
  assert.deepEqual((await call<TeamListView>(env, 'venture.team.list')).totals!.spendThisMonth.lead, dollarsFirst);
  // The exact figure is still the receipt's, and still the line's own value.
  assert.equal((await env.money<MoneyOverview>('venture.money.overview')).lines.find(line => line.id === 'spent')!.value, 'USD 0.7198');
});

test('the limit lines lead as the owner chose, the dollars to two decimals; none without a limit', async () => {
  const env = await goalBusiness();
  const none = await env.money<SpendPolicyView>('venture.spend.policy.set', { inrPerUsd: '83.50' });
  assert.deepEqual([none.capLead, none.askFirstLead], [undefined, undefined]);
  // USD 20 and USD 2 at 83.50: ₹1,670.00 and ₹167.00.
  const rupeesFirst = await env.money<SpendPolicyView>('venture.spend.policy.set', { capUsd: '20', askFirstUsd: '2' });
  assert.deepEqual(rupeesFirst.capLead, { currency: 'INR', figure: '₹1,670.00 a month', beside: 'USD 20.00 at ₹83.50 per $1', other: 'USD 20.00' });
  assert.deepEqual(rupeesFirst.askFirstLead, { currency: 'INR', figure: 'Asks you first above ₹167.00', beside: 'USD 2.00 at ₹83.50 per $1', other: 'USD 2.00' });
  const dollarsFirst = await env.money<SpendPolicyView>('venture.spend.policy.set', { currencyLead: 'usd' });
  assert.deepEqual(dollarsFirst.capLead, { currency: 'USD', figure: 'USD 20.00 a month', beside: '₹1,670.00 at ₹83.50 per $1', other: '₹1,670.00' });
  // The limits as the engine keeps them are unchanged.
  assert.deepEqual([dollarsFirst.cap, dollarsFirst.capUsd], ['USD 20.0000 a month', '20.00']);
});

test('the businesses page: a saved summary carries no rate or country, so the others lead by the open business\'s choice and say so', async () => {
  const env = await goalBusiness();
  await paidCall(env, '719800');
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const figure = (amount: string, display: string, unit: 'minor' | 'micros' = 'minor', currency = 'INR') => ({ amount, unit, currency, display, receiptId: 'their_sum' });
  const other: BusinessSnapshot = {
    format: 'chausar.snapshot.v1', businessId: 'lumen', vaultId: 'vault_lumen', name: 'Lumen Studio', playbook: null, asOf: '2026-10-21T05:00:00.000Z',
    money: { month: '2026-10', currency: 'INR', invoiced: figure('0', 'INR 0.00'), received: figure('0', 'INR 0.00'), owed: figure('0', 'INR 0.00'), late: 0, spend: figure('1250000', 'USD 1.2500', 'micros', 'USD') },
    runs: { working: 0, waiting: 0, stopped: 0 }, needsYou: 0,
  };
  const reads: BusinessSnapshotRead[] = [{ id: 'lumen', name: 'Lumen Studio', opens: 'with-this-computer', openedAt: '2026-10-21T05:00:00.000Z', read: 'saved', snapshot: other }];
  Object.assign(env.deps.workspace!, { snapshots: async () => reads });
  const view = await env.money<AcrossMoneyView>('venture.money.across');
  // The open business: its own rate and choice, as on every other page.
  assert.deepEqual(view.businesses[0]!.spendLead, { currency: 'INR', figure: '₹60.10', beside: 'USD 0.72 at ₹83.50 per $1', other: 'USD 0.72' });
  // Another business at the open one's rate: USD 1.25 at 83.50 is ₹104.38 (10437.5 paise, a half paisa up), said so.
  assert.deepEqual(view.businesses[1]!.spendLead, { currency: 'INR', figure: '₹104.38', beside: "USD 1.25 at the open business's rate, ₹83.50 per $1", other: 'USD 1.25' });
});
