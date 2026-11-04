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
