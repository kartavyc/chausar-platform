// D2 task 15: each place that used to write a changing part into a model task's instructions now keeps a fixed line
// there and puts the changing part in the input. One test per place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actTask, AWAITING_APPROVAL, DEFAULT_LIMITS, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import { REPAIR_LINE, repairReason, repairWords } from '../runtime/venture/delivery/harness/repair.ts';
import { composeTask, decideTask } from '../runtime/venture/core/compose.ts';
import { countryProfile } from '../runtime/venture/core/countries.ts';
import { SUGGEST_REPAIR_LINE, suggestRepairTask } from '../runtime/venture/core/suggest.ts';
import { briefFillTask } from '../runtime/venture/build/brief.ts';

const context = { serviceType: 'bookkeeping', offer: { name: 'Monthly books', description: 'Books.' }, clientRequest: 'Close my books', playbook: { steps: [] },
  dictionaryManifest: 'm', files: [], containsClientData: true, allowed: [] } as never;

function waiting(callId: string, reason: string | null) {
  const state = newHarnessState(['outbox.propose'] as never, DEFAULT_LIMITS, []);
  state.toolCalls = [{ id: callId, turn: 1, tool: 'outbox.propose', input: {}, outcome: 'succeeded', envelope: { ok: true, result: {} } }] as never;
  if (reason) (state as { repairs?: unknown }).repairs = [{ turn: 1, reason }];
  return state;
}

test('withAwaiting: the waiting calls are listed in the input only; the instructions keep the fixed line', () => {
  const one = actTask(context, waiting('call_one', null)), two = actTask(context, waiting('call_two', null));
  assert.equal(one.instructions, two.instructions);
  assert.ok(one.instructions.includes(`${AWAITING_APPROVAL} They are listed in awaitingApproval. Never say they were sent or done.`));
  assert.doesNotMatch(one.instructions, /call_one/);
  assert.deepEqual((one.input as { awaitingApproval: unknown }).awaitingApproval, { note: AWAITING_APPROVAL, calls: [{ call: 'call_one', tool: 'outbox.propose' }] });
});

test('the harness repair turn: the reason rides in the input; the instructions carry the fixed repair line once', () => {
  const state = waiting('call_one', 'The calls field was not a list.');
  assert.equal(repairWords(state), REPAIR_LINE);
  assert.equal(repairReason(state), 'The calls field was not a list.');
  const task = actTask(context, state);
  assert.ok(task.instructions.includes(REPAIR_LINE));
  assert.doesNotMatch(task.instructions, /not a list/);
  assert.deepEqual((task.input as { repair: unknown }).repair, { reason: 'The calls field was not a list.' });
  assert.equal(actTask(context, waiting('call_one', 'Another reason entirely.')).instructions, task.instructions);
});

test('onboarding decide and compose repairs: a fixed repair line; the problem stays in the input', () => {
  const india = countryProfile('IN');
  const first = decideTask('Books for cafes', india, 'The zebra view was not listed.'), second = decideTask('Books for cafes', india, 'The kind was not listed.');
  assert.equal(first.instructions, second.instructions);
  assert.match(first.instructions, /Your last answer was refused for the reason given as problem in the input\./);
  assert.doesNotMatch(first.instructions, /zebra/);
  assert.equal((first.input as { problem: string }).problem, 'The zebra view was not listed.');
  const decision = { text: 'Books for cafes', country: india, kind: 'service', family: { value: 'bookkeeping' }, reading: { value: 'Books' }, views: ['offers-first', 'pages'] } as never;
  const composed = composeTask(decision, 'A step had no title.');
  assert.equal(composed.instructions, composeTask(decision, 'An offer had no name.').instructions);
  assert.equal((composed.input as { problem: string }).problem, 'A step had no title.');
});

test('the plan suggestion repair: a fixed line; why the answer was refused is in the input', () => {
  const task = { purpose: 'plan-suggest', instructions: 'Fixed.', input: { ask: 'x' }, schemaName: 's', schema: {}, validate: (raw: unknown) => raw, containsClientData: false, maxOutputTokens: 256 } as never;
  const repaired = suggestRepairTask(task, 'An offer was not in the plan.');
  assert.equal(repaired.instructions, `Fixed. ${SUGGEST_REPAIR_LINE}`);
  assert.deepEqual(repaired.input, { ask: 'x', lastAnswerRefusedBecause: 'An offer was not in the plan.' });
  assert.equal(suggestRepairTask(task, 'Something else.').instructions, repaired.instructions);
});

test('the brief fill: a fixed line; the fields still to write are in the input as writeOnly', () => {
  const base = { purpose: 'brief', instructions: 'Brief.', input: { name: 'Cafe Books' }, schemaName: 'venture-brief', schema: {}, validate: (raw: unknown) => raw, containsClientData: false, maxOutputTokens: 1024 } as never;
  const words = { whatToBuild: 'A booking page', whoItIsFor: '', lookAndFeel: '', pages: [] } as never;
  const one = briefFillTask(base, ['whoItIsFor'], words, () => words), both = briefFillTask(base, ['whoItIsFor', 'lookAndFeel'], words, () => words);
  assert.equal(one.instructions, both.instructions);
  assert.equal(one.instructions, 'Brief. Write only the fields listed in writeOnly; the rest of the brief is written.');
  assert.deepEqual((one.input as { writeOnly: string[] }).writeOnly, ['who it is for']);
  assert.deepEqual((both.input as { writeOnly: string[] }).writeOnly, ['who it is for', 'how it should look and feel']);
});
