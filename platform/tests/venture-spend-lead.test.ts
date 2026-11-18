// Ink v2 wave 4, package 4Z3 (founder, 27 Oct): which currency leads AI spend. By the owner's location by default
// (Auto: rupees lead for a business in India, at the owner's rate or the reference rate), changeable in the spend settings (Rupees
// first, Dollars first). The engine sends the lead with every spend figure, so the screen works out nothing, and a lead
// figure never shows more than two decimals of dollars; the exact figure stays in the receipt. Every amount is worked
// out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AcrossMoneyView, BusinessSnapshot, BusinessSnapshotRead, MoneyOverview, SpendPolicyView, SpendRow, TeamListView } from '../runtime/venture/contracts.ts';
import { dollarsLead, rupeeRateFor, rupeeRateShown, rupeeRateWords, rupeesLead, spendLead } from '../runtime/venture/money/spend.ts';
import { goalBusiness } from './venture-goals-helpers.ts';
import { paidCall } from './venture-money-env.ts';
import { call, code } from './venture-views-env.ts';

const RUPEES = { rate: { perUsd: '835000', setOn: '2026-10-23' }, dateOrder: 'day-month-year' } as const;

test('a lead figure in dollars has two decimals at most, rounded half up in BigInt; a spend above zero never reads as nothing', () => {
  // 719800 micros is $0.72: (719800 + 5000) / 10000 = 72 cents.
  assert.equal(dollarsLead('719800'), '$0.72');
  // 5000 micros is half a cent: rounded up to a cent.
  assert.equal(dollarsLead('5000'), '$0.01');
  assert.equal(dollarsLead('4999'), 'under $0.01');
  assert.equal(dollarsLead('0'), '$0.00');
  // 1234567890 micros: 123457 cents.
  assert.equal(dollarsLead('1234567890'), '$1,234.57');
});

test('which currency leads: Auto by where the business is, or the owner\'s own choice', () => {
  const india = { code: 'IN' }, us = { code: 'US' };
  assert.equal(rupeesLead('auto', india), true);
  assert.equal(rupeesLead('auto', us), false);
  assert.equal(rupeesLead('inr', us), true);
  assert.equal(rupeesLead('usd', india), false);
});

// Fix round 4 (real-app problem 12): the real app showed an Indore business its AI spend as "$0.00" and "Shown first: US
// dollars, by business location", because rupees could lead only once the owner had typed a rate. The business's own
// currency decides: a rupee business has a rate from its first day, the dated reference rate shipped with the release.
test('the rate rupee figures use: the owner\'s own, else the reference rate for a rupee business, else none', () => {
  const own = { perUsd: '835000', setOn: '2026-10-23' };
  assert.deepEqual(rupeeRateFor({ rupeeRate: own }, { currency: 'INR' }), own);
  assert.deepEqual(rupeeRateFor({ rupeeRate: own }, { currency: 'USD' }), own);
  assert.deepEqual(rupeeRateFor(null, { currency: 'INR' }), { perUsd: '943996', setOn: '2026-11-05', source: 'FBIL reference rate' });
  assert.deepEqual(rupeeRateFor({ rupeeRate: null }, { currency: 'INR' }), { perUsd: '943996', setOn: '2026-11-05', source: 'FBIL reference rate' });
  // Outside India a rupee rate would not be the business's own currency, so none stands in; nor before the business has a country.
  assert.equal(rupeeRateFor(null, { currency: 'USD' }), null);
  assert.equal(rupeeRateFor(null, null), null);
});

// The rate in words is in the owner form, as every figure on a screen is: two decimals, a half paisa up. The exact
// figure (94.3996) is the one typed back in the settings field and kept in each receipt.
test('the rate as the owner reads it has two decimals; the exact figure is typed back and kept in the receipt', () => {
  assert.equal(rupeeRateShown('943996'), '₹94.40');
  assert.equal(rupeeRateShown('835000'), '₹83.50');
  assert.equal(rupeeRateShown('841250'), '₹84.13');
  assert.equal(rupeeRateShown('841249'), '₹84.12');
  assert.equal(rupeeRateShown('12345670000'), '₹12,34,567.00');
  assert.equal(rupeeRateWords({ rate: { perUsd: '943996', setOn: '2026-11-05', source: 'FBIL reference rate' }, dateOrder: 'day-month-year' }), '₹94.40 per $1 (FBIL reference rate of 5 Nov 2026)');
});

test('a spend figure as it leads: rupees with dollars beneath, dollars with rupees beneath, or dollars alone without a rate', () => {
  // $0.72 at 83.50: 719800 x 835000 / 10^8 = 6010.83 paise, to the nearest paisa 6010: ₹60.10.
  assert.deepEqual(spendLead('719800', { ...RUPEES, leads: true }), {
    currency: 'INR', figure: '₹60.10', beside: '$0.72 at ₹83.50 per $1', other: '$0.72',
  });
  assert.deepEqual(spendLead('719800', { ...RUPEES, leads: false }, ' this month'), {
    currency: 'USD', figure: '$0.72 this month', beside: '₹60.10 at ₹83.50 per $1', other: '₹60.10',
  });
  assert.deepEqual(spendLead('719800', null), { currency: 'USD', figure: '$0.72' });
});

test('spend settings: Auto by default; the choice is kept, said back with which currency leads, and refused when unknown', async () => {
  const env = await goalBusiness();
  const get = () => env.money<SpendPolicyView>('venture.spend.policy.get');
  // Fix round 4 (real-app problem 12): no rate of the owner's own yet, and a business in India still reads its spend in
  // rupees first, at the dated reference rate. It never came out in dollars for want of a setting.
  assert.deepEqual([(await get()).currencyLead, (await get()).leads], ['auto', 'INR']);
  // A business in India with a rate: Auto leads with rupees.
  const rated = await env.money<SpendPolicyView>('venture.spend.policy.set', { inrPerUsd: '83.50' });
  assert.deepEqual([rated.currencyLead, rated.leads], ['auto', 'INR']);
  const usd = await env.money<SpendPolicyView>('venture.spend.policy.set', { currencyLead: 'usd' });
  assert.deepEqual([usd.currencyLead, usd.leads], ['usd', 'USD']);
  // A field left out keeps it.
  assert.equal((await env.money<SpendPolicyView>('venture.spend.policy.set', { capUsd: '20' })).currencyLead, 'usd');
  const inr = await env.money<SpendPolicyView>('venture.spend.policy.set', { currencyLead: 'inr' });
  assert.deepEqual([inr.currencyLead, inr.leads], ['inr', 'INR']);
  // Rupees first with the owner's rate cleared: the reference rate stands in again, so rupees still lead.
  const cleared = await env.money<SpendPolicyView>('venture.spend.policy.set', { inrPerUsd: null });
  assert.deepEqual([cleared.currencyLead, cleared.leads], ['inr', 'INR']);
  await assert.rejects(env.money('venture.spend.policy.set', { currencyLead: 'eur' }), code('INVALID_VENTURE_REQUEST'));
});

test('every view that shows spend sends its lead: Money\'s spend line, the spend page, the businesses page and Team', async () => {
  const env = await goalBusiness();
  await paidCall(env, '719800');
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const rupeesFirst = { currency: 'INR', figure: '₹60.10', beside: '$0.72 at ₹83.50 per $1', other: '$0.72' };

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
  const dollarsFirst = { currency: 'USD', figure: '$0.72', beside: '₹60.10 at ₹83.50 per $1', other: '₹60.10' };
  assert.deepEqual((await env.money<MoneyOverview>('venture.money.overview')).lines.find(line => line.id === 'spent')!.lead, dollarsFirst);
  assert.deepEqual((await call<TeamListView>(env, 'venture.team.list')).totals!.spendThisMonth.lead, dollarsFirst);
  // The exact figure is still the receipt's, and still the line's own value.
  assert.equal((await env.money<MoneyOverview>('venture.money.overview')).lines.find(line => line.id === 'spent')!.value, '$0.72');
});

test('the limit lines lead as the owner chose, the dollars to two decimals; none without a limit', async () => {
  const env = await goalBusiness();
  const none = await env.money<SpendPolicyView>('venture.spend.policy.set', { inrPerUsd: '83.50' });
  assert.deepEqual([none.capLead, none.askFirstLead], [undefined, undefined]);
  // USD 20 and USD 2 at 83.50: ₹1,670 and ₹167.
  const rupeesFirst = await env.money<SpendPolicyView>('venture.spend.policy.set', { capUsd: '20', askFirstUsd: '2' });
  assert.deepEqual(rupeesFirst.capLead, { currency: 'INR', figure: '₹1,670 a month', beside: '$20.00 at ₹83.50 per $1', other: '$20.00' });
  assert.deepEqual(rupeesFirst.askFirstLead, { currency: 'INR', figure: 'Asks you first above ₹167', beside: '$2.00 at ₹83.50 per $1', other: '$2.00' });
  const dollarsFirst = await env.money<SpendPolicyView>('venture.spend.policy.set', { currencyLead: 'usd' });
  assert.deepEqual(dollarsFirst.capLead, { currency: 'USD', figure: '$20.00 a month', beside: '₹1,670 at ₹83.50 per $1', other: '₹1,670' });
  // The limits as the engine keeps them are unchanged.
  assert.deepEqual([dollarsFirst.cap, dollarsFirst.capUsd], ['$20.00 a month', '20.00']);
});

test('the businesses page: a saved summary carries no rate or country, so the others lead by the open business\'s choice and say so', async () => {
  const env = await goalBusiness();
  await paidCall(env, '719800');
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const figure = (amount: string, display: string, unit: 'minor' | 'micros' = 'minor', currency = 'INR') => ({ amount, unit, currency, display, receiptId: 'their_sum' });
  const other: BusinessSnapshot = {
    format: 'chausar.snapshot.v1', businessId: 'lumen', vaultId: 'vault_lumen', name: 'Lumen Studio', playbook: null, asOf: '2026-10-21T05:00:00.000Z',
    money: { month: '2026-10', currency: 'INR', invoiced: figure('0', '₹0'), received: figure('0', '₹0'), owed: figure('0', '₹0'), late: 0, spend: figure('1250000', '$1.25', 'micros', 'USD') },
    runs: { working: 0, waiting: 0, stopped: 0 }, needsYou: 0,
  };
  const reads: BusinessSnapshotRead[] = [{ id: 'lumen', name: 'Lumen Studio', opens: 'with-this-computer', openedAt: '2026-10-21T05:00:00.000Z', read: 'saved', snapshot: other }];
  Object.assign(env.deps.workspace!, { snapshots: async () => reads });
  const view = await env.money<AcrossMoneyView>('venture.money.across');
  // The open business: its own rate and choice, as on every other page.
  assert.deepEqual(view.businesses[0]!.spendLead, { currency: 'INR', figure: '₹60.10', beside: '$0.72 at ₹83.50 per $1', other: '$0.72' });
  // Another business at the open one's rate: $1.25 at 83.50 is ₹104.38 (10437.5 paise, a half paisa up), said so.
  assert.deepEqual(view.businesses[1]!.spendLead, { currency: 'INR', figure: '₹104.38', beside: "$1.25 at the open business's rate, ₹83.50 per $1", other: '$1.25' });
});
