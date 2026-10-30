// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRANSCRIPT_MODELS, tierTranscript, modelDownloadHandoff } from '../runtime/venture/playbooks/youtube/tiers.ts';
test('each transcript tier records verified model provenance and drops segments outside voice activity', () => {
  for (const tier of ['draft', 'final', 'refined'] as const) {
    const pin = TRANSCRIPT_MODELS[tier];
    const result = tierTranscript({ tier, whisperVersion: 'whisper.cpp v1.8.2', modelSha256: pin.sha256,
      segments: [{ id: 's1', text: 'Actual speech', startMs: 0, endMs: 1000 }, { id: 's2', text: 'Invented silence', startMs: 4000, endMs: 5000 }],
      voiceActivity: [{ startMs: 0, endMs: 1200 }] });
    assert.equal(result.tier, tier);
    assert.equal(result.modelSha256, pin.sha256);
    assert.equal(result.whisperVersion, 'whisper.cpp v1.8.2');
    assert.deepEqual(result.segments.map(segment => segment.text), ['Actual speech']);
    assert.throws(() => tierTranscript({ ...result, modelSha256: '0'.repeat(64), voiceActivity: [] }), { code: 'MODEL_HASH_MISMATCH' });
  }
});
test('model downloads are an owner-confirmed desktop handoff to a revision-pinned file', () => {
  assert.throws(() => modelDownloadHandoff('draft', false, false), { code: 'APP_APPROVAL_REQUIRED' });
  assert.throws(() => modelDownloadHandoff('draft', true, true), { code: 'TIER_UNAVAILABLE' });
  const handoff = modelDownloadHandoff('draft', true, false);
  assert.ok(handoff.url.includes(handoff.revision));
  assert.ok(handoff.bytes > 0);
  assert.equal(handoff.licence, 'MIT');
});
