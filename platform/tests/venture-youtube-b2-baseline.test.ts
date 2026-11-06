// Chausar 5B2 deterministic finishing baseline; original tests over the live checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadYoutubeBaseline, runYoutubeBaseline, YOUTUBE_DRAFT_RULES } from '../runtime/venture/playbooks/youtube/judge.ts';
test('finishing baseline includes real clip, commentary and b-roll checks and the required judge floors', async () => {
  const file = await loadYoutubeBaseline();
  for (const id of ['short-clip-rules', 'compilation-commentary', 'broll-licensed']) assert.ok(file.cases.some(row => row.id === id), id);
  assert.deepEqual(YOUTUBE_DRAFT_RULES.find(rule => rule.id === 'clip-stands-alone')?.floor, { kind: 'share', percent: 75 });
  assert.deepEqual(YOUTUBE_DRAFT_RULES.find(rule => rule.id === 'broll-fits-claim')?.floor, { kind: 'required-yes' });
  assert.equal((await runYoutubeBaseline(file)).ok, true);
  for (const id of ['short-clip-rules', 'compilation-commentary', 'broll-licensed']) {
    const changed = structuredClone(file);
    const row = changed.cases.find(row => row.id === id)!;
    row.sources[0]!.text = '{}';
    const result = await runYoutubeBaseline(changed);
    assert.equal(result.cases.find(row => row.id === id)!.passed, false, id);
  }
});
