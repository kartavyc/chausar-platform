// Ink v2 wave 4 (4J14, Q8, Q21, Q22): outcome words for a run that acts outside, the three classes of findings, a
// draft's report in three columns (measured by code, looked at by a model, needs a human), the counted-by-code fallback
// for a summary that failed, and decide-first answers for optional agent actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, RunDetail } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { ChausarError } from '../runtime/contracts.ts';
import { COUNTED_BY_CODE, countedByCode, summaryOr } from '../runtime/venture/delivery/fallbacks.ts';
import { decideFirstSchema, readDecideFirst } from '../runtime/venture/delivery/decide-first.ts';
import { actOutcome, deliverableReport, runOutcome } from '../runtime/venture/delivery/outcomes.ts';
import { coverageView } from '../runtime/venture/delivery/coverage.ts';
import { call, harness, owner, seedBlueprint, seedOrder, seedRun, setup } from './venture-views-env.ts';
import { business, noOn, PLAIN_IDEA, readyDraft } from './venture-judge-helpers.ts';
import { DRAFT_RULES } from '../runtime/venture/delivery/judge/rules.ts';
import { REVIEW_INCOMPLETE } from '../runtime/venture/delivery/verdicts.ts';
import { answer, chatConsent, chiefBusiness, proposalFields, scriptChief, text, tools } from './venture-chief-helpers.ts';
import { episodeOrder } from './venture-agent-helpers.ts';

const AT = '2026-10-15T10:00:00.000Z';

test('one outside act: Success only on a code check of the real result; Not checked without one; Failed when refused', () => {
  const platform = { line: 'Posted.', url: 'https://example.com/p/1', by: 'platform' as const };
  assert.deepEqual(actOutcome({ state: 'applied', outcome: platform }), { outcome: 'success', line: 'Success: the platform confirmed it.', applied: true });
  assert.deepEqual(actOutcome({ state: 'applied', outcome: { line: 'Sent.', url: null, by: 'engine' }, ends: [{ state: 'verified', at: AT, by: 'engine', line: 'Read back.', check: { id: 'readback', checkedOn: '2026-10-15' } }] }),
    { outcome: 'success', line: 'Success: a dated check verified it.', applied: true }, 'verified wins over who said it went');
  assert.deepEqual(actOutcome({ state: 'applied', outcome: { line: 'I sent it.', url: null, by: 'owner' } }),
    { outcome: 'not-checked', line: 'Not checked: no code check of the real result.', applied: true });
  assert.deepEqual(actOutcome({ state: 'applied', outcome: { line: 'Done.', url: null, by: 'engine' } }),
    { outcome: 'not-checked', line: 'Not checked: no code check of the real result.', applied: true });
  assert.deepEqual(actOutcome({ state: 'outcome_unknown', outcome: null }),
    { outcome: 'not-checked', line: 'Not checked: it may or may not have happened. Check before trying again.', applied: false });
  assert.deepEqual(actOutcome({ state: 'rejected', outcome: { line: 'Refused (403).', url: null, by: 'platform' } }),
    { outcome: 'failed', line: 'Failed: the platform refused it.', applied: false });
  assert.equal(actOutcome({ state: 'rejected', outcome: { line: 'You chose not to.', url: null, by: 'owner' } }), null, 'nothing went out');
  assert.equal(actOutcome({ state: 'described', outcome: null }), null);
  assert.equal(actOutcome({ state: 'approved', outcome: null }), null);
  assert.equal(actOutcome({ state: 'weird' as never, outcome: null }), null);
  // Several targets: Success needs every one applied; some refused is Failed, some unknown or partial is Not checked.
  const target = (id: string, outcome: 'applied' | 'rejected' | 'partial' | 'unknown' | 'throttled') => ({ id, outcome, line: outcome });
  assert.deepEqual(actOutcome({ state: 'applied', outcome: platform, targets: [target('a', 'applied'), target('b', 'applied')] }),
    { outcome: 'success', line: 'Success: the platform confirmed it.', applied: true });
  assert.deepEqual(actOutcome({ state: 'applied', outcome: platform, targets: [target('a', 'applied'), target('b', 'rejected'), target('c', 'applied')] }),
    { outcome: 'failed', line: 'Failed: 2 of 3 targets went; the rest did not.', applied: true });
  assert.deepEqual(actOutcome({ state: 'applied', outcome: platform, targets: [target('a', 'applied'), target('b', 'throttled')] }),
    { outcome: 'failed', line: 'Failed: 1 of 2 targets went; the rest did not.', applied: true });
  assert.deepEqual(actOutcome({ state: 'applied', outcome: platform, targets: [target('a', 'applied'), target('b', 'partial')] }),
    { outcome: 'not-checked', line: 'Not checked: 1 of 2 targets went in full; the rest went in part or may have gone.', applied: true });
  assert.deepEqual(actOutcome({ state: 'outcome_unknown', outcome: null, targets: [target('a', 'applied'), target('b', 'unknown')] }),
    { outcome: 'not-checked', line: 'Not checked: 1 of 2 targets went in full; the rest went in part or may have gone.', applied: true });
});

test('a run: the weakest of its acts; the gave-up line only when nothing was applied; a provider failure says the run failed', () => {
  const ok = { outcome: 'success' as const, line: '', applied: true };
  const unchecked = { outcome: 'not-checked' as const, line: '', applied: true };
  const refused = { outcome: 'failed' as const, line: '', applied: false };
  assert.deepEqual(runOutcome({ failed: null, proposed: false, acts: [ok, ok] }), { outcome: 'success', line: 'Success: 2 outside actions, each confirmed.' });
  assert.deepEqual(runOutcome({ failed: null, proposed: false, acts: [ok] }), { outcome: 'success', line: 'Success: the outside action was confirmed.' });
  assert.deepEqual(runOutcome({ failed: null, proposed: false, acts: [ok, unchecked] }), { outcome: 'not-checked', line: 'Not checked: 1 of 2 outside actions has no code check of its real result.' });
  assert.deepEqual(runOutcome({ failed: null, proposed: false, acts: [ok, refused] }), { outcome: 'failed', line: 'Failed: 1 of 2 outside actions did not happen.' });
  assert.deepEqual(runOutcome({ failed: 'agent', proposed: true, acts: [] }), { outcome: 'failed', line: 'Failed: the agent gave up before its outside action was done.' });
  assert.deepEqual(runOutcome({ failed: 'provider', proposed: true, acts: [] }), { outcome: 'failed', line: 'Failed: the run failed before its outside action was done.' });
  assert.deepEqual(runOutcome({ failed: 'agent', proposed: false, acts: [refused] }), { outcome: 'failed', line: 'Failed: the agent gave up before its outside action was done.' });
  assert.deepEqual(runOutcome({ failed: 'agent', proposed: false, acts: [ok] }), { outcome: 'success', line: 'Success: the outside action was confirmed.' },
    'what was applied stands on its own; the gave-up line is only for a run that applied nothing');
  assert.equal(runOutcome({ failed: null, proposed: true, acts: [] }), null, 'proposed but not yet done');
  assert.equal(runOutcome({ failed: 'agent', proposed: false, acts: [] }), null, 'a run that never acted outside has no outcome word; its state says failed');
  assert.equal(runOutcome({ failed: null, proposed: false, acts: [] }), null);
});

const NO_JUDGE = { state: 'none' as const, rules: null, line: null };

test('the report: three columns, findings in three classes, details without their own word, codes for the screen', () => {
  const report = deliverableReport({
    playbook: 'youtube',
    checks: [
      { check: 'house-style', passed: true, detail: 'Fine.' },
      { check: 'figures-resolve', passed: false, detail: 'A price in the draft does not match any receipt in this business.' },
      { check: 'rules-judge', passed: false, detail: 'Failed: tone-fits.' },
    ],
    playbookChecks: [{ playbook: 'youtube', check: 'hook-score', outcome: 'pass', detail: 'Chausar kept the better hook.' }],
    judge: { state: 'done', line: null, rules: [{ rule: 'goal-met', outcome: 'pass', yes: 3, votes: 3 }, { rule: 'tone-fits', outcome: 'fail', yes: 1, votes: 3 }, { rule: 'cites-source', outcome: 'unverified', yes: 0, votes: 3 }] },
    coverage: null, generatedAt: AT, draftAt: null,
  });
  assert.deepEqual(report.measured.map(item => [item.id, item.outcome, item.line, item.detail]), [
    ['house-style', 'pass', 'Passed: Fine.', 'Fine.'],
    ['figures-resolve', 'fail', 'Failed: A price in the draft does not match any receipt in this business.', 'A price in the draft does not match any receipt in this business.'],
    ['youtube:hook-score', 'pass', 'Passed: Chausar kept the better hook.', 'Chausar kept the better hook.'],
  ]);
  assert.deepEqual(report.lookedAt.map(item => [item.id, item.outcome, item.line, item.judgment ?? null, item.drop ?? null]), [
    ['rules-judge', 'fail', 'Failed: tone-fits.', null, null],
    ['rules-judge:goal-met', 'pass', 'Passed: strong, 3 of 3 checked votes said yes.', 'strong', null],
    ['rules-judge:tone-fits', 'fail', 'Failed: weak, 1 of 3 checked votes said yes.', 'weak', 'Dropped: weak is below the keep line, fair.'],
    ['rules-judge:cites-source', 'not-checked', 'Not checked: the votes did not settle it.', null, 'Dropped: it was not judged, and an unknown is never kept.'],
  ]);
  assert.deepEqual(report.needsHuman.map(item => item.code), ['youtube-voice', 'youtube-story']);
  assert.ok(report.needsHuman.every(item => item.line.endsWith('.')));
  assert.deepEqual(report.findings.map(item => [item.class, item.id]), [
    ['hard-error', 'figures-resolve'], ['content', 'rules-judge:tone-fits'], ['creative', 'youtube-voice'], ['creative', 'youtube-story'],
  ]);
  assert.equal(report.verdict, 'do-not-send', 'one failed rule settles the judge, so the review is complete; a figure no receipt backs must not go out');
  assert.deepEqual(report.review, { complete: true, line: null });
  assert.deepEqual(report.generatedBy, ['code', 'judge']);
  assert.deepEqual([report.at, report.stale, report.staleLine], [AT, false, null]);
});

test('the report: a complete review with a failed safety check is DO NOT SEND; a number in the prose is one', () => {
  const report = deliverableReport({
    playbook: null, checks: [{ check: 'house-style', passed: true, detail: 'Fine.' }, { check: 'no-numeric-prose', passed: false, detail: 'The draft writes 12 in words.' }],
    playbookChecks: [], judge: NO_JUDGE, coverage: null, generatedAt: AT, draftAt: null,
  });
  assert.deepEqual([report.verdict, report.verdictLine], ['do-not-send', 'DO NOT SEND: 1 check that guards what goes out failed. No AI judge looked at it.']);
  assert.deepEqual(report.review, { complete: true, line: null });
  assert.equal(report.result, undefined, 'no client files, so no coverage and no partial word');
});

test('the report: no judge is "Not run" in the looked-at column, PASS says so, and an edit after it makes it stale', () => {
  const report = deliverableReport({
    playbook: null, checks: [{ check: 'house-style', passed: true, detail: 'Fine.' }], playbookChecks: [], judge: NO_JUDGE,
    coverage: coverageView(130, 130, 'rows', 'read'), generatedAt: AT, draftAt: '2026-10-15T11:00:00.000Z',
  });
  assert.deepEqual(report.lookedAt, [{ id: 'rules-judge', outcome: 'not-run', line: 'Not run: no AI judge looked at this draft.', detail: 'no AI judge looked at this draft.' }]);
  assert.equal(report.verdict, 'pass');
  assert.equal(report.verdictLine, 'PASS: every check ran and passed. No AI judge looked at it.');
  assert.deepEqual(report.generatedBy, ['code']);
  assert.equal(report.result, 'complete');
  assert.equal(report.stale, true);
  assert.equal(report.staleLine, 'Stale: the draft changed after these checks ran. They describe an earlier version.');
  assert.deepEqual(report.needsHuman, [{ code: 'reply-fits', line: 'Whether the reply reads right for this client.' }]);
});

test('the report: a judge that waits, is due or failed reads Not run, and the review stays incomplete with no verdict', () => {
  const base = { playbook: null, checks: [{ check: 'house-style' as const, passed: false, detail: 'Too long.' }], playbookChecks: [], coverage: null, generatedAt: AT, draftAt: null };
  const lines = {
    waiting: "Not run: the judge's call waits for you to send it.",
    pending: 'Not run: the judge is due and has not read this draft yet.',
    failed: "Not run: the judge's call failed. The provider did not answer.",
  } as const;
  for (const state of ['waiting', 'pending', 'failed'] as const) {
    const report = deliverableReport({ ...base, judge: { state, rules: null, line: state === 'failed' ? 'The provider did not answer.' : null } });
    assert.deepEqual(report.lookedAt.map(item => [item.outcome, item.line]), [['not-run', lines[state]]], state);
    assert.deepEqual([report.verdict, report.verdictLine, report.review.complete], [null, REVIEW_INCOMPLETE, false], state);
    assert.deepEqual(report.findings.filter(item => item.class === 'hard-error').map(item => item.id), ['house-style'], 'failures stay findings');
  }
});

test('the report: incomplete coverage or an unrun check is no review; a not-checked judge is not a pass', () => {
  const partial = deliverableReport({
    playbook: null, checks: [{ check: 'house-style', passed: true, detail: 'Fine.' }], playbookChecks: [], judge: NO_JUDGE,
    coverage: coverageView(120, 130, 'rows', 'read'), generatedAt: AT, draftAt: null,
  });
  assert.deepEqual([partial.result, partial.verdict, partial.review], ['partial', null, { complete: false, line: REVIEW_INCOMPLETE }]);
  const unsettled = deliverableReport({
    playbook: null, checks: [{ check: 'house-style', passed: true, detail: 'Fine.' }, { check: 'rules-judge', passed: false, detail: 'Not settled: tone-fits.', notChecked: true }],
    playbookChecks: [], judge: { state: 'done', rules: null, line: null }, coverage: null, generatedAt: AT, draftAt: null,
  });
  assert.deepEqual(unsettled.lookedAt.map(item => [item.outcome, item.line]), [['not-checked', 'Not checked: Not settled: tone-fits.']]);
  assert.equal(unsettled.verdict, null);
  assert.equal(unsettled.findings.filter(item => item.class !== 'creative').length, 0, 'not checked is no finding, and no pass either');
});

test('venture.runs.get: a posted draft is Success, an owner-sent one Not checked, a run that gave up Failed', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const draft = { deliverable: { title: 'Posts', sections: [] } as never, renderedText: 'Draft.', checks: [{ check: 'house-style' as const, passed: true, detail: 'Fine.' }] };
  const posted = await seedRun(env, order, { status: 'accepted', ...draft, verdict: { choice: 'accepted', reason: null, at: AT } } as Partial<DeliveryRunRecord>);
  const handed = await seedRun(env, order, { status: 'accepted', ...draft, verdict: { choice: 'accepted', reason: null, at: AT } } as Partial<DeliveryRunRecord>);
  const quiet = await seedRun(env, order, { status: 'accepted', ...draft, verdict: { choice: 'accepted', reason: null, at: AT } } as Partial<DeliveryRunRecord>);
  const mocks = [{ connector: 'mail-app', operation: 'send-deliverable', payloadDigest: 'p', recordedAt: AT }];
  const gaveUp = await seedRun(env, order, { status: 'failed', harness: harness({ mocks }) } as Partial<DeliveryRunRecord>);
  await ventureAction(env.deps, owner, 'prepare', 'seed.posts', tx => {
    const ventureId = tx.venture!.id;
    tx.state.conversations.push({ id: 'post_1', kind: 'venture-connector-post', ventureId, draftId: posted.id, state: 'applied', outcome: { line: 'Posted.', url: 'https://example.com/p/1', by: 'platform' } });
    tx.state.conversations.push({ id: 'post_2', kind: 'venture-connector-post', ventureId, draftId: handed.id, state: 'applied', outcome: { line: 'You sent it.', url: null, by: 'owner' } });
    tx.state.conversations.push({ id: 'post_3', kind: 'venture-connector-post', ventureId, draftId: quiet.id, state: 'described', outcome: null });
    tx.state.conversations.push({ id: 'call_failed', kind: 'venture-model-call', ventureId, status: 'failed', error: { code: 'MODEL_FAILED', message: 'The provider did not answer.' } });
  });
  const providerDown = await seedRun(env, order, { status: 'failed', callId: 'call_failed', harness: harness({ mocks }) } as Partial<DeliveryRunRecord>);
  const get = (runId: string) => call<RunDetail>(env, 'venture.runs.get', { runId });
  assert.deepEqual((await get(posted.id)).outcome, { outcome: 'success', line: 'Success: the outside action was confirmed.' });
  assert.deepEqual((await get(handed.id)).outcome, { outcome: 'not-checked', line: 'Not checked: the outside action has no code check of its real result.' });
  assert.equal((await get(quiet.id)).outcome, undefined, 'still waiting for the owner: nothing went out yet');
  const failed = await get(gaveUp.id);
  assert.deepEqual([failed.state, failed.outcome], ['failed', { outcome: 'failed', line: 'Failed: the agent gave up before its outside action was done.' }]);
  assert.deepEqual((await get(providerDown.id)).outcome, { outcome: 'failed', line: 'Failed: the run failed before its outside action was done.' });
  // The report rides on the run's own sheet.
  const report = (await get(posted.id)).report!;
  assert.deepEqual(report.measured.map(item => item.line), ['Passed: Fine.']);
  assert.equal(report.verdict, 'pass');
});

test("judgeSend keeps each rule's result on the run, and the report words them with the keep line", async () => {
  const env = await business(PLAIN_IDEA);
  await env.call('venture.judge.auto.set', { auto: false });
  env.models.respond['judge-rules'] = noOn('policy-followed', 'The reply offers a discount the plan does not have.');
  const run = await readyDraft(env);
  const waiting = await env.call('venture.delivery.judge', { runId: run.id });
  const before = await env.call('venture.runs.get', { runId: run.id });
  assert.deepEqual(before.report.lookedAt.map((item: any) => [item.outcome, item.line]), [['not-run', "Not run: the judge's call waits for you to send it."]]);
  assert.deepEqual([before.report.verdict, before.report.review.complete], [null, false]);
  await env.call('venture.delivery.judgeSend', { runId: run.id, digest: waiting.digest });
  const stored = listRecords(env.store.read(), 'venture-delivery-run').find(item => item.id === run.id)!;
  const rules = stored.judge!.rules!;
  assert.deepEqual(rules.map(rule => rule.rule), DRAFT_RULES.map(rule => rule.id));
  const policy = rules.find(rule => rule.rule === 'policy-followed')!;
  assert.deepEqual([policy.outcome, policy.yes, policy.votes], ['fail', 0, 1]);
  const after = await env.call('venture.runs.get', { runId: run.id });
  const shown = after.report.lookedAt.find((item: any) => item.id === 'rules-judge:policy-followed');
  assert.deepEqual([shown.outcome, shown.judgment, shown.drop], ['fail', 'no', 'Dropped: no is below the keep line, fair.']);
  assert.equal(after.report.lookedAt.find((item: any) => item.id === 'rules-judge:goal-met').judgment, 'strong');
});

// ---------------------------------------------------------------------------
// Q21: when a model summary or chart fails, code counts instead. Q22: optional agent actions decide first.
// ---------------------------------------------------------------------------

test('fallback: counts per kind and new records per month, by code, labelled as such', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  await seedOrder(env, plan);
  env.advance(40 * 24 * 60 * 60_000);
  await seedOrder(env, plan);
  const state = env.store.read();
  const venture = listRecords(state, 'venture-record').at(-1)!;
  const view = countedByCode(state, venture, new Date(env.now()));
  assert.equal(view.line, "Counted by code; the summary didn't work.");
  assert.equal(COUNTED_BY_CODE, view.line);
  const counts = Object.fromEntries(view.entities.map(entity => [entity.kind, entity.count]));
  assert.deepEqual(counts, { clients: 2, orders: 2, invoices: 0, runs: 0, people: 0, leads: 0 });
  assert.deepEqual(view.entities.map(entity => entity.label), ['Clients', 'Orders', 'Invoices', 'Runs', 'People in your network', 'Leads']);
  assert.equal(view.months.length, 6);
  assert.deepEqual(view.months.slice(-2), [{ month: '2026-10', count: 2 }, { month: '2026-11', count: 2 }]);
  assert.ok(view.months.slice(0, -2).every(month => month.count === 0), 'counted months with nothing new are 0: the whole vault was counted');
  // A business still in its interview has no country: months fall back to UTC.
  const bare = countedByCode({ conversations: [] } as never, { ...venture, country: null } as never, new Date('2026-03-15T00:00:00.000Z'), 2);
  assert.deepEqual(bare.months, [{ month: '2026-02', count: 0 }, { month: '2026-03', count: 0 }]);
});

test('fallback: summaryOr gives the summary when it works and the counts when it fails, never both', async () => {
  const env = await setup();
  const state = env.store.read();
  const venture = listRecords(state, 'venture-record').at(-1)!;
  const now = new Date(env.now());
  assert.deepEqual(await summaryOr(async () => 'All quiet.', state, venture, now), { summary: 'All quiet.' });
  const failed = await summaryOr(async () => { throw new Error('The provider did not answer.'); }, state, venture, now);
  assert.ok('fallback' in failed && failed.fallback.line === COUNTED_BY_CODE && !('summary' in failed));
});

test('decide first: a yes and its reason come before any content; default no; content without a yes is dropped', () => {
  const read = (value: unknown) => { if (typeof value !== 'string' || !value.trim()) throw new ChausarError('MODEL_OUTPUT_REJECTED', 'No line.'); return value.trim(); };
  assert.deepEqual(readDecideFirst({ decision: 'yes', reason: 'They asked about a second month.', content: 'Add a line about next month.' }, read),
    { decision: 'yes', reason: 'They asked about a second month.', content: 'Add a line about next month.', dropped: null });
  assert.deepEqual(readDecideFirst({ decision: 'no', reason: 'Nothing to add.' }, read), { decision: 'no', reason: 'Nothing to add.', content: null, dropped: null });
  assert.deepEqual(readDecideFirst({ decision: 'no', reason: 'No.', content: 'Buy more!' }, read),
    { decision: 'no', reason: 'No.', content: null, dropped: 'The answer was no, so its content was dropped.' });
  assert.deepEqual(readDecideFirst({ content: 'Buy more!', decision: 'yes', reason: 'Because.' }, read),
    { decision: 'no', reason: 'Because.', content: null, dropped: 'The content came before the decision, so it was dropped.' });
  assert.deepEqual(readDecideFirst({ decision: 'yes', content: 'Buy more!', reason: 'Because.' }, read),
    { decision: 'no', reason: 'Because.', content: null, dropped: 'The content came before the reason, so it was dropped.' });
  assert.deepEqual(readDecideFirst({ decision: 'yes', reason: '  ', content: 'Buy more!' }, read),
    { decision: 'no', reason: '', content: null, dropped: 'A yes needs a reason, so its content was dropped.' });
  assert.deepEqual(readDecideFirst({ decision: 'yes', reason: 'Fine.' }, read), { decision: 'no', reason: 'Fine.', content: null, dropped: 'A yes came with nothing to add.' });
  assert.deepEqual(readDecideFirst({ decision: 'yes', reason: 'Fine.', content: '' }, read), { decision: 'no', reason: 'Fine.', content: null, dropped: 'The content did not pass its checks, so it was dropped.' });
  for (const raw of [null, 'yes', [], {}, { decision: 'maybe', reason: 'x', content: 'y' }, { decision: true, reason: 'x' }]) {
    const decided = readDecideFirst(raw, read);
    assert.equal(decided.decision, 'no', JSON.stringify(raw));
    assert.equal(decided.content, null);
  }
  assert.equal(readDecideFirst({ decision: 'no', reason: 'x'.repeat(500) }, read).reason.length, 200);
});

test('decide first: the schema asks for the decision and its reason before the content, and nothing else', () => {
  const schema = decideFirstSchema({ type: 'string', maxLength: 300 });
  assert.deepEqual(Object.keys(schema.properties), ['decision', 'reason', 'content']);
  assert.deepEqual(schema.properties.decision, { type: 'string', enum: ['no', 'yes'] });
  assert.deepEqual(schema.required, ['decision', 'reason']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.content, { type: 'string', maxLength: 300 });
});

// ---------------------------------------------------------------------------
// Q21 and Q22 wired into the chief (chief/answer.ts): counts by code when the AI's answer fails or there is no AI;
// each proposal the chief makes is decided first, and a no drops it.
// ---------------------------------------------------------------------------

/** A proposal decided first, as the chief's schema now asks for it. */
const decided = (decision: string, content: unknown, reason = 'The owner asked what to do next.') => ({ decision, reason, content });

test('chief: with no AI, and when its answer fails the checks, the records answer carries the counts by code', async () => {
  const env = await chiefBusiness();
  env.models.main = 'template';
  env.models.fast = 'template';
  const reply = (await env.chief('venture.chief.thread.send', { text: 'How is the business doing?' })).added[1];
  const texts = reply.parts.filter((part: any) => part.kind === 'text').map((part: any) => part.text);
  // 4C2 review: the counts travel structured, kind by kind and month by month, and the screen words them and their label.
  assert.ok(!texts.includes(COUNTED_BY_CODE), 'the label is the screen\'s words');
  assert.deepEqual(reply.counted.entities.map((entity: any) => entity.kind), ['clients', 'orders', 'invoices', 'runs', 'people', 'leads']);
  assert.ok(reply.counted.entities.every((entity: any) => Number.isInteger(entity.count) && entity.count >= 0));
  assert.equal(reply.counted.months.length, 3);
  assert.ok(reply.counted.months.every((month: any) => /^\d{4}-\d{2}$/.test(month.month) && Number.isInteger(month.count)));
  assert.deepEqual((await env.chief('venture.chief.thread.list', { threadId: (await env.chief('venture.chief.threads')).groups[0].threads[0].id })).messages[1].counted, reply.counted, 'kept with the message');
  assert.match(texts.at(-1), /Connect your AI in Connections/, 'the tail stays last');
  assert.ok(reply.parts.every((part: any) => part.kind !== 'estimate'), 'counts by code are no model estimate');

  const failing = await chiefBusiness();
  await chatConsent(failing);
  scriptChief(failing, [{ nope: true }]);
  const failed = (await failing.chief('venture.chief.thread.send', { text: 'How is the business doing?' })).added[1];
  assert.match(failed.parts[0].text, /did not pass Chausar's checks/);
  assert.equal(failed.counted.entities.length, 6);
});

test('chief: a capped answer keeps its own words, with no counts', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  env.models.estimateFor = () => '60000';
  scriptChief(env, [tools('money'), answer([text('Never sent.')])]);
  const reply = (await env.chief('venture.chief.thread.send', { text: 'How is money?' })).added[1];
  assert.ok(!reply.parts.some((part: any) => part.text === COUNTED_BY_CODE));
  assert.equal(reply.counted, null);
});

test('chief: every proposal is decided first; a no, or content before the decision, drafts nothing', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const order = await episodeOrder(env);
  const start = proposalFields('start-run', { orderId: order.id });
  scriptChief(env, [answer([text('Here is what I would do next.')], [
    decided('no', start, 'Nothing needs doing.'),
    { content: start, decision: 'yes', reason: 'Because.' },
    decided('yes', start, ''),
    decided('yes', start),
  ])]);
  await env.chief('venture.chief.thread.send', { text: 'What should I do next?' });
  const stored = listRecords(env.store.read(), 'venture-proposal');
  assert.equal(stored.length, 1, 'only the yes with its reason, written before its content');
  assert.equal(stored[0].proposalKind, 'start-run');
  const task = env.models.previewed.at(-1)!;
  const items = (task.schema as any).properties.proposals.items;
  assert.deepEqual(Object.keys(items.properties), ['decision', 'reason', 'content']);
  assert.deepEqual(items.properties.decision.enum, ['no', 'yes']);
});
