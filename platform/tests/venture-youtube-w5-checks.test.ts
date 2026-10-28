// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runFlagshipChecks, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';
test('a completed caption tool with invalid cues fails the real draft verification gate', async () => {
  const input = { flagship: 'youtube', offerKey: 'episode-package', servedBy: 'model', mode: 'client', today: '2026-10-27', dateOrder: 'DMY', intake: null,
    deliverable: { title: 'Coffee video', questionsForClient: [], sections: [{ heading: 'Title and thumbnail', parts: [{ kind: 'text', text: 'Title: Make good coffee' }, { kind: 'text', text: 'Thumbnail: Fresh beans' }] }] }, files: [], receipts: [], known: [], finishing: null,
    toolCalls: [{ tool: 'youtube.captions', outcome: 'succeeded', envelope: { ok: true, result: { findings: [{ code: 'too-fast', cueId: 'c1' }], notRun: [] } } }],
  } as unknown as FlagshipCheckInput;
  const results = await runFlagshipChecks(input);
  assert.equal(results.find(result => result.check === 'caption-file')?.outcome, 'fail');
});



test('caption offers list missing measured checks honestly without requiring a script on an unscripted order', async () => {
  const input = { flagship: 'youtube', offerKey: 'shorts-from-own-video', servedBy: 'model', mode: 'client', today: '2026-10-27', dateOrder: 'DMY', intake: null,
    deliverable: { title: 'Coffee clips', questionsForClient: [], sections: [{ heading: 'Title and thumbnail', parts: [{ kind: 'text', text: 'Title: Make good coffee' }, { kind: 'text', text: 'Thumbnail: Fresh beans' }] }] }, files: [], receipts: [], known: [], finishing: null, toolCalls: [],
  } as unknown as FlagshipCheckInput;
  const results = await runFlagshipChecks(input);
  assert.equal(results.find(result => result.check === 'caption-file')?.outcome, 'not-run');
  assert.equal(results.find(result => result.check === 'cleanup')?.outcome, 'not-run');
  assert.equal(results.find(result => result.check === 'script-coverage'), undefined);
});
