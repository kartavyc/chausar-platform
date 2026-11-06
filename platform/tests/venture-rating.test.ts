// Ink v2 wave 4, package 4J16 (catalogue Q5): facts in, rating out. A model only ever gives typed facts about a
// finding; code computes its severity and priority from a fixed table and says why in rationale lines. A model that
// sends a severity, or a fact the table does not know, is refused. Dismissing a finding needs cited evidence of a kind
// the table allows, that resolves; a refused dismissal stays visible with its reason. A validator answers confirmed,
// not applicable or needs follow-up, and anything else reads as needs follow-up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import {
  RATING_TABLES, dismissFinding, rateFinding, readFacts, validatorAnswer, type RatedFinding,
} from '../runtime/venture/delivery/checks/rating.ts';
import { runFlagshipChecks, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';

test('code rates a finding from its facts by the table, with rationale lines; the first matching row wins', () => {
  const unbacked = rateFinding('claim', { source: 'nowhere', subject: 'money', audience: 'public' });
  assert.equal(unbacked.severity, 'high');
  assert.equal(unbacked.priority, 'fix-before-sending');
  assert.ok(unbacked.rationale.some(line => /no source/i.test(line)), JSON.stringify(unbacked.rationale));
  assert.ok(unbacked.rationale.some(line => /money/i.test(line)));
  assert.equal(unbacked.rationale.at(-1), 'Rated by code from the table, not by the AI.');
  const backed = rateFinding('claim', { source: 'client-files', subject: 'money', audience: 'public' });
  assert.equal(backed.severity, 'info');
  assert.equal(backed.priority, 'no-action');
  // The same facts always rate the same.
  assert.deepEqual(rateFinding('claim', { source: 'nowhere', subject: 'money', audience: 'public' }), unbacked);
  const disclosure = rateFinding('disclosure', { paid: 'yes', labelled: 'no', audience: 'public' });
  assert.equal(disclosure.severity, 'high');
  for (const kind of Object.keys(RATING_TABLES)) assert.ok(RATING_TABLES[kind].rows.length >= 3, kind);
});

test('a model gives typed facts only: a severity it sends, a fact the table lacks or a value off the list is refused', () => {
  const refused = (raw: unknown) => {
    try { readFacts('claim', raw); } catch (error) { assert.ok(error instanceof ChausarError); return (error as ChausarError).code; }
    return null;
  };
  assert.deepEqual(readFacts('claim', { source: 'message', subject: 'result', audience: 'client' }), { source: 'message', subject: 'result', audience: 'client' });
  assert.equal(refused({ source: 'nowhere', subject: 'money', audience: 'public', severity: 'low' }), 'MODEL_OUTPUT_REJECTED');
  assert.equal(refused({ source: 'somewhere', subject: 'money', audience: 'public' }), 'MODEL_OUTPUT_REJECTED');
  assert.equal(refused({ source: 'nowhere', subject: 'money' }), 'MODEL_OUTPUT_REJECTED');
  assert.equal(refused('high'), 'MODEL_OUTPUT_REJECTED');
});

const finding = (): RatedFinding => ({ id: 'f1', kind: 'claim', line: 'The post says sales doubled.', ...rateFinding('claim', { source: 'nowhere', subject: 'result', audience: 'public' }), status: 'open', dismissal: null });

test('dismissing needs cited evidence of an allowed kind that resolves; a refused dismissal stays visible with why', () => {
  const resolves = (evidence: { kind: string; ref: string }) => evidence.ref === 'upload_sales';
  const none = dismissFinding(finding(), [], resolves);
  assert.equal(none.status, 'dismissal-refused');
  assert.match(none.dismissal!.reason, /needs evidence/);
  const wrongKind = dismissFinding(finding(), [{ kind: 'model-opinion', ref: 'call_1' }], resolves);
  assert.equal(wrongKind.status, 'dismissal-refused');
  assert.match(wrongKind.dismissal!.reason, /client file, a receipt or a transcript time/);
  const dangling = dismissFinding(finding(), [{ kind: 'client-file', ref: 'upload_missing' }], resolves);
  assert.equal(dangling.status, 'dismissal-refused');
  assert.match(dangling.dismissal!.reason, /could not be found/);
  // Still listed, still rated: a refused dismissal never hides the finding.
  for (const item of [none, wrongKind, dangling]) { assert.equal(item.severity, 'high'); assert.equal(item.line, 'The post says sales doubled.'); }
  const ok = dismissFinding(finding(), [{ kind: 'client-file', ref: 'upload_sales' }], resolves);
  assert.equal(ok.status, 'dismissed');
  assert.deepEqual(ok.dismissal!.evidence, [{ kind: 'client-file', ref: 'upload_sales' }]);
});

test('a validator answers confirmed, not applicable or needs follow-up; anything else is needs follow-up', () => {
  assert.equal(validatorAnswer('confirmed'), 'confirmed');
  assert.equal(validatorAnswer('not-applicable'), 'not-applicable');
  assert.equal(validatorAnswer('needs-follow-up'), 'needs-follow-up');
  for (const raw of ['yes', '', null, 3, { answer: 'confirmed' }]) assert.equal(validatorAnswer(raw), 'needs-follow-up', JSON.stringify(raw));
});

// ---------------------------------------------------------------------------
// The CA firm's open items: a tax figure that rests on a fact nobody gave
// ---------------------------------------------------------------------------

const call = (id: string, turn: number, ok: boolean) => ({
  id, turn, tool: 'tax.income', input: null, inputDigest: id, outcome: ok ? 'succeeded' : 'failed', effect: 'compute', tier: 'code', receiptIds: [], tableIds: [],
  envelope: ok ? { ok: true, result: {} } : { ok: false, error: { code: 'NEEDS_FACTS', name: 'NeedsFacts', message: 'x', details: { retry: false, missing: [{ field: 'residency' }] } } },
});
const caInput = (toolCalls: unknown[]): FlagshipCheckInput => ({
  flagship: 'ca-firm', offerKey: 'itr-salaried', servedBy: 'model', request: 'My return, please.', intake: null, files: [], receipts: [], known: [], mode: 'client',
  today: '2026-10-21', dateOrder: 'day-month-year', finishing: null, toolCalls: toolCalls as never,
  deliverable: { title: 'Your papers', sections: [{ heading: 'Summary', parts: [{ kind: 'text', text: 'The papers follow.' }] }], questionsForClient: [] },
});
const factsResult = async (toolCalls: unknown[]) => (await runFlagshipChecks(caInput(toolCalls))).find(item => item.check === 'facts-answered');

test('a CA draft whose tax rests on facts the client never gave is rated by code from the table, high, and fails', async () => {
  const open = await factsResult([call('t1.1', 1, false)]);
  assert.equal(open?.outcome, 'fail');
  assert.match(open!.detail, /^Rated high by code: /);
  assert.match(open!.detail, /tax figure rests on a fact nobody has given/);
  assert.match(open!.detail, /whether you were resident in India/);
  // Once a later call of the same tool worked (the client answered), the open item is settled.
  const settled = await factsResult([call('t1.1', 1, false), call('t3.1', 3, true)]);
  assert.equal(settled?.outcome, 'pass');
  assert.match(settled!.detail, /answered/);
  // No calculator asked for facts: the check has nothing to say, so it is not listed.
  assert.equal(await factsResult([call('t1.1', 1, true)]), undefined);
});

test('facts-answered also flags a payee the agent left out after the client was asked about them', async () => {
  const tds = (id: string, turn: number, ok: boolean, payees: string[] = []) => ({
    ...call(id, turn, ok), tool: 'tax.tds',
    envelope: ok ? { ok: true, result: { payments: payees.map(payee => ({ payee })) } }
      : { ok: false, error: { code: 'NEEDS_FACTS', name: 'NeedsFacts', message: 'x', details: { retry: false, missing: [{ field: 'payeeKind', about: 'Meera Joshi' }, { field: 'payeeKind', about: 'Ravi Kumar' }] } } },
  });
  const skipped = await factsResult([tds('t1.1', 1, false), tds('t3.1', 3, true, ['Ravi Kumar'])]);
  assert.equal(skipped?.outcome, 'fail');
  assert.match(skipped!.detail, /Meera Joshi/);
  assert.doesNotMatch(skipped!.detail, /Ravi Kumar/);
  const worked = await factsResult([tds('t1.1', 1, false), tds('t3.1', 3, true, ['Meera Joshi', 'Ravi Kumar'])]);
  assert.equal(worked?.outcome, 'pass');
});
