// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makePinnedLocalTranscript } from '../runtime/venture/playbooks/youtube/transcribe.ts';
import { owner } from './venture-judge-helpers.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';
test('a tier verifies the actual model bytes before starting transcription, and hosted refuses', async () => {
  let called = false;
  const deps = { host: 'test', services: { speech: { localTranscriber: () => ({ ready: true, providerId: 'local' }), localTranscriptionFiles: () => ({ providerId: 'local', model: import.meta.filename, command: import.meta.filename }), transcribeFile: () => { called = true; throw new Error('must not run'); } } } } as unknown as VentureDeps;
  const input = { cutFile: import.meta.filename, prompt: 'Glossary: Chausar.', tier: 'draft' as const, voiceActivity: [{ startMs: 0, endMs: 1000 }] };
  await assert.rejects(() => makePinnedLocalTranscript(deps, owner, input), { code: 'MODEL_HASH_MISMATCH' });
  assert.equal(called, false);
  await assert.rejects(() => makePinnedLocalTranscript({ ...deps, host: 'hosted-web' }, owner, input), { code: 'TIER_UNAVAILABLE' });
});
