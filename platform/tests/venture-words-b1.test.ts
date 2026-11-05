// One-shot B1 (W6-ALL-IDEAS section 4, "Stiff or confused replies" and "Tool jargon"): an agent's reply to a standing
// order and the launch checklist in plain words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STANDING_REPLY } from '../runtime/venture/agents/proposals.ts';
import { CHECKLIST_ITEMS } from '../runtime/venture/core/checklist.ts';
import { KEEPER_WORDS as AWAY_JOB_WORDS } from '../runtime/venture/delivery/away.ts';

test('an agent answers a standing order plainly', () => {
  assert.equal(STANDING_REPLY, "Got it. I've proposed it as a new rule for you to approve.");
});

test('the launch checklist says what to do, not which tool to open', () => {
  // B1 fix round 1 (spec 9): the checklist itself, not its source text.
  assert.equal(CHECKLIST_ITEMS.find(item => item.id === 'builder')?.label, 'Build your website');
  assert.equal(CHECKLIST_ITEMS.some(item => /Lovable|Replit/.test(item.label)), false);
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
  assert.equal(AWAY_JOB_WORDS['journal-sweep'], 'Checking anything that may not have gone through');
  assert.equal(Object.values(AWAY_JOB_WORDS).some(line => /outcome is unknown/.test(line)), false);
});
