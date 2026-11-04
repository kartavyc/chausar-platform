// One-shot B1 (W6-ALL-IDEAS section 4, "Stiff or confused replies" and "Tool jargon"): an agent's reply to a standing
// order and the launch checklist in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDING_REPLY } from '../runtime/venture/agents/proposals.ts';
import { readFileSync } from 'node:fs';

test('an agent answers a standing order plainly', () => {
  assert.equal(STANDING_REPLY, "Got it. I've proposed it as a new rule for you to approve.");
});

test('the launch checklist says what to do, not which tool to open', () => {
  const source = readFileSync(new URL('../runtime/venture/core/checklist.ts', import.meta.url), 'utf8');
  assert.match(source, /label: 'Build your website'/);
  assert.doesNotMatch(source, /Open it in Lovable or Replit/);
});

// Hands-on bug 19: the run sheet said "in rehearsal" for a normal order. That is the agent's setting (How much it asks
// you), not the order, so the scope line now says it as the agent's.
test("a run's scope line says the agent's setting, never that the order is a rehearsal", async () => {
  const { RUN_SCOPE_POSTURE } = await import('../runtime/venture/views/runs.ts');
  assert.deepEqual(RUN_SCOPE_POSTURE, {
    rehearsal: 'with the agent still rehearsing', shadow: 'with the agent practising on real orders',
    'approve-each': 'with each step waiting for your approval', 'auto-spot-check': 'on auto with spot checks',
  });
});

// SCREENS P1 (shot 18): the Keeper's job list on Away said "The check of actions whose outcome is unknown".
test("Away names the Keeper's journal check in plain words", () => {
  const source = readFileSync(new URL('../runtime/venture/delivery/away.ts', import.meta.url), 'utf8');
  assert.match(source, /'journal-sweep': 'Checking anything that may not have gone through'/);
  assert.doesNotMatch(source, /outcome is unknown/);
});
