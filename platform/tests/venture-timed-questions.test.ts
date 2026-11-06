import test from 'node:test';
import assert from 'node:assert/strict';
import { noAnswerLine, questionWindowMs, withQuestionExpiry } from '../runtime/venture/delivery/timed-questions.ts';
import { newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';

// These helpers remain for rehearsal playbooks. Native jobs use their tool session and durable fact questions.
test('rehearsal question windows retain explicit playbook timing and a safe UTC display without a country', () => {
  const hour = 3_600_000;
  const step = (timeoutMs?: number) => ({ steps: [{ id: 'ask', kind: 'question' as const, title: 'Ask', tier: 'code' as const, model: null, doneBy: 'agent' as const, requiredSections: [], checks: [], ...(timeoutMs === undefined ? {} : { timeoutMs }) }] });
  assert.equal(questionWindowMs(null), 24 * hour);
  assert.equal(questionWindowMs(step()), 24 * hour);
  assert.equal(questionWindowMs(step(2 * hour)), 2 * hour);
  assert.equal(questionWindowMs(step(1000)), 15 * 60_000);
  assert.equal(noAnswerLine('2026-10-17T10:00:00.000Z', { country: null } as never), 'No answer by 2026-10-17, 10:00 am. Go on without it, or stop.');
});

test('rehearsal question stamping never adds expiry to a trusted missing-facts question', () => {
  const state = newHarnessState([], { maxTurns: 4, maxToolCalls: 12, maxCallsPerTurn: 4, maxCostMicros: '250000', keepOutputs: 6, stubChars: 600 }, []);
  state.handoffs = [{ to: 'client', question: 'Confirm the current facts.', answer: null, answeredBy: null, turn: 1, expiresAt: null }];
  assert.equal(withQuestionExpiry(state, '2026-10-16T10:00:00.000Z', 86400000).handoffs[0].expiresAt, null);
});
