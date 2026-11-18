// One-shot B1 (hands-on row 100; A4 review L4): Practice's words. "Practice drafts are not for clients. Move to approve
// each to use drafts." did not say what to move or where; "Cost: Ran on your own plan." read as two broken sentences.
// Windows, 16 Nov 2026: B1's own answer, "set How much it asks you to Approve each", named a setting the app no longer
// shows by that name. The setting is the Stage (Practice or Live), so the words say go live, and the app links there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRACTICE_REASON } from '../runtime/venture/delivery/runs.ts';
import { RAN_ON_OWN_PLAN } from '../runtime/venture/delivery/simulate.ts';
import { STAGE_PLACE } from '../runtime/venture/core/launch-stage.ts';
import { refusal } from '../runtime/venture/delivery/run-machine.ts';

test('a practice draft says why it never goes out, and the setting that changes it', () => {
  assert.equal(PRACTICE_REASON, 'This is a practice draft, so it never goes to a client. To use drafts, go live.');
  assert.equal(STAGE_PLACE, '#/business/practice');
  assert.equal(refusal('accept', { status: 'ready-for-review', practice: true } as never)?.line, PRACTICE_REASON, 'the run machine says the same words');
});

test('a run on the owner\'s own AI plan reads as a cost: nothing extra', () => {
  assert.equal(RAN_ON_OWN_PLAN, 'Nothing extra, it ran on your own AI plan.');
});
