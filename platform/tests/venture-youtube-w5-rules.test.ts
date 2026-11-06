// Chausar 5B1 regression tests. Tomada (AGPL, ideas only), Kimo (MIT), FilmCraft (MIT/Apache-2.0); original tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLATFORM_RULES, validatePlatformRules } from '../runtime/venture/playbooks/youtube/platform-rules.ts';
test('caption and cleanup rows are dated, labelled house or platform, and require no invented legal confirmation', () => {
  for (const id of ['caption-formats', 'caption-profile', 'cleanup-thresholds']) {
    const rule = PLATFORM_RULES.find(rule => rule.id === id);
    assert.ok(rule, id);
    assert.equal(rule.checkedOn, '2026-10-27');
    assert.equal(rule.needs, null);
    assert.ok(rule.usedBy.includes('edit'));
  }
  assert.doesNotThrow(() => validatePlatformRules(PLATFORM_RULES));
});
