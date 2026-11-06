// Ink v2 wave 4 (4J1, O17): the decision record. Every decision says who decided (the owner, a saved rule or a
// timeout), when, on what rule and why; a step that ran without asking is marked in the journal with a way to stop
// always allowing; always-ask beats every allow and never beats a deny; "allow for this session" lets a held step below
// the floor run without asking, in memory only, gone on restart, never for the floor; and the same call refused three
// times is a health reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import type { AgentView, DecisionsView, DeliveryRunRecord, InvoiceView, JournalEntry, JournalRecord, PolicyHold, QueueDecision, QueueDecisionRecord, QueueList, ToolCallRecord } from '../runtime/venture/contracts.ts';
import { VentureTestStore } from './venture-test-store.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as core } from '../runtime/venture/core/index.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { practiceFiles } from '../runtime/venture/delivery/harness/practice.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { buildToolEnv } from '../runtime/venture/delivery/harness/env.ts';
import { applyTurn, DEFAULT_LIMITS, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import { harnessPolicyContext } from '../runtime/venture/policy/context.ts';
import { ladderPolicy, type HarnessPolicy, type PolicyContext } from '../runtime/venture/policy/ladder.ts';
import { evaluateSync, type Policy } from '../runtime/venture/policy/verdict.ts';
import { endSessionAllowances, sessionAllowedSteps } from '../runtime/venture/policy/allow-session.ts';
import { AUTO_LOCKED_WORDS } from '../runtime/venture/policy/auto-lock.ts';
import { recordDecision } from '../runtime/venture/journal/decisions.ts';
import { HOLD_DECLINE_ANSWER } from '../runtime/venture/policy/holds.ts';
import { CLIENT_NAME, call, code, harness, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const decisions = (env: Env, ctx: Context = owner) => call<DecisionsView>(env, 'venture.decisions.list', {}, ctx).then(view => view.decisions);
const journal = (env: Env) => call<{ entries: JournalEntry[] }>(env, 'venture.journal.list', {}).then(view => view.entries);
const team = (env: Env) => call<{ agents: AgentView[] }>(env, 'venture.team.list').then(view => view.agents);
const allow = (env: Env, stepId: string, ctx: Context = owner) => call<{ stepId: string; line: string }>(env, 'venture.policy.allowSession', { stepId }, ctx);

/** A plan in use and its playbook, with the delivery playbook record the policy reads its steps from. */
async function business(stage: 'rehearsal' | 'approve-each' | 'auto-spot-check' = 'approve-each') {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, stage);
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  return { env, order, fields: { playbookId: playbook.id, playbookHash: playbook.hash } };
}

const call1 = (over: Partial<ToolCallRecord>): ToolCallRecord => ({
  id: 't1.1', turn: 1, tool: 'calc.sum', input: {}, inputDigest: 'd'.repeat(64), envelope: { ok: true, result: {} }, outcome: 'succeeded',
  effect: 'compute', tier: null, receiptIds: [], tableIds: [], startedAt: '2026-10-15T10:05:00.000Z', finishedAt: '2026-10-15T10:05:01.000Z', ...over,
});

// ---------------------------------------------------------------------------
// 1. The record
// ---------------------------------------------------------------------------

test('decisions.list: who decided, when, on what rule and why, newest first: the owner on Today, a timeout, a saved rule', async () => {
  const { env, order, fields } = await business('auto-spot-check');
  await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900', price2: '1500000' });
  const [price] = (await call<QueueList>(env, 'venture.queue.list', {})).rows.filter(row => row.kind === 'price');
  assert.equal((await call<QueueDecision>(env, 'venture.queue.decide', { id: price.id, digest: price.digest, action: 'approve' })).outcome, 'done');
  env.advance(60_000);
  await ventureAction(env.deps, owner, 'prepare', 'seed.timeout', tx => {
    recordDecision(tx, { subject: 'run:delivery_x', action: 'decline', who: 'timeout', ruleId: null, reason: 'No answer by 16:00, so the held call was declined.', rowId: null });
  });
  env.advance(60_000);
  const { agent } = await call<{ agent: AgentView }>(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'work', gate: 'auto' });
  assert.equal(agent.steps.find(step => step.id === 'work')?.gate, 'auto');
  const [gate] = listRecords(env.store.read(), 'venture-team-gate');
  env.advance(60_000);
  const ran = await seedRun(env, order, { ...fields, status: 'ready-for-review', harness: harness({ toolCalls: [call1({ startedAt: env.now(), allowedBy: { rule: 'auto', stepId: 'work' } })] }) });

  const list = await decisions(env);
  // The plan accepted on Today is listed once, as the Today decision; the gate set on Team is the owner's decision too.
  assert.deepEqual(list.map(item => [item.who, item.action]), [['saved-rule', 'calc.sum'], ['owner', 'gate-auto'], ['timeout', 'decline'], ['owner', 'approve']]);
  const [rule, setting, timeout, mine] = list;
  assert.equal(rule.rule, "Your Auto setting on 'Sort and match every entry'");
  assert.equal(rule.ruleId, gate.id);
  assert.equal(rule.line, "Allowed by your Auto setting on 'Sort and match every entry', without asking");
  assert.equal(rule.by, null);
  assert.equal(rule.subject, 'step:work');
  assert.equal(rule.id, `${ran.id}/work`);
  assert.deepEqual([setting.subject, setting.by, setting.line, setting.ruleId], ['step:work', 'owner', "You set 'Sort and match every entry' to run on its own.", null]);
  assert.deepEqual([timeout.rule, timeout.ruleId, timeout.reason, timeout.by], [null, null, 'No answer by 16:00, so the held call was declined.', null]);
  assert.match(timeout.line, /^No answer in time/);
  assert.deepEqual([mine.reason, mine.by, mine.subject], ['Plan accepted.', 'owner', price.id.slice(0, price.id.lastIndexOf(':'))]);
  assert.equal(mine.line, 'You chose Approve on Today: Plan accepted.');
  // Reading needs no app: the phone sees the record too. It takes no fields.
  assert.equal((await decisions(env, phone)).length, 4);
  await assert.rejects(call(env, 'venture.decisions.list', { limit: 5 }), code('INVALID_VENTURE_REQUEST'));
});

test('decisions made outside Today reach the record: a review from Work, a plan accepted in the menu, an invoice issued from Money', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const draft = await seedBlueprint(env, { status: 'draft', version: 2, price1: '299900', price2: '1500000' });
  await core['venture.blueprint.accept']!(env.deps, owner, { digest: draft.digest });
  env.advance(1000);
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  env.advance(1000);
  const prepared = await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  await money['venture.invoice.issue']!(env.deps, owner, { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest });
  const list = await decisions(env);
  const venture = listRecords(env.store.read(), 'venture-record')[0];
  assert.deepEqual(list.map(item => [item.who, item.subject, item.action, item.by]), [
    ['owner', `invoice:${prepared.invoice.id}`, 'approve', 'owner'],
    ['owner', `run:${outline.id}`, 'accepted', 'owner'],
    ['owner', `plan:${venture.id}`, 'accept', 'owner'],
  ]);
  assert.equal(list[0].line, `You approved it: Issue the invoice for ${CLIENT_NAME}.`);
  assert.equal(list[1].line, 'You decided: Draft accepted.');
  assert.equal(list[2].line, 'You decided: Plan version 2 accepted.');
});

test('a decision made on Today is listed once, however many records it left', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  const [row] = (await call<QueueList>(env, 'venture.queue.list', {})).rows.filter(item => item.kind === 'draft');
  assert.equal((await call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve', viewed: true })).outcome, 'done');
  assert.equal(listRecords(env.store.read(), 'venture-decision').length, 1, 'the review recorded its own decision too');
  const list = (await decisions(env)).filter(item => item.subject === `run:${outline.id}`);
  assert.deepEqual(list.map(item => [item.action, item.line]), [['approve', 'You chose Approve on Today: Draft accepted. You send it to the client.']]);
});

test('a decision a saved rule made names its rule, by id and in words', async () => {
  const { env } = await business('auto-spot-check');
  await call(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'work', gate: 'auto' });
  const [gate] = listRecords(env.store.read(), 'venture-team-gate');
  env.advance(1000);
  await ventureAction(env.deps, owner, 'prepare', 'seed.rule', tx => {
    recordDecision(tx, { subject: 'step:work', action: 'ran', who: 'saved-rule', ruleId: gate.id, reason: 'The agent ran calc.sum without asking.', rowId: null });
  });
  const [ruled] = (await decisions(env)).filter(item => item.who === 'saved-rule');
  assert.deepEqual([ruled.ruleId, ruled.rule], [gate.id, "Your Auto setting on 'Sort and match every entry'"]);
  // 4J19: the agent whose step it is, so Stop always allowing can name it to venture.team.gate.
  assert.equal(ruled.agentId, 'delivery');
});

test('journal: a step that ran without asking says which saved rule allowed it, with what Stop always allowing sets', async () => {
  const { env, order, fields } = await business('auto-spot-check');
  await call(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'work', gate: 'auto' });
  const [gate] = listRecords(env.store.read(), 'venture-team-gate');
  env.advance(1000);
  const first = env.now();
  const allowed = (id: string, at: string) => call1({ id, startedAt: at, allowedBy: { rule: 'auto', stepId: 'work' } });
  const run = await seedRun(env, order, { ...fields, status: 'ready-for-review', harness: harness({ toolCalls: [allowed('t1.1', first), call1({ id: 't1.2', tool: 'files.list' }), allowed('t2.1', '2026-10-15T10:07:00.000Z'), allowed('t2.2', '2026-10-15T10:08:00.000Z')] }) });
  const entries = (await journal(env)).filter(entry => entry.allowedBy);
  assert.equal(entries.length, 1, 'one entry for the step in this run, however many calls it made without asking');
  const [entry] = entries;
  assert.deepEqual(entry, {
    id: `${run.id}/work`, action: 'Ran without asking', target: 'Sort and match every entry', state: 'applied', at: '2026-10-15T10:08:00.000Z',
    line: "Allowed by your Auto setting on 'Sort and match every entry', without asking · 3 calls",
    allowedBy: { rule: 'auto', agentId: 'delivery', stepId: 'work', ruleId: gate.id },
  });
  const ruled = (await decisions(env)).filter(item => item.who === 'saved-rule');
  assert.equal(ruled.length, 1, 'the record groups them the same way');
  // 4J19: the decision names the agent and step too, as the journal entry does.
  assert.deepEqual([ruled[0].agentId, ruled[0].subject], [entry.allowedBy!.agentId, 'step:work']);
  // Stop always allowing: the gate goes back to hold, through the method the team already has.
  const { agent } = await call<{ agent: AgentView }>(env, 'venture.team.gate', { agentId: entry.allowedBy!.agentId, stepId: entry.allowedBy!.stepId, gate: 'hold' });
  assert.equal(agent.steps.find(step => step.id === 'work')?.gate, 'hold');
});

// ---------------------------------------------------------------------------
// 2. The order of rules
// ---------------------------------------------------------------------------

function context(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    posture: 'auto-spot-check', approval: { kind: 'none' }, gates: { gather: 'hold', work: 'auto', send: 'auto' },
    stepsByTool: { 'files.list': ['gather'], 'calc.sum': ['work'], 'outbox.propose': ['send'] }, stepTitles: { gather: 'Read the files', work: 'Sort and match every entry' }, ...over,
  };
}

test('order of rules: always-ask beats every allow, a session allowance included, and never beats a deny', () => {
  // A floor action at auto with its step on Auto still asks: the floor is always-ask.
  const floor = evaluateSync([ladderPolicy], { phase: 'tool-call', name: 'mail.send', effect: 'outside-write', inputDigest: 'e'.repeat(64), input: {} }, context({ stepsByTool: { 'mail.send': ['send'] }, session: { send: 'decision_1' } }));
  assert.equal(floor.verdict, 'ask');
  assert.equal(floor.code, 'floor');
  // A deny from any policy wins over the floor's ask and over every allow.
  const no: Policy<PolicyContext> = { id: 'no', decide: () => ({ verdict: 'deny', code: 'risky', reason: 'This run read bank statements.' }) };
  const denied = evaluateSync([no, ladderPolicy], { phase: 'tool-call', name: 'mail.send', effect: 'outside-write', inputDigest: 'e'.repeat(64), input: {} }, context({ stepsByTool: { 'mail.send': ['send'] } }));
  assert.deepEqual([denied.verdict, denied.code], ['deny', 'risky']);
  const deniedAllow = evaluateSync([no, ladderPolicy], { phase: 'tool-call', name: 'calc.sum', effect: 'compute', inputDigest: 'e'.repeat(64), input: {} }, context());
  assert.equal(deniedAllow.verdict, 'deny');
  // The taint latch asks whatever a session allowance says.
  const latched = evaluateSync([ladderPolicy], { phase: 'tool-call', name: 'notes.write', effect: 'delegate', inputDigest: 'e'.repeat(64), input: {} },
    context({ stepsByTool: { 'notes.write': ['gather'] }, session: { gather: 'decision_1' }, taint: { turn: 1, source: 'client-file', toolCallId: 't1.1', tool: 'files.read' } }));
  assert.deepEqual([latched.verdict, latched.code], ['ask', 'tainted'], 'a latched call is never opened by a session allowance');
  // Below the floor, a session allowance lets a held step run on its own, like Auto, and says so.
  const session = evaluateSync([ladderPolicy], { phase: 'tool-call', name: 'files.list', effect: 'read', inputDigest: 'e'.repeat(64), input: {} }, context({ session: { gather: 'decision_1' } }));
  assert.deepEqual([session.verdict, session.code, session.step], ['allow', 'session_allowed', 'gather']);
  const held = evaluateSync([ladderPolicy], { phase: 'tool-call', name: 'files.list', effect: 'read', inputDigest: 'e'.repeat(64), input: {} }, context());
  assert.deepEqual([held.verdict, held.code], ['ask', 'step_on_hold']);
});

// ---------------------------------------------------------------------------
// 3. Allow for this session
// ---------------------------------------------------------------------------

// Ink v2 wave 4 (4J15): auto with spot checks is built but locked, and the policy caps every posture at approve each
// (policy/auto-lock.ts), so "allow for this session" is refused even in a vault whose stage says auto. The allowance
// code stays (policy/allow-session.ts) and is read by the ladder above; nothing can grant one while the lock holds.

test('allowSession: refused with AUTO_LOCKED in a vault whose stage says auto; nothing is recorded or held in memory', async () => {
  const { env } = await business('auto-spot-check');
  const venture = listRecords(env.store.read(), 'venture-record')[0];
  for (const stepId of ['gather', 'send', 'step_missing']) {
    await assert.rejects(allow(env, stepId), (error: any) => {
      assert.equal(error.code, 'AUTO_LOCKED');
      assert.equal(error.message, AUTO_LOCKED_WORDS);
      return true;
    });
  }
  assert.equal(listRecords(env.store.read(), 'venture-decision').length, 0);
  assert.deepEqual(sessionAllowedSteps(env.store, env.store.read(), venture.id), {});
  const playbook = listRecords(env.store.read(), 'venture-playbook')[0];
  assert.deepEqual(harnessPolicyContext({ state: env.store.read(), venture, playbook, runRef: { kind: 'delivery', runId: 'delivery_1' }, store: env.store }).session, {});
  assert.equal(harnessPolicyContext({ state: env.store.read(), venture, playbook, runRef: { kind: 'delivery', runId: 'delivery_1' }, store: env.store }).posture, 'approve-each');
  endSessionAllowances();
});

test('allowSession: approvals happen in the app and only the owner principal asks; the lock answers before any step check', async () => {
  const { env } = await business('auto-spot-check');
  await assert.rejects(allow(env, 'gather', phone), code('APP_APPROVAL_REQUIRED'));
  await env.store.update(state => { state.members.push({ id: 'books', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] }); });
  await assert.rejects(allow(env, 'gather', { memberId: 'books', role: 'accountant', epoch: 1, channel: 'desktop' }), code('FORBIDDEN'));
  await assert.rejects(call(env, 'venture.policy.allowSession', { stepId: 'gather', allowedBy: 'owner' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(allow(env, 'send'), code('AUTO_LOCKED'), 'the floor step is refused by the lock first');
  assert.equal(listRecords(env.store.read(), 'venture-decision').length, 0);
});

test('allowSession: at every stage it is refused in the lock words and promises nothing', async () => {
  for (const stage of ['approve-each', 'rehearsal', 'auto-spot-check'] as const) {
    const { env } = await business(stage);
    await assert.rejects(allow(env, 'gather'), (error: any) => {
      assert.equal(error.code, 'AUTO_LOCKED');
      assert.match(error.message, /built but locked/);
      return true;
    });
    assert.equal(listRecords(env.store.read(), 'venture-decision').length, 0);
    assert.deepEqual(sessionAllowedSteps(env.store, env.store.read(), listRecords(env.store.read(), 'venture-record')[0].id), {});
  }
});

test('allowSession: with nothing granted, closing the vault or opening it again leaves no allowance anywhere', async () => {
  const one = await business('auto-spot-check');
  const two = await business('auto-spot-check');
  await assert.rejects(allow(one.env, 'gather'), code('AUTO_LOCKED'));
  await assert.rejects(allow(two.env, 'gather'), code('AUTO_LOCKED'));
  const idOf = (env: Env) => listRecords(env.store.read(), 'venture-record')[0].id;
  const host = new VentureHost(one.env.store, one.env.deps.services, {
    demo: true, storage: 'experimental-file', host: 'test', clock: one.env.deps.clock, workspace: one.env.workspace,
    modelTransport: { replay: true, http: async () => { throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); }, process: async () => { throw new ChausarError('FIXTURE_MISSING', 'No recording in this test.'); } },
  });
  host.close();
  assert.deepEqual(sessionAllowedSteps(one.env.store, one.env.store.read(), idOf(one.env)), {});
  assert.deepEqual(sessionAllowedSteps(two.env.store, two.env.store.read(), idOf(two.env)), {});
  const reopened = new VentureTestStore(two.env.store.read());
  assert.deepEqual(sessionAllowedSteps(reopened, reopened.read(), idOf(two.env)), {});
  endSessionAllowances();
});

test('a Today click hides only the record of what it ran: a run-sheet approval of turn 1 and a Today approval of turn 2 both show', async () => {
  const { env, order, fields } = await business();
  const run = await seedRun(env, order, { ...fields, status: 'waiting-for-you', callId: 'call_2', harness: harness() });
  const send = (callId: string) => ventureAction(env.deps, owner, 'prepare', 'seed.send', tx => tx.put<JournalRecord>({
    ...tx.base('venture-journal-entry'), action: 'delivery.send', subject: `${run.id}:${callId}`, target: CLIENT_NAME, actionDigest: 'a'.repeat(64),
    describe: `Send the next step for ${CLIENT_NAME} to your AI.`, agent: null, shadow: false, quote: null, state: 'applied', claimedAt: tx.now, decidedBy: 'owner',
    outcome: null, receiptId: null, approval: null, expiresAt: tx.now,
    journal: [
      { state: 'described', at: tx.now, by: 'owner', line: 'Waiting for your approval.' },
      { state: 'approved', at: tx.now, by: 'owner', line: 'You approved this.' },
    ],
  }));
  await send('call_1');
  env.advance(60_000);
  await send('call_2');
  await ventureAction(env.deps, owner, 'approve', 'seed.click', tx => tx.put<QueueDecisionRecord>({
    ...tx.base('venture-queue-decision'), rowId: `run:${run.id}:send-call_2`, subject: `run:${run.id}`, digest: 'b'.repeat(64), action: 'approve', line: 'Sent to your AI.', receiptId: null, decidedBy: 'owner',
  }));
  const list = (await decisions(env)).filter(item => item.subject === `run:${run.id}`);
  assert.deepEqual(list.map(item => item.line), ['You chose Approve on Today: Sent to your AI.', `You approved it: Send the next step for ${CLIENT_NAME} to your AI.`]);
  assert.ok(list[1].id.startsWith(listRecords(env.store.read(), 'venture-journal-entry')[0].id), 'the one turn 1 left, from the run sheet');
});

// ---------------------------------------------------------------------------
// 4. A call a saved rule let through is marked on its record
// ---------------------------------------------------------------------------

const REAL = { kind: 'delivery' as const, runId: 'delivery_1' };
function toolEnv(policy: HarnessPolicy): ToolEnv {
  return {
    deps: { services: {} } as never, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef: REAL,
    files: practiceFiles({ id: 'bookkeeping-clean', serviceType: 'bookkeeping', source: 'template' }), tables: [], receipts: [], dictionary: [], sandbox: undefined,
    now: () => '2026-10-21T10:00:00.000Z', allowed: [], policy,
  };
}
const GRANT = ['files.list', 'files.read', 'calc.sum', 'handoff.owner', 'outbox.propose'] as const;
const run = (env: ToolEnv, tool: string, input: unknown) => callTool(env, [...GRANT], 1, 0, { tool, input: JSON.stringify(input) });

test('end to end in a vault whose stage says auto: the turn is stopped, nothing runs by the Auto rule, and no saved rule is recorded', async () => {
  // Ink v2 wave 4 (4J15): setting the stage in the vault no longer lifts the lock. The policy context caps the posture at
  // approve each (policy/auto-lock.ts), and a real order's turn at that stage is stopped: never run by the Auto rule.
  const { env, order, fields } = await business('auto-spot-check');
  await call(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'gather', gate: 'auto' });
  env.advance(1000);
  const run = await seedRun(env, order, { ...fields, status: 'waiting-for-you', callId: 'call_1', harness: harness() });
  const state = env.store.read();
  const venture = listRecords(state, 'venture-record')[0];
  const playbook = listRecords(state, 'venture-playbook')[0];
  const files = practiceFiles({ id: 'bookkeeping-clean', serviceType: 'bookkeeping', source: 'template' });
  const toolEnv = buildToolEnv({ deps: env.deps, ctx: owner, state, venture, playbook, runRef: { kind: 'delivery', runId: run.id }, files, allowed: [], approval: { kind: 'owner-turn', callId: 'call_1' } });
  const turn = { note: 'Look at what the client sent', calls: [{ tool: 'files.list', input: '{}' }], finished: false };
  const after = await applyTurn(toolEnv, newHarnessState(['files.list', 'files.read', 'handoff.owner'], DEFAULT_LIMITS, files.map(file => file.id)), turn, { by: 'model', callId: 'call_1', costMicros: '100' });
  const [ran] = after.toolCalls;
  // A real order's turn at a stage an agent never works at is stopped before it runs (delivery/harness/recheck.ts).
  assert.equal(ran.outcome, 'cancelled');
  assert.equal(!ran.envelope.ok && ran.envelope.error.code, 'LAUNCH_STAGE_BLOCKED');
  assert.equal(ran.allowedBy, undefined, 'no saved rule let it through');
  await ventureAction(env.deps, owner, 'prepare', 'seed.turn', tx => { tx.replace<DeliveryRunRecord>({ ...tx.find('venture-delivery-run', run.id)!, harness: after }); });
  assert.equal((await decisions(env)).filter(item => item.who === 'saved-rule').length, 0);
  assert.equal((await journal(env)).filter(item => item.allowedBy).length, 0);
});

test('a call allowed by the Auto setting or a session allowance is marked on its record; an asked or approved one is not', async () => {
  const auto = await run(toolEnv({ context: context() }), 'calc.sum', { table: 'f2', amountColumn: 'Amount' });
  assert.equal(auto.verdict?.code, 'auto');
  assert.deepEqual(auto.record.allowedBy, { rule: 'auto', stepId: 'work' });
  const session = await run(toolEnv({ context: context({ session: { gather: 'decision_1' } }) }), 'files.list', {});
  assert.equal(session.record.outcome, 'succeeded');
  assert.deepEqual(session.record.allowedBy, { rule: 'session', stepId: 'gather' });
  const held = await run(toolEnv({ context: context() }), 'files.list', {});
  assert.equal(held.record.outcome, 'cancelled');
  assert.equal(held.record.allowedBy, undefined);
  const approved = await run(toolEnv({ context: context({ posture: 'approve-each', approval: { kind: 'owner-turn', callId: 'call_1' } }) }), 'files.list', {});
  assert.equal(approved.verdict?.code, 'owner_turn');
  assert.equal(approved.record.allowedBy, undefined, 'the owner approved the turn: that is asking');
});

// ---------------------------------------------------------------------------
// 5. Asked again and again for something refused
// ---------------------------------------------------------------------------

const declined = (index: number, inputDigest = 'f'.repeat(64)): PolicyHold => ({
  id: `h${index}.1`, toolCallId: 't1.1', tool: 'files.read', stepId: 'gather', inputDigest, code: 'step_on_hold', reason: 'Read the files is on hold, so it waits for you.',
  turn: 1, handoff: 0, status: 'declined', validTurn: null,
});

test('health: the same tool and input refused 3 times reads "Asked 3 times for something you refused"', async () => {
  const { env, order, fields } = await business();
  type Answered = { answer: string | null; answeredBy: 'owner' | 'practice-client' | null };
  const ownerNo: Answered = { answer: HOLD_DECLINE_ANSWER, answeredBy: 'owner' };
  const refused = async (count: number, inputDigest?: string, answered: Answered = ownerNo) => {
    for (let index = 0; index < count; index += 1) {
      env.advance(1000);
      await seedRun(env, order, {
        ...fields, status: 'rejected' as DeliveryRunRecord['status'], verdict: null,
        harness: harness({
          holds: [declined(index, inputDigest)], toolCalls: [call1({ id: 't1.1', tool: 'files.read', outcome: 'cancelled', startedAt: env.now() })],
          handoffs: [{ to: 'owner', question: 'Read the files is on hold, so it waits for you. The agent wants to run files.read. Let it run once?', turn: 1, ...answered }],
        }),
      });
    }
  };
  await refused(2);
  assert.equal((await team(env))[0].health?.status, 'healthy', 'twice is not yet a pattern');
  await refused(1, 'a'.repeat(64));
  assert.equal((await team(env))[0].health?.status, 'healthy', 'a different input is a different ask');
  // Only the owner's own Keep on hold counts: other words, a practice client or a question nobody answered do not.
  await refused(1, undefined, { answer: 'Use the HDFC statement instead.', answeredBy: 'owner' });
  await refused(1, undefined, { answer: HOLD_DECLINE_ANSWER, answeredBy: 'practice-client' });
  await refused(1, undefined, { answer: null, answeredBy: null });
  assert.equal((await team(env))[0].health?.status, 'healthy', 'none of those is the owner refusing');
  await refused(1);
  const [agent] = await team(env);
  assert.deepEqual([agent.health?.status, agent.health?.reason], ['degraded', 'Asked 3 times for something you refused.']);
  // A month later the old refusals no longer count.
  env.advance(31 * 24 * 60 * 60_000);
  assert.equal((await team(env))[0].health?.status, 'healthy');
});
