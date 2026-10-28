// Social media agency playbook: the judge rules (yes or no, each with its own floor, never averaged) and the committed
// baseline of held-back cases. The baseline runs every case through the code checks with no model and fails when the
// pass rate drops below the committed one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRules, validateRules, type Ballot } from '../runtime/venture/delivery/judge/rules.ts';
import {
  SOCIAL_JUDGE_RULES, loadSocialBaseline, runSocialBaseline, scoreSocialCase, socialJudgeTrace,
} from '../runtime/venture/playbooks/social/judge.ts';

test('judge rules: yes or no questions with a floor each; the disclosure and claim rules need every vote', () => {
  const rules = validateRules(SOCIAL_JUDGE_RULES);
  assert.deepEqual(rules.map(rule => rule.id), [
    'on-brand-voice', 'fits-pillar', 'claims-backed', 'disclosure-clear', 'no-fake-customer', 'platform-conduct', 'client-comfortable', 'source-faithful', 'one-goal',
  ]);
  for (const id of ['claims-backed', 'disclosure-clear', 'no-fake-customer', 'platform-conduct']) {
    assert.deepEqual(rules.find(rule => rule.id === id)!.floor, { kind: 'required-yes' }, id);
  }
  assert.equal(rules.find(rule => rule.id === 'on-brand-voice')!.floor.kind, 'share');
});

test('judge rules: code counts the votes against the trace of checks, files and the draft', () => {
  const trace = socialJudgeTrace({
    draftId: 'post-1', draft: 'Sunday thali for ₹450.', proofFileIds: ['proof-menu.csv'],
    checks: { passed: true, findings: [] }, voiceSheetId: 'voice-1',
  });
  const ids = trace.events.map(event => event.id);
  assert.deepEqual(ids, ['voice-1', 'proof-menu.csv', 'checks.post-1', 'draft.post-1']);
  const yes = (rule: string): Ballot[number] => ({ rule, answer: 'yes', cites: ['draft.post-1'], quote: '', reason: 'Fine.' });
  const ballot: Ballot = SOCIAL_JUDGE_RULES.map(rule => yes(rule.id));
  assert.equal(decideRules(SOCIAL_JUDGE_RULES, [ballot], trace).outcome, 'pass');
  const noClaim = ballot.map(vote => vote.rule === 'claims-backed'
    ? { ...vote, answer: 'no' as const, quote: SOCIAL_JUDGE_RULES.find(rule => rule.id === 'claims-backed')!.text }
    : vote);
  assert.equal(decideRules(SOCIAL_JUDGE_RULES, [noClaim], trace).outcome, 'fail');
});

test('baseline: the committed file loads and every held-back case passes the code checks with its reference', async () => {
  const { file } = await loadSocialBaseline();
  assert.equal(file.playbook, 'social-agency');
  assert.ok(file.cases.length >= 6);
  const result = await runSocialBaseline();
  assert.equal(result.ok, true, result.detail);
  assert.equal(result.passed, file.baseline.passed);
  assert.equal(result.of, file.baseline.of);
});

test('baseline: a worse draft fails its case by name, and quality below the baseline fails the suite', async () => {
  const { file, social } = await loadSocialBaseline();
  const paidCase = file.cases.find(item => social[item.id]?.paid)!;
  assert.ok(paidCase, 'the baseline holds a paid case');
  const undisclosed = scoreSocialCase(paidCase, social[paidCase.id], paidCase.reference.replace(/#ad\b/gi, '').replace(/\bAd:\s*/g, ''));
  assert.equal(undisclosed.passed, false);
  assert.ok(undisclosed.failures.some(line => /paid/i.test(line)), undisclosed.failures.join(' | '));
  const invented = scoreSocialCase(file.cases[0], social[file.cases[0].id], `${file.cases[0].reference} Rated 4.9 by 3,000 diners.`);
  assert.equal(invented.passed, false);
  const worse = await runSocialBaseline({ draftFor: item => (item.id === paidCase.id ? 'Tag a friend! #ad' : item.reference) });
  assert.equal(worse.ok, false);
  assert.match(worse.detail, /below the baseline/);
});
