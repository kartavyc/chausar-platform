// Money's AI spend on the owner's own AI plan (found by running the real app, 15 Nov 2026: an Indian business on the
// owner's own Codex read "$0.00" with "Set a rupee rate" beside it). On the owner's own Codex or Claude plan a call is
// counted, never priced, so nothing spent says that, in no currency, as Team's month total already does
// (views/team-series.ts). With a key, or once anything is priced, the provider's dollar figure stays the code-computed
// figure it is; a rupee business reads it in rupees first, at the owner's own rate or, until they type one, the dated
// reference rate shipped with the release (fix round 4, real-app problem 12), named beside the figure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { OWN_PLAN_WORDS, onOwnPlan, ownPlanLead } from '../runtime/venture/models/own-plan.ts';
import { agentBusiness } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

const money = (env: any, method: string, payload: unknown = {}): Promise<any> => (moneyHandlers as any)[method](env.deps, owner, payload);
const spentLine = async (env: any) => (await money(env, 'venture.money.overview')).lines.find((line: any) => line.id === 'spent');
function onCodex(env: any, tiers: ('fast' | 'main')[] = ['fast', 'main']) {
  const status = env.models.status.bind(env.models);
  const codex = (tier: any) => ({ ...tier, presetId: 'codex-cli', model: 'codex' });
  env.models.status = () => { const now = status(); return { ...now, tiers: { fast: tiers.includes('fast') ? codex(now.tiers.fast) : now.tiers.fast, main: tiers.includes('main') ? codex(now.tiers.main) : now.tiers.main } }; };
}

test('the words are the owner format\'s own, with no currency in them', () => {
  assert.equal(OWN_PLAN_WORDS, 'On your own AI plan');
  assert.ok(!/[$₹]|\d/.test(OWN_PLAN_WORDS));
});

test('Money at a glance: on the owner\'s own AI plan nothing spent says so, with no price and no rupee rate asked for', async () => {
  const env = await agentBusiness();
  // On a key every call has a price, so nothing spent yet is a figure: rupees first for a rupee business.
  const keyed = await spentLine(env);
  assert.deepEqual(keyed.lead, { currency: 'INR', figure: '₹0', beside: '$0.00 at ₹94.40 per $1', other: '$0.00' });
  onCodex(env);
  assert.equal(onOwnPlan(env.deps, owner), true);
  const counted = await spentLine(env);
  assert.deepEqual(counted.lead, { currency: 'USD', figure: 'On your own AI plan' });
  assert.equal('needsRate' in counted, false);
  assert.equal(counted.value, keyed.value, 'the receipt keeps the sum it proved');
  assert.match(counted.receiptId, /^sum_/);
  // One tier on a key: a price can come, so the figure stays.
  const mixed = await agentBusiness();
  onCodex(mixed, ['fast']);
  assert.equal((await spentLine(mixed)).lead.figure, '₹0');
});

test('Money, Spend: the month\'s total follows the same rule', async () => {
  const env = await agentBusiness();
  const keyed = await money(env, 'venture.spend.list');
  assert.deepEqual(keyed.totalLead, { currency: 'INR', figure: '₹0 this month', beside: '$0.00 at ₹94.40 per $1', other: '$0.00' });
  onCodex(env);
  const counted = await money(env, 'venture.spend.list');
  assert.deepEqual(counted.totalLead, { currency: 'USD', figure: 'On your own AI plan' });
  assert.equal('needsRate' in counted, false);
  assert.equal(counted.total, keyed.total, 'the exact words stay for the receipt and for older readers');
});

test('Team and Money share one rule: the same answer from the same facts', async () => {
  const env = await agentBusiness();
  onCodex(env);
  const team = (await (viewHandlers as any)['venture.team.list'](env.deps, owner, {})).totals.spendThisMonth.lead;
  assert.deepEqual(team, (await spentLine(env)).lead);
});

test('anything priced, or an estimate, keeps its figure: only a plain zero on the owner\'s plan is said in words', async () => {
  const env = await agentBusiness();
  onCodex(env);
  assert.deepEqual(ownPlanLead(env.deps, owner, '0', false), { currency: 'USD', figure: 'On your own AI plan' });
  assert.equal(ownPlanLead(env.deps, owner, '4200', false), null, 'a priced call is a dollar figure');
  assert.equal(ownPlanLead(env.deps, owner, '0', true), null, 'a held estimate is not nothing');
  const keyed = await agentBusiness();
  assert.equal(ownPlanLead(keyed.deps, owner, '0', false), null);
});
