// Found on the real Windows app, 16 November 2026: Today said "Confirm your tax. Chausar assumed you do not charge GST.
// Say whether you do.", and an owner who does not charge GST had nothing to press: the Prices page had only an "I charge
// GST" tick, and leaving it off saved nothing, so the card stayed for ever. The owner's own "No" in the app is now an
// answer: it is recorded as the owner's (told-by-you, with a decision), it applies at once on an accepted plan because
// no amount, price, offer or step changes, and the Today card goes and stays gone. Turning tax on, or off when the plan
// charged it, changes what invoices say, so that still waits for Accept as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintView, QueueList } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { call, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';
import type { Context } from '../runtime/contracts.ts';

const update = (env: Env, patch: Record<string, unknown>, options: { ctx?: Context; ownerSave?: boolean } = {}) =>
  (core['venture.blueprint.update'] as (deps: unknown, ctx: Context, payload: unknown) => Promise<BlueprintView>)(env.deps, options.ctx ?? owner, { patch, ...(options.ownerSave === false ? {} : { ownerSave: true }) });
const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const venture = (env: Env) => listRecords(env.store.read(), 'venture-record')[0];
const blueprints = (env: Env) => listRecords(env.store.read(), 'venture-blueprint').slice().sort((a, b) => a.version - b.version);
const taxCard = async (env: Env) => (await list(env)).rows.find(row => row.id.startsWith('setup:prices:'));

test('the owner says No to an assumed "no GST": recorded as the owner\'s own, applied at once, and the card goes for good', async () => {
  const env = await setup();
  const before = await seedBlueprint(env, { status: 'accepted', price2: '1500000', taxAssumed: true });
  assert.equal((await taxCard(env))?.title, 'Confirm your tax');
  assert.equal(before.backOffice.taxRegistered.label, 'assumption');

  const view = await update(env, { taxRegistered: false });
  assert.equal(view.blueprint.status, 'accepted', 'nothing waits to be accepted for an answer that changes no amount');
  assert.deepEqual(view.blueprint.backOffice.taxRegistered, { value: false, label: 'told-by-you', by: 'owner' });
  assert.equal(view.blueprint.backOffice.taxRateBps, '0');
  assert.equal(venture(env).acceptedBlueprintId, view.blueprint.id);
  assert.deepEqual(view.decided, { line: 'You said you do not charge GST.', undoRowId: null });

  const rows = (await list(env)).rows;
  assert.equal(await taxCard(env), undefined, 'the tax card is gone');
  assert.equal(rows.filter(row => row.kind === 'price' || row.kind === 'plan').length, 0, 'and no plan waits on Today in its place');
  const decision = listRecords(env.store.read(), 'venture-decision').at(-1)!;
  assert.deepEqual([decision.action, decision.reason, decision.who], ['approve', 'You do not charge GST.', 'owner']);

  // It stays away: a later price save keeps the owner's answer, and saying No again writes nothing.
  const priced = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000' }] });
  assert.equal(priced.blueprint.backOffice.taxRegistered.label, 'told-by-you');
  assert.equal(await taxCard(env), undefined);
  const count = blueprints(env).length;
  const again = await update(env, { taxRegistered: false });
  assert.equal(blueprints(env).length, count, 'the same answer again writes no version');
  assert.equal(again.blueprint.id, priced.blueprint.id);
  assert.equal(again.decided, undefined);
});

test('everything else in the plan is exactly as it was', async () => {
  const env = await setup();
  const before = await seedBlueprint(env, { status: 'accepted', price2: '1500000', taxAssumed: true });
  const view = await update(env, { taxRegistered: false });
  const now = blueprints(env).at(-1)!;
  assert.equal(now.id, view.blueprint.id);
  for (const key of ['name', 'oneLiner', 'customer', 'offers', 'deliverySteps', 'approvals', 'starterConnectorIds', 'source'] as const) assert.deepEqual(now[key], before[key], key);
  const { taxRegistered: said, ...office } = now.backOffice;
  const { taxRegistered: _assumed, ...officeBefore } = before.backOffice;
  assert.deepEqual(office, officeBefore, 'no tax rate, id, state or invoice setting moved');
  assert.deepEqual(said, { value: false, label: 'told-by-you', by: 'owner' });
});

test('while another plan change waits for Accept, the answer joins that draft, and the tax card still goes', async () => {
  const env = await setup();
  const accepted = await seedBlueprint(env, { status: 'accepted', price2: '1500000', taxAssumed: true });
  await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900', price2: '1500000', taxAssumed: true });
  assert.equal((await taxCard(env))?.title, 'Confirm your tax');
  const view = await update(env, { taxRegistered: false });
  assert.equal(view.blueprint.status, 'draft', 'the waiting price change is not accepted by a tax answer');
  assert.equal(view.blueprint.offers[0].pricing.unitPriceMinor, '299900');
  assert.equal(view.blueprint.backOffice.taxRegistered.label, 'told-by-you');
  assert.equal(view.decided, undefined);
  assert.equal(venture(env).acceptedBlueprintId, accepted.id);
  assert.equal(await taxCard(env), undefined);
});

test('only the owner\'s own press in the app applies at once', async () => {
  // Without the page's own Save it is prepared and waits for Accept, as every other plan change does.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000', taxAssumed: true });
    const view = await update(env, { taxRegistered: false }, { ownerSave: false });
    assert.equal(view.blueprint.status, 'draft');
    assert.equal(view.decided, undefined);
    assert.notEqual(venture(env).acceptedBlueprintId, view.blueprint.id);
  }
  // From the phone it is prepared too.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000', taxAssumed: true });
    const view = await update(env, { taxRegistered: false }, { ctx: phone });
    assert.equal(view.blueprint.status, 'draft');
    assert.equal(view.decided, undefined);
  }
  // Joined with any other change it is a plan change like any other.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000', taxAssumed: true });
    const view = await update(env, { taxRegistered: false, name: 'Ledger Cafe Accounts' });
    assert.equal(view.blueprint.status, 'draft');
    assert.equal(view.decided, undefined);
  }
  // A suggestion's patch (basedOn) is never the owner's own press.
  {
    const env = await setup();
    const plan = await seedBlueprint(env, { status: 'accepted', price2: '1500000', taxAssumed: true });
    const view = await (core['venture.blueprint.update'] as (deps: unknown, ctx: Context, payload: unknown) => Promise<BlueprintView>)(env.deps, owner, { patch: { taxRegistered: false }, ownerSave: true, basedOn: { blueprintId: plan.id, digest: plan.digest } });
    assert.equal(view.blueprint.status, 'draft');
    assert.equal(view.decided, undefined);
  }
});

test('turning tax on, or off when the plan charged it, still waits for Accept', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'accepted', price2: '1500000', taxAssumed: true });
  const on = await update(env, { taxRegistered: true, taxRate: '18' });
  assert.equal(on.blueprint.status, 'draft', 'charging GST changes what invoices say');
  assert.equal(on.decided, undefined);
  assert.equal(on.blueprint.backOffice.taxRegistered.value, true);
  assert.equal(await taxCard(env), undefined, 'the owner answered, so the card is gone either way');
  assert.equal((await list(env)).rows.filter(row => row.kind === 'plan').length, 1, 'the changed plan waits on Today');
});

test('a No that changes the accepted plan from charging tax to not charging waits for Accept', async () => {
  const env = await setup();
  const charged = await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  assert.equal(charged.backOffice.taxRegistered.value, true);
  const view = await update(env, { taxRegistered: false });
  assert.equal(view.blueprint.status, 'draft');
  assert.equal(view.decided, undefined);
  assert.equal(venture(env).acceptedBlueprintId, charged.id);
});
