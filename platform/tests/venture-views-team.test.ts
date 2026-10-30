// P1-A: the team (venture.team.list and venture.team.gate) from the playbook, the launch ladder and the model calls.
// Ink v2 wave 4 (4A1): each agent's department, kind, state from facts and who set its posture; Keeper on the team;
// the five departments with their counts, jobs done this week, spend this month by department (and what no single role
// can claim, shared by the team) and the six-week series, every figure with its sum receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, DeliveryRunRecord, RunDetail, SumReceiptRecord, TeamListView } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { memberState } from '../runtime/venture/views/health.ts';
import { call, code, harness, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';
import { flagshipTeam, seedRehearsal, seedRupeeRate, seedSpend, turn } from './venture-team-fixtures.ts';

const team = (env: Env) => call<{ agents: AgentView[] }>(env, 'venture.team.list').then(result => result.agents);
const gate = (env: Env, stepId: string, value: 'auto' | 'hold', agentId = 'delivery', ctx = owner) =>
  call<{ agent: AgentView }>(env, 'venture.team.gate', { agentId, stepId, gate: value }, ctx);

test('team: no agents before a plan is accepted; then one agent from the playbook, every gate on hold, the send step on the floor', async () => {
  const env = await setup();
  assert.deepEqual(await team(env), []);
  await seedBlueprint(env, { price2: '1500000' });
  const [agent] = await team(env);
  // Only the built-in templates serve, so the idle agent waits for the owner's AI (spec 8).
  assert.deepEqual({ id: agent.id, name: agent.name, posture: agent.posture, now: agent.now, spend: agent.spend, last: agent.last },
    { id: 'delivery', name: 'Bookkeeping agent', posture: 'rehearsal', now: 'Connect your AI', spend: 'USD 0.0000', last: undefined });
  assert.equal(agent.role, 'Reads each order, works on it with tools, and drafts the reply for you to check.');
  assert.deepEqual(agent.steps.map(step => [step.id, step.gate, step.floor]), [
    ['gather', 'hold', false], ['clarify', 'hold', false], ['work', 'hold', false], ['price', 'hold', false],
    ['draft', 'hold', false], ['verify', 'hold', false], ['approve', 'hold', false], ['send', 'hold', true],
  ]);
  assert.equal(agent.steps[0].purpose, "Read the client's message and files and pull out what is needed");
  assert.deepEqual(listRecords(env.store.read(), 'venture-playbook'), [], 'reading the team builds no playbook');
});

test('team.gate: loosening a step is stored; the always-ask floor refuses auto; tightening is always allowed', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  const { agent } = await gate(env, 'draft', 'auto');
  assert.equal(agent.steps.find(step => step.id === 'draft')?.gate, 'auto');
  assert.equal((await team(env))[0].steps.find(step => step.id === 'draft')?.gate, 'auto');
  const [record] = listRecords(env.store.read(), 'venture-team-gate');
  assert.deepEqual([record.agentId, record.stepId, record.gate, record.memberId], ['delivery', 'draft', 'auto', 'owner']);

  await assert.rejects(gate(env, 'send', 'auto'), (error: any) => error.code === 'GATE_FLOOR' && error.message === 'Sending to a client or the public always asks you first.');
  assert.equal((await gate(env, 'send', 'hold')).agent.steps.find(step => step.id === 'send')?.gate, 'hold');
  assert.equal((await gate(env, 'draft', 'hold')).agent.steps.find(step => step.id === 'draft')?.gate, 'hold', 'the newest gate wins');

  await assert.rejects(gate(env, 'draft', 'auto', 'designer'), code('AGENT_NOT_FOUND'));
  await assert.rejects(gate(env, 'publish', 'auto'), code('STEP_NOT_FOUND'));
  await assert.rejects(gate(env, 'draft', 'auto', 'delivery', phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'draft', gate: 'sometimes' }), code('INVALID_VENTURE_REQUEST'));
});

test('team: posture follows the launch ladder; now, spend and the last result come from runs and model calls', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'needs-answer',
    harness: harness({ phase: 'needs-answer', handoffs: [{ to: 'owner', question: 'Which account?', turn: 1, answer: null, answeredBy: null }] }),
  });
  // Spend: the agent's own calls only (a draft and an agent turn), not rehearsal or plan calls.
  // 2000 + 1000 = 3000 micros = USD 0.0030; the plan call (500) is someone else's.
  await ventureAction(env.deps, owner, 'prepare', 'seed.calls', tx => {
    const call = (id: string, purpose: string, costMicros: string | null, priceConfirmed = true) =>
      tx.state.conversations.push({ id, kind: 'venture-model-call', ventureId: tx.venture!.id, purpose, costMicros, priceConfirmed, status: 'completed' });
    call('call_a', 'delivery', '2000'); call('call_b', 'agent-turn', '1000'); call('call_c', 'blueprint', '500'); call('call_d', 'agent-turn', null);
  });
  const [agent] = await team(env);
  assert.equal(agent.posture, 'approve-each');
  assert.equal(agent.now, 'Waiting on you: Decide what is still unclear');
  assert.equal(agent.spend, 'USD 0.0030');
  assert.deepEqual(agent.last, { line: 'Draft for Cafe Aroma Demo accepted.' });
  await ventureAction(env.deps, owner, 'prepare', 'seed.unconfirmed', tx => {
    tx.state.conversations.push({ id: 'call_e', kind: 'venture-model-call', ventureId: tx.venture!.id, purpose: 'delivery', costMicros: '1000', priceConfirmed: false, status: 'completed' });
  });
  assert.equal((await team(env))[0].spend, 'USD 0.0040 (estimate, price unconfirmed)');
  await setStage(env, 'shadow');
  assert.equal((await team(env))[0].posture, 'shadow');
});

// ---------------------------------------------------------------------------
// Ink v2 wave 4 (4A1): departments, state, Keeper, spend and jobs by department
// ---------------------------------------------------------------------------

const list = (env: Env) => call<TeamListView>(env, 'venture.team.list');
const receipt = (env: Env, id: string) => listRecords(env.store.read(), 'venture-sum-receipt').find(item => item.id === id) as SumReceiptRecord;

test('team: each agent has its department, kind, a state from facts and who set its posture; Keeper is listed last', async () => {
  const env = await setup();
  const { playbook, order } = await flagshipTeam(env, 'youtube');
  // A run waiting on the owner at the packager's writing step.
  await seedRun(env, order, { playbookId: playbook.id, playbookHash: playbook.hash, status: 'waiting-for-you', harness: harness({ phase: 'write' }) });
  const { agents, departments } = await list(env);
  assert.deepEqual(agents.map(item => [item.id, item.department, item.kind, item.state, item.postureSetBy, item.chat]), [
    ['intake-clerk', 'production', 'agent', 'idle', 'business', true],
    ['producer', 'sales', 'agent', 'idle', 'business', true],
    ['chausar', 'production', 'code', 'idle', 'business', false],
    ['story-editor', 'production', 'agent', 'idle', 'business', true],
    ['cutter', 'production', 'agent', 'idle', 'business', true],
    ['packager', 'marketing', 'agent', 'waiting', 'business', true],
    ['analyst', 'marketing', 'agent', 'idle', 'business', true],
    ['community-helper', 'sales', 'agent', 'idle', 'business', true],
    ['keeper', 'operations', 'code', 'idle', undefined, false],
  ]);
  assert.deepEqual(departments!.map(item => [item.id, item.name, item.counts]), [
    ['sales', 'Sales and clients', { working: 0, waiting: 0, stopped: 0, idle: 2 }],
    ['marketing', 'Marketing', { working: 0, waiting: 1, stopped: 0, idle: 1 }],
    ['production', 'Production', { working: 0, waiting: 0, stopped: 0, idle: 4 }],
    ['money', 'Money', { working: 0, waiting: 0, stopped: 0, idle: 0 }],
    ['operations', 'Operations', { working: 0, waiting: 0, stopped: 0, idle: 1 }],
  ]);
  // The one agent of the eight fixed steps takes the service type's department.
  const books = await setup();
  await seedBlueprint(books, { price2: '1500000' });
  assert.deepEqual((await list(books)).agents.map(item => [item.id, item.department, item.kind]), [['delivery', 'money', 'agent'], ['keeper', 'operations', 'code']]);
  // An agent's own posture record means the agent's posture was set on it, not by the business.
  await setStage(env, 'approve-each');
  await call(env, 'venture.team.posture', { agentId: 'packager', posture: 'shadow' });
  assert.ok((await list(env)).agents.filter(item => item.kind === 'agent' || item.id === 'chausar').every(item => item.postureSetBy === 'agent'));
});

test("an agent's state comes from runs only: working, waiting, failed or idle", () => {
  const run = (state: RunDetail['state'], steps: [string, RunDetail['steps'][number]['state']][]): RunDetail => ({
    runId: 'r', businessId: 'main', agent: 'a', purpose: 'p', state, startedAt: '2026-10-15T10:00:00.000Z', elapsed: '0s',
    steps: steps.map(([id, stepState]) => ({ id, purpose: id, state: stepState })),
  });
  const mine = (id: string) => id === 'find';
  assert.equal(memberState(mine, [run('active', [['intake', 'done'], ['find', 'current']])]), 'working');
  assert.equal(memberState(mine, [run('waiting', [['intake', 'done'], ['find', 'waiting']])]), 'waiting');
  assert.equal(memberState(mine, [run('waiting', [['intake', 'waiting'], ['find', 'pending']])]), 'idle', 'waiting on another role');
  assert.equal(memberState(mine, [run('failed', [['intake', 'done'], ['find', 'failed']])]), 'failed');
  assert.equal(memberState(mine, [run('done', [['intake', 'done'], ['find', 'done']]), run('failed', [['find', 'failed']])]), 'idle', 'its latest run finished well');
  assert.equal(memberState(mine, []), 'idle');
});

test('spend by department: each paid call lands with the role its turn worked for; what no single role can claim is shared', async () => {
  const env = await setup();
  const { playbook, order } = await flagshipTeam(env, 'youtube');
  const run = (fields: Partial<DeliveryRunRecord>) => seedRun(env, order, { playbookId: playbook.id, playbookHash: playbook.hash, ...fields });
  await run({
    status: 'ready-for-review',
    harness: harness({ phase: 'done', turns: [turn(1, ['youtube.hooks'], 'call_hooks'), turn(2, ['files.read'], 'call_read'), turn(3, [], 'call_write', 'write')] }),
  });
  // A second run is writing its reply now: the call it holds money for is the packager's.
  await run({ status: 'waiting-for-you', callId: 'call_now', harness: harness({ phase: 'write' }) });
  // youtube.hooks is held only by the story editor's step (find), so that turn is Production's; files.read alone is
  // held by two roles' steps, so that turn is the team's; the write turn is the packager's (Marketing). A plan-writing
  // call is no role's either.
  const hooks = await seedSpend(env, { ref: 'call_hooks', micros: '3000' });
  const read = await seedSpend(env, { ref: 'call_read', micros: '1000' });
  const write = await seedSpend(env, { ref: 'call_write', micros: '2000' });
  const running = await seedSpend(env, { ref: 'call_now', micros: '215600', phase: 'reserved' });
  const planCall = await seedSpend(env, { ref: 'call_plan', micros: '500', label: 'Claude Sonnet, blueprint' });
  // 01:30 on 1 October in India is still 30 September in UTC, the month the spend limit and Money count it in.
  await seedSpend(env, { ref: 'call_hooks', micros: '9000', at: '2026-09-30T20:00:00.000Z' });

  const { departments, shared, totals } = await list(env);
  const by = Object.fromEntries(departments!.map(item => [item.id, item.spendThisMonth]));
  assert.deepEqual({ display: by.production.display, rupees: by.production.rupees, held: by.production.held }, { display: 'USD 0.0030', rupees: undefined, held: undefined });
  // A call still running counts at its estimate, as the spend limit and Money count it, and says so.
  // 4Z3: dollars lead the held words without a rate, never past two decimals; the exact figure is the held receipt's.
  assert.deepEqual({ display: by.marketing.display, held: by.marketing.held }, { display: 'USD 0.2176 (includes estimates)', held: 'including USD 0.22 held for running work' });
  assert.deepEqual(by.marketing.lead, { currency: 'USD', figure: 'USD 0.22 (includes estimates)' });
  for (const id of ['sales', 'money', 'operations']) assert.equal(by[id].display, 'USD 0.0000', id);
  assert.equal(shared!.display, 'USD 0.0015');

  const production = receipt(env, by.production.receiptId);
  assert.deepEqual(production.subject, { type: 'spent-department', department: 'production', from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(production.addends.map(item => item.recordId), [hooks.id]);
  assert.equal(production.unit, 'micros');
  assert.deepEqual(receipt(env, by.marketing.receiptId).addends.map(item => item.recordId), [write.id, running.id]);
  const marketingHeld = receipt(env, by.marketing.heldReceiptId!);
  assert.deepEqual([marketingHeld.subject, marketingHeld.addends.map(item => item.recordId), marketingHeld.totalMinor],
    [{ type: 'held', scope: 'marketing', month: '2026-10' }, [running.id], '215600']);
  assert.deepEqual(receipt(env, shared!.receiptId).addends.map(item => item.recordId), [read.id, planCall.id]);
  assert.deepEqual(receipt(env, shared!.receiptId).subject, { type: 'spent-department', department: 'shared', from: '2026-10-01', to: '2026-10-31' });

  // The Team tile and Money's figure are one sum, and the departments with the shared part add up to it exactly.
  const total = receipt(env, totals!.spendThisMonth.receiptId);
  assert.deepEqual(total.subject, { type: 'spent', month: '2026-10' });
  const parts = [...departments!.map(item => item.spendThisMonth.receiptId), shared!.receiptId].reduce((sum, id) => sum + BigInt(receipt(env, id).totalMinor), 0n);
  assert.equal(parts, BigInt(total.totalMinor));
  assert.equal(total.totalMinor, '222100', '3000 + 1000 + 2000 + 215600 + 500; the 30 September call is September\'s');
  assert.equal(totals!.spendThisMonth.display, 'USD 0.2221 (includes estimates)');
  const money = await moneyHandlers['venture.money.overview']!(env.deps, owner, {}) as { lines: { id: string; receiptId?: string }[] };
  assert.equal(money.lines.find(line => line.id === 'spent')!.receiptId, totals!.spendThisMonth.receiptId, "the same receipt as Money's figure");
  assert.deepEqual([receipt(env, totals!.held!.receiptId).subject, totals!.held!.display], [{ type: 'held', scope: 'all', month: '2026-10' }, 'USD 0.2156']);

  // With the owner's rupee rate, rupees show beside the dollars, labelled with that rate.
  await seedRupeeRate(env);
  const again = Object.fromEntries((await list(env)).departments!.map(item => [item.id, item.spendThisMonth]));
  assert.equal(again.marketing.rupees, '₹18.17 at ₹83.50 per $1 (your rate, set 15 Oct 2026)');
  // 4A2: the rate on its own as well, so a page can say it once and show only the rupee amount elsewhere.
  assert.equal(again.marketing.rate, '₹83.50 per $1 (your rate, set 15 Oct 2026)');
  assert.equal(again.production.rate, again.marketing.rate);
  assert.equal(by.marketing.rate, undefined, 'no rate without the owner\'s rupee rate');
  // 4Z3: a business in India with a rate: rupees lead the figure and the held words, the dollars to two decimals.
  // 217600 micros at 83.50: 1816.96 paise, ₹18.17; 22 cents. 215600 held: ₹18.00, 22 cents.
  assert.equal(again.marketing.held, 'including ₹18.00 held for running work: USD 0.22 at ₹83.50 per $1 (your rate, set 15 Oct 2026)');
  assert.deepEqual(again.marketing.lead, { currency: 'INR', figure: '₹18.17 (includes estimates)', beside: 'USD 0.22 at ₹83.50 per $1', other: 'USD 0.22' });
  // Dollars first: the dollars lead the held words too, the rupees after them at the rate.
  await moneyHandlers['venture.spend.policy.set']!(env.deps, owner, { currencyLead: 'usd' });
  const usd = Object.fromEntries((await list(env)).departments!.map(item => [item.id, item.spendThisMonth]));
  assert.equal(usd.marketing.held, 'including USD 0.22 held for running work: ₹18.00 at ₹83.50 per $1 (your rate, set 15 Oct 2026)');
  assert.deepEqual(usd.marketing.lead, { currency: 'USD', figure: 'USD 0.22 (includes estimates)', beside: '₹18.17 at ₹83.50 per $1', other: '₹18.17' });
  await moneyHandlers['venture.spend.policy.set']!(env.deps, owner, { currencyLead: 'auto' });
  assert.equal(again.marketing.receiptId, by.marketing.receiptId, 'the same sum keeps its receipt');
});

test("spend shares (4A2): each department's and the shared part's share of the month's spend in per mille, floored in code; 0 when nothing was spent", async () => {
  const env = await setup();
  const { playbook, order } = await flagshipTeam(env, 'youtube');
  const empty = await list(env);
  for (const item of empty.departments!) assert.equal(item.spendThisMonth.sharePermille, 0, `${item.id} with nothing spent`);
  await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'ready-for-review',
    harness: harness({ phase: 'done', turns: [turn(1, ['youtube.hooks'], 'call_hooks'), turn(2, ['files.read'], 'call_read'), turn(3, [], 'call_write', 'write')] }),
  });
  await seedSpend(env, { ref: 'call_hooks', micros: '3000' });
  await seedSpend(env, { ref: 'call_read', micros: '1000' });
  await seedSpend(env, { ref: 'call_write', micros: '2000' });
  await seedSpend(env, { ref: 'call_plan', micros: '500', label: 'Claude Sonnet, blueprint' });
  const { departments, shared } = await list(env);
  const share = Object.fromEntries(departments!.map(item => [item.id, item.spendThisMonth.sharePermille]));
  // 6500 in all: Production 3000 (461.5), Marketing 2000 (307.6), shared 1500 (230.7), each floored.
  assert.deepEqual(share, { sales: 0, marketing: 307, production: 461, money: 0, operations: 0 });
  assert.equal(shared!.sharePermille, 230);
});

test('the fixed steps: the one agent spends for its department; calls that are no agent\'s are shared', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await ventureAction(env.deps, owner, 'prepare', 'seed.calls', tx => {
    tx.state.conversations.push({ id: 'call_turn', kind: 'venture-model-call', ventureId: tx.venture!.id, purpose: 'agent-turn', costMicros: '4000', priceConfirmed: true, status: 'completed' });
    tx.state.conversations.push({ id: 'call_blueprint', kind: 'venture-model-call', ventureId: tx.venture!.id, purpose: 'blueprint', costMicros: '700', priceConfirmed: true, status: 'completed' });
  });
  await seedSpend(env, { ref: 'call_turn', micros: '4000' });
  await seedSpend(env, { ref: 'call_blueprint', micros: '700' });
  const { departments, shared } = await list(env);
  assert.equal(departments!.find(item => item.id === 'money')!.spendThisMonth.display, 'USD 0.0040');
  assert.equal(shared!.display, 'USD 0.0007');
});

test("done this week: runs that reached review and finished rehearsals in the owner's week, with a count receipt; Keeper's jobs stay on its card", async () => {
  const env = await setup();
  const { playbook, order } = await flagshipTeam(env, 'youtube');
  const run = (fields: Partial<DeliveryRunRecord>) => seedRun(env, order, { playbookId: playbook.id, playbookHash: playbook.hash, ...fields });
  const accepted = await run({ status: 'accepted', verdict: { choice: 'accepted', reason: null, at: env.now() } });
  await run({ status: 'waiting-for-you', harness: harness({ phase: 'write' }) });
  await run({ status: 'ready-for-review', at: '2026-10-08T10:00:00.000Z' });
  const rehearsal = await seedRehearsal(env, playbook.id);
  await sweepWholeJournal(env.deps, owner);
  const { departments, totals } = await list(env);
  const by = Object.fromEntries(departments!.map(item => [item.id, item.doneThisWeek]));
  assert.deepEqual(Object.fromEntries(Object.entries(by).map(([id, done]) => [id, done.count])), { sales: 0, marketing: 2, production: 0, money: 0, operations: 0 });
  // 4A2: each department's jobs this week scaled to the busiest department's, in code, for Team's bars by department.
  assert.deepEqual(Object.fromEntries(Object.entries(by).map(([id, done]) => [id, done.permille])), { sales: 0, marketing: 1000, production: 0, money: 0, operations: 0 });
  const marketing = receipt(env, by.marketing.receiptId);
  assert.deepEqual(marketing.subject, { type: 'count', what: 'jobs', scope: 'marketing', from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual([marketing.unit, marketing.totalMinor], ['count', '2']);
  assert.deepEqual(marketing.addends.map(item => item.recordId).sort(), [accepted.id, rehearsal.id].sort());
  assert.equal(receipt(env, by.operations.receiptId).totalMinor, '0', "Keeper's runs show on its own card, not as department jobs");
  assert.equal(receipt(env, by.sales.receiptId).totalMinor, '0');
  // The team's total is the same partition: the departments add up to it.
  const all = receipt(env, totals!.doneThisWeek.receiptId);
  assert.deepEqual([all.subject, totals!.doneThisWeek.count], [{ type: 'count', what: 'jobs', scope: 'all', from: '2026-10-12', to: '2026-10-18' }, 2]);
  assert.equal(departments!.reduce((sum, item) => sum + item.doneThisWeek.count, 0), totals!.doneThisWeek.count);
});

test('the six-week series: jobs and spend per local week, scaled in code to the largest week, null where a week has no data', async () => {
  const env = await setup();
  const { playbook, order } = await flagshipTeam(env, 'youtube');
  const run = (fields: Partial<DeliveryRunRecord>) => seedRun(env, order, { playbookId: playbook.id, playbookHash: playbook.hash, ...fields });
  await run({
    at: '2026-09-29T09:00:00.000Z', status: 'accepted', verdict: { choice: 'accepted', reason: null, at: '2026-09-29T10:00:00.000Z' },
    harness: harness({ phase: 'done', turns: [turn(1, ['youtube.hooks'], 'call_old')] }),
  });
  await run({
    status: 'accepted', verdict: { choice: 'accepted', reason: null, at: env.now() },
    harness: harness({ phase: 'done', turns: [turn(1, ['youtube.hooks'], 'call_new')] }),
  });
  await seedRehearsal(env, playbook.id);
  await seedSpend(env, { ref: 'call_old', micros: '6000', at: '2026-09-29T09:30:00.000Z' });
  await seedSpend(env, { ref: 'call_new', micros: '3000' });
  const { departments } = await list(env);
  const marketing = departments!.find(item => item.id === 'marketing')!.series.jobs;
  assert.deepEqual(marketing.map(point => point.key), ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
  assert.equal(marketing[5].label, 'Week of 12 Oct 2026');
  assert.deepEqual(marketing.map(point => [point.value, point.valuePermille]), [[null, null], [null, null], [null, null], ['1', 500], [null, null], ['2', 1000]]);
  assert.deepEqual(marketing.map(point => point.receiptId === null), [true, true, true, false, true, false]);
  const production = departments!.find(item => item.id === 'production')!.series.spend;
  assert.deepEqual(production.map(point => [point.value, point.valuePermille]), [[null, null], [null, null], [null, null], ['USD 0.0060', 1000], [null, null], ['USD 0.0030', 500]]);
  const week = receipt(env, production[3].receiptId!);
  assert.deepEqual(week.subject, { type: 'spent-department', department: 'production', from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(departments!.find(item => item.id === 'money')!.series.spend.map(point => point.valuePermille), [null, null, null, null, null, null], 'never 0');
  assert.ok(production.every(point => point.rupees === undefined), 'no rupees without the owner\'s rate');
  // 4Z3: each point as the owner's currency leads it; without a rate, dollars to two decimals (6000 micros: 1 cent;
  // 3000 micros rounds to no cents, so it reads as under a cent, never as nothing).
  assert.deepEqual(production.map(point => point.lead ?? null), [null, null, null, { currency: 'USD', figure: 'USD 0.01' }, null, { currency: 'USD', figure: 'under USD 0.01' }]);
  // With the owner's rate, each spend point shows rupees beside the dollars, labelled with that rate.
  await seedRupeeRate(env);
  const withRate = (await list(env)).departments!.find(item => item.id === 'production')!.series.spend;
  assert.deepEqual(withRate.map(point => point.rupees ?? null), [null, null, null,
    '₹0.50 at ₹83.50 per $1 (your rate, set 15 Oct 2026)', null, '₹0.25 at ₹83.50 per $1 (your rate, set 15 Oct 2026)']);
  // 4Z3: with the rate, rupees lead each point (6000 micros: 50.1 paise, ₹0.50; 3000: ₹0.25).
  assert.deepEqual(withRate.map(point => point.lead?.figure ?? null), [null, null, null, '₹0.50', null, '₹0.25']);
  assert.equal(withRate[3]!.lead!.beside, 'USD 0.01 at ₹83.50 per $1');
});

test('team: an idle agent reads Connect your AI until a connected AI can run; a code role, work in hand and a pause keep their own words', async () => {
  const env = await setup();
  const { playbook, order } = await flagshipTeam(env, 'youtube');
  const nowOf = async () => Object.fromEntries((await list(env)).agents.filter(agent => agent.id !== 'keeper').map(agent => [agent.id, agent.now]));
  // Templates only: each idle agent waits for the owner's AI. The code role needs none.
  assert.deepEqual(await nowOf(), { 'intake-clerk': 'Connect your AI', producer: 'Connect your AI', chausar: 'Idle', 'story-editor': 'Connect your AI', cutter: 'Connect your AI', packager: 'Connect your AI', analyst: 'Connect your AI', 'community-helper': 'Connect your AI' });
  env.models.connected = true;
  assert.deepEqual(Object.values(await nowOf()), ['Idle', 'Idle', 'Idle', 'Idle', 'Idle', 'Idle', 'Idle', 'Idle'], 'a connected AI that can run');
  env.models.usable = false;
  assert.equal((await nowOf())['intake-clerk'], 'Connect your AI', 'an AI that cannot run now leaves them waiting');
  // Work in hand says what it is, AI or not.
  await seedRun(env, order, { playbookId: playbook.id, playbookHash: playbook.hash, status: 'waiting-for-you', harness: harness({ phase: 'write' }) });
  const busy = await nowOf();
  assert.match(busy.packager, /^Waiting on you: /);
  assert.equal(busy.producer, 'Connect your AI');
  // A team view that cannot read the AI status still lists the team, with the plain idle words.
  env.models.status = () => { throw new Error('The models package did not load.'); };
  assert.equal((await nowOf()).producer, 'Idle');

  // The one-agent team: a gate change answers with the same line the list shows.
  const single = await setup();
  await seedBlueprint(single, { price2: '1500000' });
  assert.equal((await gate(single, 'draft', 'auto')).agent.now, 'Connect your AI');
  single.models.connected = true;
  assert.equal((await gate(single, 'draft', 'hold')).agent.now, 'Idle');
});
