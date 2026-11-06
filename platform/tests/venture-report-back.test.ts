// Report-back (Ink v2 wave 4, package 4J13; catalogue H30): a background job reports into the run that asked, under a
// fixed message id, the report and its delivery marker in one write; a second delivery of the same id is ignored; a
// report with no sources carries a warning; on the desktop, background model work waits while the owner is active
// and the AI is local or rate-limited.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, ModelStatusView, RunDetail } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import {
  ACTIVE_MS, BUSY_MS, NO_SOURCES_WARNING, WAITS_BUSY, WAITS_LOCAL, backgroundGateNow, backgroundWaits, deliverReport, reportBack, withReport,
} from '../runtime/venture/delivery/report-back.ts';
import { DONE, READ, START, call, owner, record, startRun, setup } from './venture-run-controls-env.ts';
import { approveFromToday, business, PLAIN_IDEA } from './venture-judge-helpers.ts';
import { routineTick } from '../runtime/venture/agents/routine-runner.ts';

const steps = (env: Awaited<ReturnType<typeof setup>>, runId: string) => listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'run.step' && (event.data as { runId?: unknown }).runId === runId).length;

test('a report lands in the run that asked once per message id, with its marker in the same write; no sources means a warning', async () => {
  const env = await setup();
  const run = await startRun(env, [READ, DONE]);
  const before = steps(env, run.id);
  const report = { messageId: 'brief:t1.1', from: 'research' as const, line: 'Three supplier prices found.', sources: ['https://example.com/a', ' https://example.com/a ', 'https://example.com/b'] };
  assert.equal(await reportBack(env.deps, owner, run.id, report), true);
  assert.equal(await reportBack(env.deps, owner, run.id, { ...report, line: 'Delivered twice.' }), false, 'the same id again is ignored');
  const stored = record(env, run.id);
  assert.deepEqual(stored.reports, [{ messageId: 'brief:t1.1', from: 'research', at: START, line: 'Three supplier prices found.', sources: ['https://example.com/a', 'https://example.com/b'], warning: null }]);
  assert.equal(steps(env, run.id), before + 1, 'one run.step for the one delivery');

  // In a caller's own transaction, with no sources: the warning comes with it.
  const delivered = await ventureAction(env.deps, owner, 'prepare', 'test.report', tx => deliverReport(tx, run.id, { messageId: 'brief:t2.1', from: 'heavy-work', line: 'Claude Code reported back.', sources: [] }));
  assert.equal(delivered, true);
  assert.equal(record(env, run.id).reports!.at(-1)!.warning, NO_SOURCES_WARNING);
  assert.equal(await ventureAction(env.deps, owner, 'prepare', 'test.report', tx => deliverReport(tx, 'run_missing', { ...report, messageId: 'x' })), false);

  // The pure step keeps a record unchanged on a second delivery.
  const once = withReport(stored as DeliveryRunRecord, report, START);
  assert.equal(once.delivered, false);
  assert.equal(once.run, stored);
});

test('background model work waits on the desktop while the owner is active and the AI is local or busy; otherwise it goes', async () => {
  const now = Date.parse(START);
  const gate = { host: 'desktop' as const, nowMs: now, watchingAt: START, local: false, busyAt: null };
  assert.equal(backgroundWaits(gate), null, 'a key AI that is not busy: it goes');
  assert.equal(backgroundWaits({ ...gate, local: true }), WAITS_LOCAL);
  assert.equal(backgroundWaits({ ...gate, busyAt: new Date(now - BUSY_MS + 1000).toISOString() }), WAITS_BUSY);
  assert.equal(backgroundWaits({ ...gate, busyAt: new Date(now - BUSY_MS - 1000).toISOString() }), null, 'busy long ago no longer counts');
  assert.equal(backgroundWaits({ ...gate, local: true, watchingAt: new Date(now - ACTIVE_MS - 1000).toISOString() }), null, 'the owner is not active');
  assert.equal(backgroundWaits({ ...gate, local: true, watchingAt: null }), null);
  assert.equal(backgroundWaits({ ...gate, local: true, host: 'hosted-web' }), null, 'only on the desktop');

  // Read from the business: the owner watching, a CLI tier, and a busy answer from the AI.
  const env = await setup();
  env.deps.host = 'desktop';
  env.deps.watching = () => START;
  assert.deepEqual({ ...backgroundGateNow(env.deps, owner), nowMs: 0 }, { host: 'desktop', nowMs: 0, watchingAt: START, local: false, busyAt: null });
  const status = env.models.status.bind(env.models);
  env.models.status = (): ModelStatusView => { const view = status(); return { ...view, tiers: { ...view.tiers, fast: { ...view.tiers.fast, presetId: 'claude-code-cli' } } }; };
  assert.equal(backgroundWaits(backgroundGateNow(env.deps, owner)), WAITS_LOCAL);
  env.models.status = status;
  await ventureAction(env.deps, owner, 'prepare', 'test.busy', tx => {
    tx.put({ ...tx.base('venture-model-call'), purpose: 'agent-turn', tier: 'fast', presetId: 'anthropic-haiku-5-5', connectionId: null, routeKind: 'anthropic-messages', model: 'claude-haiku-5-5', consent: 'approved-preview', endpoint: 'https://api.anthropic.com/v1/messages', payloadText: '', payloadDigest: '', payloadTruncated: false, containsClientData: false, status: 'failed', approvedDigest: null, approvedAt: null, approvedBy: null, estimatedMaxCostMicros: '0', priceConfirmed: true, usage: null, costMicros: null, outputDigest: null, error: { code: 'MODEL_FAILED', message: 'Anthropic is busy or your account limit was reached. Try again later.' }, replay: false } as never);
  });
  assert.equal(backgroundWaits(backgroundGateNow(env.deps, owner)), WAITS_BUSY);
});

test('the run sheet shows what background jobs reported into the run, with the no-sources warning', async () => {
  const env = await setup();
  const run = await startRun(env, [READ, DONE]);
  await reportBack(env.deps, owner, run.id, { messageId: 'brief:t1.1', from: 'heavy-work', line: 'Claude Code reported back.', sources: [] });
  const detail = await call<RunDetail>(env, 'venture.runs.get', { runId: run.id });
  assert.deepEqual(detail.reports, [{ at: START, from: 'heavy-work', line: 'Claude Code reported back.', sources: [], warning: NO_SOURCES_WARNING }]);
});

test('the judge waits on the desktop while the owner works and the AI is busy, and the sweep asks it once they are not', async () => {
  const env = await business(PLAIN_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Please look at my pricing for the new product line and advise.' });
  const waiting = await env.call('venture.delivery.run', { orderId: order.id });
  env.deps.host = 'desktop';
  env.deps.watching = () => env.deps.clock().toISOString();
  // The owner's AI answered busy a moment ago (a 429).
  await ventureAction(env.deps, owner, 'prepare', 'test.busy', tx => {
    tx.put({ ...tx.base('venture-model-call'), purpose: 'agent-turn', tier: 'fast', presetId: 'anthropic-haiku-5-5', connectionId: null, routeKind: 'anthropic-messages', model: 'claude-haiku-5-5', consent: 'approved-preview', endpoint: 'https://api.anthropic.com/v1/messages', payloadText: '', payloadDigest: '', payloadTruncated: false, containsClientData: false, status: 'failed', approvedDigest: null, approvedAt: null, approvedBy: null, estimatedMaxCostMicros: '0', priceConfirmed: true, usage: null, costMicros: null, outputDigest: null, error: { code: 'MODEL_FAILED', message: 'Anthropic is busy or your account limit was reached. Try again later.' }, replay: false } as never);
  });
  const run = await approveFromToday(env, waiting.id);
  assert.equal(env.models.rulesTasks().length, 0, 'no judge call went on its own');
  // Waiting, not failed: the reason is on the run, and the review reads the judge as Not run, incomplete.
  assert.deepEqual([run.judge.status, run.judge.line, run.judge.preview], ['waiting', `Waiting: ${WAITS_BUSY}`, null]);
  const detail = await env.call('venture.runs.get', { runId: waiting.id });
  assert.equal(detail.report.review.complete, false);
  const judged = [...detail.report.measured, ...detail.report.lookedAt].find((item: any) => item.id === 'rules-judge');
  assert.equal(judged.outcome, 'not-run');
  assert.ok(JSON.stringify(judged).includes(`Waiting: ${WAITS_BUSY}`), JSON.stringify(judged));
  // A sweep while the owner still works leaves it waiting.
  await routineTick(env.deps, owner);
  assert.equal(env.models.rulesTasks().length, 0);
  // Once the owner is no longer active, the next sweep asks the judge on its own, within the bound the approval showed.
  env.deps.watching = () => null;
  await routineTick(env.deps, owner);
  assert.equal(env.models.rulesTasks().length, 1);
  const after = (await env.call('venture.delivery.list')).find((item: any) => item.id === waiting.id);
  assert.equal(after.judge.status, 'done');
});
