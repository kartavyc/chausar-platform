// Seen in the real app on Windows (17 Nov 2026, re-check 027): the owner wrote "Proposals that find customers first",
// their AI named both the exact kind and its wider kind (first: find-customers, proposal), and the box read "proposals
// that find customers first, then proposals". The wider kind after its exact one leads only the rest of its kind, so
// code says "other proposals"; the exact kind after its wider one would lead nothing, so code keeps only the wider; and
// the AI is told to name only the kinds the words name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleDoes, ruleLine, triageTask, validateRule } from '../runtime/venture/views/triage.ts';

test('a wider kind after its exact kind reads "other proposals"', () => {
  const rule = validateRule({ first: ['find-customers', 'proposal'], keys: [] }, 'Proposals that find customers first', 'MODEL_OUTPUT_REJECTED');
  assert.equal(ruleDoes(rule), 'proposals that find customers first, then other proposals');
  assert.equal(ruleLine(rule), 'Today is ordered: proposals that find customers first, then other proposals. Nothing is hidden.');
  assert.equal(ruleDoes({ first: ['find-customers', 'draft', 'proposal'], keys: [], words: 'x' }), 'proposals that find customers first, then drafts, then other proposals');
});

test('an exact kind named after its wider kind leads nothing, so code keeps the wider one only', () => {
  const rule = validateRule({ first: ['proposal', 'find-customers'], keys: [] }, 'Proposals first', 'MODEL_OUTPUT_REJECTED');
  assert.deepEqual(rule.first, ['proposal']);
  assert.equal(ruleDoes(rule), 'proposals first');
});

test('the AI is told to name only the kinds the owner\'s words name', () => {
  assert.match(triageTask('Proposals that find customers first').instructions, /only those the words name/);
});
