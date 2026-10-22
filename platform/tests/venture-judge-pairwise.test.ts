// Pairwise comparison tests: the judge sees two options, the order is randomised and then swapped so a preference
// for whichever comes first cancels out, and code tallies the rounds. No network: the model is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelTask } from '../runtime/venture/contracts.ts';
import { comparePair, pairwiseTask, pickBest, validatePairVote, type PairVote } from '../runtime/venture/delivery/judge/pairwise.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const A = { id: 'hook-a', text: 'A good hook that names the problem.' };
const B = { id: 'hook-b', text: 'A plain hook.' };

/** A stub judge: picks by what it is shown. Records what it saw. */
function judge(pick: (first: string, second: string) => PairVote['choice']) {
  const seen: [string, string][] = [];
  let calls = 0;
  const ask = async (task: ModelTask<PairVote>) => {
    const input = task.input as { first: string; second: string };
    seen.push([input.first, input.second]);
    calls += 1;
    return { value: task.validate({ choice: pick(input.first, input.second), reason: 'Plain reason.' }), callId: `call_${calls}` };
  };
  return { ask, seen };
}
const prefersGood = (first: string, second: string) => first.includes('good') ? 'first' : second.includes('good') ? 'second' : 'tie';

test('pairwise: the task shows two options and asks for first, second or tie, never a score', () => {
  const task = pairwiseTask({ question: 'Which hook will a viewer keep watching?', criteria: ['Names the problem'], first: A.text, second: B.text, containsClientData: false });
  assert.equal(task.purpose, 'judge');
  const schema = JSON.stringify(task.schema);
  assert.ok(schema.includes('"first"') && schema.includes('"second"') && schema.includes('"tie"'));
  assert.ok(!/"number"|"integer"/.test(schema));
  assert.deepEqual(task.input, { question: 'Which hook will a viewer keep watching?', criteria: ['Names the problem'], first: A.text, second: B.text });
  assert.deepEqual(validatePairVote({ choice: 'tie', reason: 'Both fine.' }), { choice: 'tie', reason: 'Both fine.' });
  for (const bad of [{ choice: 'both', reason: 'x' }, { choice: 'first' }, { choice: 'first', reason: 'x', score: 'high' }, null, []]) {
    assert.throws(() => validatePairVote(bad), code('MODEL_OUTPUT_REJECTED'), JSON.stringify(bad));
  }
});

test('pairwise: each round asks twice with the order swapped, and a consistent preference wins the round', async () => {
  const stub = judge(prefersGood);
  const result = await comparePair(stub.ask, { question: 'Which hook is better?', a: A, b: B, containsClientData: false }, { rounds: 2, random: () => 0.9 });
  assert.equal(stub.seen.length, 4);
  for (const index of [0, 2]) assert.deepEqual(stub.seen[index + 1], [stub.seen[index][1], stub.seen[index][0]], 'the second ask swaps the order');
  assert.deepEqual(stub.seen[0], [B.text, A.text], 'a high random draw shows b first');
  assert.deepEqual([result.aWins, result.bWins, result.ties, result.splits], [2, 0, 0, 0]);
  assert.equal(result.winner, 'hook-a');
  assert.deepEqual(result.rounds.map(round => round.result), ['a', 'a']);
  assert.deepEqual(result.rounds[0].callIds, ['call_1', 'call_2']);
  assert.match(result.detail, /hook-a/);
});

test('pairwise: a judge that always picks whatever comes first wins nothing; the swap cancels it', async () => {
  const stub = judge(() => 'first');
  const result = await comparePair(stub.ask, { question: 'Which hook is better?', a: A, b: B, containsClientData: false }, { rounds: 3, random: () => 0.1 });
  assert.deepEqual(stub.seen[0], [A.text, B.text], 'a low random draw shows a first');
  assert.deepEqual([result.aWins, result.bWins, result.ties, result.splits], [0, 0, 0, 3]);
  assert.equal(result.winner, null);
  assert.match(result.detail, /order/);
  const ties = await comparePair(judge(() => 'tie').ask, { question: 'q', a: A, b: B, containsClientData: false }, { rounds: 1 });
  assert.deepEqual([ties.aWins, ties.bWins, ties.ties, ties.splits, ties.winner], [0, 0, 1, 0, null]);
  await assert.rejects(() => comparePair(stub.ask, { question: 'q', a: A, b: A, containsClientData: false }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(() => comparePair(stub.ask, { question: 'q', a: A, b: B, containsClientData: false }, { rounds: 0 }), code('INVALID_VENTURE_REQUEST'));
});

test('pairwise: pickBest compares every pair and code counts the wins; no clear winner gives none', async () => {
  const options = [{ id: 'short', text: 'Hi.' }, { id: 'longest', text: 'A much longer and clearer title.' }, { id: 'middle', text: 'A clear title.' }];
  const longer = (first: string, second: string) => first.length > second.length ? 'first' : second.length > first.length ? 'second' : 'tie';
  const stub = judge(longer);
  const best = await pickBest(stub.ask, { question: 'Which title is clearer?', options, containsClientData: false }, { rounds: 1, random: () => 0.5 });
  assert.equal(stub.seen.length, 6, 'three pairs, two asks each');
  assert.deepEqual(best.wins, { short: 0, longest: 2, middle: 1 });
  assert.equal(best.winner, 'longest');
  const flat = await pickBest(judge(() => 'tie').ask, { question: 'q', options, containsClientData: false });
  assert.equal(flat.winner, null);
  await assert.rejects(() => pickBest(stub.ask, { question: 'q', options: [options[0]], containsClientData: false }), code('INVALID_VENTURE_REQUEST'));
});
