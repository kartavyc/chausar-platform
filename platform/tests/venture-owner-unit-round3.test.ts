// Seen in the newest Windows build (15 Nov 2026): changing an offer's unit on Settings, Prices made a draft plan the
// owner had to accept again ("Your plan changed. Read it, then accept it. No prices, offers or steps changed"), even
// when the unit was changed straight back. A unit is the owner's own setting, like a price: saved by the owner in the
// app it applies at once, is recorded as the owner's decision and comes with an Undo, exactly as the owner's own price
// does (core/owner-price.ts). A unit from anywhere else still waits on Today.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintRecord, BlueprintView, QueueList, QueueUndoResult } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { call, code, owner, phone, seedBlueprint, seedOrder, setup, type Env } from './venture-views-env.ts';
import type { Context } from '../runtime/contracts.ts';

const send = (env: Env, body: Record<string, unknown>, ctx: Context = owner) =>
  (core['venture.blueprint.update'] as (deps: unknown, ctx: Context, payload: unknown) => Promise<BlueprintView>)(env.deps, ctx, body);
const save = (env: Env, patch: Record<string, unknown>, ctx: Context = owner) => send(env, { patch, ownerSave: true }, ctx);
const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const undo = (env: Env, rowId: string) => call<QueueUndoResult>(env, 'venture.queue.undo', { rowId });
const venture = (env: Env) => listRecords(env.store.read(), 'venture-record')[0];
const blueprints = (env: Env) => listRecords(env.store.read(), 'venture-blueprint').slice().sort((a, b) => a.version - b.version);
const waiting = async (env: Env) => (await list(env)).rows.filter(row => row.kind === 'price' || row.kind === 'plan').length;
const content = (record: BlueprintRecord) => {
  const { id: _id, at: _at, digest: _digest, status: _status, version: _version, structureHash: _hash, ...rest } = record;
  return rest;
};

test('the owner\'s own unit applies on Save: accepted at once, recorded, and nothing waits on Today', async () => {
  const env = await setup();
  const before = await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  const view = await save(env, { offers: [{ id: 'offer_2', unit: 'year' }] });
  assert.equal(view.blueprint.status, 'accepted');
  assert.equal(view.blueprint.offers[1].pricing.quantityUnit, 'year');
  assert.equal(view.blueprint.offers[1].pricing.unitPriceMinor, before.offers[1].pricing.unitPriceMinor, 'the price is never touched');
  assert.equal(venture(env).acceptedBlueprintId, view.blueprint.id);
  const name = before.offers[1].name.value;
  assert.deepEqual(view.decided, { line: `You set ${name} to be priced per year.`, undoRowId: `price-set:${venture(env).id}:${view.blueprint.id}` });
  assert.equal(await waiting(env), 0, 'no plan to accept again');
  const decision = listRecords(env.store.read(), 'venture-decision').at(-1)!;
  assert.equal(decision.reason, `${name} priced per year.`);
  assert.equal(decision.who, 'owner');
  assert.equal(decision.rowId, view.decided!.undoRowId!);
});

test('changing the unit back is one more Save, and still nothing waits', async () => {
  const env = await setup();
  const before = await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  const was = before.offers[1].pricing.quantityUnit;
  await save(env, { offers: [{ id: 'offer_2', unit: 'year' }] });
  const back = await save(env, { offers: [{ id: 'offer_2', unit: was }] });
  assert.equal(back.blueprint.status, 'accepted');
  assert.equal(back.blueprint.offers[1].pricing.quantityUnit, was);
  assert.equal(await waiting(env), 0);
  // A Save that changes nothing (the unit it already has) makes no decision and no draft to accept.
  const same = await save(env, { offers: [{ id: 'offer_2', unit: was }] });
  assert.equal(same.decided, undefined);
  assert.equal(same.blueprint.status, 'accepted');
  assert.equal(same.blueprint.id, back.blueprint.id, 'no new version for no change');
  assert.equal(await waiting(env), 0);
});

test('Undo puts the unit back exactly, until the plan with the new unit is used', async () => {
  const env = await setup();
  const before = await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  const name = before.offers[1].name.value;
  const view = await save(env, { offers: [{ id: 'offer_2', unit: 'visit' }] });
  const done = await undo(env, view.decided!.undoRowId!);
  assert.deepEqual(done, { restored: true, line: `You took back the new unit for ${name}.` });
  const now = blueprints(env).at(-1)!;
  assert.equal(now.status, 'accepted');
  assert.deepEqual(content(now), content(before));
  assert.equal(await waiting(env), 0);
  await assert.rejects(undo(env, view.decided!.undoRowId!), code('UNDO_NOTHING'));
  // Used by an order: too late, as for a price.
  const again = await save(env, { offers: [{ id: 'offer_2', unit: 'visit' }] });
  await seedOrder(env, blueprints(env).at(-1)!);
  await assert.rejects(undo(env, again.decided!.undoRowId!), code('UNDO_TOO_LATE'));
});

test('a price and a unit saved together are one decision; the line names both', async () => {
  const env = await setup();
  const before = await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
  const view = await save(env, { offers: [{ id: 'offer_1', unitPrice: '2000', unit: 'year' }] });
  assert.equal(view.blueprint.status, 'accepted');
  assert.equal(view.decided!.line, `You set the price of ${before.offers[0].name.value} to ₹2,000 a year.`);
  assert.equal(await waiting(env), 0);
});

test('a unit that is not the owner\'s own Save in the app still waits on Today', async () => {
  // Without the Save's own mark (an agent, the AI, an older window).
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    const view = await send(env, { patch: { offers: [{ id: 'offer_2', unit: 'year' }] } });
    assert.equal(view.blueprint.status, 'draft');
    assert.equal(view.decided, undefined);
    assert.equal(await waiting(env), 1);
  }
  // From the phone.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    const view = await save(env, { offers: [{ id: 'offer_2', unit: 'year' }] }, phone);
    assert.equal(view.blueprint.status, 'draft');
  }
  // With words beside it: more than the owner's own price or unit.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'accepted', price2: '1500000' });
    const view = await save(env, { offers: [{ id: 'offer_2', unit: 'year', name: 'Yearly books' }] });
    assert.equal(view.blueprint.status, 'draft');
  }
  // While the plan is not accepted yet, the unit joins the draft, as a price does.
  {
    const env = await setup();
    await seedBlueprint(env, { status: 'draft', price2: '1500000' });
    const view = await save(env, { offers: [{ id: 'offer_2', unit: 'year' }] });
    assert.equal(view.blueprint.status, 'draft');
    assert.equal(view.decided, undefined);
  }
});
