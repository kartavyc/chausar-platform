// One-shot C4 task 33 (66.d1, founder decision 1): the owner's own price applies on Save. A price the owner typed and
// saved in the app is the one press on that exact price: the new version is accepted at once and recorded as the
// owner's decision, with an Undo that puts back exactly the previous version until a quote, an order or an invoice uses
// the new price. A price that arrives any other way (an agent, the AI, the phone) still waits on Today for Accept.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintRecord, BlueprintView, QueueList, QueueUndoResult } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { call, code, owner, phone, seedBlueprint, seedOrder, setup, type Env } from './venture-views-env.ts';
import type { Context } from '../runtime/contracts.ts';

const update = (env: Env, patch: Record<string, unknown>, ctx: Context = owner) =>
  (core['venture.blueprint.update'] as (deps: unknown, ctx: Context, payload: unknown) => Promise<BlueprintView>)(env.deps, ctx, { patch });
const quote = (env: Env, payload: Record<string, unknown>) =>
  (money['venture.price.quote'] as (deps: unknown, ctx: Context, payload: unknown) => Promise<unknown>)(env.deps, owner, payload);
const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const undo = (env: Env, rowId: string) => call<QueueUndoResult>(env, 'venture.queue.undo', { rowId });
const venture = (env: Env) => listRecords(env.store.read(), 'venture-record')[0];
const blueprints = (env: Env) => listRecords(env.store.read(), 'venture-blueprint').slice().sort((a, b) => a.version - b.version);
/** Everything a version holds that is not its identity or its version number. */
const content = (record: BlueprintRecord) => {
  const { id: _id, at: _at, digest: _digest, status: _status, version: _version, structureHash: _hash, ...rest } = record;
  return rest;
};

test('an owner save in the app applies the price at once, records the decision and leaves no Today row', async () => {
  const env = await setup();
  const before = await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  const view = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000' }] });
  assert.equal(view.blueprint.status, 'accepted');
  assert.equal(view.blueprint.offers[0].pricing.unitPriceMinor, '200000');
  assert.equal(venture(env).acceptedBlueprintId, view.blueprint.id);
  assert.notEqual(view.blueprint.id, before.id);
  assert.deepEqual(view.decided, { line: 'You set the price of Monthly books to ₹2,000 a month.', undoRowId: `price-set:${venture(env).id}:${view.blueprint.id}` });
  const rows = (await list(env)).rows;
  assert.equal(rows.filter(row => row.kind === 'price' || row.kind === 'plan').length, 0, 'nothing waits on Today');
  const [decision] = listRecords(env.store.read(), 'venture-decision');
  assert.equal(decision.reason, 'Price of Monthly books set to ₹2,000 a month.');
  assert.equal(decision.who, 'owner');
  assert.equal(decision.rowId, view.decided!.undoRowId);
  const decisions = await call<{ decisions: { line: string }[] }>(env, 'venture.decisions.list', {});
  assert.ok(decisions.decisions.some(item => item.line === 'You decided: Price of Monthly books set to ₹2,000 a month.'), JSON.stringify(decisions.decisions));
});

test('Undo puts back exactly the previous version and records it; a second Undo has nothing to undo', async () => {
  const env = await setup();
  const before = await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  const view = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000' }] });
  // Showing the new price on Prices (a quote at the usual quantity) is not a use of it.
  await quote(env, { offerId: 'offer_1' });
  const done = await undo(env, view.decided!.undoRowId);
  assert.deepEqual(done, { restored: true, line: 'You took back the new price for Monthly books.' });
  const now = blueprints(env).at(-1)!;
  assert.equal(now.status, 'accepted');
  assert.equal(venture(env).acceptedBlueprintId, now.id);
  assert.deepEqual(content(now), content(before), 'every offer, price, tax setting and word as before');
  assert.equal(now.offers[0].pricing.unitPriceMinor, '249900');
  assert.equal((await list(env)).rows.filter(row => row.kind === 'price' || row.kind === 'plan').length, 0);
  const reasons = listRecords(env.store.read(), 'venture-decision').map(item => [item.action, item.reason]);
  assert.deepEqual(reasons.at(-1), ['undo', 'You took back the new price for Monthly books.']);
  await assert.rejects(undo(env, view.decided!.undoRowId), code('UNDO_NOTHING'));
});

test('Undo is refused once an order, an invoice or a quote used the new price, or the plan changed again', async () => {
  // An order priced with it.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    const view = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000' }] });
    await seedOrder(env, blueprints(env).at(-1)!);
    await assert.rejects(undo(env, view.decided!.undoRowId), code('UNDO_TOO_LATE'));
    assert.equal(blueprints(env).at(-1)!.id, view.blueprint.id, 'nothing changed');
  }
  // A quote for a client at another quantity.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    const view = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000' }] });
    await quote(env, { offerId: 'offer_1', quantity: '3' });
    await assert.rejects(undo(env, view.decided!.undoRowId), code('UNDO_TOO_LATE'));
  }
  // A later change of the plan.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    const view = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000' }] });
    await update(env, { offers: [{ id: 'offer_1', unitPrice: '2100' }] });
    await assert.rejects(undo(env, view.decided!.undoRowId), code('UNDO_TOO_LATE'));
  }
});

test('a price from outside the app, a change with words, or one joining a waiting change still waits on Today', async () => {
  // From the phone (an agent's or the AI's way in): a draft with the price row and its second ask.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    const view = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000' }] }, phone);
    assert.equal(view.blueprint.status, 'draft');
    assert.equal(view.decided, undefined);
    const [row] = (await list(env)).rows.filter(item => item.kind === 'price');
    assert.equal(row.title, 'New price for Monthly books');
    assert.deepEqual(row.actions.map(action => [action.id, action.secondAsk ?? false]), [['read', false], ['approve', true]]);
    assert.equal(listRecords(env.store.read(), 'venture-decision').length, 0);
  }
  // A price with new words: the plan changed, so it asks.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    const view = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000', name: 'Monthly ledgers' }] });
    assert.equal(view.blueprint.status, 'draft');
  }
  // An accepted plan with another change still waiting: the save joins that draft, which waits.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    await update(env, { name: 'Ledger Cafe Books Pune' });
    const view = await update(env, { offers: [{ id: 'offer_1', unitPrice: '2000' }] });
    assert.equal(view.blueprint.status, 'draft');
  }
});
