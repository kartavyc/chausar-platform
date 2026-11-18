import test from 'node:test';
import assert from 'node:assert/strict';
import { expireQuestions } from '../runtime/venture/delivery/timed-questions.ts';
import { askOwner, OWNER_WAIT_LIMIT_MS, RUN_TRANSITIONS, startJob, type RunSeed } from '../runtime/venture/delivery/run-machine.ts';

// An AI job's waits on the owner have no clock, on purpose (run-machine.ts OWNER_WAIT_LIMIT_MS says why). The old round
// loop's 24 hour question window went with the loop.
test('no wait on the owner runs out: the tick stops no run, and the machine has no move that would', async () => {
  assert.deepEqual(OWNER_WAIT_LIMIT_MS, { 'needs-answer': null, 'ready-for-review': null, 'step-approval': null });
  assert.deepEqual(await expireQuestions({} as never, {} as never), []);
  // The only ways out of a pending question are the owner's: an answer, a stop, or erasing the data.
  const leaves = Object.entries(RUN_TRANSITIONS).filter(([, rule]) => rule.from.length < 9 && rule.from.includes('needs-answer')).map(([event]) => event).sort();
  assert.deepEqual(leaves, ['ownerAnswered', 'stopByOwner', 'supersede']);
});

test('a question for a missing fact stays pending for as long as it takes', () => {
  const seed = { id: 'run_1', kind: 'venture-delivery-run', ventureId: 'v', memberId: 'm', epoch: 1, at: '2026-10-16T10:00:00.000Z', orderId: 'o', playbookId: 'p', playbookHash: 'h',
    servedBy: 'model', practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], editedText: null,
    agentJob: { scope: { jobId: 'j' }, sourceDigest: 's', draftDigest: null, proposal: null, messages: [], tools: [] } } as unknown as RunSeed;
  const asked = askOwner(startJob(seed), { digest: 'q', missing: [], question: 'Confirm the current facts.', callId: 'calculation-1', at: '2026-10-16T10:00:00.000Z' });
  assert.equal(asked.status, 'needs-answer');
  assert.equal(asked.agentJob!.pendingFacts!.question, 'Confirm the current facts.');
  assert.equal('expiresAt' in asked.agentJob!.pendingFacts!, false, 'it carries no expiry');
});
