// Judge calibration (Ink v2 wave 4, package 4J15, catalogue Q13). Fixtures with a known right verdict, including the
// lucky-correct ones (the right answer reached the wrong way), check a judge before it is trusted. Votes may be na;
// code folds them deterministically (any false is false); every cited event id is checked against the run's log; a
// rule that needs a kind of event (a calculator receipt) is a yes only when the vote cites one; a failure quotes the
// rule's clause word for word. Agreement is counted by code with a receipt, and says model estimate when a model voted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALIBRATION_FIXTURES, CALIBRATION_RULES, calibrate, calibrationTask, foldVotes, validateCalibrationBallot, type CalibrationBallot,
} from '../runtime/venture/delivery/judge/calibration.ts';
import type { JudgeTrace } from '../runtime/venture/delivery/judge/trace.ts';
import { digest } from '../runtime/venture/records.ts';

const [FIGURES, FILES] = CALIBRATION_RULES;
const trace: JudgeTrace = { events: [
  { id: 'turn.1', kind: 'turn', summary: 'Agent turn: read the bank file.' },
  { id: 't1.1', kind: 'tool', summary: 'files.read succeeded' },
  { id: 't1.2', kind: 'tool', summary: 'calc.sum succeeded' },
  { id: 'rcpt_1', kind: 'receipt', summary: 'Calculator receipt: Total of amount: INR 12,400.00.' },
  { id: 'draft', kind: 'draft', summary: 'The draft says the month came to INR 12,400.00.' },
] };
const yes = (rule: string, cites: string[]) => ({ rule, answer: 'yes' as const, cites, quote: '', reason: 'Shown in the trace.' });
const no = (rule: string, cites: string[], quote: string) => ({ rule, answer: 'no' as const, cites, quote, reason: 'Broken.' });
const na = (rule: string) => ({ rule, answer: 'na' as const, cites: [], quote: '', reason: 'Does not apply.' });
/** A rule that may not apply to a run, so it counts by a share and takes na. */
const ASKED = { id: 'questions-asked', question: 'Did the draft ask about what the client left out?', text: 'Ask the client about anything they left out.', floor: { kind: 'share' as const, percent: 50 } };

test('fold: every checked yes is true; one false vote makes the fold false; na votes are left out; all na is no verdict', () => {
  assert.equal(foldVotes(CALIBRATION_RULES, [yes(FIGURES.id, ['rcpt_1']), yes(FILES.id, ['t1.1'])], trace).value, true);
  const broke = foldVotes(CALIBRATION_RULES, [yes(FIGURES.id, ['rcpt_1']), no(FILES.id, ['t1.1'], FILES.text)], trace);
  assert.equal(broke.value, false, 'one false vote is enough');
  assert.equal(foldVotes([...CALIBRATION_RULES, ASKED], [yes(FIGURES.id, ['rcpt_1']), yes(FILES.id, ['t1.1']), na(ASKED.id)], trace).value, true, 'na is left out of the fold');
  // A rule every run must meet (required-yes) cannot be answered na: that vote is not counted and the fold fails closed.
  const dodged = foldVotes(CALIBRATION_RULES, [yes(FIGURES.id, ['rcpt_1']), na(FILES.id)], trace);
  assert.equal(dodged.value, false);
  assert.equal(dodged.votes[1].verified, false);
  assert.match(dodged.votes[1].problem!, /needs a yes or a no/);
  const none = foldVotes([ASKED], [na(ASKED.id)], trace);
  assert.equal(none.value, null);
  assert.match(none.detail, /No rule applied/);
  assert.throws(() => foldVotes(CALIBRATION_RULES, [yes(FIGURES.id, ['rcpt_1'])], trace), (error: any) => error.code === 'INVALID_VENTURE_REQUEST', 'one vote per rule');
});

test('fold: a failure quotes the rule\'s clause word for word; a no that does not quote it is not counted and fails closed', () => {
  const broke = foldVotes(CALIBRATION_RULES, [no(FIGURES.id, ['draft'], 'Every figure in the draft must come from a calculator receipt'), yes(FILES.id, ['t1.1'])], trace);
  assert.equal(broke.value, false);
  assert.deepEqual(broke.failures.map(item => [item.rule, item.clause]), [[FIGURES.id, 'Every figure in the draft must come from a calculator receipt']]);
  assert.ok(FIGURES.text.includes(broke.failures[0].clause), 'the clause is the rule\'s own words');
  assert.match(broke.detail, /Every figure in the draft must come from a calculator receipt/);
  const vague = foldVotes(CALIBRATION_RULES, [no(FIGURES.id, ['draft'], 'it is wrong'), yes(FILES.id, ['t1.1'])], trace);
  assert.equal(vague.value, false, 'a vote code cannot check never passes');
  assert.equal(vague.votes[0].verified, false);
  assert.equal(vague.failures[0].clause, FIGURES.text, 'an unchecked vote fails on the whole rule');
});

test('fold: cited event ids are checked against the run\'s log; a rule that needs a receipt is a yes only when one is cited', () => {
  const made = foldVotes(CALIBRATION_RULES, [yes(FIGURES.id, ['rcpt_9']), yes(FILES.id, ['t1.1'])], trace);
  assert.equal(made.value, false);
  assert.match(made.votes[0].problem!, /rcpt_9.*not in the run's trace/);
  const uncited = foldVotes(CALIBRATION_RULES, [yes(FIGURES.id, []), yes(FILES.id, ['t1.1'])], trace);
  assert.equal(uncited.value, false);
  // A yes on the figures rule that points only at the draft: the right figure, but nothing shows code worked it out.
  const lucky = foldVotes(CALIBRATION_RULES, [yes(FIGURES.id, ['draft']), yes(FILES.id, ['t1.1'])], trace);
  assert.equal(lucky.value, false);
  assert.match(lucky.votes[0].problem!, /cites no receipt/);
  // An na may cite nothing, but what it cites must be in the log too.
  const naCited = foldVotes([...CALIBRATION_RULES, ASKED], [yes(FIGURES.id, ['rcpt_1']), yes(FILES.id, ['t1.1']), { ...na(ASKED.id), cites: ['nowhere'] }], trace);
  assert.equal(naCited.votes[2].verified, false);
  assert.equal(naCited.value, false);
});

test('calibrate: lucky-correct fixtures must fail; a judge that passes one is counted wrong; agreement is code\'s count with a receipt', () => {
  const lucky = CALIBRATION_FIXTURES.filter(item => item.lucky);
  assert.ok(lucky.length >= 2, 'at least two right-answer-wrong-way fixtures');
  assert.ok(lucky.every(item => item.expected === false));
  assert.ok(CALIBRATION_FIXTURES.some(item => item.expected === true), 'and one done the right way');
  // A careful judge: cites the receipt where there is one and says no, quoting the rule, where there is none.
  const careful: Record<string, CalibrationBallot> = {};
  for (const fixture of CALIBRATION_FIXTURES) {
    const receipt = fixture.trace.events.find(event => event.kind === 'receipt');
    const read = fixture.trace.events.find(event => event.kind === 'tool');
    careful[fixture.id] = [
      receipt ? yes(FIGURES.id, [receipt.id]) : no(FIGURES.id, ['draft'], FIGURES.text),
      read ? yes(FILES.id, [read.id]) : no(FILES.id, ['draft'], FILES.text),
    ];
  }
  const good = calibrate(CALIBRATION_RULES, CALIBRATION_FIXTURES, careful, 'model');
  assert.equal(good.agreed, CALIBRATION_FIXTURES.length);
  assert.equal(good.missed.length, 0);
  assert.deepEqual(good.lucky, { total: lucky.length, caught: lucky.length });
  assert.equal(good.estimate, true);
  assert.match(good.line, /^Model estimate: /);
  // A judge fooled by the right answer: says yes everywhere, citing the draft.
  const fooled: Record<string, CalibrationBallot> = Object.fromEntries(CALIBRATION_FIXTURES.map(fixture => [fixture.id, [yes(FIGURES.id, ['draft']), yes(FILES.id, ['draft'])]]));
  const bad = calibrate(CALIBRATION_RULES, CALIBRATION_FIXTURES, fooled, 'model');
  assert.equal(bad.lucky.caught, lucky.length, 'code still fails them: a yes that cites no receipt is not counted');
  // A judge whose ballots code cannot fault but who is simply wrong on the right-way fixture.
  const right = CALIBRATION_FIXTURES.find(item => item.expected === true)!;
  const wrong = calibrate(CALIBRATION_RULES, CALIBRATION_FIXTURES, { ...careful, [right.id]: [no(FIGURES.id, ['draft'], FIGURES.text), careful[right.id][1]] }, 'code');
  assert.equal(wrong.agreed, CALIBRATION_FIXTURES.length - 1);
  assert.deepEqual(wrong.missed.map(item => [item.fixture, item.expected, item.got]), [[right.id, true, false]]);
  assert.equal(wrong.estimate, false);
  assert.doesNotMatch(wrong.line, /estimate/i);
  const { digest: seen, ...body } = wrong.receipt;
  assert.equal(seen, digest(body));
  assert.throws(() => calibrate(CALIBRATION_RULES, CALIBRATION_FIXTURES, {}, 'model'), (error: any) => error.code === 'INVALID_VENTURE_REQUEST', 'every fixture needs a ballot');
});

test('the calibration ballot: yes, no or na; one vote per rule; the task asks for na where a rule does not apply', () => {
  const ballot = validateCalibrationBallot({ votes: [
    { rule: FIGURES.id, answer: 'na', cites: [], quote: '', reason: 'No figures.' },
    { rule: FILES.id, answer: 'yes', cites: ['t1.1'], quote: '', reason: 'Read.' },
  ] }, CALIBRATION_RULES);
  assert.deepEqual(ballot.map(vote => vote.answer), ['na', 'yes']);
  assert.throws(() => validateCalibrationBallot({ votes: [{ rule: FIGURES.id, answer: 'maybe', cites: [], quote: '', reason: '' }, { rule: FILES.id, answer: 'yes', cites: [], quote: '', reason: '' }] }, CALIBRATION_RULES),
    (error: any) => error.code === 'MODEL_OUTPUT_REJECTED');
  const task = calibrationTask({ rules: CALIBRATION_RULES, trace, draft: 'The month came to the total.', containsClientData: false });
  const answer = (task.schema as any).properties.votes.items.properties.answer;
  assert.deepEqual(answer.enum, ['yes', 'no', 'na']);
  assert.equal(task.purpose, 'judge');
  assert.match(task.instructions, /na/);
});
