// One-shot B1 (hands-on row 100; A4 review L4): Practice's words. "Practice drafts are not for clients. Move to approve
// each to use drafts." did not say what to move or where; "Cost: Ran on your own plan." read as two broken sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_REASON } from '../runtime/venture/delivery/runs.ts';
import { RAN_ON_OWN_PLAN } from '../runtime/venture/delivery/simulate.ts';

test('a practice draft says why it never goes out, and the setting that changes it', () => {
  assert.equal(PRACTICE_REASON, 'This is a practice draft, so it never goes to a client. To use drafts, set How much it asks you to Approve each.');
});

test('a run on the owner\'s own AI plan reads as a cost: nothing extra', () => {
  assert.equal(RAN_ON_OWN_PLAN, 'Nothing extra, it ran on your own AI plan.');
});
