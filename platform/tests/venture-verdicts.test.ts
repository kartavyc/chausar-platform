// Ink v2 wave 4 (4J14, Q7): one vocabulary of verdict words. Every check outcome goes through one table; model
// judgments are words with a keep line and a printed drop reason; drafts are PASS, REWRITE or DO NOT SEND; a fix is
// Fixed, Partially fixed, Not fixed or Unverified; a report older than its draft is stale; an unknown is "Unknown".
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_OUTCOMES, CHECK_WORDS, DRAFT_VERDICTS, DRAFT_VERDICT_WORDS, FIX_STATUSES, FIX_WORDS, FINDING_CLASSES, JUDGMENTS, JUDGMENT_WORDS,
  COVERAGE_UNITS, COVERAGE_VERBS, REVIEW_INCOMPLETE, RUN_OUTCOMES, RUN_OUTCOME_WORDS, STALE_LINE, UNKNOWN, VERDICT_VOCABULARY,
  checkDetail, checkLine, checkWord, draftVerdict, fixStatus, isHardCheck, judgmentOfHook, judgmentOfRule, keepJudgment, outcomeOfCheck,
  outcomeOfPlaybookCheck, outcomeOfRule, reportStamp,
} from '../runtime/venture/delivery/verdicts.ts';
import { checkLabel, playbookCheckLabel } from '../runtime/venture/views/runs.ts';
import { decideRules, notRuled, type JudgeRule } from '../runtime/venture/delivery/judge/rules.ts';
import { hookScore } from '../runtime/venture/playbooks/youtube/checks.ts';

test('one table: four check outcomes, each with its word; anything else is Unknown, never a pass', () => {
  assert.deepEqual([...CHECK_OUTCOMES], ['pass', 'fail', 'not-run', 'not-checked']);
  assert.deepEqual(CHECK_OUTCOMES.map(checkWord), ['Passed', 'Failed', 'Not run', 'Not checked']);
  assert.deepEqual({ ...CHECK_WORDS }, { pass: 'Passed', fail: 'Failed', 'not-run': 'Not run', 'not-checked': 'Not checked' });
  for (const odd of [undefined, null, '', 'PASS', 'passed', true, 1, 'skipped', 'unresolved', {}]) assert.equal(checkWord(odd), UNKNOWN, String(odd));
  assert.equal(UNKNOWN, 'Unknown');
});

test('a harness check, a playbook check and a judge rule map onto the same four outcomes', () => {
  assert.equal(outcomeOfCheck({ check: 'house-style', passed: true, detail: 'Fine.' }), 'pass');
  assert.equal(outcomeOfCheck({ check: 'house-style', passed: false, detail: 'Too long.' }), 'fail');
  assert.equal(outcomeOfCheck({ check: 'rules-judge', passed: false, detail: 'Not settled.', notChecked: true }), 'not-checked');
  assert.equal(outcomeOfPlaybookCheck({ playbook: 'youtube', check: 'hook-score', outcome: 'pass', detail: '' }), 'pass');
  assert.equal(outcomeOfPlaybookCheck({ playbook: 'youtube', check: 'hook-score', outcome: 'fail', detail: '' }), 'fail');
  assert.equal(outcomeOfPlaybookCheck({ playbook: 'youtube', check: 'finishing', outcome: 'not-run', detail: '' }), 'not-run');
  assert.equal(outcomeOfPlaybookCheck({ playbook: 'youtube', check: 'finishing', outcome: 'skipped' as never, detail: '' }), 'unknown');
  assert.equal(outcomeOfRule('pass'), 'pass');
  assert.equal(outcomeOfRule('fail'), 'fail');
  assert.equal(outcomeOfRule('unverified'), 'not-checked', 'an unresolved rule is never passed');
  assert.equal(outcomeOfRule('maybe' as never), 'unknown');
});

test('the run labels use the table: a check that could not run reads Not run, an unsettled one Not checked', () => {
  assert.equal(checkLabel({ check: 'house-style', passed: true, detail: 'Fine.' }), 'Passed: Fine.');
  assert.equal(checkLabel({ check: 'rules-judge', passed: false, detail: 'Not settled: tone-fits.', notChecked: true }), 'Not checked: Not settled: tone-fits.');
  assert.equal(playbookCheckLabel({ playbook: 'youtube', check: 'finishing', outcome: 'not-run', detail: 'not run: the draft has no chapters to check.' }),
    'Not run: the draft has no chapters to check.', 'the check\'s own "not run:" is not said twice');
  assert.equal(playbookCheckLabel({ playbook: 'youtube', check: 'hook-score', outcome: 'pass', detail: 'Kept the better hook.' }), 'Passed: Kept the better hook.');
  assert.equal(playbookCheckLabel({ playbook: 'youtube', check: 'odd', outcome: 'weird' as never, detail: 'Something.' }), 'Unknown: Something.');
  assert.equal(checkLabel({ check: 'rules-judge', passed: false, detail: 'Failed: tone-fits.' }), 'Failed: tone-fits.', "the judge's own 'Failed:' is not said twice");
  assert.equal(checkDetail('Failed: tone-fits.'), 'tone-fits.');
  assert.equal(checkDetail('not run: no chapters.'), 'no chapters.');
  assert.equal(checkDetail('Not settled: tone-fits.'), 'Not settled: tone-fits.', 'only an outcome word of its own is cut');
  assert.equal(checkLine('fail', 'Failed: tone-fits.'), 'Failed: tone-fits.');
  assert.equal(checkLine('weird', 'Passed: fine.'), 'Unknown: fine.');
});

const RULES: JudgeRule[] = [
  { id: 'tone-fits', question: 'Does the tone suit this client?', text: 'The tone must suit this client.', floor: { kind: 'share', percent: 60 } },
];
const trace = { events: [{ id: 'e1', kind: 'tool', summary: 'read the file' }] };
const vote = (answer: 'yes' | 'no', cites = ['e1']) => [{ rule: 'tone-fits', answer, cites, quote: answer === 'no' ? 'The tone must suit this client.' : '', reason: 'r' }];

test('model judgments are words: strong, fair, weak or no; an unsettled rule has no judgment', () => {
  assert.deepEqual([...JUDGMENTS], ['strong', 'fair', 'weak', 'no']);
  assert.deepEqual({ ...JUDGMENT_WORDS }, { strong: 'strong', fair: 'fair', weak: 'weak', no: 'no' });
  const rule = (ballots: ReturnType<typeof vote>[]) => decideRules(RULES, ballots, trace).rules[0];
  assert.equal(judgmentOfRule(rule([vote('yes'), vote('yes'), vote('yes')])), 'strong', 'every checked vote said yes');
  assert.equal(judgmentOfRule(rule([vote('yes'), vote('yes'), vote('no')])), 'fair', 'it met its floor');
  assert.equal(judgmentOfRule(rule([vote('yes'), vote('no'), vote('no')])), 'weak', 'some yes, below the floor');
  assert.equal(judgmentOfRule(rule([vote('no'), vote('no'), vote('no')])), 'no');
  assert.equal(judgmentOfRule(rule([vote('yes', []), vote('yes', []), vote('no')])), null, 'votes code could not check settle nothing');
  assert.equal(judgmentOfRule(notRuled(RULES, 'No judge connected.').rules[0]), null);
  // The stored shape (judge-run.ts keeps the vote count, not the votes) gives the same words.
  assert.equal(judgmentOfRule({ outcome: 'pass', yes: 3, votes: 3 }), 'strong');
  assert.equal(judgmentOfRule({ outcome: 'pass', yes: 2, votes: 3 }), 'fair');
  assert.equal(judgmentOfRule({ outcome: 'fail', yes: 1, votes: 3 }), 'weak');
  assert.equal(judgmentOfRule({ outcome: 'fail', yes: 0, votes: 3 }), 'no');
  assert.equal(judgmentOfRule({ outcome: 'unverified', yes: 0, votes: 3 }), null);
  // Hooks: the scorer's bands in the same words; below the floor the check fails, so it is no.
  assert.equal(judgmentOfHook({ verdict: 80, band: 'strong' }), 'strong');
  assert.equal(judgmentOfHook({ verdict: 60, band: 'workable' }), 'fair');
  assert.equal(judgmentOfHook({ verdict: 45, band: 'weak' }), 'weak');
  assert.equal(judgmentOfHook({ verdict: 20, band: 'weak' }), 'no');
  const greeting = hookScore('Hi');
  assert.equal(judgmentOfHook(greeting), greeting.verdict < 40 ? 'no' : 'weak');
});

test('a keep line keeps fair or better by default, and prints why it dropped the rest', () => {
  assert.deepEqual(keepJudgment('strong'), { keep: true, word: 'strong', drop: null });
  assert.deepEqual(keepJudgment('fair'), { keep: true, word: 'fair', drop: null });
  assert.deepEqual(keepJudgment('weak'), { keep: false, word: 'weak', drop: 'Dropped: weak is below the keep line, fair.' });
  assert.deepEqual(keepJudgment('fair', 'strong'), { keep: false, word: 'fair', drop: 'Dropped: fair is below the keep line, strong.' });
  assert.deepEqual(keepJudgment('no', 'no'), { keep: true, word: 'no', drop: null });
  assert.deepEqual(keepJudgment(null), { keep: false, word: 'Unknown', drop: 'Dropped: it was not judged, and an unknown is never kept.' });
  assert.deepEqual(keepJudgment('excellent'), { keep: false, word: 'Unknown', drop: 'Dropped: it was not judged, and an unknown is never kept.' });
});

test('draft verdicts: PASS only when every check ran and passed; a safety failure is DO NOT SEND; anything unrun is no review', () => {
  assert.deepEqual([...DRAFT_VERDICTS], ['pass', 'rewrite', 'do-not-send']);
  assert.deepEqual({ ...DRAFT_VERDICT_WORDS }, { pass: 'PASS', rewrite: 'REWRITE', 'do-not-send': 'DO NOT SEND' });
  const item = (id: string, outcome: string, hard = false) => ({ id, outcome: outcome as never, hard });
  assert.deepEqual(draftVerdict([item('house-style', 'pass'), item('receipts', 'pass', true)]), { verdict: 'pass', line: 'PASS: every check ran and passed.' });
  assert.deepEqual(draftVerdict([item('house-style', 'fail'), item('receipts', 'pass', true)]), { verdict: 'rewrite', line: 'REWRITE: 1 check failed.' });
  assert.deepEqual(draftVerdict([item('house-style', 'fail'), item('receipts', 'fail', true)]), { verdict: 'do-not-send', line: 'DO NOT SEND: 1 check that guards what goes out failed.' });
  assert.deepEqual(draftVerdict([item('house-style', 'pass'), item('finishing', 'not-run')]), { verdict: null, line: REVIEW_INCOMPLETE });
  assert.deepEqual(draftVerdict([item('house-style', 'pass'), item('rules-judge', 'not-checked')]), { verdict: null, line: REVIEW_INCOMPLETE });
  assert.deepEqual(draftVerdict([item('house-style', 'pass'), item('odd', 'unknown')]), { verdict: null, line: REVIEW_INCOMPLETE });
  assert.deepEqual(draftVerdict([]), { verdict: null, line: REVIEW_INCOMPLETE }, 'no checks is no review');
  assert.deepEqual(draftVerdict([item('house-style', 'fail'), item('finishing', 'not-run')]), { verdict: null, line: REVIEW_INCOMPLETE },
    'an incomplete review shows no verdict at all; its failures stay findings');
  assert.deepEqual(draftVerdict([item('receipts', 'fail', true), item('rules-judge', 'not-run')]), { verdict: null, line: REVIEW_INCOMPLETE });
  assert.equal(isHardCheck('no-numeric-prose'), true, 'a number in the prose never reaches a client, under the money rule');
  assert.equal(isHardCheck('youtube:prompt-leak'), true);
  assert.equal(isHardCheck('house-style'), false);
  assert.deepEqual(draftVerdict([item('no-numeric-prose', 'fail', isHardCheck('no-numeric-prose'))]).verdict, 'do-not-send');
  assert.equal(REVIEW_INCOMPLETE, 'Review incomplete: this is not a review.');
});

test('a fix is Fixed, Partially fixed, Not fixed or Unverified, from the checks run again after it', () => {
  assert.deepEqual([...FIX_STATUSES], ['fixed', 'partially-fixed', 'not-fixed', 'unverified']);
  assert.deepEqual({ ...FIX_WORDS }, { fixed: 'Fixed', 'partially-fixed': 'Partially fixed', 'not-fixed': 'Not fixed', unverified: 'Unverified' });
  assert.equal(fixStatus(null), 'unverified', 'nothing ran again');
  assert.equal(fixStatus([]), 'unverified');
  assert.equal(fixStatus(['pass', 'pass']), 'fixed');
  assert.equal(fixStatus(['pass', 'fail']), 'partially-fixed');
  assert.equal(fixStatus(['pass', 'not-run']), 'partially-fixed');
  assert.equal(fixStatus(['fail', 'fail']), 'not-fixed');
  assert.equal(fixStatus(['fail', 'not-checked']), 'not-fixed');
  assert.equal(fixStatus(['not-run', 'not-checked']), 'unverified', 'never Fixed for checks that did not run');
  assert.equal(fixStatus(['unknown' as never]), 'unverified');
});

test('a report older than its draft is stale', () => {
  assert.deepEqual(reportStamp('2026-10-15T10:00:00.000Z', null), { stale: false, line: null });
  assert.deepEqual(reportStamp('2026-10-15T10:00:00.000Z', '2026-10-15T09:00:00.000Z'), { stale: false, line: null });
  assert.deepEqual(reportStamp('2026-10-15T10:00:00.000Z', '2026-10-15T10:00:00.000Z'), { stale: false, line: null });
  assert.deepEqual(reportStamp('2026-10-15T10:00:00.000Z', '2026-10-15T10:05:00.000Z'),
    { stale: true, line: 'Stale: the draft changed after these checks ran. They describe an earlier version.' });
});

test('the engine exports every list, for the screen\'s drift test', () => {
  assert.deepEqual(Object.keys(VERDICT_VOCABULARY).sort(), ['checks', 'drafts', 'findings', 'fixes', 'judgments', 'lines', 'outcomes', 'units', 'verbs']);
  assert.deepEqual([...VERDICT_VOCABULARY.units], ['rows', 'lines', 'pages', 'items', 'bank-lines']);
  assert.deepEqual([...VERDICT_VOCABULARY.verbs], ['read', 'matched', 'used']);
  assert.deepEqual(VERDICT_VOCABULARY.units, COVERAGE_UNITS);
  assert.deepEqual(VERDICT_VOCABULARY.verbs, COVERAGE_VERBS);
  assert.deepEqual({ ...VERDICT_VOCABULARY.lines }, { unknown: 'Unknown', stale: STALE_LINE, incomplete: REVIEW_INCOMPLETE });
  assert.deepEqual(VERDICT_VOCABULARY.checks, CHECK_OUTCOMES);
  assert.deepEqual([...RUN_OUTCOMES], ['success', 'not-checked', 'failed']);
  assert.deepEqual({ ...RUN_OUTCOME_WORDS }, { success: 'Success', 'not-checked': 'Not checked', failed: 'Failed' });
  assert.deepEqual([...FINDING_CLASSES], ['hard-error', 'content', 'creative']);
  for (const list of Object.values(VERDICT_VOCABULARY)) assert.ok(Object.isFrozen(list));
});
