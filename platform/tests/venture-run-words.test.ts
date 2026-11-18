// Fix round 7 (re-check 6, item 5): the words views/run-words.ts holds for the app to say in the owner's language are
// exactly the words the engine writes, so a change to one cannot leave the other behind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECEIPT_WORDS as RECEIPT_EXPORT, usageWords } from '../runtime/venture/money/model-receipt.ts';
import { RECEIPT_WORDS, RUN_FIXED_WORDS, RUN_TEMPLATE_WORDS, SERVICE_STEPS, stepKey } from '../runtime/venture/views/run-words.ts';
import { serviceTemplate } from '../runtime/venture/core/service-types.ts';
import { SERVICE_TYPES } from '../runtime/venture/contracts.ts';
import { OWN_PLAN_WORDS } from '../runtime/venture/models/own-plan.ts';
import { checkLine } from '../runtime/venture/delivery/verdicts.ts';
import { fillWords } from '../runtime/venture/views/card-words.ts';

test('run words: every service type\'s starting steps are listed once, each with its own pack name', () => {
  const steps = new Set(SERVICE_TYPES.flatMap(type => serviceTemplate(type).steps));
  assert.deepEqual([...SERVICE_STEPS].sort(), [...steps].sort());
  assert.equal(new Set(SERVICE_STEPS.map(stepKey)).size, SERVICE_STEPS.length);
  assert.equal(stepKey('Do the hands-on work'), 'do-the-hands-on-work');
});

test('run words: the receipt, the own-plan spend and the check lines are the engine\'s own words', () => {
  assert.equal(RECEIPT_EXPORT, RECEIPT_WORDS);
  assert.equal(usageWords({ inputTokens: 80531, outputTokens: 787 }, 'IN'), fillWords(RUN_TEMPLATE_WORDS.usage, { input: '80,531', output: '787' }));
  assert.equal(OWN_PLAN_WORDS, RUN_FIXED_WORDS.ownPlan);
  assert.equal(checkLine('pass', 'Every required section is there.'), fillWords(RUN_TEMPLATE_WORDS.checkPass, { detail: 'Every required section is there.' }));
  assert.equal(checkLine('fail', 'x'), fillWords(RUN_TEMPLATE_WORDS.checkFail, { detail: 'x' }));
  assert.equal(checkLine('not-run', 'x'), fillWords(RUN_TEMPLATE_WORDS.checkNotRun, { detail: 'x' }));
  assert.equal(checkLine('not-checked', 'x'), fillWords(RUN_TEMPLATE_WORDS.checkNotChecked, { detail: 'x' }));
});
