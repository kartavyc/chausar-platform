import test from 'node:test';
import assert from 'node:assert/strict';
import { toolCeiling } from '../runtime/venture/delivery/harness/patches.ts';
import { YOUTUBE_STEPS } from '../runtime/venture/playbooks/youtube/playbook.ts';

test('every active YouTube step tool is permitted only for the appropriate playbook', () => {
  const youtube = toolCeiling('studio', 'youtube');
  const ordinary = toolCeiling('studio');
  for (const name of new Set(YOUTUBE_STEPS.flatMap(step => step.tools))) {
    assert.ok(youtube.includes(name), name + ' must be granted to YouTube');
    if (name.startsWith('youtube.')) assert.equal(ordinary.includes(name), false, name + ' must remain YouTube-only');
  }
});
