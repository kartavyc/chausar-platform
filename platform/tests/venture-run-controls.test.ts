// Run controls (Ink v2 wave 4, 4F1; catalogue O1, O3, O4; spec 5.6 and spec 8 "stop during an irreversible send"):
// Stop finishes the step in progress and keeps every finished step; Force stop cuts it and says what is lost; Resume
// asks again with a fresh preview; steering queues the owner's words for the next turn, used once; Stop all stops the
// running runs. Nothing in flight is ever sent again after a stop, and a stopped run never reads as done.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { BrowserPort, BrowserPostResult, DeliveryRunView, PlaybookRecord, RunControlResult, RunDetail, VentureDeps } from '../runtime/venture/contracts.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { decidePost, proposePost } from '../runtime/venture/build/posting.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { seedPostDraft } from './venture-post-drafts.ts';
import {
  CLIENT, DONE, PYTHON, READ, RECONCILE, approve, call, code, controlRow, decide, eventNames, getRun, lookAround, owner, phone, queue, record, scriptTurns,
  setup, startRun, stop, orderWithFiles,
} from './venture-run-controls-env.ts';

const STOPPED = 'Stopped by you. Finished steps are kept.';
const RECEIVED = 'Stop received. The step in progress finishes, then the run stops.';
const SKIPPED = 'You stopped the run, so this call did not run.';
const STEER_WAITING = 'Sent. Waiting for the agent to pick it up.';

test('stop while the run waits for approval: its preview is voided, finished steps stay, Today offers Resume and Run again', async () => {
  const env = await setup();
  let run = await startRun(env, [READ, RECONCILE, DONE]);
  run = await approve(env, run);
  const waiting = run;
  const sent = env.models.sent;
  await assert.rejects(stop(env, run.id, false, phone), code('APP_APPROVAL_REQUIRED'));

  const stopped = await stop(env, run.id);
  assert.equal(stopped.line, STOPPED);
  assert.equal(stopped.lost, undefined, 'nothing was in progress, so nothing is lost');
  const stored = record(env, run.id);
  assert.deepEqual([stored.status, stored.preview, stored.callId], ['stopped', null, null]);
  assert.deepEqual(stored.harness!.toolCalls.map(item => item.outcome), ['succeeded', 'succeeded', 'succeeded'], 'finished steps are kept');
  assert.ok(eventNames(env).includes('run.stopped'));
  await assert.rejects(approve(env, waiting), code('DELIVERY_NOT_WAITING'));
  assert.equal(env.models.sent, sent, 'the voided call is never sent');

  // The run sheet: stopped, never done.
  assert.equal(stopped.run.state, 'waiting');
  assert.deepEqual(stopped.run.stop, { state: 'stopped', line: STOPPED });
  assert.equal(stopped.run.result, STOPPED);
  assert.equal((await call<{ runs: { runId: string; state: string }[] }>(env, 'venture.runs.list', { state: 'done' })).runs.length, 0);

  const row = await controlRow(env, run.id);
  assert.ok(row, 'a Today row for the stopped run');
  assert.equal(row.title, `The draft for ${CLIENT} is stopped`);
  assert.equal(row.line, STOPPED);
  assert.deepEqual(row.actions.map(item => [item.id, item.primary]), [['run-again', false], ['resume', true]]);
  assert.equal((await queue(env)).rows.filter(item => item.viewRef?.id === run.id).length, 1, 'only the stopped row speaks for the run');
  await assert.rejects(stop(env, run.id), code('RUN_ALREADY_STOPPED'));
});

test('stop while a turn runs: the call in progress finishes and is kept, later calls are cancelled, then the run is stopped', async () => {
  const env = await setup();
  const run = await startRun(env, [PYTHON, DONE]);
  const previews = env.models.previewed.length;
  let during: RunControlResult | null = null;
  let sheet: RunDetail | null = null;
  env.container = async () => {
    during = await stop(env, run.id);
    sheet = await getRun(env, run.id);
  };
  const after = await approve(env, run);
  assert.equal(during!.line, RECEIVED);
  assert.equal(sheet!.stop?.state, 'stopping');
  assert.equal(sheet!.state, 'active');
  assert.equal(after.status, 'stopped');
  assert.deepEqual([after.callId, after.preview], [null, null]);
  assert.equal(env.models.previewed.length, previews, 'no next turn is previewed');
  const calls = after.harness!.toolCalls;
  assert.deepEqual(calls.map(item => [item.tool, item.outcome]), [['files.list', 'succeeded'], ['sandbox.python', 'succeeded'], ['files.read', 'cancelled']]);
  const skipped = calls[2].envelope;
  assert.ok(!skipped.ok && skipped.error.message === SKIPPED);
  assert.equal(listRecords(env.store.read(), 'venture-work-table').length, 1, 'the container result is kept');
  const detail = await getRun(env, run.id);
  assert.deepEqual(detail.stop, { state: 'stopped', line: STOPPED });
  assert.ok(eventNames(env).includes('run.stopped'));
  const journal = listRecords(env.store.read(), 'venture-journal-entry').filter(entry => entry.subject.startsWith(`${run.id}:`));
  assert.deepEqual(journal.map(entry => entry.state), ['applied']);
});

test('force stop while a turn runs: stopped at once, the step is thrown away, the send stays sent and is never sent again', async () => {
  const env = await setup();
  const run = await startRun(env, [PYTHON, DONE]);
  const before = await getRun(env, run.id);
  const step = before.steps.find(item => item.state === 'waiting' || item.state === 'current')!;
  let during: RunControlResult | null = null;
  let statusDuring = '';
  env.container = async () => {
    during = await stop(env, run.id, true);
    statusDuring = record(env, run.id).status;
  };
  const after = await approve(env, run);
  assert.equal(statusDuring, 'stopped', 'stopped at once');
  assert.equal(during!.lost, `The step in progress is thrown away: ${step.purpose}. Anything already sent stays sent.`);
  assert.equal(after.status, 'stopped');
  const harness = record(env, run.id).harness!;
  assert.deepEqual([harness.toolCalls.length, harness.turns.length, harness.used.turns], [0, 0, 0], 'nothing from the cut turn is stored');
  assert.equal(harness.used.costMicros, '200', 'what the call cost still counts');
  assert.deepEqual(listRecords(env.store.read(), 'venture-work-table'), []);
  const journal = listRecords(env.store.read(), 'venture-journal-entry').filter(entry => entry.subject === `${run.id}:${run.callId}`);
  assert.deepEqual(journal.map(entry => entry.state), ['applied'], 'the send went out and stays sent');
  assert.equal((await getRun(env, run.id)).stop?.line, 'Stopped by you. The step in progress was thrown away.');

  // Resume does the cut step again with a fresh preview; the old call is never sent again.
  const sent = env.models.sent;
  const resumed = await call<RunControlResult>(env, 'venture.runs.resume', { runId: run.id });
  const live = record(env, run.id);
  assert.equal(live.status, 'waiting-for-you');
  assert.notEqual(live.callId, run.callId);
  assert.equal(env.models.previewed.at(-1)!.purpose, 'agent-turn');
  assert.equal(resumed.run.stop, undefined);
  assert.equal(env.models.sent, sent, 'resuming sends nothing: the turn waits for your approval again');
  // Approving goes out as the fresh call; the cut call's journal entry stays the one entry it had.
  await approve(env, { ...run, preview: live.preview, callId: live.callId });
  assert.equal(env.models.sent, sent + 1);
  const entries = listRecords(env.store.read(), 'venture-journal-entry');
  assert.equal(entries.filter(entry => entry.subject === `${run.id}:${run.callId}`).length, 1, 'the cut call is never sent again');
  assert.equal(entries.filter(entry => entry.subject === `${run.id}:${live.callId}`).length, 1);
});

test('stop and resume refuse what they cannot do, by name', async () => {
  const env = await setup();
  await assert.rejects(stop(env, 'delivery_missing'), code('RUN_NOT_FOUND'));
  const order = await orderWithFiles(env);
  const outline = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id, useTemplate: true });
  await assert.rejects(stop(env, outline.id), code('RUN_NOT_RUNNING'), 'a ready draft is not running');
  await call(env, 'venture.delivery.review', { runId: outline.id, verdict: 'accepted' });
  await assert.rejects(stop(env, outline.id), code('RUN_NOT_RUNNING'), 'an accepted draft is not running');
  const failed = await ventureAction(env.deps, owner, 'prepare', 'seed.failed', tx => tx.put({ ...record(env, outline.id), id: 'delivery_failed1', status: 'failed' as const }));
  await assert.rejects(stop(env, failed.id), code('RUN_NOT_RUNNING'));
  const rehearsal = await ventureAction(env.deps, owner, 'prepare', 'seed.rehearsal', tx => tx.put({
    ...tx.base('venture-simulation-run'), playbookId: 'p', playbookHash: 'h', scenarioIds: [], episodes: [], passed: true, summary: { scenarios: 0, passed: 0, failed: 0 },
    costMicros: '0', costDisplay: 'USD 0.0000', startedAt: tx.now, finishedAt: tx.now, modelMode: 'template' as const,
  }));
  await assert.rejects(stop(env, rehearsal.id), code('RUN_NOT_RUNNING'), 'a rehearsal runs to its end in one go');

  scriptTurns(env, [READ, DONE]);
  const run = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  await assert.rejects(call(env, 'venture.runs.resume', { runId: run.id }), code('RUN_NOT_STOPPED'));
  await assert.rejects(call(env, 'venture.runs.resume', { runId: run.id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.runs.resume', { runId: 'delivery_missing' }), code('RUN_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.runs.stop', { runId: run.id, force: 'yes' }), code('INVALID_VENTURE_REQUEST'));
});

test('resume: a fresh preview of the next turn, the write turn once limits are spent, and the run keeps its own playbook version', async () => {
  const env = await setup();
  // Reading turns that differ, so the repeat-failure breaker (4F2) does not take three of the same for a loop.
  let run = await startRun(env, [lookAround(0), lookAround(1), lookAround(2), lookAround(3), DONE]);
  run = await approve(env, run);
  await stop(env, run.id);
  // A newer playbook version comes into use while the run is stopped.
  const own = findRecord(env.store.read(), 'venture-playbook', run.playbookId)!;
  const newer = await ventureAction(env.deps, owner, 'prepare', 'seed.playbook', tx => {
    const steps = own.steps.map(step => step.kind === 'gather' ? { ...step, guidance: ['Newer guidance only the newer version has.'] } : step);
    const stored = tx.put<PlaybookRecord>({ ...own, id: 'playbook_newer', version: own.version + 1, steps, hash: 'newer-hash', parentId: own.id });
    tx.touch({ playbookId: stored.id });
    return stored;
  });
  const resumed = await call<RunControlResult>(env, 'venture.runs.resume', { runId: run.id });
  assert.equal(resumed.line, 'Resumed. Approve the next step when you are ready.');
  const live = record(env, run.id);
  assert.equal(live.status, 'waiting-for-you');
  assert.equal(live.playbookId, own.id);
  assert.ok(live.preview && !live.preview.payloadText.includes('Newer guidance'), 'the run keeps its own playbook version');
  assert.notEqual(newer.id, own.id);

  // Spend the turns, stop at the write turn, and resume: the write turn is previewed.
  run = await approve(env, { ...run, preview: live.preview });
  run = await approve(env, run);
  run = await approve(env, run);
  assert.equal(run.harness!.phase, 'write');
  await stop(env, run.id);
  await call(env, 'venture.runs.resume', { runId: run.id });
  assert.equal(env.models.previewed.at(-1)!.purpose, 'delivery');
  assert.equal(record(env, run.id).status, 'waiting-for-you');
});

test('Today: Resume and Run again on a stopped run go through the queue, once each', async () => {
  const env = await setup();
  let run = await startRun(env, [READ, DONE]);
  await stop(env, run.id);
  let row = (await controlRow(env, run.id))!;
  const resumed = await decide(env, row, 'resume');
  assert.equal(resumed.outcome, 'done');
  assert.equal(resumed.line, 'Resumed. Approve the next step when you are ready.');
  assert.equal(record(env, run.id).status, 'waiting-for-you');
  assert.equal((await decide(env, row, 'resume')).outcome, 'refused');

  await stop(env, run.id);
  row = (await controlRow(env, run.id))!;
  const again = await decide(env, row, 'run-again');
  assert.equal(again.outcome, 'done');
  assert.equal(again.line, 'Started again with the same files.');
  const runs = listRecords(env.store.read(), 'venture-delivery-run');
  assert.equal(runs.length, 2);
  assert.equal(runs[1].status, 'waiting-for-you');
  assert.deepEqual(runs[1].uploadIds, runs[0].uploadIds, 'Run again keeps the files the first step collected');
  assert.equal(await controlRow(env, run.id), undefined, 'a newer run for the order replaces the stopped row');
  run = runs[0] as DeliveryRunView;
  assert.equal(record(env, run.id).status, 'stopped');
});

test('steer: a note waits for the next turn, refreshes the waiting text, is picked up once, and is screened', async () => {
  const env = await setup();
  let run = await startRun(env, [READ, RECONCILE, DONE]);
  await assert.rejects(call(env, 'venture.runs.steer', { runId: run.id, text: 'Use the cafe account.' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.runs.steer', { runId: run.id, text: 'x'.repeat(501) }), code('INVALID_VENTURE_REQUEST'));
  const before = run.preview!;
  const steered = await call<RunControlResult>(env, 'venture.runs.steer', { runId: run.id, text: 'Look at the bills before the bank statement.' });
  assert.equal(steered.line, STEER_WAITING);
  const live = record(env, run.id);
  assert.notEqual(live.preview!.digest, before.digest, 'the waiting text now carries the note');
  assert.ok(live.preview!.payloadText.includes('Look at the bills before the bank statement.'));
  assert.deepEqual(steered.run.steer?.map(item => [item.text, item.line]), [['Look at the bills before the bank statement.', STEER_WAITING]]);
  await assert.rejects(approve(env, run), code('APPROVAL_STALE'));

  run = await approve(env, { ...run, preview: live.preview, callId: live.callId });
  const picked = await getRun(env, run.id);
  assert.deepEqual(picked.steer?.map(item => item.line), ['Picked up in turn 1']);
  assert.ok(!run.preview!.payloadText.includes('Look at the bills before the bank statement.'), 'used once');

  // A key pasted by mistake never reaches the agent.
  const key = ['sk', 'ant', 'api03', 'Zq8vR2mKx7LpW4nT9sYb3cHd6fJg1aE5'].join('-');
  await call(env, 'venture.runs.steer', { runId: run.id, text: `Use this key ${key} for the bank.` });
  const screened = record(env, run.id);
  assert.ok(!screened.preview!.payloadText.includes(key));
  assert.ok(screened.preview!.payloadText.includes('[redacted secret]'));

  // A note sent while a turn runs is kept for the turn after it.
  const waiting = { ...run, preview: screened.preview, callId: screened.callId };
  env.container = null;
  env.models.inFlight = async () => { await call(env, 'venture.runs.steer', { runId: run.id, text: 'Then write it up.' }); };
  run = await approve(env, waiting);
  assert.ok(run.preview!.payloadText.includes('Then write it up.'));
  const lines = (await getRun(env, run.id)).steer!.map(item => [item.text, item.line]);
  assert.deepEqual(lines.slice(-1), [['Then write it up.', STEER_WAITING]]);

  await stop(env, run.id);
  const done =await ventureAction(env.deps, owner, 'prepare', 'seed.done', tx => tx.replace({ ...record(env, run.id), status: 'accepted' as const }));
  await assert.rejects(call(env, 'venture.runs.steer', { runId: done.id, text: 'Hello.' }), code('RUN_NOT_RUNNING'));
});

test('stop all: pausing with stopRunning stops every running run, in flight or waiting; unpausing changes no run', async () => {
  const env = await setup();
  const first = await startRun(env, [READ, DONE]);
  const order = await orderWithFiles(env);
  const second = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: order.id });
  let paused: { paused: boolean; stopped: number; line: string } | null = null;
  env.models.inFlight = async () => { paused = await call(env, 'venture.business.pause', { paused: true, stopRunning: true }); };
  const after = await approve(env, first);
  assert.deepEqual(paused, { paused: true, stopped: 2, line: 'Paused. 2 runs are stopping or stopped. No new work starts until you unpause.' });
  assert.equal(after.status, 'stopped', 'the run in flight finished its step, then stopped');
  assert.equal(record(env, second.id).status, 'stopped', 'the waiting run stopped at once');
  const unpaused = await call<{ paused: boolean; stopped: number; line: string }>(env, 'venture.business.pause', { paused: false });
  assert.deepEqual(unpaused, { paused: false, stopped: 0, line: 'Unpaused. Stopped runs stay stopped until you resume them.' });
  assert.deepEqual([record(env, first.id).status, record(env, second.id).status], ['stopped', 'stopped']);
});

// ---------------------------------------------------------------------------
// Spec 8: stop during an irreversible send. A post in the middle of its send finishes or becomes outcome_unknown,
// and it is never sent again, whatever the owner stops.
// ---------------------------------------------------------------------------

const agentCtx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };

for (const ending of ['posted', 'throw'] as const) {
  test(`stop all while a post is mid-send (${ending}): the post settles as its journal says and is never sent again`, async () => {
    const jobs: string[] = [];
    const held: { release: (() => void) | null } = { release: null };
    const port: BrowserPort = {
      async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; },
      async post(job) {
        jobs.push(job.postId);
        await new Promise<void>(resolve => { held.release = resolve; });
        if (ending === 'throw') throw new Error('browser crashed');
        return { outcome: 'posted', line: 'X showed the post.', url: null } satisfies BrowserPostResult;
      },
    };
    let tick = 0;
    const store = new VentureTestStore();
    const deps = { store, clock: () => new Date(Date.UTC(2026, 9, 21, 10, 0, tick++)), host: 'desktop', connectors: { browser: port, appReviewed: [], postTimeoutMs: 5000 } } as unknown as VentureDeps;
    await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
      ...tx.base('venture-record'), idea: 'Social media for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Lumen Social', country: null,
      serviceType: 'agency', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
    } as any), { create: true });
    const draft = await seedPostDraft(deps, ['X: Fresh pastries at 8.']);
    const post = await proposePost(deps, agentCtx, { connectorId: 'x', draftId: draft.id });
    const sending = decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' }).then(value => value, error => error);
    while (!held.release) await new Promise(resolve => setImmediate(resolve));
    const handler = (method: string) => (views as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<unknown>>)[method];
    const paused = await handler('venture.business.pause')(deps, owner, { paused: true, stopRunning: true }) as { stopped: number };
    assert.equal(paused.stopped, 0, 'a post is not a run');
    await assert.rejects(handler('venture.runs.stop')(deps, owner, { runId: draft.id, force: true }), code('RUN_NOT_RUNNING'));
    held.release!();
    await sending;
    const settled = listRecords(store.read(), 'venture-connector-post').find(item => item.id === post.id)!;
    assert.equal(settled.state, ending === 'posted' ? 'applied' : 'outcome_unknown');
    await assert.rejects(decidePost(deps, owner, { postId: post.id, digest: post.digest, action: 'approve' }), (error: any) => typeof error?.code === 'string');
    assert.deepEqual(jobs, [post.id], 'sent once, never again');
  });
}
