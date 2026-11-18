// The chief's standing plan, the part code decides alone (chief/plan-core.ts): each move's state and the one table
// that says how a state changes, the week's moves seeded from the way to earn, what the records move by themselves, and
// the one next best step. Nothing here asks a model or reads a store.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_BY, MOVES_MAX, MOVE_EVENTS, MOVE_STATES, MOVE_STATE_LABEL, MOVE_TABLE, OPEN_STATES, PLAN_KINDS, addChiefMoves, codeLine, moveAfter, moveId, nextStepOf, ownerCan, ownerMove,
  proposeMove, seedPlan, setupProgress, syncPlan, weekOf, type PlanFacts, type PlanMove, type StandingPlan,
} from '../runtime/venture/chief/plan-core.ts';
import { stepView } from '../runtime/venture/chief/plan-view.ts';

const NOW = '2026-11-11T03:00:00.000Z';
const WEEK = ['Photograph three sample sets.', 'Approve the first list of cafes.', 'Send the first five messages.', 'Visit two cafes with samples.'];
const facts = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  today: '2026-11-11', accepted: true, ready: true, missing: [], clients: 0, invoicesIssued: 0, payments: 0, firstWeek: WEEK, proposals: {}, ...over,
});
const states = (plan: StandingPlan) => plan.moves.map(move => [move.text, move.state]);
const byText = (plan: StandingPlan, text: string): PlanMove => plan.moves.find(move => move.text === text)!;

test('a move has seven states, and one table says every way a state may change', () => {
  assert.deepEqual([...MOVE_STATES], ['planned', 'waiting', 'proposed', 'working', 'failed', 'done', 'dropped']);
  assert.deepEqual(Object.keys(MOVE_TABLE), [...MOVE_STATES]);
  assert.deepEqual(MOVE_TABLE, {
    planned: { start: 'waiting', propose: 'proposed', finish: 'done', drop: 'dropped' },
    waiting: { propose: 'proposed', finish: 'done', drop: 'dropped' },
    proposed: { begin: 'working', approve: 'done', fail: 'failed', dismiss: 'dropped', withdraw: 'planned', drop: 'dropped' },
    working: { approve: 'done', fail: 'failed', return: 'proposed', dismiss: 'dropped', withdraw: 'planned', drop: 'dropped' },
    failed: { begin: 'working', approve: 'done', return: 'proposed', dismiss: 'dropped', drop: 'dropped' },
    done: { reopen: 'planned', return: 'proposed', fail: 'failed' },
    dropped: { reopen: 'planned' },
  });
  for (const state of MOVE_STATES) for (const event of MOVE_EVENTS) assert.equal(moveAfter(state, event), (MOVE_TABLE[state] as Record<string, string>)[event] ?? null);
  // Nothing leaves done or dropped but the owner's own reopen; only the chief proposes; only the records start one.
  assert.deepEqual(EVENT_BY.reopen, ['owner']);
  assert.deepEqual(EVENT_BY.drop, ['owner']);
  assert.deepEqual(EVENT_BY.propose, ['chief']);
  assert.deepEqual(EVENT_BY.start, ['records']);
  for (const event of ['begin', 'fail', 'return'] as const) assert.deepEqual(EVENT_BY[event], ['records'], 'only the records say how a card\'s work went');
  assert.deepEqual([...OPEN_STATES], ['planned', 'waiting', 'proposed', 'working']);
  assert.deepEqual(Object.keys(MOVE_STATE_LABEL), [...MOVE_STATES]);
  assert.equal(MOVE_STATE_LABEL.waiting, 'Waiting on you');
  assert.deepEqual([MOVE_STATE_LABEL.working, MOVE_STATE_LABEL.failed], ['Approved, working on it', 'Did not finish']);
});

test('the week starts on Monday of the owner calendar', () => {
  assert.equal(weekOf('2026-11-11'), '2026-11-09');
  assert.equal(weekOf('2026-11-09'), '2026-11-09');
  assert.equal(weekOf('2026-11-15'), '2026-11-09');
  assert.equal(weekOf('2026-11-16'), '2026-11-16');
});

test('a new plan is the way first week, in order, with the first move waiting on the owner', () => {
  const plan = seedPlan(facts(), NOW);
  assert.equal(plan.weekOf, '2026-11-09');
  assert.deepEqual(states(plan), [[WEEK[0], 'waiting'], [WEEK[1], 'planned'], [WEEK[2], 'planned'], [WEEK[3], 'planned']]);
  assert.ok(plan.moves.every(move => move.source === 'way' && move.id === moveId(move.text)));
  // The same words always make the same id, so a plan nobody stored yet can still be acted on.
  assert.deepEqual(seedPlan(facts(), '2026-11-12T00:00:00.000Z').moves.map(move => move.id), plan.moves.map(move => move.id));
});

test('until what is sold is ready the setup moves lead, and the records finish them', () => {
  const fresh = seedPlan(facts({ accepted: false, ready: false, missing: ['Read your plan and accept it.'] }), NOW);
  assert.deepEqual(states(fresh).slice(0, 2), [['Accept your plan', 'waiting'], ['Set your prices', 'planned']]);
  assert.equal(fresh.moves.length, MOVES_MAX, 'at most five moves a week');
  assert.deepEqual(fresh.moves.slice(2).map(move => move.text), WEEK.slice(0, 3));
  const accepted = syncPlan(fresh, facts({ accepted: true, ready: false, missing: ['Set your price for Mug sets.'] }), NOW);
  assert.deepEqual(states(accepted).slice(0, 2), [['Accept your plan', 'done'], ['Set your prices', 'waiting']]);
  assert.equal(byText(accepted, 'Accept your plan').by, 'records');
  const priced = syncPlan(accepted, facts(), NOW);
  assert.deepEqual(states(priced).slice(0, 3), [['Accept your plan', 'done'], ['Set your prices', 'done'], [WEEK[0], 'waiting']]);
  // Sync changes nothing more when the records say nothing new.
  assert.deepEqual(syncPlan(priced, facts(), NOW), priced);
});

test('with no way kept, the plan is the setup and the first client, invoice and payment, each finished by the records', () => {
  const plan = seedPlan(facts({ firstWeek: [] }), NOW);
  assert.deepEqual(states(plan), [['Add your first client', 'waiting'], ['Send your first invoice', 'planned'], ['Record your first payment', 'planned']]);
  const later = syncPlan(plan, facts({ firstWeek: [], clients: 1, invoicesIssued: 1 }), NOW);
  assert.deepEqual(states(later), [['Add your first client', 'done'], ['Send your first invoice', 'done'], ['Record your first payment', 'waiting']]);
});

test('the owner finishes, drops and reopens a move; nothing else is theirs to do', () => {
  let plan = seedPlan(facts(), NOW);
  const first = plan.moves[0]!, second = plan.moves[1]!;
  plan = ownerMove(plan, first.id, 'done', facts(), NOW)!;
  assert.deepEqual(states(plan).slice(0, 2), [[WEEK[0], 'done'], [WEEK[1], 'waiting']], 'the next planned move starts at once');
  assert.equal(byText(plan, WEEK[0]!).by, 'owner');
  plan = ownerMove(plan, second.id, 'dropped', facts(), NOW)!;
  assert.deepEqual(states(plan).slice(1, 3), [[WEEK[1], 'dropped'], [WEEK[2], 'waiting']]);
  plan = ownerMove(plan, second.id, 'planned', facts(), NOW)!;
  assert.equal(byText(plan, WEEK[1]!).state, 'waiting', 'a reopened move is the first still to do, so it is the owner\'s turn again');
  assert.equal(ownerMove(plan, second.id, 'planned', facts(), NOW), null, 'a move still to do cannot be reopened');
  assert.equal(ownerMove(plan, 'mv_nope', 'done', facts(), NOW), null);
  // A move the records check is never the owner's to tick.
  const setup = seedPlan(facts({ accepted: false, ready: false }), NOW);
  assert.equal(ownerMove(setup, setup.moves[0]!.id, 'done', facts({ accepted: false, ready: false }), NOW), null);
});

test('a proposal card moves its move: approved is done, not now is dropped, a card that went away is planned again', () => {
  const start = seedPlan(facts(), NOW);
  const raised = proposeMove(start, { title: 'Draft a quote for Cafe mug sets', proposalId: 'prop_1' }, NOW);
  const move = byText(raised, 'Draft a quote for Cafe mug sets');
  assert.deepEqual([move.state, move.source, move.proposalId, move.by], ['proposed', 'chief', 'prop_1', 'chief']);
  assert.equal(byText(syncPlan(raised, facts({ proposals: { prop_1: 'raised' } }), NOW), move.text).state, 'proposed');
  assert.equal(byText(syncPlan(raised, facts({ proposals: { prop_1: 'approved' } }), NOW), move.text).state, 'done');
  assert.equal(byText(syncPlan(raised, facts({ proposals: { prop_1: 'dismissed' } }), NOW), move.text).state, 'dropped');
  assert.equal(byText(syncPlan(raised, facts({ proposals: { prop_1: 'refused' } }), NOW), move.text).state, 'dropped');
  assert.equal(byText(syncPlan(raised, facts(), NOW), move.text).state, 'planned', 'its card is gone, so it is planned again');
  // Approved is not done until the card's work is: while it runs the move says so, and it is done only when it finished.
  const working = syncPlan(raised, facts({ proposals: { prop_1: 'working' } }), NOW);
  assert.equal(byText(working, move.text).state, 'working');
  assert.deepEqual(ownerCan(byText(working, move.text)), ['dropped'], 'the owner may take it off the list, never tick it done');
  assert.equal(byText(syncPlan(working, facts({ proposals: { prop_1: 'approved' } }), NOW), move.text).state, 'done');
  // Found live, 16 Nov 2026: a search for customers was approved, the map did not answer, the card went back on Today,
  // and the week still said Done. The card back on Today is a move back on Today.
  const back = syncPlan(working, facts({ proposals: { prop_1: 'raised' } }), NOW);
  assert.equal(byText(back, move.text).state, 'proposed');
  // Work that stopped for good (a call left in doubt, a restart) is not done either: it says it did not finish.
  const failed = syncPlan(working, facts({ proposals: { prop_1: 'failed' } }), NOW);
  assert.equal(byText(failed, move.text).state, 'failed');
  assert.deepEqual(ownerCan(byText(failed, move.text)), ['dropped']);
  assert.equal(byText(syncPlan(failed, facts({ proposals: { prop_1: 'raised' } }), NOW), move.text).state, 'proposed', 'asked again, it waits on Today again');
  // A plan stored while the old rule stood (done at the approval) follows the records too.
  const wronglyDone = syncPlan(raised, facts({ proposals: { prop_1: 'approved' } }), NOW);
  assert.equal(byText(syncPlan(wronglyDone, facts({ proposals: { prop_1: 'raised' } }), NOW), move.text).state, 'proposed');
  assert.equal(byText(syncPlan(wronglyDone, facts({ proposals: { prop_1: 'failed' } }), NOW), move.text).state, 'failed');
  assert.equal(byText(syncPlan(wronglyDone, facts({ proposals: { prop_1: 'approved' } }), NOW), move.text).state, 'done');
  // The same proposal never makes a second move.
  assert.equal(proposeMove(raised, { title: 'Draft a quote for Cafe mug sets', proposalId: 'prop_1' }, NOW).moves.length, raised.moves.length);
});

test('the chief adds moves only while fewer than five are open, never twice, and may finish a move the records do not check', () => {
  const start = seedPlan(facts(), NOW);
  const more = addChiefMoves(start, ['List ten hotels near the station.', WEEK[0]!, 'Plan a tasting day.'], NOW);
  assert.deepEqual(more.moves.map(move => move.text), [...WEEK, 'List ten hotels near the station.']);
  assert.equal(more.moves.at(-1)!.source, 'chief');
  assert.equal(more.moves.filter(move => (OPEN_STATES as readonly string[]).includes(move.state)).length, MOVES_MAX);
});

test('a new week keeps what is still open and sets the rest aside, so a finished move never comes back', () => {
  let plan = seedPlan(facts(), NOW);
  plan = ownerMove(plan, plan.moves[0]!.id, 'done', facts(), NOW)!;
  const next = syncPlan(plan, facts({ today: '2026-11-16' }), '2026-11-16T03:00:00.000Z');
  assert.equal(next.weekOf, '2026-11-16');
  assert.deepEqual(next.moves.map(move => move.text), WEEK.slice(1));
  assert.deepEqual(next.past, [moveId(WEEK[0]!)]);
  assert.equal(next.moves[0]!.state, 'waiting');
});

test('the next best step: finish what is sold, then what waits on Today, then an overdue invoice, then the move, else all clear', () => {
  const plan = seedPlan(facts(), NOW);
  const row = { rowId: 'proposal:p1:v1', title: 'Draft the invoice for Asha Rao\'s order' };
  const overdue = { invoiceId: 'inv_1', number: 'INV-0004', days: 9 };
  const notReady = facts({ accepted: false, ready: false, missing: ['Read your plan and accept it.'] });
  assert.deepEqual(nextStepOf({ facts: notReady, row, planRowId: 'plan:v:1', overdue, moves: plan.moves }), { kind: 'offer', what: 'accept', title: 'Read your plan and accept it.', rowId: 'plan:v:1' });
  const unpriced = facts({ ready: false, missing: ['Set your price for Mug sets.', 'Set your price for Bowl sets.'] });
  assert.deepEqual(nextStepOf({ facts: unpriced, row, planRowId: null, overdue, moves: plan.moves }), { kind: 'offer', what: 'price', title: 'Set your price for Mug sets.', rowId: null });
  assert.deepEqual(nextStepOf({ facts: facts(), row, planRowId: null, overdue, moves: plan.moves }), { kind: 'row', ...row });
  assert.deepEqual(nextStepOf({ facts: facts(), row: null, planRowId: null, overdue, moves: plan.moves }), { kind: 'overdue', ...overdue });
  assert.deepEqual(nextStepOf({ facts: facts(), row: null, planRowId: null, overdue: null, moves: plan.moves }), { kind: 'move', moveId: plan.moves[0]!.id, title: WEEK[0] });
  assert.deepEqual(nextStepOf({ facts: facts(), row: null, planRowId: null, overdue: null, moves: [] }), { kind: 'clear' });
  const allDone = plan.moves.map(move => ({ ...move, state: 'done' as const }));
  assert.deepEqual(nextStepOf({ facts: facts(), row: null, planRowId: null, overdue: null, moves: allDone }), { kind: 'clear' });
});

test('the line code writes for today says where the week stands, in plain words with no em dash', () => {
  const plan = seedPlan(facts(), NOW);
  assert.equal(codeLine(facts({ ready: false }), plan.moves), 'First, get what you sell ready.');
  assert.equal(codeLine(facts(), plan.moves), 'None of 4 moves done yet this week.');
  const one = ownerMove(plan, plan.moves[0]!.id, 'done', facts(), NOW)!;
  assert.equal(codeLine(facts(), one.moves), '1 of 4 moves done this week.');
  assert.equal(codeLine(facts(), one.moves.map(move => ({ ...move, state: 'done' as const }))), 'All 4 moves done this week.');
  assert.equal(codeLine(facts(), []), 'No moves planned for this week yet.');
});

test('an offer added later with no price puts its setup move ahead of the week, waiting on the owner at once', () => {
  let plan = seedPlan(facts(), NOW);
  plan = ownerMove(plan, plan.moves[0]!.id, 'done', facts(), NOW)!;
  const unready = syncPlan(plan, facts({ ready: false, missing: ['Set your price for Bowl sets.'] }), NOW);
  assert.deepEqual(states(unready), [[WEEK[0], 'done'], ['Set your prices', 'waiting'], [WEEK[1], 'waiting'], [WEEK[2], 'planned'], [WEEK[3], 'planned']]);
  assert.deepEqual(setupProgress(facts({ ready: false })), { done: 1, total: 2 });
  assert.deepEqual(setupProgress(facts({ accepted: false, ready: false })), { done: 0, total: 2 });
  assert.deepEqual(setupProgress(facts()), { done: 2, total: 2 });
  assert.ok(PLAN_KINDS.includes('venture-blueprint') && PLAN_KINDS.includes('venture-payment') && PLAN_KINDS.includes('venture-proposal'));
});

// Found live on Windows, 15 Nov 2026: with the plan accepted and prices set, "Confirm your tax" was the next best step
// for a potter, a repair technician and a translator, ahead of their own week of finding customers.
test('a setup card never outranks real work: decisions on real work, an overdue invoice and the week all come before it', () => {
  const plan = seedPlan(facts(), NOW);
  const tax = { rowId: 'setup:prices:bp_1', title: 'Confirm your tax', setup: true };
  const card = { rowId: 'proposal:p1:v1', title: 'Find possible customers: cafes in Pune' };
  const overdue = { invoiceId: 'inv_1', number: 'INV-0004', days: 9 };
  const first = { kind: 'move', moveId: plan.moves[0]!.id, title: WEEK[0] };
  // Confirming an assumed tax setting blocks nothing: the week's first open move is the step.
  assert.deepEqual(nextStepOf({ facts: facts(), row: tax, planRowId: null, overdue: null, moves: plan.moves }), first);
  assert.deepEqual(nextStepOf({ facts: facts(), row: tax, planRowId: null, overdue, moves: plan.moves }), { kind: 'overdue', ...overdue });
  // A card that is the owner's decision on real work still leads the week.
  assert.deepEqual(nextStepOf({ facts: facts(), row: card, planRowId: null, overdue, moves: plan.moves }), { kind: 'row', ...card });
  // With nothing else left the setup card is the step, never "nothing needs you".
  assert.deepEqual(nextStepOf({ facts: facts(), row: tax, planRowId: null, overdue: null, moves: [] }), { kind: 'row', rowId: tax.rowId, title: tax.title });
  // A plan not accepted blocks everything, whatever waits.
  const notReady = facts({ accepted: false, ready: false, missing: ['Read your plan and accept it.'] });
  assert.equal(nextStepOf({ facts: notReady, row: card, planRowId: 'plan:v:1', overdue, moves: plan.moves }).kind, 'offer');
});

test('an offer with no price leads a business with no client yet, but never a customer already waiting on the owner', () => {
  const plan = seedPlan(facts(), NOW);
  const card = { rowId: 'run:r1:q1', title: 'Answer a client\'s question' };
  const tax = { rowId: 'setup:prices:bp_1', title: 'Confirm your prices and tax', setup: true };
  const overdue = { invoiceId: 'inv_1', number: 'INV-0004', days: 9 };
  const price = { kind: 'offer', what: 'price', title: 'Set your price for Bowl sets.', rowId: null };
  const missing = ['Set your price for Bowl sets.'];
  // No client yet: nothing real can be waiting, so the price comes first (customers are not looked for before it).
  assert.deepEqual(nextStepOf({ facts: facts({ ready: false, missing }), row: card, planRowId: null, overdue: null, moves: plan.moves }), price);
  // An established business added an offer: the customer waiting and the late invoice are not held behind its price.
  const established = facts({ ready: false, missing, clients: 2 });
  assert.deepEqual(nextStepOf({ facts: established, row: card, planRowId: null, overdue, moves: plan.moves }), { kind: 'row', ...card });
  assert.deepEqual(nextStepOf({ facts: established, row: null, planRowId: null, overdue, moves: plan.moves }), { kind: 'overdue', ...overdue });
  // Then the price, ahead of the week (its moves look for customers) and of any setup card.
  assert.deepEqual(nextStepOf({ facts: established, row: tax, planRowId: null, overdue: null, moves: plan.moves }), price);
  // A notice only tells the owner something (a payment came in): it is no customer waiting, so the price still leads it.
  const paid = { rowId: 'paid:payment_1:abc', title: 'A payment came in', notice: true };
  assert.deepEqual(nextStepOf({ facts: established, row: paid, planRowId: null, overdue: null, moves: plan.moves }), price);
  // With everything priced a notice is a card like any other, ahead of the week.
  assert.deepEqual(nextStepOf({ facts: facts({ clients: 2 }), row: paid, planRowId: null, overdue: null, moves: plan.moves }), { kind: 'row', rowId: paid.rowId, title: paid.title });
});

test('the step says which setup cards also wait, in one quiet line, and never names the step itself twice', () => {
  const plan = seedPlan(facts(), NOW);
  const act = (id: string, label: string) => [{ id, label, primary: true }];
  const rows = [
    { id: 'setup:ai:none', kind: 'setup', title: 'Connect your AI', actions: act('connect', 'Connect') },
    { id: 'setup:prices:bp_1', kind: 'setup', title: 'Confirm your tax', actions: act('set-prices', 'Confirm tax') },
    { id: 'setup:keep:not-made', kind: 'setup', title: 'Keep this business', actions: act('keep', 'Keep it') },
    { id: 'proposal:p1:v1', kind: 'proposal', title: 'Find possible customers: cafes in Pune', actions: act('approve', 'Approve') },
  ];
  const context = { rows, ranked: null, moves: plan.moves, reviewOn: true };
  const move = stepView({ kind: 'move', moveId: plan.moves[0]!.id, title: WEEK[0]! }, context);
  assert.deepEqual(move.also, { line: 'Also waiting: Connect your AI, Confirm your tax, Keep this business.', rowIds: ['setup:ai:none', 'setup:prices:bp_1', 'setup:keep:not-made'], titles: ['Connect your AI', 'Confirm your tax', 'Keep this business'] });
  // A setup card that is the step is not also waiting.
  const keep = stepView({ kind: 'row', rowId: 'setup:keep:not-made', title: 'Keep this business' }, context);
  assert.deepEqual(keep.also?.rowIds, ['setup:ai:none', 'setup:prices:bp_1']);
  // The step to set a price goes where the prices card goes, so that card is not named beside it.
  const price = stepView({ kind: 'offer', what: 'price', title: 'Set your price for Bowl sets.', rowId: null }, context);
  assert.equal(price.also?.line, 'Also waiting: Connect your AI, Keep this business.');
  // One card reads as one; none leaves the line out.
  assert.equal(stepView({ kind: 'clear' }, { ...context, rows: rows.slice(0, 1) }).also?.line, 'Also waiting: Connect your AI.');
  assert.equal(stepView({ kind: 'clear' }, { ...context, rows: rows.slice(3) }).also, null);
  assert.equal(/—/.test(move.also!.line), false);
});
