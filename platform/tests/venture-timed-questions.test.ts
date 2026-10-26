// Timed questions (Ink v2 wave 4, package 4J13; catalogue A13): a run's question carries expiresAt, 24 hours unless the
// playbook's question step says otherwise, which Today's row meta shows; when it passes unanswered, a held call is
// declined (fail closed), the run stops with "No answer by {time}. Go on without it, or stop.", the decision record
// says timeout (never the owner's no), a late answer is refused, and Resume's next turn reads the line. Other runs go
// on meanwhile.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, PolicyHold } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { routineTick } from '../runtime/venture/agents/routine-runner.ts';
import { QUESTION_HOURS, noAnswerLine, questionWindowMs, withQuestionExpiry } from '../runtime/venture/delivery/timed-questions.ts';
import { HOLD_DECLINE_ANSWER } from '../runtime/venture/policy/holds.ts';
import { DONE, READ, START, approve, call, code, getRun, owner, queue, record, startRun, turnOf, type Env, setup } from './venture-run-controls-env.ts';

const HOUR = 3_600_000;
const QUESTION = 'Which account is the cafe current account?';
const ASK = turnOf('Ask which account is the cafe account', [['handoff.owner', { question: QUESTION }]]);
const DAY_LATER = new Date(Date.parse(START) + QUESTION_HOURS * HOUR).toISOString();
// START is 10:00 UTC on 16 October: 15:30 in India, where the business is.
const LINE = 'No answer by 17 Oct 2026, 15:30. Go on without it, or stop.';

/** A run that asked the owner its question, at START. */
async function asking(env: Env) {
  const run = await startRun(env, [ASK, READ, DONE]);
  const asked = await approve(env, run);
  assert.equal(asked.status, 'needs-answer');
  return asked;
}

/** Puts a held call behind the run's open question, as the policy does for a call on hold. */
async function holdBehind(env: Env, runId: string): Promise<void> {
  await ventureAction(env.deps, owner, 'prepare', 'test.hold', tx => {
    const run = tx.find('venture-delivery-run', runId)!;
    const harness = structuredClone(run.harness!);
    const hold: PolicyHold = { id: 'h9.1', toolCallId: 't9.1', tool: 'files.read', stepId: 'gather', inputDigest: 'digest', code: 'step_on_hold', reason: 'Read the files is on hold.', turn: 1, handoff: harness.handoffs.length - 1, status: 'waiting', validTurn: null };
    harness.holds = [...(harness.holds ?? []), hold];
    tx.replace<DeliveryRunRecord>({ ...run, harness });
  });
}

test('a question carries when it stops being answerable: 24 hours, or what the playbook question step says; Today shows it', async () => {
  const env = await setup();
  const run = await asking(env);
  const open = record(env, run.id).harness!.handoffs.at(-1)!;
  assert.equal(open.question, QUESTION);
  assert.equal(open.expiresAt, DAY_LATER);
  const row = (await queue(env)).rows.find(item => item.kind === 'question' && item.viewRef?.id === run.id);
  assert.equal(row?.meta?.expiresAt, DAY_LATER, "Today's row says when the question runs out");

  assert.equal(questionWindowMs(null), 24 * HOUR);
  const step = (timeoutMs?: number) => ({ steps: [{ id: 'ask', kind: 'question' as const, title: 'Ask', tier: 'code' as const, model: null, doneBy: 'agent' as const, requiredSections: [], checks: [], ...(timeoutMs === undefined ? {} : { timeoutMs }) }] });
  assert.equal(questionWindowMs(step()), 24 * HOUR);
  assert.equal(questionWindowMs(step(2 * HOUR)), 2 * HOUR);
  assert.equal(questionWindowMs(step(1000)), 15 * 60_000, 'never shorter than 15 minutes');
  assert.equal(noAnswerLine(DAY_LATER, env.venture), LINE);
  // A business still in its interview has no country yet: the time reads in UTC, never a crash.
  assert.equal(noAnswerLine(DAY_LATER, { country: null } as never), 'No answer by 2026-10-17, 10:00. Go on without it, or stop.');
});

test('unanswered past its time: the held call is declined, the run stops with the line, the record says timeout; other runs go on', async () => {
  const env = await setup();
  const run = await asking(env);
  await holdBehind(env, run.id);
  // A second order's run, waiting for approval of its first turn: it is not touched.
  const other = await startRun(env, [READ, DONE]);
  env.advance(QUESTION_HOURS * HOUR - 60_000);
  await routineTick(env.deps, owner);
  assert.equal(record(env, run.id).status, 'needs-answer', 'not before its time');

  env.advance(2 * 60_000);
  await routineTick(env.deps, owner);
  const stored = record(env, run.id);
  assert.equal(stored.status, 'stopped');
  const closed = stored.harness!.handoffs.at(-1)!;
  assert.deepEqual([closed.answer, closed.answeredBy], [LINE, 'timeout']);
  assert.equal(stored.harness!.holds!.at(-1)!.status, 'declined', 'fail closed: nothing it asked about runs');
  assert.equal(stored.harness!.control?.line, LINE);
  assert.equal((await getRun(env, run.id)).stop?.line, LINE);
  const otherNow = record(env, other.id);
  assert.deepEqual([otherNow.status, otherNow.callId], ['waiting-for-you', other.callId], 'the other run goes on');

  const decisions = (await call<{ decisions: { subject: string; who: string; line: string }[] }>(env, 'venture.decisions.list')).decisions.filter(item => item.subject === `run:${run.id}`);
  // The owner's own approvals of the run's turns are there too; the question's end is one timeout, and nothing says the owner refused.
  const timeouts = decisions.filter(item => item.who === 'timeout');
  assert.equal(timeouts.length, 1, JSON.stringify(decisions));
  assert.match(timeouts[0].line, /^No answer in time: the question "Which account is the cafe current account\?" was not answered/);
  assert.ok(decisions.every(item => !/said no|refused|declined it/i.test(item.line) || item.who === 'timeout'), JSON.stringify(decisions));
  assert.notEqual(closed.answer, HOLD_DECLINE_ANSWER);

  // Today offers going on or leaving it: the stopped row with the line.
  const row = (await queue(env)).rows.find(item => item.id.startsWith('runctl:') && item.viewRef?.id === run.id);
  assert.equal(row?.line, LINE);
  assert.deepEqual(row?.actions.map(item => item.id), ['run-again', 'resume']);

  // Going on: the next turn reads the line among the answers, and waits for approval like any other.
  await call(env, 'venture.runs.resume', { runId: run.id });
  const resumed = record(env, run.id);
  assert.equal(resumed.status, 'waiting-for-you');
  const input = env.models.previewed.at(-1)!.input as { answers: { question: string; answer: string }[] };
  assert.deepEqual(input.answers.at(-1), { to: 'owner', question: QUESTION, answer: LINE });
});

test('a late answer is refused before anything moves, even before the sweep has run', async () => {
  const env = await setup();
  const run = await asking(env);
  env.advance(QUESTION_HOURS * HOUR + 1000);
  const sent = env.models.sent;
  await assert.rejects(call(env, 'venture.delivery.answer', { runId: run.id, answer: 'The HDFC one.' }), (error: any) => {
    assert.equal(error.code, 'DELIVERY_NOT_ASKING');
    assert.match(error.message, /^No answer by 17 Oct 2026, 15:30\./);
    return true;
  });
  assert.equal(record(env, run.id).status, 'needs-answer');
  assert.equal(env.models.sent, sent);
});

test('an answer in time still works as before', async () => {
  const env = await setup();
  const run = await asking(env);
  env.advance(QUESTION_HOURS * HOUR - 60_000);
  const next = await call<{ status: string }>(env, 'venture.delivery.answer', { runId: run.id, answer: 'The HDFC one.' });
  assert.equal(next.status, 'waiting-for-you');
  await routineTick(env.deps, owner);
  assert.equal(record(env, run.id).status, 'waiting-for-you', 'an answered question never times out');
  await assert.rejects(call(env, 'venture.delivery.answer', { runId: run.id, answer: 'Again.' }), code('DELIVERY_NOT_ASKING'));
});

test('a NEEDS_FACTS question never expires: expiresAt null, set where it is made, is the one rule', async () => {
  const env = await setup();
  const run = await asking(env);
  // A NEEDS_FACTS hand-off is made with expiresAt null (loop.ts, 4J16): the facts are needed however long they take.
  await ventureAction(env.deps, owner, 'prepare', 'test.facts', tx => {
    const current = tx.find('venture-delivery-run', run.id)!;
    const harness = structuredClone(current.harness!);
    harness.handoffs[harness.handoffs.length - 1].expiresAt = null;
    tx.replace<DeliveryRunRecord>({ ...current, harness });
  });
  const stored = record(env, run.id).harness!;
  assert.equal(withQuestionExpiry(stored, START, QUESTION_HOURS * HOUR).handoffs.at(-1)!.expiresAt, null, 'never stamped over');
  env.advance(30 * HOUR);
  await routineTick(env.deps, owner);
  assert.equal(record(env, run.id).status, 'needs-answer', 'never timed out');

  // A model's own question in a turn where a call was refused NEEDS_FACTS keeps its normal window.
  const fresh = { ...stored, toolCalls: stored.toolCalls.map(item => ({ ...item, envelope: { ok: false as const, error: { code: 'NEEDS_FACTS', name: 'NeedsFacts', message: 'Facts needed.' } } })),
    handoffs: stored.handoffs.map(item => { const { expiresAt: _drop, ...rest } = item; void _drop; return rest; }) };
  assert.equal(withQuestionExpiry(fresh, START, QUESTION_HOURS * HOUR).handoffs.at(-1)!.expiresAt, DAY_LATER);
});

test('Resume back to a question gives it a fresh window from then', async () => {
  const env = await setup();
  const run = await asking(env);
  await call(env, 'venture.runs.stop', { runId: run.id });
  env.advance(30 * HOUR);
  await routineTick(env.deps, owner);
  assert.equal(record(env, run.id).status, 'stopped', 'a stopped run is not timed out');
  await call(env, 'venture.runs.resume', { runId: run.id });
  const resumed = record(env, run.id);
  assert.equal(resumed.status, 'needs-answer');
  assert.equal(resumed.harness!.handoffs.at(-1)!.expiresAt, new Date(env.deps.clock().getTime() + QUESTION_HOURS * HOUR).toISOString());
  await routineTick(env.deps, owner);
  assert.equal(record(env, run.id).status, 'needs-answer', 'still answerable');
});
