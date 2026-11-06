// One-shot B4 task 7 (founder approved): a row that changes one price and nothing else accepts on one press on that exact
// price, and Undo restores the previous version exactly, until a quote, an order or an invoice uses the new price. A plan
// change keeps its second ask and its refusal. Nothing changes a price without the owner's press on that price.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintRecord, DecisionsView, QueueDecision, QueueList, QueueRow, QueueUndoResult } from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { call, code, owner, seedBlueprint, seedOrder, setup, type Env } from './venture-views-env.ts';

const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const decide = (env: Env, row: QueueRow, extra: Record<string, unknown> = {}) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', ...extra });
const undo = (env: Env, row: QueueRow) => call<QueueUndoResult>(env, 'venture.queue.undo', { rowId: row.id });
const planRow = async (env: Env) => (await list(env)).rows.find(row => row.viewRef?.kind === 'plan');
const accept = (row: QueueRow) => row.actions.find(action => action.id === 'approve')!;
const venture = (env: Env) => listRecords(env.store.read(), 'venture-record')[0]!;
const blueprint = (env: Env, id: string) => listRecords(env.store.read(), 'venture-blueprint').find(item => item.id === id)!;
const quote = (env: Env, offerId: string) => money['venture.price.quote']!(env.deps, owner, { offerId });

/** The plan in use at ₹2,499 and ₹15,000, and a newer version at ₹2,999 for the first offer. */
async function priced(env: Env, draft: { price1?: string; price2?: string } = {}) {
  const first = await seedBlueprint(env, { status: 'accepted', price1: '249900', price2: '1500000' });
  const second = await seedBlueprint(env, { status: 'draft', version: 2, price1: draft.price1 ?? '299900', price2: draft.price2 ?? '1500000' });
  const row = await planRow(env);
  assert.ok(row);
  return { first, second, row };
}

/** A newer version that also rewrites a line of the plan, and is sealed the way the plan's own writes seal it. */
async function withWords(env: Env, version: BlueprintRecord): Promise<BlueprintRecord> {
  return ventureAction(env.deps, owner, 'admin', 'seed.words', tx => {
    const { id: _id, at: _at, digest: _digest, status: _status, ...rest } = { ...version, oneLiner: { ...version.oneLiner, value: 'Monthly books for cafes and bakeries.' } };
    const changed = { ...rest, digest: digest(rest), id: version.id, at: version.at, status: version.status };
    return tx.replace(changed as BlueprintRecord);
  });
}

test('a row that changes one price has no second ask; the owner presses once on the exact price it shows', async () => {
  const env = await setup();
  const { second, row } = await priced(env);
  assert.equal(row.kind, 'price');
  assert.deepEqual(row.change, { label: 'Monthly books', before: '₹2,499 per month', after: '₹2,999 per month', ownerEntered: true });
  assert.equal(accept(row).secondAsk, undefined);
  const decided = await decide(env, row);
  assert.equal(decided.outcome, 'done');
  assert.equal(decided.line, 'New price for Monthly books accepted.');
  assert.equal(decided.undoable, true);
  assert.equal(venture(env).acceptedBlueprintId, second.id);
});

test('a row that changes more than the price keeps its second ask, and no Undo', async () => {
  const env = await setup();
  const { second } = await priced(env);
  await withWords(env, second);
  const row = (await planRow(env))!;
  assert.equal(row.kind, 'price');
  assert.equal(accept(row).secondAsk, true);
  const decided = await decide(env, row);
  assert.equal(decided.outcome, 'done');
  assert.equal(decided.undoable, undefined);
  await assert.rejects(undo(env, row), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'UNDO_NOTHING');
    assert.equal(error.message, 'Your plan change is still a draft in the business menu. Accept it there.');
    return true;
  });
  assert.equal(venture(env).acceptedBlueprintId, second.id);
});

test('a row that changes two prices keeps its second ask, since the card shows only the first', async () => {
  const env = await setup();
  const { row } = await priced(env, { price2: '1700000' });
  assert.equal(row.title, 'New prices in your plan');
  assert.equal(accept(row).secondAsk, true);
  assert.equal((await decide(env, row)).undoable, undefined);
  await assert.rejects(undo(env, row), code('UNDO_NOTHING'));
});

test('a first plan is still read first, and an accepted plan refuses undo', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft', price2: '1500000' });
  const row = (await planRow(env))!;
  assert.equal(row.kind, 'plan');
  assert.equal(accept(row).requiresView, true);
  assert.equal((await decide(env, row, { viewed: true })).undoable, undefined);
  await assert.rejects(undo(env, row), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'UNDO_NOTHING');
    assert.equal(error.message, 'Your plan change is still a draft in the business menu. Accept it there.');
    return true;
  });
});

test('undo restores the previous version exactly, records the line, and the same row comes back to decide anew', async () => {
  const env = await setup();
  const { first, second, row } = await priced(env);
  const before = structuredClone(blueprint(env, first.id));
  const statusBefore = venture(env).status;
  await decide(env, row);

  const undone = await undo(env, row);
  assert.deepEqual(undone, { restored: true, line: 'You took back the new price for Monthly books.' });

  assert.equal(venture(env).acceptedBlueprintId, first.id);
  assert.equal(venture(env).status, statusBefore);
  assert.deepEqual(blueprint(env, first.id), before, 'the version in use is the same record, untouched');
  assert.equal(blueprint(env, second.id).status, 'draft');
  assert.equal(blueprint(env, second.id).digest, second.digest);
  assert.ok(!listRecords(env.store.read(), 'venture-term').some(term => term.evidence.some(item => item.recordId === second.id)), 'no term still cites the version taken back');

  const decision = listRecords(env.store.read(), 'venture-queue-decision').find(item => item.rowId === row.id)!;
  assert.ok(decision.undoneAt, 'the decision is marked undone, not removed');
  const { decisions } = await call<DecisionsView>(env, 'venture.decisions.list', {});
  assert.ok(decisions.some(item => item.action === 'undo' && item.reason === 'You took back the new price for Monthly books.' && item.who === 'owner'));

  const back = (await planRow(env))!;
  assert.equal(back.id, row.id);
  assert.equal(back.digest, row.digest);
  assert.deepEqual(back.change, row.change);
  await assert.rejects(undo(env, row), code('UNDO_NOTHING'));

  // Decided again, it is the same one press and can be taken back again.
  assert.equal((await decide(env, back)).outcome, 'done');
  assert.equal(venture(env).acceptedBlueprintId, second.id);
  assert.equal((await undo(env, back)).restored, true);
  assert.equal(venture(env).acceptedBlueprintId, first.id);
});

test('a quote made before the press does not use the price; one made after it does', async () => {
  const env = await setup();
  const { row } = await priced(env);
  await quote(env, 'offer_1');
  await decide(env, row);
  // Another offer's quote leaves this price unused.
  await quote(env, 'offer_2');
  assert.equal((await undo(env, row)).restored, true);

  const again = (await planRow(env))!;
  await decide(env, again);
  await quote(env, 'offer_1');
  await assert.rejects(undo(env, again), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'UNDO_TOO_LATE');
    assert.equal(error.message, 'Too late to undo: this price is already in use.');
    return true;
  });
});

test('an order priced at the new price is too late, and nothing moves', async () => {
  const env = await setup();
  const { second, row } = await priced(env);
  await decide(env, row);
  await seedOrder(env, blueprint(env, second.id));
  await assert.rejects(undo(env, row), code('UNDO_TOO_LATE'));
  assert.equal(venture(env).acceptedBlueprintId, second.id);
  assert.equal(blueprint(env, second.id).status, 'accepted');
  const decision = listRecords(env.store.read(), 'venture-queue-decision').find(item => item.rowId === row.id)!;
  assert.equal(decision.undoneAt ?? null, null);
});

test('an invoice priced at the new price is too late, for an order made before it', async () => {
  const env = await setup();
  const { first, second, row } = await priced(env);
  const { order } = await seedOrder(env, first);
  await decide(env, row);
  // Undo still works: the order was priced at the old price.
  assert.equal((await undo(env, row)).restored, true);
  const again = (await planRow(env))!;
  await decide(env, again);
  await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 });
  await assert.rejects(undo(env, again), code('UNDO_TOO_LATE'));
  assert.equal(venture(env).acceptedBlueprintId, second.id);
});

test('a newer version of the plan is too late: the undo never lands on top of it', async () => {
  const env = await setup();
  const { second, row } = await priced(env);
  await decide(env, row);
  await seedBlueprint(env, { status: 'draft', version: 3, price1: '349900', price2: '1500000' });
  await assert.rejects(undo(env, row), code('UNDO_TOO_LATE'));
  assert.equal(venture(env).acceptedBlueprintId, second.id);
});

test('undo works only inside the app, for someone who can approve', async () => {
  const env = await setup();
  const { row } = await priced(env);
  await decide(env, row);
  await assert.rejects(call(env, 'venture.queue.undo', { rowId: row.id }, { ...owner, channel: 'phone' }));
});
