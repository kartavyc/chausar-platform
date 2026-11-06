// One-shot C4 task 12: a run's worked time leaves out the time it waited on the owner, the wait is its own figure, and
// a run waiting now says since when. Found from the run's own events; a run without them is never guessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, RunSummary } from '../runtime/venture/contracts.ts';
import { runTimes } from '../runtime/venture/views/runs.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { CLIENT_NAME, START, call, owner, seedBlueprint, seedOrder, setup } from './venture-views-env.ts';

const at = (minutes: number) => new Date(Date.parse('2026-10-21T09:00:00.000Z') + minutes * 60_000).toISOString();

test('run times: a 6-minute owner wait between two 1-minute steps is worked 2 min and waited 6 min', () => {
  const events = [
    { name: 'run.started', at: at(0) },
    { name: 'run.step', at: at(1) },
    { name: 'run.waiting', at: at(1) },
    { name: 'run.step', at: at(7) },
    { name: 'run.done', at: at(8) },
  ];
  const times = runTimes(events, at(0), at(8));
  assert.equal(times.worked, '2 min');
  assert.equal(times.workedMs, 2 * 60_000);
  assert.equal(times.waited, '6 min');
  assert.equal(times.waitedMs, 6 * 60_000);
  assert.equal(times.waitingSince, undefined);
});

test('run times: a run waiting now says since when, and its open wait is not worked time', () => {
  const times = runTimes([{ name: 'run.started', at: at(0) }, { name: 'run.waiting', at: at(1) }], at(0), at(1));
  assert.equal(times.waitingSince, at(1));
  assert.equal(times.worked, '1 min');
});

test('run times: a run without its events keeps its whole span as worked and has no waited figure', () => {
  const times = runTimes([], at(0), at(4));
  assert.equal(times.worked, '4 min');
  assert.equal(times.waited, undefined);
  assert.equal(times.waitedMs, undefined);
  assert.equal(times.waitingSince, undefined);
});

test('runs list: a template draft the owner reviews 5 minutes later worked no time and waited 5 min', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  const [waiting] = (await call<{ runs: RunSummary[] }>(env, 'venture.runs.list', {})).runs;
  assert.equal(waiting.waitingSince, START);
  assert.deepEqual(waiting.client, { id: order.clientId, name: CLIENT_NAME }, 'the run names its client for the link');
  env.advance(5 * 60_000);
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  const [done] = (await call<{ runs: RunSummary[] }>(env, 'venture.runs.list', { state: 'done' })).runs;
  assert.equal(done.elapsed, '');
  assert.equal(done.waited, '5 min');
  assert.equal(done.waitingSince, undefined);
});
