// Judge checks in the check flow: the claim check with no model (claims-grounded), the rules judge as a check
// (rules-judge, counted by code, never passed without checked votes), and pairwise preference breaking a tie in the
// improvement gate. No network and no paid calls: every model here is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import { CHECK_IDS } from '../runtime/venture/contracts.ts';
import type { CaseScore, Deliverable, HarnessState, ModelTask, PriceReceiptRecord, SignalRecord } from '../runtime/venture/contracts.ts';
import { judgeDraftRules, preferDraft, runChecks, type CheckInput } from '../runtime/venture/delivery/checks.ts';
import { DEFAULT_LIMITS, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import { practiceFiles } from '../runtime/venture/delivery/harness/practice.ts';
import { gate } from '../runtime/venture/delivery/improve.ts';
import { DRAFT_RULES, decideRules, notRuled, type Ballot } from '../runtime/venture/delivery/judge/rules.ts';
import type { PairVote } from '../runtime/venture/delivery/judge/pairwise.ts';
import { VERIFY_CHECKS } from '../runtime/venture/delivery/playbook.ts';
import { scenariosFor, signalScenario } from '../runtime/venture/delivery/scenarios.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const text = (value: string) => ({ kind: 'text' as const, text: value });

function draftOf(...lines: string[]): Deliverable {
  return { title: 'Your September books', sections: [{ heading: 'Summary', parts: lines.map(text) }], questionsForClient: [] };
}

function input(deliverable: Deliverable, extra: Partial<CheckInput> = {}): CheckInput {
  return {
    checks: ['claims-grounded'], deliverable, renderedText: deliverable.sections.flatMap(section => section.parts.map(part => part.kind === 'text' ? part.text : '')).join('\n'),
    serviceType: 'bookkeeping', allowed: [], receipts: [], ventureId: 'venture_1', mocks: [], mockModes: {}, agentTurns: 1, turnLimit: 1, askedQuestions: false,
    ...extra,
  };
}

const receipt = (id: string, ventureId = 'venture_1') => ({
  id, ventureId, explanation: '1 x month at INR 2,499.00, plus GST at 18% (INR 449.82) = INR 2,948.82.',
  figures: [{ key: 'total', label: 'Total', minor: '294882', display: 'INR 2,948.82', currency: 'INR' }],
}) as unknown as PriceReceiptRecord;

function signal(reason: SignalRecord['reason']): SignalRecord {
  return { id: `signal_${reason}`, kind: 'venture-signal', ventureId: 'venture_1', memberId: 'owner', epoch: 1, at: '2026-10-15T10:00:00.000Z', source: 'owner-edited', runId: 'delivery_1', reason, scenarioId: null } as SignalRecord;
}

// ---------------------------------------------------------------------------
// Where each check runs
// ---------------------------------------------------------------------------

test('check lists: the claim check runs on every draft; the rules judge on every practice client, never in the verify step', () => {
  assert.ok(CHECK_IDS.includes('claims-grounded'));
  assert.ok(CHECK_IDS.includes('rules-judge'));
  assert.ok(VERIFY_CHECKS.includes('claims-grounded'), 'the verify step of a real order runs the claim check');
  assert.ok(!VERIFY_CHECKS.includes('rules-judge'), "a real order's judge call goes through the action journal (judge-run.ts), never the verify step");
  for (const scenario of scenariosFor('bookkeeping')) {
    assert.ok(scenario.checks.includes('claims-grounded'), scenario.id);
    assert.ok(scenario.checks.includes('rules-judge'), scenario.id);
  }
  // An owner's own feedback that code cannot check (tone, off the brief, claimed work) brings the rules judge in.
  assert.ok(signalScenario(signal('tone'), 'bookkeeping').checks.includes('rules-judge'));
  assert.ok(signalScenario(signal('off-brief'), 'bookkeeping').checks.includes('rules-judge'));
  assert.ok(signalScenario(signal('claims-work-not-done'), 'bookkeeping').checks.includes('rules-judge'));
  assert.ok(!signalScenario(signal('too-long'), 'bookkeeping').checks.includes('rules-judge'));
  assert.ok(signalScenario(signal('wrong-fact'), 'bookkeeping').checks.includes('claims-grounded'));
});

// ---------------------------------------------------------------------------
// claims-grounded
// ---------------------------------------------------------------------------

test('claims-grounded: a name the client never gave fails; the same name in the request, an answer or a known name passes', () => {
  const draft = draftOf('Thanks, Cafe Aroma Demo. We will match the HDFC Bank statement to your bills.');
  const known = ['Cafe Aroma Demo', 'Ledger Cafe Books'];
  const [unbacked] = runChecks(input(draft, { grounding: { clientRequest: 'Please close my September books.', known } }));
  assert.equal(unbacked.check, 'claims-grounded');
  assert.equal(unbacked.passed, false);
  assert.match(unbacked.detail, /HDFC Bank/);
  assert.doesNotMatch(unbacked.detail, /Cafe Aroma Demo/, 'a known name is never a claim');

  const [inRequest] = runChecks(input(draft, { grounding: { clientRequest: 'Please close my September books from the HDFC Bank account.', known } }));
  assert.equal(inRequest.passed, true, inRequest.detail);
  const [inAnswer] = runChecks(input(draft, { grounding: { clientRequest: 'Please close my books.', answers: ['It is the HDFC Bank current account.'], known } }));
  assert.equal(inAnswer.passed, true, inAnswer.detail);
});

test('claims-grounded: figures are matched against the receipts of this business and the client files, never a model guess', () => {
  const files = practiceFiles({ id: 'bookkeeping-clean', serviceType: 'bookkeeping', source: 'template' });
  const csv = Buffer.from(files.find(file => file.format === 'csv')!.contentBase64, 'base64').toString('utf8');
  const amount = /"(\d[\d,]*\.\d{2})"/.exec(csv.split('\n').slice(2).join('\n'))?.[1];
  assert.ok(amount, csv);

  const fromFile = draftOf(`The first payment on the statement was ${amount}.`);
  assert.equal(runChecks(input(fromFile, { grounding: { clientRequest: 'Close my books.', files } }))[0].passed, true, 'a figure in the client file is grounded');
  assert.equal(runChecks(input(fromFile, { grounding: { clientRequest: 'Close my books.' } }))[0].passed, false, 'without the file it is not');

  const total = draftOf('Your total for the month is 2,948.82.');
  assert.equal(runChecks(input(total, { receipts: [receipt('receipt_1')], grounding: { clientRequest: 'Close my books.' } }))[0].passed, true);
  assert.equal(runChecks(input(total, { receipts: [receipt('receipt_1', 'venture_other')], grounding: { clientRequest: 'Close my books.' } }))[0].passed, false,
    "another business's receipt is not a source");

  // A tool result of the run is a source; a failed tool call is not.
  const harness: HarnessState = {
    ...newHarnessState(['files.read'], DEFAULT_LIMITS, []),
    toolCalls: [{ id: 't1.1', turn: 1, tool: 'files.read', input: null, inputDigest: '', envelope: { ok: true, result: { rows: [{ cells: { Narration: 'MEHTA EXPORTS', Amount: '1200.00' } }] } }, outcome: 'succeeded', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] }],
  };
  assert.equal(runChecks(input(draftOf('Mehta Exports was paid 1200.'), { grounding: { clientRequest: 'Close my books.', harness } }))[0].passed, true);
});

test('claims-grounded: receipt figures code renders are not claims, and a draft with no specific claim passes', () => {
  const draft: Deliverable = { title: 'Your plan', sections: [{ heading: 'Summary', parts: [text('Your plan price is below.'), { kind: 'figure', receiptId: 'receipt_1', figureKey: 'total' }] }], questionsForClient: [] };
  const [result] = runChecks(input(draft, { grounding: { clientRequest: 'Hello.' } }));
  assert.equal(result.passed, true);
  assert.match(result.detail, /no specific claim/);
  // Without grounding the check still runs, on the receipts alone.
  assert.equal(runChecks(input(draftOf('We reviewed the Kotak Bank statement.')))[0].passed, false);
});

// ---------------------------------------------------------------------------
// rules-judge
// ---------------------------------------------------------------------------

const TRACE = { events: [
  { id: 'client-message', kind: 'client', summary: 'Please close my September books.' },
  { id: 'draft', kind: 'draft', summary: 'The draft reply.' },
] };
const allYes = (cite = 'client-message'): Ballot => DRAFT_RULES.map(rule => ({ rule: rule.id, answer: 'yes' as const, cites: [cite], quote: '', reason: 'Shown in the run.' }));

test('rules-judge: left out when no judge ruled; a verdict counted by code passes, fails or stays unsettled, never a pass by default', () => {
  const draft = draftOf('We will start once the files arrive.');
  const base = input(draft, { checks: ['house-style', 'rules-judge'] });
  assert.deepEqual(runChecks(base).map(result => result.check), ['house-style'], 'no AI judge ruled, so the check is not claimed either way');

  const pass = runChecks({ ...base, rules: decideRules(DRAFT_RULES, [allYes()], TRACE) }).find(result => result.check === 'rules-judge')!;
  assert.equal(pass.passed, true, pass.detail);

  const toneNo = allYes().map(vote => vote.rule === 'tone-fits' ? { ...vote, answer: 'no' as const, quote: 'The tone must suit this client.', cites: ['draft'] } : vote);
  const fail = runChecks({ ...base, rules: decideRules(DRAFT_RULES, [toneNo], TRACE) }).find(result => result.check === 'rules-judge')!;
  assert.equal(fail.passed, false);
  assert.match(fail.detail, /tone-fits/);

  const uncited = runChecks({ ...base, rules: decideRules(DRAFT_RULES, [allYes('t9.9')], TRACE) }).find(result => result.check === 'rules-judge')!;
  assert.equal(uncited.passed, false, 'a vote citing nothing in the run never counts as a pass');
  assert.match(uncited.detail, /Not settled/);

  const unruled = runChecks({ ...base, rules: notRuled(DRAFT_RULES, 'No AI judge connected.') }).find(result => result.check === 'rules-judge')!;
  assert.equal(unruled.passed, false);
});

test('rules-judge: the judge sees the trace, the client message and the draft; a refused answer leaves the rules unsettled', async () => {
  const seen: ModelTask<Ballot>[] = [];
  const ask = async (task: ModelTask<Ballot>) => { seen.push(task); return { value: task.validate({ votes: allYes() }), callId: 'call_1' }; };
  const harness: HarnessState = {
    ...newHarnessState(['files.read'], DEFAULT_LIMITS, []),
    toolCalls: [{ id: 't1.1', turn: 1, tool: 'files.read', input: null, inputDigest: '', envelope: { ok: true, result: { rows: [] } }, outcome: 'succeeded', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] }],
  };
  const verdict = await judgeDraftRules(ask, {
    draft: 'Draft words with [price from Chausar].', clientRequest: 'Please close my September books.', harness, containsClientData: false,
    context: 'Expected outcome: a reply that sets out the plan.',
  });
  assert.equal(verdict.outcome, 'pass', verdict.detail);
  assert.deepEqual(verdict.callIds, ['call_1']);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].schemaName, 'venture-judge-rules');
  assert.equal(seen[0].containsClientData, false);
  const ids = (seen[0].input as { trace: { id: string }[] }).trace.map(event => event.id);
  assert.ok(ids.includes('t1.1') && ids.includes('client-message') && ids.includes('draft'), ids.join(','));

  const refused = await judgeDraftRules(async () => { throw new ChausarError('MODEL_OUTPUT_REJECTED', 'The judge did not answer in the expected shape.'); }, {
    draft: 'Draft words.', clientRequest: 'Hello.', containsClientData: false, context: '',
  });
  assert.equal(refused.outcome, 'unverified');
  assert.match(refused.detail, /refused/);
  await assert.rejects(judgeDraftRules(async () => { throw new ChausarError('BUDGET_REACHED', 'The monthly limit is reached.'); }, {
    draft: 'Draft words.', clientRequest: 'Hello.', containsClientData: false, context: '',
  }), code('BUDGET_REACHED'));
});

// ---------------------------------------------------------------------------
// Pairwise in the improvement gate
// ---------------------------------------------------------------------------

function pairJudge(pick: (first: string, second: string) => PairVote['choice']) {
  let calls = 0;
  return async (task: ModelTask<PairVote>) => {
    const shown = task.input as { first: string; second: string };
    calls += 1;
    return { value: task.validate({ choice: pick(shown.first, shown.second), reason: 'Plain reason.' }), callId: `call_${calls}` };
  };
}

test('pairwise: the judge prefers one draft only when both orders agree; a refused answer is no preference', async () => {
  const prefersWarm = pairJudge((first, second) => first.includes('warm') ? 'first' : second.includes('warm') ? 'second' : 'tie');
  const picked = await preferDraft(prefersWarm, { question: 'Which reply better serves the client?', parent: 'A plain reply.', candidate: 'A warm reply.' });
  assert.equal(picked.winner, 'candidate');
  const firstShown = await preferDraft(pairJudge(() => 'first'), { question: 'Which?', parent: 'One.', candidate: 'Two.' });
  assert.equal(firstShown.winner, null, 'a judge that always picks what it sees first prefers nothing');
  const refused = await preferDraft(async () => { throw new ChausarError('MODEL_REFUSAL', 'No.'); }, { question: 'Which?', parent: 'One.', candidate: 'Two.' });
  assert.equal(refused.winner, null);
  assert.match(refused.detail, /refused/);
});

test('gate: a pairwise preference breaks a tie the scores left, and never overrides a score', () => {
  const score = (fields: Partial<CaseScore> = {}): CaseScore => ({ passed: true, checksPassed: 9, checksRun: 9, judgeYes: 4, critical: null, firstFailure: null, ...fields });
  const tied = { scenarioId: 'case_1', set: 'rehearsal' as const, parent: score(), candidate: score() };
  assert.equal(gate([tied], false).decision, 'keep-parent');
  const preferred = gate([{ ...tied, pairwise: { winner: 'candidate' as const, detail: 'candidate was preferred.' } }], false);
  assert.equal(preferred.cases[0].winner, 'candidate');
  assert.deepEqual(preferred.cases[0].pairwise, { winner: 'candidate', detail: 'candidate was preferred.' });
  assert.equal(preferred.decision, 'keep-candidate');
  const scored = gate([{ ...tied, parent: score({ checksPassed: 8, passed: false }), pairwise: { winner: 'parent' as const, detail: 'parent was preferred.' } }], false);
  assert.equal(scored.cases[0].winner, 'candidate', 'the scores decide first');
  assert.equal(gate([{ ...tied, pairwise: { winner: 'candidate' as const, detail: 'x' } }], true).decision, 'keep-parent', 'template drafts are never chosen between');
});
