// A first-week move about finding customers opens Find customers (found by running the real app, 15 Nov 2026: the
// kept first week said "Build a list of possible cafes in Pune", and the next best step offered only "Done", leaving
// the owner to discover the search under Clients). When the step is such a move of the way to earn, its one button
// opens Find customers, whose brief is already seeded from the way. Code decides it from the move's source and plain
// words, and only when sure: anything else keeps "Done".
import test from 'node:test';
import assert from 'node:assert/strict';
import { findsCustomers, moveId, nextStepOf, type PlanFacts, type PlanMove } from '../runtime/venture/chief/plan-core.ts';
import { FIND_PLACE, STEP_WORDS, stepView } from '../runtime/venture/chief/plan-view.ts';

const move = (text: string, source: PlanMove['source'] = 'way', extra: Partial<PlanMove> = {}): PlanMove => ({ id: moveId(text), text, source, state: 'waiting', at: '2026-11-15T04:00:00.000Z', by: 'records', ...extra });
const step = (item: PlanMove) => stepView({ kind: 'move', moveId: item.id, title: item.text }, { rows: [], ranked: null, moves: [item], reviewOn: true });

test('a move of the kept first week that finds or lists possible customers is known by its plain words', () => {
  for (const text of [
    'Build a list of possible cafes in Pune',
    'Build a list of possible cafes in Pune.',
    'Find 20 possible customers near Koregaon Park.',
    'List potential clients among small hotels in Goa.',
    'Make a list of likely buyers for bulk tableware.',
    'Look for prospects among boutique hotels.',
    'Put together a shortlist of leads in Jaipur.',
    // Fix round 6 (17 Nov 2026): the real plan's step 3. A list of a kind of place the map knows says who plainly.
    'Prepare a list of offices and event planners to review.',
  ]) assert.equal(findsCustomers(move(text)), true, text);
});

test('unsure means no: other first-week moves, and the same words from elsewhere, keep Done', () => {
  for (const text of [
    'Photograph three sample sets.',
    'Approve the first list of cafes.', // the owner's approval of a search already on Today, not a search to start
    'Send the first five messages.',
    'Make a list of your designs and prices.',
    'Build a list of materials to buy.',
    'List 20 cafes near Koregaon Park.', // no word that says they are possible customers
    'Email possible customers your price list.',
    'Call the two cafes that asked for samples.',
    'Decide the designs and your price for each offer.',
    'Find a supplier for glaze.',
    'Make a cake for the office party.', // a kind of place, but no list of them
    'Prepare the cake options for office orders.',
  ]) assert.equal(findsCustomers(move(text)), false, text);
  // Only the way's own first week: the chief's moves become cards through its own proposals, and setup moves are checked by records.
  assert.equal(findsCustomers(move('Build a list of possible cafes in Pune', 'chief')), false);
  assert.equal(findsCustomers(move('Build a list of possible cafes in Pune', 'setup')), false);
  assert.equal(findsCustomers(move('Build a list of possible cafes in Pune', 'way', { check: 'first-client' })), false);
  assert.equal(findsCustomers(move('Build a list of possible cafes in Pune', 'way', { proposalId: 'proposal_1' })), false);
});

test('the next best step for such a move opens Find customers; any other move still says Done', () => {
  const finds = move('Build a list of possible cafes in Pune');
  const view = step(finds);
  assert.deepEqual(view.action, { id: 'go', label: 'Find customers', link: '#/clients/pipeline?sheet=find:new' });
  assert.deepEqual(view.action, { id: 'go', ...FIND_PLACE });
  assert.equal(view.line, 'Chausar looks only after you approve the search. You can still mark this done under This week.');
  assert.equal(view.by, 'records');
  assert.ok(!/[\u2014\u2013]/.test(view.line!));
  const other = move('Photograph three sample sets.');
  assert.deepEqual(step(other).action, { id: 'done', label: STEP_WORDS.done, moveId: other.id });
  assert.equal(step(other).line, null);
});

test('it is the step only once what is sold is ready: until then the step is to finish that', () => {
  const facts: PlanFacts = { today: '2026-11-15', accepted: true, ready: false, missing: ['Set your price for Cafe mug sets.'], clients: 0, invoicesIssued: 0, payments: 0, firstWeek: ['Build a list of possible cafes in Pune'], proposals: {} };
  const moves = [move('Build a list of possible cafes in Pune')];
  assert.equal(nextStepOf({ facts, row: null, planRowId: null, overdue: null, moves }).kind, 'offer');
  assert.deepEqual(nextStepOf({ facts: { ...facts, ready: true, missing: [] }, row: null, planRowId: null, overdue: null, moves }), { kind: 'move', moveId: moves[0]!.id, title: moves[0]!.text });
});
