// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import '../runtime/venture/delivery/harness/tools.ts';
import { YOUTUBE_TOOLS } from '../runtime/venture/delivery/harness/tools-youtube.ts';
import { YOUTUBE_STEPS } from '../runtime/venture/playbooks/youtube/playbook.ts';
import { toolCeiling } from '../runtime/venture/delivery/harness/patches.ts';
test('the Cutter holds every built word-edit tool and the flagship ceiling grants them', () => {
  const cutter = YOUTUBE_STEPS.find(step => step.role.kind === 'agent' && step.role.name === 'Cutter');
  assert.ok(cutter);
  for (const name of ['youtube.editOps', 'youtube.clean', 'youtube.captions', 'youtube.coverage', 'youtube.dictionary'] as const) {
    assert.ok(YOUTUBE_TOOLS[name]);
    assert.ok(cutter.tools.includes(name));
    assert.ok(toolCeiling('studio', 'youtube').includes(name));
  }
});
