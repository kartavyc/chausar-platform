import test from 'node:test';
import assert from 'node:assert/strict';
import { POSTURE_WORDS } from '../runtime/venture/policy/posture.ts';
import { WEBHOOK_WORDS } from '../runtime/venture/build/webhook-handoff.ts';
import { JUDGE_AUTO_ON_LINE, JUDGE_AUTO_OFF_LINE, JUDGE_FAILED_CHECK } from '../runtime/venture/delivery/judge-run.ts';

test('wave 6: live engine approval and quality guidance uses owner-facing words', () => {
  assert.equal(POSTURE_WORDS.shadow, 'In practice on real orders');
  for (const text of [JUDGE_AUTO_ON_LINE, JUDGE_AUTO_OFF_LINE, JUDGE_FAILED_CHECK]) {
    assert.doesNotMatch(text, /\bjudge\b/i);
    assert.match(text, /quality check/i);
  }
});

test('wave 6: n8n and Make results name the app and preserve exact-approval and uncertain-outcome guidance', () => {
  for (const kind of ['n8n', 'make'] as const) {
    const lines = [WEBHOOK_WORDS.kept(kind, 'example.org'), WEBHOOK_WORDS.answered(kind), WEBHOOK_WORDS.unknown(kind), WEBHOOK_WORDS.cleared(kind), WEBHOOK_WORDS.notSet(kind)];
    for (const line of lines) {
      assert.doesNotMatch(line, /\bwebhook\b/i);
      assert.match(line, kind === 'n8n' ? /n8n/ : /Make/);
    }
    assert.match(lines[0], /approve that exact item/);
    assert.match(lines[2], /will not send it again/);
  }
});
