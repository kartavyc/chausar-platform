// Daily write caps (Ink v2 wave 4, 4F2; catalogue H32). Per business and per day on the owner's calendar, agents may
// make at most 30 drafts, 500 books lines and 40 messages for people, counted from stored rows; the owner may lower
// each, never raise it past that. The next write past a cap does not happen (WRITE_CAP_REACHED, in plain words), a
// Today row says so, and venture.runs.allowWrites (approve, app only) raises that cap once for the day.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { AllowWritesView, DeliveryRunView, SpendPolicyView, ToolName, VentureDeps } from '../runtime/venture/contracts.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { owner as portOwner, realPortEnv, wordsTask } from './venture-real-port-env.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { buildToolEnv } from '../runtime/venture/delivery/harness/env.ts';
import { callTool } from '../runtime/venture/delivery/harness/tools.ts';
import { WRITE_CAPS } from '../runtime/venture/delivery/harness/write-caps.ts';
import { PRACTICE_FILES } from '../runtime/venture/delivery/harness/practice.ts';
import { proposePost } from '../runtime/venture/build/posting.ts';
import { setSpendPolicy } from '../runtime/venture/money/spend.ts';
import type { BrowserPort } from '../runtime/venture/contracts.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { seedPostDraft } from './venture-post-drafts.ts';
import {
  approve, call, code, decide, owner, phone, queue, RECONCILE, DONE, record, setup, startRun, turnOf, type Env,
} from './venture-run-controls-env.ts';

const policySet = (env: Env, payload: unknown, ctx: Context = owner) =>
  (money as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<SpendPolicyView>>)['venture.spend.policy.set'](env.deps, ctx, payload);
const policyGet = (env: Env) => (money as Record<string, (d: VentureDeps, c: Context, p: unknown) => Promise<SpendPolicyView>>)['venture.spend.policy.get'](env.deps, owner, {});
const capRow = async (env: Env, kind: string) => (await queue(env)).rows.find(row => row.id.startsWith(`writecap:${kind}`));

/** One agent draft, start to finish: reconcile, finish, then write. Returns the run waiting on its write turn. */
async function upToWrite(env: Env): Promise<DeliveryRunView> {
  let run = await startRun(env, [RECONCILE, DONE]);
  run = await approve(env, run);
  run = await approve(env, run);
  assert.equal(run.harness!.phase, 'write');
  return run;
}

test('drafts: counted from the draft records, stamped when each became ready, so a flood of events cannot hide them', async () => {
  const env = await setup();
  await policySet(env, { writeCaps: { drafts: 1 } });
  const first = await upToWrite(env);
  const ready = await approve(env, first);
  assert.equal(ready.status, 'ready-for-review');
  assert.equal(record(env, first.id).readyAt, env.deps.clock().toISOString(), 'stamped in the commit that kept the draft');
  // More than the 500 events a business keeps: the draft's own ready event is pruned away.
  await ventureAction(env.deps, owner, 'prepare', 'seed.flood', tx => { for (let n = 0; n < 520; n += 1) tx.emit('run.step', { runId: 'flood' }); });
  assert.equal(listRecords(env.store.read(), 'venture-event').some(event => event.name === 'delivery-ready'), false, 'the ready event is gone');
  const second = await upToWrite(env);
  await assert.rejects(approve(env, second), code('WRITE_CAP_REACHED'));
});

test('drafts: the real model port reads the cap again inside the claim that lets a draft-writing call go', async () => {
  const env = await realPortEnv();
  await env.connect('anthropic-sonnet-5-5');
  await env.money('venture.spend.policy.set', { writeCaps: { drafts: 1 } });
  await ventureAction(env.deps, portOwner, 'prepare', 'seed.draft', tx => tx.put({
    ...tx.base('venture-delivery-run'), orderId: 'order_x', playbookId: 'p', playbookHash: 'h', status: 'ready-for-review', servedBy: 'model', practice: false, callId: null,
    preview: null, deliverable: { title: 'x', sections: [], questionsForClient: [] }, renderedText: 'x', checks: [], verdict: null, editedText: null, readyAt: tx.now,
  } as never));
  const { outcome } = await env.approveTask(wordsTask('delivery', { containsClientData: true }));
  await assert.rejects(outcome, code('WRITE_CAP_REACHED'));
  assert.equal(env.sent.length, 0, 'nothing was sent');
  // Another kind of call is not a draft.
  const other = await env.approveTask(wordsTask('blueprint', { containsClientData: true }));
  await other.outcome;
  assert.equal(env.sent.length, 1);
});

test('write caps: 30 drafts, 500 books lines and 40 messages a day; the owner may lower each, never raise it', async () => {
  assert.deepEqual({ ...WRITE_CAPS }, { drafts: 30, 'books-lines': 500, messages: 40 });
  assert.ok(Object.isFrozen(WRITE_CAPS));
  const env = await setup();
  const before = await policyGet(env);
  assert.deepEqual(before.writeCaps!.map(item => [item.kind, item.cap, item.used]), [['drafts', 30, 0], ['books-lines', 500, 0], ['messages', 40, 0]]);
  assert.equal(before.writeCaps![0].line, "Chausar stops agents at 30 drafts a day so a stuck agent can't flood you.");
  const lowered = await policySet(env, { writeCaps: { drafts: 5, messages: 0 } });
  assert.deepEqual(lowered.writeCaps!.map(item => [item.kind, item.cap]), [['drafts', 5], ['books-lines', 500], ['messages', 0]]);
  await assert.rejects(policySet(env, { writeCaps: { drafts: 31 } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(policySet(env, { writeCaps: { pages: 3 } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(policySet(env, { writeCaps: { drafts: 2 } }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.equal((await policySet(env, { askFirstUsd: '1.00' })).writeCaps![0].cap, 5, 'other changes keep the caps');
});

test('drafts: past the cap the next draft is not sent; Today says so; Allow more raises it once for the day; the next day starts again', async () => {
  const env = await setup();
  await policySet(env, { writeCaps: { drafts: 1 } });
  const first = await upToWrite(env);
  assert.equal((await approve(env, first)).status, 'ready-for-review');
  assert.equal(await capRow(env, 'drafts') !== undefined, true, 'the cap is reached: Today says so');

  const second = await upToWrite(env);
  const sent = env.models.sent;
  await assert.rejects(approve(env, second), (error: any) => {
    assert.equal(error.code, 'WRITE_CAP_REACHED');
    assert.equal(error.message, "Chausar stops agents at 1 draft a day so a stuck agent can't flood you. Allow more for today on Today, or wait until tomorrow.");
    return true;
  });
  assert.equal(env.models.sent, sent, 'nothing was sent or charged');
  assert.equal(record(env, second.id).status, 'waiting-for-you', 'the draft waits; nothing is lost');
  const row = (await capRow(env, 'drafts'))!;
  assert.equal(row.title, "Agents reached today's cap of 1 draft");
  assert.equal(row.line, "Chausar stops agents at 1 draft a day so a stuck agent can't flood you.");
  assert.deepEqual(row.actions.map(item => [item.id, item.label, item.primary]), [['later', 'Not today', false], ['approve', 'Allow 1 more today', true]]);

  await assert.rejects(call(env, 'venture.runs.allowWrites', { kind: 'drafts' }, phone), code('APP_APPROVAL_REQUIRED'));
  const decided = await decide(env, row, 'approve');
  assert.equal(decided.outcome, 'done');
  assert.equal(decided.line, 'Agents may make 1 more draft today. The cap starts again tomorrow.');
  assert.equal((await approve(env, { ...second, preview: record(env, second.id).preview })).status, 'ready-for-review');
  await assert.rejects(call<AllowWritesView>(env, 'venture.runs.allowWrites', { kind: 'drafts' }), (error: any) => {
    assert.equal(error.code, 'WRITE_CAP_REACHED');
    assert.equal(error.message, 'You already allowed more drafts today. The cap starts again tomorrow.');
    return true;
  });
  const raisedRow = (await capRow(env, 'drafts'))!;
  assert.equal(raisedRow.title, "Agents reached today's raised cap of 2 drafts");
  assert.deepEqual(raisedRow.actions.map(item => [item.id, item.primary]), [['later', true]], 'raised once: nothing more to allow today');

  env.advance(24 * 60 * 60_000);
  assert.equal(await capRow(env, 'drafts'), undefined, 'a new day starts with nothing used');
  assert.deepEqual((await policyGet(env)).writeCaps!.filter(item => item.kind === 'drafts').map(item => [item.cap, item.used, item.raised]), [[1, 0, false]]);
  await assert.rejects(call(env, 'venture.runs.allowWrites', { kind: 'pages' }), code('INVALID_VENTURE_REQUEST'));
});

/** The bills table's rows: what one program over f2 makes. */
const BILL_ROWS = PRACTICE_FILES['bookkeeping-clean'][1].content.trim().split('\n').length - 1;
const sort = (n: number) => ['sandbox.python', { table: 'f2', code: `def transform(row):\n    return {"kind": "s${n}"}` }] as [string, unknown];

test('books lines: once the cap is reached the next table-making call does not run; the rows already made count', async () => {
  const env = await setup();
  await policySet(env, { writeCaps: { 'books-lines': BILL_ROWS } });
  const run = await startRun(env, [turnOf('Sort the bills twice', [sort(1), sort(2)]), DONE]);
  await approve(env, run);
  const calls = record(env, run.id).harness!.toolCalls;
  assert.deepEqual(calls.map(item => item.outcome), ['succeeded', 'cancelled']);
  const refused = calls[1].envelope;
  assert.ok(!refused.ok && refused.error.code === 'WRITE_CAP_REACHED');
  assert.equal(!refused.ok && refused.error.message, `Chausar stops agents at ${BILL_ROWS} books lines a day so a stuck agent can't flood your books. Allow more for today on Today, or wait until tomorrow. Nothing ran.`);
  assert.equal(env.containerRuns, 1, 'the second program never ran');
  const row = (await capRow(env, 'books-lines'))!;
  assert.equal(row.title, `Agents reached today's cap of ${BILL_ROWS} books lines`);
  assert.equal((await policyGet(env)).writeCaps!.find(item => item.kind === 'books-lines')!.used, BILL_ROWS);
});

test('books lines: a call whose rows would take the count past the cap has its table dropped, and says so', async () => {
  const env = await setup();
  await policySet(env, { writeCaps: { 'books-lines': BILL_ROWS - 1 } });
  const run = await startRun(env, [turnOf('Sort the bills', [sort(1)]), DONE]);
  await approve(env, run);
  const [made] = record(env, run.id).harness!.toolCalls;
  assert.equal(made.outcome, 'cancelled');
  assert.ok(!made.envelope.ok && made.envelope.error.code === 'WRITE_CAP_REACHED');
  assert.match(!made.envelope.ok ? made.envelope.error.message : '', /The table it made was not kept\.$/);
  assert.deepEqual(made.tableIds, []);
  assert.equal(listRecords(env.store.read(), 'venture-work-table').length, 0, 'nothing past the cap is stored');
  assert.equal((await policyGet(env)).writeCaps!.find(item => item.kind === 'books-lines')!.used, 0);
});

test('books lines: only tables of agent programs and picked bills count, not tables other tools compute', async () => {
  const env = await setup();
  await policySet(env, { writeCaps: { 'books-lines': 1 } });
  await ventureAction(env.deps, owner, 'prepare', 'seed.computed', tx => tx.put({
    ...tx.base('venture-work-table'), name: 'Hooks ranked', columns: ['Hook'], rows: [{ id: 'r1', cells: { Hook: 'a' } }, { id: 'r2', cells: { Hook: 'b' } }],
    source: { kind: 'computed', tool: 'youtube.hooks', uploadIds: [] }, runRef: { kind: 'delivery', runId: 'run_x' }, digest: 'd',
  } as never));
  assert.equal((await policyGet(env)).writeCaps!.find(item => item.kind === 'books-lines')!.used, 0);
});

test('messages: a message for people past the cap is not recorded, in a real order\'s own tool environment', async () => {
  const env = await setup();
  const run = await startRun(env, [RECONCILE, DONE]);
  await policySet(env, { writeCaps: { messages: 0 } });
  const state = env.store.read();
  const venture = findRecord(state, 'venture-record', env.venture.id)!;
  const playbook = findRecord(state, 'venture-playbook', run.playbookId)!;
  const toolEnv = buildToolEnv({ deps: env.deps, ctx: owner, state, venture, playbook, runRef: { kind: 'delivery', runId: run.id }, files: [], allowed: [], approval: { kind: 'owner-turn', callId: run.callId! } });
  const grant: ToolName[] = ['outbox.propose'];
  const outcome = await callTool(toolEnv, grant, 1, 0, { tool: 'outbox.propose', input: JSON.stringify({ connector: 'mail-app', summary: 'Send the September report to the client' }) });
  assert.equal(outcome.record.outcome, 'cancelled');
  assert.equal(outcome.mock, null, 'nothing was recorded for sending');
  assert.ok(!outcome.record.envelope.ok && outcome.record.envelope.error.code === 'WRITE_CAP_REACHED');
  assert.match(!outcome.record.envelope.ok ? outcome.record.envelope.error.message : '', /^Chausar stops agents at 0 messages for people a day so a stuck agent can't flood anyone\./);
  // Allow more for today: a cap the owner set to nothing still lets one more through, once.
  const raised = await call<AllowWritesView>(env, 'venture.runs.allowWrites', { kind: 'messages' });
  assert.deepEqual(raised, { kind: 'messages', line: 'Agents may make 1 more message for people today. The cap starts again tomorrow.' });
  const allowed = await callTool(toolEnv, grant, 1, 0, { tool: 'outbox.propose', input: JSON.stringify({ connector: 'mail-app', summary: 'Send the September report to the client' }) });
  assert.equal(allowed.record.outcome, 'succeeded');
  // The messages a run recorded count, stored or still in the turn: a second one in the same turn is past the cap.
  toolEnv.calls = [allowed.record];
  const again = await callTool(toolEnv, grant, 1, 1, { tool: 'outbox.propose', input: JSON.stringify({ connector: 'mail-app', summary: 'And a reminder for next week' }) });
  assert.ok(!again.record.envelope.ok && again.record.envelope.error.code === 'WRITE_CAP_REACHED');
  await ventureAction(env.deps, owner, 'prepare', 'seed.agent-post', tx => {
    tx.put({ ...tx.base('venture-connector-post'), connectorId: 'x', mode: 'api', account: null, text: 'Fresh pastries at 8.', agent: 'Marketing agent', digest: 'd', state: 'described', describe: 'Post', risk: null, claimedAt: null, decidedBy: null, outcome: null, journal: [] } as never);
  });
  const view = await policyGet(env);
  assert.equal(view.writeCaps!.find(item => item.kind === 'messages')!.used, 1, 'a post an agent proposed counts as a message for people');
});

test('messages: a post an agent proposes past the cap is refused; the owner\'s own post is not an agent write', async () => {
  const port: BrowserPort = { async probe() { return { present: true, reason: 'Playwright with Chromium found on this computer.' }; }, async post() { return { outcome: 'posted', line: 'Posted.', url: null }; } };
  const store = new VentureTestStore();
  const deps = { store, clock: () => new Date('2026-10-21T10:00:00.000Z'), host: 'desktop', connectors: { browser: port, appReviewed: [], postTimeoutMs: 5000 } } as unknown as VentureDeps;
  await ventureAction(deps, owner, 'admin', 'seed', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Social media for cafes in Pune', ideaDigest: 'synthetic', workingName: 'Lumen Social', country: null,
    serviceType: 'agency', status: 'live', launchStage: 'approve-each', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  } as never), { create: true });
  await setSpendPolicy(deps, owner, { writeCaps: { messages: 1 } });
  const agentCtx: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
  const draft = await seedPostDraft(deps, ['X: Fresh pastries at 8.', 'LinkedIn: Fresh pastries at 8.']);
  await proposePost(deps, agentCtx, { connectorId: 'x', draftId: draft.id, agent: 'Social writer' });
  await assert.rejects(proposePost(deps, agentCtx, { connectorId: 'linkedin', draftId: draft.id, agent: 'Social writer' }), (error: any) => {
    assert.equal(error.code, 'WRITE_CAP_REACHED');
    assert.match(error.message, /^Chausar stops agents at 1 message for people a day so a stuck agent can't flood anyone\./);
    return true;
  });
  // A proposal from outside the app is an agent's, named or not.
  await assert.rejects(proposePost(deps, agentCtx, { connectorId: 'linkedin', draftId: draft.id }), code('WRITE_CAP_REACHED'));
  const own = await proposePost(deps, owner, { connectorId: 'linkedin', draftId: draft.id });
  assert.equal(own.agent, null);
});
