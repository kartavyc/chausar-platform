// C7 task 17: owner-made trackers. Make, change and remove one; a count cell or text cell with money refuses
// TRACKER_MONEY; a receipt from another business refuses; a receipt cell shows the receipt's figure; an estimate cell
// always carries the label; limits hold; making one is app only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ventureAction } from '../runtime/venture/records.ts';
import { TRACKER_LIMITS } from '../runtime/venture/trackers/cells.ts';
import { agentBusiness } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

const phone = { ...owner, channel: 'phone' as const };
const COLUMNS = [
  { id: 'title', name: 'Title', kind: 'text' }, { id: 'hours', name: 'Hours', kind: 'count' }, { id: 'stage', name: 'Stage', kind: 'choice', options: ['Idea', 'Out'] },
  { id: 'bill', name: 'Bill', kind: 'receipt' }, { id: 'guess', name: 'Guess', kind: 'estimate' },
];
async function withTracker() {
  const env = await agentBusiness();
  const { tracker } = await env.agents('venture.trackers.set', { tracker: { name: 'Work log', columns: COLUMNS, boardBy: 'stage' } });
  return { env, tracker };
}
const add = (env: any, trackerId: string, cells: unknown) => env.agents('venture.trackers.rows.add', { trackerId, cells });

test('make, change and remove a tracker; rows go with it; app only', async () => {
  const { env, tracker } = await withTracker();
  assert.equal(tracker.name, 'Work log');
  await add(env, tracker.id, { title: 'First cut', hours: 3, stage: 'Idea' });
  const list = await env.agents('venture.trackers.list', {});
  assert.deepEqual(list.trackers.map((item: any) => [item.name, item.rows]), [['Work log', 1]]);
  const changed = await env.agents('venture.trackers.set', { tracker: { id: tracker.id, name: 'Log', columns: COLUMNS } });
  assert.equal(changed.tracker.name, 'Log');
  await assert.rejects(env.agents('venture.trackers.set', { tracker: { name: 'No', columns: COLUMNS } }, phone), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(env.agents('venture.trackers.set', { tracker: { name: 'Bad board', columns: COLUMNS, boardBy: 'title' } }), { code: 'INVALID_VENTURE_REQUEST' });
  await env.agents('venture.trackers.remove', { id: tracker.id });
  assert.deepEqual((await env.agents('venture.trackers.list', {})).trackers, []);
  await assert.rejects(env.agents('venture.trackers.get', { id: tracker.id }), { code: 'TRACKER_NOT_FOUND' });
});

test('money gets in only by a receipt or an estimate', async () => {
  const { env, tracker } = await withTracker();
  await assert.rejects(add(env, tracker.id, { hours: 'Fee 5000' }), { code: 'TRACKER_MONEY' });
  await assert.rejects(add(env, tracker.id, { title: 'Billed ₹5,000 for this' }), { code: 'TRACKER_MONEY' });
  await assert.rejects(env.agents('venture.trackers.set', { tracker: { name: 'Fees', columns: [{ id: 'fee', name: 'Fee', kind: 'count' }] } }), { code: 'TRACKER_MONEY' });
  await assert.rejects(add(env, tracker.id, { bill: 'sum_from_elsewhere' }), { code: 'INVALID_VENTURE_REQUEST' });
  // A plain date in words with a figure is no money.
  await add(env, tracker.id, { title: 'GST payment due 20 Nov' });
  const receipt = await ventureAction(env.deps, owner, 'prepare', 'test.receipt', tx => tx.put({ ...tx.base('venture-sum-receipt'), subject: { kind: 'test' }, operation: 'venture.sum', currency: 'INR', unit: 'minor', figures: [{ key: 'total', label: 'Total', display: '₹5,000', minor: '500000' }] } as any));
  const { row } = await add(env, tracker.id, { title: 'Billed', bill: receipt.id, guess: 'About a week of work' });
  const cells = Object.fromEntries(row.cells.map((cell: any) => [cell.column, cell]));
  assert.equal(cells.bill.display, '₹5,000');
  assert.equal(cells.bill.receiptId, receipt.id);
  assert.equal(cells.guess.label, 'model estimate');
  assert.equal(cells.title.label, undefined);
});

test('limits hold: 12 columns, 20 trackers, 1,000 rows', async () => {
  const env = await agentBusiness();
  const many = Array.from({ length: TRACKER_LIMITS.columns + 1 }, (_, index) => ({ id: `c${index}`, name: `C${index}`, kind: 'text' }));
  await assert.rejects(env.agents('venture.trackers.set', { tracker: { name: 'Wide', columns: many } }), { code: 'INVALID_VENTURE_REQUEST' });
  for (let index = 0; index < TRACKER_LIMITS.trackers; index++) await env.agents('venture.trackers.set', { tracker: { name: `T${index}`, columns: [COLUMNS[0]] } });
  await assert.rejects(env.agents('venture.trackers.set', { tracker: { name: 'One more', columns: [COLUMNS[0]] } }), { code: 'TRACKER_LIMIT' });
  const { trackers } = await env.agents('venture.trackers.list', {});
  await ventureAction(env.deps, owner, 'prepare', 'test.rows', tx => {
    for (let index = 0; index < TRACKER_LIMITS.rows; index++) tx.put({ ...tx.base('venture-tracker-row'), trackerId: trackers[0].id, cells: { title: `R${index}` }, addedBy: 'owner', undoneAt: null } as any);
  });
  await assert.rejects(add(env, trackers[0].id, { title: 'One more' }), { code: 'TRACKER_LIMIT' });
});

test('edit changes only the cells sent; Undo is only for a row an agent added; the GST starter needs tax fields', async () => {
  const { env, tracker } = await withTracker();
  const { row } = await add(env, tracker.id, { title: 'First', hours: 2 });
  const edited = await env.agents('venture.trackers.rows.edit', { rowId: row.id, cells: { hours: 5 } });
  const cells = Object.fromEntries(edited.row.cells.map((cell: any) => [cell.column, cell.value]));
  assert.deepEqual([cells.title, cells.hours], ['First', 5]);
  await assert.rejects(env.agents('venture.trackers.rows.undo', { rowId: row.id }), { code: 'INVALID_VENTURE_REQUEST' });
  await env.agents('venture.trackers.rows.remove', { rowId: row.id });
  assert.equal((await env.agents('venture.trackers.get', { id: tracker.id })).rows.length, 0);
  const { starters } = await env.agents('venture.trackers.list', {});
  assert.deepEqual(starters.map((item: any) => item.id), ['content-calendar']);
});
