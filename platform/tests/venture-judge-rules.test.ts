// Judge rules tests: each rule is a yes/no question with its own floor, the model cites evidence ids from the run's
// trace, code checks every citation and every quote, and code counts the votes. No score is averaged across rules,
// and a vote code could not check never counts as a pass. No network and no paid calls: the model is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessState } from '../runtime/venture/contracts.ts';
import { DEFAULT_LIMITS, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import {
  DRAFT_RULES, decideRules, judgeByRules, notRuled, rulesTask, validateBallot, validateRules, votesNeeded,
  type Ballot, type JudgeRule, type JudgeTrace,
} from '../runtime/venture/delivery/judge/rules.ts';
import { traceFromHarness } from '../runtime/venture/delivery/judge/trace.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

const RULES: JudgeRule[] = [
  { id: 'no-unbacked-claims', question: 'Does the draft avoid claiming work the run did not do?', text: 'Never claim work was done unless a tool run in the trace shows it.', floor: { kind: 'required-yes' } },
  { id: 'answers-question', question: 'Does the draft answer what the client asked?', text: 'The reply must answer the question the client asked in their message.', floor: { kind: 'share', percent: 75 } },
];
const TRACE: JudgeTrace = { events: [
  { id: 'client-message', kind: 'client', summary: 'Please close my September books.' },
  { id: 't1.1', kind: 'tool', summary: 'files.read succeeded' },
  { id: 't1.2', kind: 'tool', summary: 'books.reconcile succeeded' },
  { id: 'draft', kind: 'draft', summary: 'The draft reply.' },
] };

const yes = (rule: string, cites = ['t1.2']) => ({ rule, answer: 'yes' as const, cites, quote: '', reason: 'Shown in the run.' });
const no = (rule: string, quote: string, cites = ['draft']) => ({ rule, answer: 'no' as const, cites, quote, reason: 'The draft says so.' });
const ballot = (...votes: Ballot) => votes;

test('rules: each rule needs an id, a question, its rule text and a floor that is a whole percent', () => {
  assert.equal(validateRules(RULES).length, 2);
  assert.throws(() => validateRules([RULES[0], RULES[0]]), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRules([{ ...RULES[1], floor: { kind: 'share', percent: 0 } }]), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRules([{ ...RULES[1], floor: { kind: 'share', percent: 101 } }]), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRules([{ ...RULES[1], floor: { kind: 'share', percent: 62.5 } }]), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRules([{ ...RULES[0], text: ' ' }]), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => validateRules([]), code('INVALID_VENTURE_REQUEST'));
  assert.equal(validateRules(DRAFT_RULES).length, 4);
  assert.deepEqual(DRAFT_RULES.map(rule => rule.id), ['goal-met', 'tone-fits', 'policy-followed', 'no-unbacked-claims']);
});

test('rules: the votes a floor needs are counted by code, rounding up', () => {
  assert.equal(votesNeeded({ kind: 'required-yes' }, 1), 1);
  assert.equal(votesNeeded({ kind: 'required-yes' }, 3), 3);
  assert.equal(votesNeeded({ kind: 'share', percent: 75 }, 4), 3);
  assert.equal(votesNeeded({ kind: 'share', percent: 70 }, 3), 3);
  assert.equal(votesNeeded({ kind: 'share', percent: 65 }, 3), 2);
  assert.equal(votesNeeded({ kind: 'share', percent: 50 }, 1), 1);
});

test('rules: a cited yes passes, a cited no that quotes the rule fails, and anything code cannot check is unverified', () => {
  const decide = (vote: Ballot[number]) => decideRules([RULES[0]], [[vote]], TRACE).rules[0];
  assert.equal(decide(yes('no-unbacked-claims')).outcome, 'pass');
  const failed = decide(no('no-unbacked-claims', 'never claim work was done'));
  assert.equal(failed.outcome, 'fail');
  assert.equal(failed.votes[0].verified, true);

  const uncited = decide(yes('no-unbacked-claims', []));
  assert.equal(uncited.outcome, 'unverified');
  assert.match(uncited.votes[0].problem ?? '', /cited no evidence/);
  const unknown = decide(yes('no-unbacked-claims', ['t1.2', 't9.9']));
  assert.equal(unknown.outcome, 'unverified');
  assert.match(unknown.votes[0].problem ?? '', /t9\.9/);
  const misquoted = decide(no('no-unbacked-claims', 'never promise a date the plan lacks'));
  assert.equal(misquoted.outcome, 'unverified');
  assert.match(misquoted.votes[0].problem ?? '', /does not quote the rule/);
  assert.equal(decide(no('no-unbacked-claims', 'Never')).outcome, 'unverified', 'a quote must be long enough to point at the rule');
  assert.equal(decide(no('no-unbacked-claims', '')).outcome, 'unverified');
  assert.equal(decide(no('no-unbacked-claims', 'never claim work was done', ['nowhere'])).outcome, 'unverified');
  assert.equal(decide(no('no-unbacked-claims', '  "Never   claim work was done unless"  ')).outcome, 'fail', 'spacing, case and quote marks are forgiven');
});

test('rules: a share floor counts verified yes votes; unverified votes never count as yes', () => {
  const rule = RULES[1];
  const run = (...answers: ('y' | 'n' | 'u')[]) => decideRules([rule], answers.map(answer =>
    answer === 'y' ? [yes(rule.id)] : answer === 'n' ? [no(rule.id, 'must answer the question the client asked')] : [yes(rule.id, [])]), TRACE).rules[0];
  assert.deepEqual(pick(run('y', 'y', 'y', 'n')), { outcome: 'pass', yes: 3, no: 1, unverified: 0, needed: 3 });
  assert.deepEqual(pick(run('y', 'y', 'y', 'u')), { outcome: 'pass', yes: 3, no: 0, unverified: 1, needed: 3 });
  assert.deepEqual(pick(run('y', 'y', 'u', 'n')), { outcome: 'unverified', yes: 2, no: 1, unverified: 1, needed: 3 });
  assert.deepEqual(pick(run('y', 'y', 'n', 'n')), { outcome: 'fail', yes: 2, no: 2, unverified: 0, needed: 3 });
  assert.deepEqual(pick(run('u', 'u', 'u', 'u')), { outcome: 'unverified', yes: 0, no: 0, unverified: 4, needed: 3 });
});

test('rules: code counts the rule verdicts and one failed rule fails the draft, whatever the others say', () => {
  const all = decideRules(RULES, [ballot(yes(RULES[0].id), yes(RULES[1].id))], TRACE);
  assert.deepEqual([all.outcome, all.passed, all.failed, all.unverified], ['pass', 2, 0, 0]);
  const oneFails = decideRules(RULES, [ballot(no(RULES[0].id, 'Never claim work was done'), yes(RULES[1].id))], TRACE);
  assert.deepEqual([oneFails.outcome, oneFails.passed, oneFails.failed, oneFails.unverified], ['fail', 1, 1, 0]);
  assert.match(oneFails.detail, /no-unbacked-claims/);
  const oneUnchecked = decideRules(RULES, [ballot(yes(RULES[0].id, []), yes(RULES[1].id))], TRACE);
  assert.deepEqual([oneUnchecked.outcome, oneUnchecked.passed, oneUnchecked.failed, oneUnchecked.unverified], ['unverified', 1, 0, 1]);
  const mixed = decideRules(RULES, [ballot(no(RULES[0].id, 'Never claim work was done'), yes(RULES[1].id, []))], TRACE);
  assert.equal(mixed.outcome, 'fail', 'a failure wins over an unchecked vote');
  assert.throws(() => decideRules(RULES, [], TRACE), code('INVALID_VENTURE_REQUEST'));
});

test('rules: the model answer must have one vote per rule in a closed shape; uncited votes still parse', () => {
  const good = { votes: [yes(RULES[0].id), { ...yes(RULES[1].id, []) }] };
  assert.equal(validateBallot(good, RULES).length, 2);
  assert.deepEqual(validateBallot({ votes: [...good.votes].reverse() }, RULES).map(vote => vote.rule), RULES.map(rule => rule.id), 'votes come back in rule order');
  for (const bad of [
    { votes: [yes(RULES[0].id)] },
    { votes: [yes(RULES[0].id), yes(RULES[0].id)] },
    { votes: [yes(RULES[0].id), yes('made-up')] },
    { votes: [yes(RULES[0].id), { ...yes(RULES[1].id), answer: 'maybe' }] },
    { votes: [yes(RULES[0].id), { ...yes(RULES[1].id), extra: true }] },
    { votes: [yes(RULES[0].id), { ...yes(RULES[1].id), cites: 't1.1' }] },
    { votes: [yes(RULES[0].id), { ...yes(RULES[1].id), cites: Array(20).fill('t1.1') }] },
    { votes: good.votes, more: 1 },
    [good],
    null,
  ]) assert.throws(() => validateBallot(bad, RULES), code('MODEL_OUTPUT_REJECTED'), JSON.stringify(bad));
});

test('rules: the judge task lists the rules, the trace ids and the draft, and asks for votes only', () => {
  const task = rulesTask({ rules: RULES, trace: TRACE, draft: 'We reconciled your statement.', containsClientData: true });
  assert.equal(task.purpose, 'judge');
  assert.equal(task.containsClientData, true);
  const input = task.input as any;
  assert.deepEqual(input.rules.map((rule: any) => rule.id), RULES.map(rule => rule.id));
  assert.deepEqual(input.trace.map((event: any) => event.id), TRACE.events.map(event => event.id));
  assert.equal(input.draft, 'We reconciled your statement.');
  const schema = JSON.stringify(task.schema);
  assert.ok(!/"number"|"integer"/.test(schema), 'the model is never asked for a number');
  assert.ok(schema.includes('no-unbacked-claims') && schema.includes('answers-question'));
  assert.match(task.instructions, /cite/i);
  assert.match(task.instructions, /quote/i);
  assert.equal(task.validate({ votes: [yes(RULES[0].id), yes(RULES[1].id)] }).length, 2);
  assert.equal(task.template, undefined, 'with no AI the rules are not judged, never passed by a template');
});

test('rules: judgeByRules asks once per sample and code decides; with no AI every rule is unverified, never passed', async () => {
  const answers: Ballot[] = [
    ballot(yes(RULES[0].id), yes(RULES[1].id)),
    ballot(yes(RULES[0].id), yes(RULES[1].id)),
    ballot(yes(RULES[0].id), no(RULES[1].id, 'answer the question the client asked')),
    ballot(yes(RULES[0].id), yes(RULES[1].id)),
  ];
  let calls = 0;
  const ask = async (task: ReturnType<typeof rulesTask>) => { const raw = { votes: answers[calls] }; calls += 1; return { value: task.validate(raw), callId: `call_${calls}` }; };
  const verdict = await judgeByRules(ask, { rules: RULES, trace: TRACE, draft: 'A draft.', containsClientData: false }, 4);
  assert.equal(calls, 4);
  assert.equal(verdict.outcome, 'pass');
  assert.deepEqual(verdict.callIds, ['call_1', 'call_2', 'call_3', 'call_4']);
  assert.deepEqual(pick(verdict.rules[1]), { outcome: 'pass', yes: 3, no: 1, unverified: 0, needed: 3 });
  await assert.rejects(() => judgeByRules(ask, { rules: RULES, trace: TRACE, draft: 'A draft.', containsClientData: false }, 0), code('INVALID_VENTURE_REQUEST'));

  const off = notRuled(RULES, 'No AI judge connected.');
  assert.equal(off.outcome, 'unverified');
  assert.deepEqual(off.rules.map(rule => rule.outcome), ['unverified', 'unverified']);
  assert.ok(off.rules.every(rule => rule.detail === 'No AI judge connected.'));
});

test('trace: a run gives citable ids for its turns, tool calls, hand-offs, files, tables and receipts', () => {
  const state: HarnessState = {
    ...newHarnessState(['files.read', 'books.reconcile'], DEFAULT_LIMITS, ['upload_bank']),
    turns: [{ turn: 1, step: 'act', note: 'Read the statement', calls: [], finished: false, forced: false, by: 'model', callId: null, costMicros: '0' }],
    toolCalls: [{ id: 't1.1', turn: 1, tool: 'files.read', input: { target: 'f1' }, inputDigest: 'd', envelope: { ok: true, result: { rows: 3 } }, outcome: 'succeeded', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] }],
    handoffs: [{ to: 'client', question: 'Which account?', turn: 1, answer: 'The cafe account.', answeredBy: 'owner' }],
    tableIds: ['worktable_1'], workReceiptIds: ['work_1'],
  };
  const trace = traceFromHarness(state, { extra: [{ id: 'draft', kind: 'draft', summary: 'The reply.' }, { id: 't1.1', kind: 'tool', summary: 'duplicate' }] });
  const ids = trace.events.map(event => event.id);
  assert.deepEqual(ids, ['turn.1', 't1.1', 'handoff.1', 'upload_bank', 'worktable_1', 'work_1', 'draft']);
  assert.match(trace.events[1].summary, /files\.read/);
  assert.match(trace.events[2].summary, /Which account\?/);
  assert.match(trace.events[2].summary, /The cafe account\./);
  assert.equal(traceFromHarness(null).events.length, 0);
});

function pick(verdict: { outcome: string; yes: number; no: number; unverified: number; needed: number }) {
  return { outcome: verdict.outcome, yes: verdict.yes, no: verdict.no, unverified: verdict.unverified, needed: verdict.needed };
}
