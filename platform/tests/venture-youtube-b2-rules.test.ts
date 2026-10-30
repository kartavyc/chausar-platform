// Chausar 5B2 finishing rule provenance, original tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORM_RULES, validatePlatformRules } from '../runtime/venture/playbooks/youtube/platform-rules.ts';
import { SAFE_ZONES, FINISHING_HOUSE } from '../runtime/venture/playbooks/youtube/finishing-extra.ts';
test('the finishing code reads dated house values with explicit platform verification limits', () => {
  validatePlatformRules(PLATFORM_RULES);
  const house = PLATFORM_RULES.find(rule => rule.id === 'finishing-house');
  assert.ok(house, 'finishing-house');
  assert.equal(house.needs, null);
  assert.equal(house.limits.loudnessMagnitude, -FINISHING_HOUSE.lufsTenths);
  for (const platform of ['reels', 'stories', 'tiktok'] as const) {
    const row = PLATFORM_RULES.find(rule => rule.id === `safe-zone-${platform}`);
    assert.ok(row, platform);
    assert.equal(row.limits.bottomPermille, SAFE_ZONES[platform].bottomPermille);
    assert.equal(row.limits.rightPx, SAFE_ZONES[platform].rightPx);
    assert.equal(row.checkedOn, '2026-10-28');
    assert.ok(row.limitations.some(line => /not.*platform|not.*certif/i.test(line)));
  }
});

import {VENTURE_ERRORS} from '../runtime/venture/contracts.ts';
test('B2 public refusals are registered',()=>{for(const code of ['BOARD_REQUIRED','BOARD_OUTPUT_INVALID','OUTPUT_APPROVAL_REQUIRED','STYLE_NOT_FOUND','STYLE_OWNED_REQUIRED','STYLE_SAMPLES_REQUIRED','STYLE_MEASUREMENTS_REQUIRED','BROLL_INVALID','BROLL_REMOVED','BROLL_LICENCE_REQUIRED','BROLL_APPROVAL_REQUIRED','BROLL_REVIEW_REQUIRED','SOURCE_DOWNSCALED','FINISHING_FAILED','FINISHING_INPUT_INVALID','INTERCHANGE_INVALID','PUBLISHING_TEXT_INVALID','CLIP_RULES_FAILED','CLIP_PAGE_INVALID','BEAT_RULES_FAILED','BEAT_INPUT_INVALID','AUDIO_INPUT_INVALID','AUDIO_TOO_LARGE'])assert.ok((VENTURE_ERRORS as readonly string[]).includes(code),code);});
