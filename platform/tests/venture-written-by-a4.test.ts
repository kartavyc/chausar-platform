// One-shot A4 (A3 leftover): a native agent job writes no model call record of its own, so its draft's "Written by" line
// is read from the job's own route (the preset and the model the job ran on), and only once the job handed it over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { modelLabel, writtenByLine } from '../runtime/venture/models/written-by.ts';

const state = { conversations: [] } as never;
const job = (agentJob: Record<string, unknown>) => ({ servedBy: 'model' as const, callId: null, agentJob: { scope: {}, sourceDigest: 'x', draftDigest: 'y', proposal: null, messages: [], tools: [], ...agentJob } as never });

test('a native Codex or Claude Code draft says which model wrote it, through which tool', () => {
  assert.equal(writtenByLine(state, job({ reviewReady: true, model: 'gpt-6-luna', route: { presetId: 'codex-cli', model: 'gpt-6-luna', tier: 'main' } })), `Written by ${modelLabel('gpt-6-luna')} through Codex`);
  assert.equal(writtenByLine(state, job({ reviewReady: true, model: 'claude-sonnet-5-5', route: { presetId: 'claude-code-cli', model: 'claude-sonnet-5-5', tier: 'main' } })), `Written by ${modelLabel('claude-sonnet-5-5')} through Claude Code`);
  // The model the tool reported wins over the one asked for.
  assert.equal(writtenByLine(state, job({ reviewReady: true, model: 'gpt-6.1-terra', route: { presetId: 'codex-cli', model: 'gpt-6-luna', tier: 'main' } })), `Written by ${modelLabel('gpt-6.1-terra')} through Codex`);
  // A tool that did not report a model says so, by its route's preset.
  assert.equal(writtenByLine(state, job({ reviewReady: true, route: { presetId: 'codex-cli', model: '', tier: 'main' } })), 'Written by Codex on this computer. It did not report the model.');
});

test('nothing is claimed before the job handed its draft over, or for a job with no route', () => {
  assert.equal(writtenByLine(state, job({ model: 'gpt-6-luna', route: { presetId: 'codex-cli', model: 'gpt-6-luna', tier: 'main' } })), null);
  assert.equal(writtenByLine(state, job({ reviewReady: true })), null);
});
