// C7 task 2: the plan meter kept for one engine. A used-up failure marks the tool used up with no reset known, for 30
// minutes; a later reading that is not used up clears it; an API key's preset has no plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanBook, USED_UP_HOLD_MS, planBookOf, planCliOf } from '../runtime/venture/models/plan-book.ts';
import { fromCodexLimits } from '../runtime/venture/models/plan-meter.ts';

test('a used-up failure marks the tool used up, reset unknown, then is looked at again after the hold', () => {
  const book = new PlanBook(), at = '2026-11-06T10:00:00.000Z';
  assert.equal(book.read('codex', at).state, 'unknown');
  book.failed('codex', 'usage-limit', at);
  const held = book.read('codex', '2026-11-06T10:10:00.000Z');
  assert.equal(held.state, 'used-up'); assert.deepEqual(held.windows, []); assert.equal(held.readAt, at);
  assert.equal(book.read('claude-code', '2026-11-06T10:10:00.000Z').state, 'unknown');
  assert.equal(book.read('codex', new Date(Date.parse(at) + USED_UP_HOLD_MS).toISOString()).state, 'unknown');
  const other = new PlanBook(); other.failed('codex', 'stream-cut', at);
  assert.equal(other.read('codex', '2026-11-06T10:01:00.000Z').state, 'unknown');
});

test('a later reading that is not used up clears the mark; one book per engine object', () => {
  const book = new PlanBook(), at = '2026-11-06T10:00:00.000Z';
  book.failed('codex', 'usage-limit', at);
  const reset = Math.floor(Date.parse('2026-11-06T15:00:00Z') / 1000);
  book.note(fromCodexLimits({ rateLimits: { primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: reset } } }, '2026-11-06T10:05:00.000Z'));
  assert.equal(book.read('codex', '2026-11-06T10:06:00.000Z').state, 'ok');
  const key = {};
  assert.equal(planBookOf(key), planBookOf(key)); assert.notEqual(planBookOf(key), planBookOf({}));
  assert.equal(planCliOf('codex-cli'), 'codex'); assert.equal(planCliOf('claude-code-cli'), 'claude-code'); assert.equal(planCliOf('openai-gpt-6-luna'), null);
});
