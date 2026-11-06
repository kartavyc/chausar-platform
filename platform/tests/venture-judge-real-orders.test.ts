// The rules judge on real orders (Ink v2 wave 2, package 2C1, catalogue Q1 and the founder's decision of 23 Oct).
// "Ask the judge" (venture.delivery.judge) previews the judge's call on a ready agent draft; "Send to the judge"
// (venture.delivery.judgeSend) sends it once through the action journal and code counts the votes. A failed verdict
// blocks Accept with the judge's reason; a vote code could not check settles nothing and blocks nothing. With judgeAuto
// on (the default), the judge runs on its own on every ready draft that goes to a client or the public, once per draft,
// under the standing consent recorded once; internal papers for the CA never trigger it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { DRAFT_RULES } from '../runtime/venture/delivery/judge/rules.ts';
import { CA_JUDGE_RULES } from '../runtime/venture/playbooks/ca-firm/claims.ts';
import { autoJudge, JUDGE_AUTO_ON_LINE, JUDGE_EDIT_LINE, JUDGE_UNSHOWN_LINE, recheckJudgeSend } from '../runtime/venture/delivery/judge-run.ts';
import { JUDGE_READING } from '../runtime/venture/delivery/runs.ts';
import { diagnose } from '../runtime/venture/delivery/improve.ts';
import { signalScenario } from '../runtime/venture/delivery/scenarios.ts';
import { draftPostChecks } from '../runtime/venture/build/posting.ts';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { approveFromToday, business, CA_IDEA, code, noOn, owner, phone, plainDraft, PLAIN_IDEA, readyDraft, type Business } from './venture-judge-helpers.ts';

const accountant: Context = { memberId: 'owner', role: 'accountant', epoch: 1, channel: 'desktop' };
const desktop: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const judgeOf = (run: any) => run.checks.find((item: any) => item.check === 'rules-judge');
const journal = (env: Business) => listRecords(env.store.read(), 'venture-journal-entry');
const judgeEntries = (env: Business) => journal(env).filter(entry => entry.action === 'delivery.send' && entry.subject.includes(':judge:'));
const settings = (env: Business) => listRecords(env.store.read(), 'venture-judge-setting');
const runOf = (env: Business, id: string) => listRecords(env.store.read(), 'venture-delivery-run').find(run => run.id === id)!;

async function manual(idea = PLAIN_IDEA, stage: 'shadow' | 'approve-each' = 'approve-each'): Promise<Business> {
  const env = await business(idea, stage);
  await env.call('venture.judge.auto.set', { auto: false });
  return env;
}

// ---------------------------------------------------------------------------
// The setting
// ---------------------------------------------------------------------------

test('judgeAuto: on by default, set by the owner inside the app only, with the standing consent recorded when on', async () => {
  const env = await business(PLAIN_IDEA);
  const fresh = await env.call('venture.judge.auto.get');
  assert.equal(fresh.auto, true, 'on by default');
  assert.equal(fresh.consentAt, null, 'no consent recorded until the judge first runs or the owner turns it on');
  assert.match(fresh.line, /your client's words go to your AI/);
  await assert.rejects(env.call('venture.judge.auto.set', { auto: false }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.call('venture.judge.auto.set', { auto: false }, accountant), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.call('venture.judge.auto.set', { auto: 'no' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.call('venture.judge.auto.set', {}), code('INVALID_VENTURE_REQUEST'));
  const off = await env.call('venture.judge.auto.set', { auto: false });
  assert.equal(off.auto, false);
  assert.equal(off.consentAt, null);
  assert.match(off.line, /only when you ask/);
  const on = await env.call('venture.judge.auto.set', { auto: true });
  assert.equal(on.auto, true);
  assert.equal(on.consentAt, '2026-10-21T10:00:00.000Z');
  const again = await env.call('venture.judge.auto.set', { auto: true });
  assert.equal(again.consentAt, on.consentAt);
  assert.equal(settings(env).length, 2, 'setting it to what it is writes nothing');
  assert.deepEqual((await env.call('venture.judge.auto.get', {}, phone)).auto, true, 'anyone may read it, from anywhere');
});

// ---------------------------------------------------------------------------
// Ask the judge, then send it
// ---------------------------------------------------------------------------

test('ask the judge: a preview of the rules task with the client\'s words, waiting for the owner to send it', async () => {
  const env = await manual();
  const run = await readyDraft(env);
  assert.equal(run.status, 'ready-for-review');
  assert.equal(judgeOf(run), undefined, 'with judgeAuto off nothing is judged on its own');
  assert.equal(env.models.rulesTasks().length, 0);
  const preview = await env.call('venture.delivery.judge', { runId: run.id });
  assert.equal(preview.runId, run.id);
  assert.match(preview.digest, /^[a-f0-9]{64}$/);
  assert.equal(preview.estimatedMaxCostDisplay, 'USD 0.0010');
  assert.equal(preview.containsClientData, true);
  const task = env.models.previewed.at(-1)!;
  assert.equal(task.schemaName, 'venture-judge-rules');
  assert.equal(task.containsClientData, true);
  assert.deepEqual((task.input as any).rules.map((rule: any) => rule.id), DRAFT_RULES.map(rule => rule.id));
  const trace = (task.input as any).trace as { id: string; summary: string }[];
  assert.ok(trace.some(event => event.id === 'client-message' && event.summary.includes('pricing for the new product line')));
  assert.ok(trace.some(event => event.id === 'draft'));
  assert.equal(env.models.sent, 1, 'only the draft was sent; the judge waits');
  const stored = runOf(env, run.id);
  assert.equal(stored.judge!.status, 'waiting');
  assert.equal(stored.judge!.preview!.digest, preview.digest);
  assert.equal(stored.judge!.auto, false);
  assert.equal(stored.judge!.estimatedMaxCostDisplay, 'USD 0.0010');
  const again = await env.call('venture.delivery.judge', { runId: run.id });
  assert.equal(again.digest, preview.digest, 'asking again while it waits gives the same preview');
});

test('ask the judge: refused for a draft that is not ready, failed a check, is practice, or with no AI', async () => {
  const env = await manual();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Please advise on my prices.' });
  const waiting = await env.call('venture.delivery.run', { orderId: order.id });
  await assert.rejects(env.call('venture.delivery.judge', { runId: waiting.id }), code('JUDGE_NOT_READY'));
  await assert.rejects(env.call('venture.delivery.judge', { runId: 'delivery_missing' }), code('DELIVERY_NOT_FOUND'));
  await assert.rejects(env.call('venture.delivery.judge', {}), code('INVALID_VENTURE_REQUEST'));

  env.models.respond.delivery = task => { const draft = plainDraft(task) as any; return { ...draft, sections: draft.sections.slice(0, -1) }; };
  const failed = await readyDraft(env);
  assert.ok(failed.checks.some((item: any) => !item.passed), 'a heading is missing');
  await assert.rejects(env.call('venture.delivery.judge', { runId: failed.id }), (error: any) => {
    assert.equal(error.code, 'JUDGE_NOT_READY');
    assert.equal(error.message, 'Fix the failed check first; the judge reads only drafts that pass the code checks.');
    return true;
  });

  const shadow = await manual(PLAIN_IDEA, 'shadow');
  const practice = await readyDraft(shadow);
  assert.equal(practice.practice, true);
  await assert.rejects(shadow.call('venture.delivery.judge', { runId: practice.id }), code('PRACTICE_DRAFT'));

  const noAi = await manual();
  noAi.models.fast = 'template';
  const ready = await readyDraft(noAi);
  await assert.rejects(noAi.call('venture.delivery.judge', { runId: ready.id }), code('NO_MODEL_CONNECTED'));
});

test('send to the judge: once, in the app, with the digest the owner saw; a passing verdict leaves Accept open', async () => {
  const env = await manual();
  const run = await readyDraft(env);
  const preview = await env.call('venture.delivery.judge', { runId: run.id });
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: run.id, digest: 'e'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: run.id, digest: 'not-a-digest' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(env.models.rulesTasks().length, 0, 'nothing went before the right digest');
  const judged = await env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest });
  assert.equal(env.models.rulesTasks().length, 1);
  const result = judgeOf(judged);
  assert.equal(result.passed, true, result.detail);
  assert.equal(judged.judge.status, 'done');
  assert.equal(judged.judge.preview, null);
  assert.equal(judged.canAccept, true, judged.acceptBlocked ?? '');
  const [entry] = judgeEntries(env);
  assert.equal(entry.state, 'applied');
  assert.equal(entry.actionDigest, preview.digest);
  assert.equal(entry.target, 'Asha Rao');
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest }), code('JUDGE_ALREADY_SENT'));
  await assert.rejects(env.call('venture.delivery.judge', { runId: run.id }), code('JUDGE_ALREADY_SENT'));
  assert.equal(env.models.rulesTasks().length, 1, 'a second send sends nothing');
  const accepted = await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' });
  assert.equal(accepted.status, 'accepted');
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: 'delivery_missing', digest: preview.digest }), code('DELIVERY_NOT_FOUND'));

  const fresh = await readyDraft(env, 'Please advise on bundles.');
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: fresh.id, digest: preview.digest }), code('JUDGE_NOT_WAITING'));
});

test('send to the judge: a checked no blocks Accept with the judge\'s reason and records a signal', async () => {
  const env = await manual();
  env.models.respond['judge-rules'] = noOn('policy-followed', 'The reply offers a discount the plan does not have.');
  const run = await readyDraft(env);
  const preview = await env.call('venture.delivery.judge', { runId: run.id });
  const judged = await env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest });
  const result = judgeOf(judged);
  assert.equal(result.passed, false);
  assert.equal(result.notChecked, undefined);
  assert.match(result.detail, /Failed: policy-followed/);
  assert.match(result.detail, /offers a discount the plan does not have/);
  assert.equal(judged.canAccept, false);
  assert.match(judged.acceptBlocked, /offers a discount the plan does not have/);
  await assert.rejects(env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' }), (error: any) => {
    assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
    assert.match(error.message, /offers a discount the plan does not have/);
    return true;
  });
  const signals = listRecords(env.store.read(), 'venture-signal').filter(signal => signal.runId === run.id);
  assert.deepEqual(signals.map(signal => [signal.source, signal.reason]), [['check-failed', 'policy-followed']], 'the first rule it failed');
  const sentBefore = env.models.sent;
  const edited = await env.call('venture.delivery.review', { runId: run.id, verdict: 'edited', editedText: 'The reply without the discount.' });
  assert.equal(edited.status, 'edited', 'the owner can still edit it');
  assert.equal(edited.judge.line, JUDGE_EDIT_LINE, "the owner's own words are not judged, and the run says so");
  assert.equal(env.models.sent, sentBefore, 'nothing goes to the judge for an edit');
});

test('send to the judge: votes code cannot check settle nothing and block nothing; a refused answer is never a pass', async () => {
  const env = await manual();
  env.models.respond['judge-rules'] = task => ({ votes: (task.input as any).rules.map((rule: any) => ({ rule: rule.id, answer: 'yes', cites: ['event-not-in-trace'], quote: '', reason: 'Fine.' })) });
  const run = await readyDraft(env);
  const preview = await env.call('venture.delivery.judge', { runId: run.id });
  const judged = await env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest });
  const result = judgeOf(judged);
  assert.equal(result.passed, false);
  assert.equal(result.notChecked, true);
  assert.match(result.detail, /Not settled/);
  assert.equal(judged.canAccept, true, judged.acceptBlocked ?? 'an unsettled judge blocks nothing');
  assert.equal(listRecords(env.store.read(), 'venture-signal').filter(signal => signal.runId === run.id).length, 0);

  env.models.respond['judge-rules'] = () => ({ answer: 'looks fine' });
  const second = await readyDraft(env, 'Please advise on my shop prices.');
  const asked = await env.call('venture.delivery.judge', { runId: second.id });
  const refused = await env.call('venture.delivery.judgeSend', { runId: second.id, digest: asked.digest });
  const unsettled = judgeOf(refused);
  assert.equal(unsettled.passed, false);
  assert.equal(unsettled.notChecked, true);
  assert.match(unsettled.detail, /refused, so no rule is settled/);
  assert.equal(refused.judge.status, 'done');
  assert.equal(refused.canAccept, true);
});

test('send to the judge: a call that fails after it was claimed marks the judge failed; asking again makes a new call', async () => {
  const env = await manual();
  const run = await readyDraft(env);
  const preview = await env.call('venture.delivery.judge', { runId: run.id });
  env.models.failNextSend = new ChausarError('MODEL_FAILED', 'The provider failed.');
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest }), code('MODEL_FAILED'));
  const stored = runOf(env, run.id);
  assert.equal(stored.judge!.status, 'failed');
  assert.equal(stored.judge!.preview, null);
  assert.match(stored.judge!.line ?? '', /The provider failed/);
  assert.equal(judgeOf(stored), undefined, 'no verdict, so nothing is claimed');
  assert.equal(judgeEntries(env)[0].state, 'rejected');
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest }), code('JUDGE_NOT_WAITING'));
  const again = await env.call('venture.delivery.judge', { runId: run.id });
  assert.equal(runOf(env, run.id).judge!.status, 'waiting');
  assert.notEqual(runOf(env, run.id).judge!.callId, stored.judge!.callId, 'a new call, never the failed one again');
  const judged = await env.call('venture.delivery.judgeSend', { runId: run.id, digest: again.digest });
  assert.equal(judgeOf(judged).passed, true);
});

// ---------------------------------------------------------------------------
// The judge on its own (judgeAuto)
// ---------------------------------------------------------------------------

const ORDER = 'Please look at my pricing for the new product line and advise.';
const rulesTask = (task: any) => task.schemaName === 'venture-judge-rules';

test('judgeAuto on: the write turn says the judge will read the draft and what it could cost, before any judge call', async () => {
  const env = await business(PLAIN_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: ORDER });
  const waiting = await env.call('venture.delivery.run', { orderId: order.id });
  assert.ok(waiting.judgeNotice.startsWith(JUDGE_AUTO_ON_LINE), waiting.judgeNotice);
  assert.match(waiting.judgeNotice, /the judge's check could cost up to USD \d+\.\d{4}\.$/);
  const [listed] = await env.call('venture.delivery.list');
  assert.equal(listed.judgeNotice, waiting.judgeNotice, 'Work reads it on the waiting turn');
  const row = (await env.call('venture.queue.list')).rows.find((item: any) => item.kind === 'quote');
  assert.ok(row.line.includes(JUDGE_AUTO_ON_LINE), 'Today shows it on the approval row');
  assert.equal(env.models.rulesTasks().length, 0, 'no judge call yet');
  assert.equal(settings(env).length, 0, 'no consent yet');

  // Approved on Today, whose row binds the notice it showed: that is where the standing consent is given.
  const run = await approveFromToday(env, waiting.id);
  const write = journal(env).find(entry => entry.subject === `${waiting.id}:${waiting.callId}`)!;
  assert.match(write.describe, /^Send the next step for Asha Rao to your AI\. Then the judge reads the ready draft on your AI, with your client's words, for up to USD /);
  const [setting] = settings(env);
  assert.deepEqual(setting.consent, { at: '2026-10-21T10:00:00.000Z', by: 'owner', how: 'default', entryId: write.id }, 'consent recorded against the approved entry');
  assert.equal(judgeOf(run).passed, true, 'then the judge ran on its own');
  assert.equal(run.judge.auto, true);
  assert.equal(run.judge.estimatedMaxCostDisplay, 'USD 0.0010');
  assert.deepEqual(env.models.consents, ['approved-preview', 'standing-judge'], "the judge's call goes on the standing consent, not as the owner's approval");
  const standing = judgeEntries(env)[0];
  assert.match(standing.describe, /standing consent/);
  const approval = standing.journal.find(step => step.state === 'approved')!;
  assert.equal(approval.line, 'Sent under your standing judge setting.', 'never "You approved this."');
  assert.equal(approval.by, 'engine');
  assert.equal(standing.decidedBy, null);
  assert.equal(standing.approval!.approvedBy, null, 'no owner is recorded as approving the judge call');
  assert.equal(run.judgeNotice, null);

  const next = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Please advise on my bundle prices.' });
  const second = await env.call('venture.delivery.run', { orderId: next.id });
  // Once consented, the setting's words are not repeated, but the judge's cost is still shown before the write turn.
  assert.match(second.judgeNotice, /^Once this draft is ready, the judge reads it on your AI; that check could cost up to USD \d+\.\d{4}\.$/);
  assert.ok(!second.judgeNotice.includes(JUDGE_AUTO_ON_LINE));
  const secondRow = (await env.call('venture.queue.list')).rows.find((item: any) => item.kind === 'quote');
  assert.ok(secondRow.line.includes(second.judgeNotice), 'Today shows the cost too');
  const judged = await env.call('venture.delivery.approve', { runId: second.id, digest: second.preview.digest });
  const secondWrite = journal(env).find(entry => entry.subject === `${second.id}:${second.callId}`)!;
  assert.match(secondWrite.describe, /Then the judge reads the ready draft on your AI, for up to USD /);
  assert.equal(judgeOf(judged).passed, true);
  assert.equal(settings(env).length, 1, 'the consent is recorded once');
  await assert.rejects(env.call('venture.delivery.judge', { runId: judged.id }), code('JUDGE_ALREADY_SENT'));
});

test("judgeAuto on: with no consent recorded, the first judge call waits with the setting's words; sending it records the consent", async () => {
  const env = await manual();
  const run = await readyDraft(env);
  // A business whose setting was stored on with no consent (before consent was recorded): nothing goes on its own.
  await ventureAction(env.deps, desktop, 'admin', 'seed.setting', tx => { tx.put({ ...tx.base('venture-judge-setting'), auto: true, consent: null }); });
  const view: any = await autoJudge(env.deps, desktop, run);
  assert.equal(view.judge.status, 'waiting');
  assert.equal(view.judge.line, JUDGE_AUTO_ON_LINE);
  assert.equal(env.models.rulesTasks().length, 0, 'nothing sent without consent');
  const judged = await env.call('venture.delivery.judgeSend', { runId: run.id, digest: view.judge.preview.digest });
  assert.equal(judgeOf(judged).passed, true);
  assert.equal(env.models.consents.at(-1), 'approved-preview', "the owner's own send");
  const consent = settings(env).at(-1)!.consent!;
  assert.equal(consent.how, 'send');
  assert.equal(consent.entryId, judgeEntries(env)[0].id);
});

test('judgeAuto on with no consent: an owner who asks the judge by hand gives no standing consent', async () => {
  const env = await manual();
  const run = await readyDraft(env);
  await ventureAction(env.deps, desktop, 'admin', 'seed.setting', tx => { tx.put({ ...tx.base('venture-judge-setting'), auto: true, consent: null }); });
  const preview = await env.call('venture.delivery.judge', { runId: run.id });
  const judged = await env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest });
  assert.equal(judgeOf(judged).passed, true);
  assert.equal(settings(env).at(-1)!.consent, null, "a call the owner asked for is not the automatic one shown with the setting's words");
});

test('judgeAuto: turning it off while the judge call is being prepared stops the send and leaves it off', async () => {
  const env = await business(PLAIN_IDEA);
  env.models.onPreview = async task => { if (rulesTask(task)) await env.call('venture.judge.auto.set', { auto: false }); };
  const run = await readyDraft(env);
  assert.equal(env.models.rulesTasks().length, 0, 'nothing was sent');
  assert.equal(run.judge, undefined);
  assert.equal(judgeOf(run), undefined);
  assert.equal((await env.call('venture.judge.auto.get')).auto, false, 'it stays off');
  assert.deepEqual(settings(env).map(item => item.auto), [true, false], 'the consent of the approved turn, then off; nothing turned it back on');
});

test('judgeAuto on: a failing verdict blocks Accept as soon as the draft is ready', async () => {
  const env = await business(PLAIN_IDEA);
  env.models.respond['judge-rules'] = noOn('no-unbacked-claims', 'It says the prices were checked, which no tool did.');
  const run = await readyDraft(env);
  assert.equal(judgeOf(run).passed, false);
  assert.equal(run.canAccept, false);
  assert.match(run.acceptBlocked, /which no tool did/);
});

test('judgeAuto on: a refused automatic ballot settles nothing and blocks nothing; the run says Not checked', async () => {
  const env = await business(PLAIN_IDEA);
  env.models.respond['judge-rules'] = () => ({ answer: 'looks fine' });
  const run = await readyDraft(env);
  const result = judgeOf(run);
  assert.equal(result.passed, false);
  assert.equal(result.notChecked, true);
  assert.equal(run.judge.status, 'done');
  assert.equal(run.canAccept, true, run.acceptBlocked ?? '');
  assert.equal(run.acceptBlocked, null);
  const detail = await env.call('venture.runs.get', { runId: run.id });
  const labels = detail.steps.flatMap((step: any) => step.evidence ?? []).filter((item: any) => item.id === 'rules-judge').map((item: any) => item.label);
  assert.ok(labels.length && labels.every((label: string) => label.startsWith('Not checked:')), JSON.stringify(labels));
  assert.equal(listRecords(env.store.read(), 'venture-signal').filter(signal => signal.runId === run.id).length, 0);
  // Today's draft view counts only checks that settled, and the posting gate reads an unsettled judge as no failure.
  const view = await env.call('venture.queue.view', { id: run.id, kind: 'draft' });
  const counted = run.checks.filter((item: any) => !item.notChecked).length;
  assert.deepEqual(view.sections.find((section: any) => section.heading === 'Checks').lines[0],
    `${counted} of ${counted} checks passed. The judge settled no rule, so its check is not counted.`);
  const stored = listRecords(env.store.read(), 'venture-delivery-run').find(item => item.id === run.id)!;
  assert.equal(draftPostChecks(env.store.read(), stored, { channel: 'linkedin', text: 'Our new prices start this week.' }).checks, 'passed');
  const failedJudge = { ...stored, checks: [...stored.checks.filter(item => item.check !== 'rules-judge'), { check: 'rules-judge' as const, passed: false, detail: 'Failed: goal-met.' }] };
  assert.equal(draftPostChecks(env.store.read(), failedJudge, { channel: 'linkedin', text: 'Our new prices start this week.' }).checks, 'failed', 'a checked no still holds a post');
  assert.equal((await env.call('venture.delivery.review', { runId: run.id, verdict: 'accepted' })).status, 'accepted');
});

test('judgeAuto off: no judge until the owner asks; a draft that failed a check is never sent to it', async () => {
  const env = await manual();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: ORDER });
  assert.equal((await env.call('venture.delivery.run', { orderId: order.id })).judgeNotice, null, 'no notice while off');
  const run = await readyDraft(env);
  assert.equal(judgeOf(run), undefined);
  assert.equal(run.judge, undefined);
  assert.equal(env.models.rulesTasks().length, 0);
  assert.equal(judgeEntries(env).length, 0);

  const on = await business(PLAIN_IDEA);
  on.models.respond.delivery = task => { const draft = plainDraft(task) as any; return { ...draft, sections: draft.sections.slice(0, -1) }; };
  const failed = await readyDraft(on);
  assert.equal(judgeOf(failed), undefined, 'the judge reads only drafts that pass the code checks');
  assert.equal(on.models.rulesTasks().length, 0);
});

test('judgeAuto on: internal papers for the CA, practice drafts and a business with no AI judge are not judged', async () => {
  const ca = await business(CA_IDEA);
  // The plan's third offer becomes the CA firm's tax audit support: papers gathered for the CA, who does the audit.
  await ventureAction(ca.deps, desktop, 'admin', 'seed.audit-offer', tx => {
    const plan = tx.list('venture-blueprint').find(item => item.id === tx.venture!.acceptedBlueprintId)!;
    tx.replace({ ...plan, offers: plan.offers.map(offer => offer.id !== 'offer_3' ? offer : {
      ...offer, playbookOffer: 'audit-support', name: { ...offer.name, value: 'Tax audit support' }, description: { ...offer.description, value: 'Papers gathered for the CA who does the audit and signs the report.' },
    }) });
  });
  ca.models.respond.delivery = task => {
    const draft = plainDraft(task) as { sections: { parts: unknown[] }[] };
    draft.sections[0].parts.push({ kind: 'text', text: 'Your CA reads these papers, decides the next step and signs the report.', ref: '' });
    return draft;
  };
  const auditOrder = await ca.call('venture.order.create', { clientId: ca.client.id, offerId: 'offer_3', request: 'Please gather the papers for my tax audit.' });
  const auditWaiting = await ca.call('venture.delivery.run', { orderId: auditOrder.id });
  assert.equal(auditWaiting.judgeNotice, null, 'no notice on internal papers');
  const papers = await ca.call('venture.delivery.approve', { runId: auditWaiting.id, digest: auditWaiting.preview.digest });
  ca.models.respond.delivery = plainDraft;
  assert.equal(papers.status, 'ready-for-review');
  assert.ok(papers.checks.every((item: any) => item.passed), JSON.stringify(papers.checks.filter((item: any) => !item.passed)));
  assert.ok((papers.playbookChecks ?? []).every((item: any) => item.outcome !== 'fail'), JSON.stringify(papers.playbookChecks));
  assert.equal(judgeOf(papers), undefined, 'papers gathered for the CA are an internal note');
  assert.equal(papers.judge, undefined);
  assert.equal(ca.models.rulesTasks().length, 0);
  assert.equal(settings(ca).length, 0, 'approving internal papers gives no consent');
  const books = await readyDraft(ca, 'Please close my books for October.', 'offer_1');
  assert.equal(judgeOf(books)?.passed, true, "the same firm's client papers are judged, with the CA rules");
  assert.deepEqual((ca.models.rulesTasks()[0].input as any).rules.map((rule: any) => rule.id), CA_JUDGE_RULES.map(rule => rule.id));

  const shadow = await business(PLAIN_IDEA, 'shadow');
  const practice = await readyDraft(shadow);
  assert.equal(practice.practice, true);
  assert.equal(judgeOf(practice), undefined);

  const noJudge = await business(PLAIN_IDEA);
  noJudge.models.fast = 'template';
  const plain = await readyDraft(noJudge);
  assert.equal(plain.judge, undefined);
  assert.equal(settings(noJudge).length, 0, 'no notice was shown, so no consent is recorded');
});

test('judgeAuto on: a CA firm draft the judge fails records its first failed rule, which the improvement loop reads as a cluster', async () => {
  const ca = await business(CA_IDEA);
  ca.models.respond['judge-rules'] = noOn('right-head', 'An interest item sits under salary.');
  const books = await readyDraft(ca, 'Please close my books for October.', 'offer_1');
  assert.equal(judgeOf(books).passed, false);
  const signals = listRecords(ca.store.read(), 'venture-signal').filter(signal => signal.runId === books.id);
  assert.deepEqual(signals.map(signal => signal.reason), ['right-head']);
  const diagnosis = diagnose(signals, [], new Set());
  assert.deepEqual(diagnosis.clusters.map(cluster => [cluster.reason, cluster.level, cluster.step]), [['right-head', 'harness', 'compute']]);
  assert.equal(diagnosis.chosen?.reason, 'right-head');
  const practiceCase = signalScenario(signals[0], 'bookkeeping');
  assert.ok(practiceCase.checks.includes('rules-judge'), 'its practice case asks the judge again');
  assert.match(practiceCase.expectedOutcome, /Watch for the judge's rule right-head\./);
});

test('judgeAuto on: a preview that cannot be made, or a send refused before it went, leaves the run saying why', async () => {
  const off = await business(PLAIN_IDEA);
  off.models.refusePreview = task => rulesTask(task) ? new ChausarError('SEND_DISABLED', 'Sending is off for this workspace.') : null;
  const notRun = await readyDraft(off);
  assert.equal(notRun.judge.status, 'failed');
  assert.match(notRun.judge.line, /Sending is off/);
  assert.equal(off.models.rulesTasks().length, 0);

  const env = await business(PLAIN_IDEA);
  env.models.refuseSend = task => rulesTask(task) ? new ChausarError('BUDGET_REACHED', 'Your monthly AI limit is reached.') : null;
  const held = await readyDraft(env);
  assert.equal(held.judge.status, 'waiting', 'the call still waits for the owner');
  assert.match(held.judge.line, /The judge did not run on its own: Your monthly AI limit is reached\./);
  assert.equal(env.models.rulesTasks().length, 0);
  env.models.refuseSend = null;
  const judged = await env.call('venture.delivery.judgeSend', { runId: held.id, digest: held.judge.preview.digest });
  assert.equal(judgeOf(judged).passed, true);
});

async function agentRun(env: Business): Promise<any> {
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Please look at my price list and advise.' });
  await env.call('venture.files.add', { orderId: order.id, name: 'prices.csv', contentBase64: Buffer.from('Item,Price\nTea,120\nCake,250\n').toString('base64') });
  let run = await env.call('venture.delivery.run', { orderId: order.id });
  assert.ok(run.harness, 'files on the order run the agent loop');
  while (run.status === 'waiting-for-you') run = await approveFromToday(env, run.id);
  assert.equal(run.status, 'ready-for-review');
  return run;
}

test("judgeAuto on: an agent run counts the judge's cost; a call past its spend cap waits for the owner to send it", async () => {
  const env = await business(PLAIN_IDEA);
  const run = await agentRun(env);
  assert.equal(run.judge.status, 'done');
  assert.equal(run.harness.used.costMicros, String(200 * env.models.sent), "every call at 200, the judge's own included");

  const capped = await business(PLAIN_IDEA);
  capped.models.estimateFor = task => rulesTask(task) ? '300000' : '1000';
  const waiting = await agentRun(capped);
  assert.equal(waiting.judge.status, 'waiting');
  assert.match(waiting.judge.line, /spend cap/);
  assert.equal(capped.models.rulesTasks().length, 0, 'nothing was sent on its own');
  const before = waiting.harness.used.costMicros;
  const judged = await capped.call('venture.delivery.judgeSend', { runId: waiting.id, digest: waiting.judge.preview.digest });
  assert.equal(judgeOf(judged).passed, true, 'the owner sends it with the cost in view');
  assert.equal(judged.harness.used.costMicros, before, "the owner's own send is outside the run's cap");
});

// ---------------------------------------------------------------------------
// Second review: Accept while the judge reads, Today's words, cost on refusal, the loop, the guard, the price
// ---------------------------------------------------------------------------

test('judgeAuto on: Accept waits while the automatic call is out, and a verdict never lands on a draft decided meanwhile', async () => {
  const env = await business(PLAIN_IDEA);
  env.models.respond['judge-rules'] = noOn('policy-followed', 'The reply offers a discount the plan does not have.');
  let during: any = null;
  env.models.onSend = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await env.call('venture.delivery.list');
    await assert.rejects(env.call('venture.delivery.review', { runId: listed.id, verdict: 'accepted' }), (error: any) => {
      assert.equal(error.code, 'INVALID_VENTURE_REQUEST');
      assert.equal(error.message, 'The judge is reading this draft. Accept it once its answer is in.');
      return true;
    });
    during = listed;
  };
  const run = await readyDraft(env);
  assert.equal(during.canAccept, false);
  assert.equal(during.acceptBlocked, 'The judge is reading this draft. Accept it once its answer is in.');
  assert.equal(run.canAccept, false, 'the failing verdict landed before anything was accepted');
  assert.match(run.acceptBlocked, /offers a discount/);

  const decided = await business(PLAIN_IDEA);
  decided.models.onSend = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await decided.call('venture.delivery.list');
    await decided.call('venture.delivery.review', { runId: listed.id, verdict: 'rejected', reason: 'tone' });
  };
  const rejected = await readyDraft(decided);
  assert.equal(rejected.status, 'rejected');
  assert.equal(judgeOf(rejected), undefined, 'no verdict is stored on a draft decided while the judge read it');
  assert.equal(rejected.judge.status, 'failed');
});

test('judgeAuto on: Today and the draft view say when the judge has not read a draft, and when it settled nothing', async () => {
  const refused = await business(PLAIN_IDEA);
  refused.models.respond['judge-rules'] = () => ({ answer: 'looks fine' });
  const run = await readyDraft(refused);
  const row = (await refused.call('venture.queue.list')).rows.find((item: any) => item.kind === 'draft');
  assert.match(row.line, /Not checked by the judge\./);
  const view = await refused.call('venture.queue.view', { id: run.id, kind: 'draft' });
  assert.ok(view.sections.find((section: any) => section.heading === 'Checks').lines.some((line: string) => line.includes('Not checked by the judge.')));

  const capped = await business(PLAIN_IDEA);
  capped.models.estimateFor = task => rulesTask(task) ? '300000' : '1000';
  const waiting = await agentRun(capped);
  const cappedRow = (await capped.call('venture.queue.list')).rows.find((item: any) => item.kind === 'draft');
  assert.match(cappedRow.line, /The judge has not read this draft\. The judge did not run on its own: this run is at its spend cap/);
  const cappedView = await capped.call('venture.queue.view', { id: waiting.id, kind: 'draft' });
  assert.ok(cappedView.sections.find((section: any) => section.heading === 'Checks').lines.some((line: string) => line.startsWith('The judge has not read this draft.')));

  const passed = await business(PLAIN_IDEA);
  await readyDraft(passed);
  const passedRow = (await passed.call('venture.queue.list')).rows.find((item: any) => item.kind === 'draft');
  assert.doesNotMatch(passedRow.line, /judge/, 'a passing verdict adds nothing');
});

test('judgeAuto on: a refused automatic ballot still counts the cost the port billed against the run, once', async () => {
  const env = await business(PLAIN_IDEA);
  env.models.respond['judge-rules'] = () => ({ answer: 'looks fine' });
  const run = await agentRun(env);
  assert.equal(judgeOf(run).notChecked, true);
  assert.equal(run.harness.used.costMicros, String(200 * env.models.sent), "the refused judge call's cost is counted");
});

test('the improvement loop reads social and YouTube judge rules as clusters, each on a step its playbook has', async () => {
  const { applyPatch } = await import('../runtime/venture/delivery/harness/patches.ts');
  const { RULES, ruleStep } = await import('../runtime/venture/delivery/improve.ts');
  const { flagshipDelivery } = await import('../runtime/venture/playbooks/steps.ts');
  const { DEFAULT_LIMITS } = await import('../runtime/venture/delivery/harness/loop.ts');
  const { SOCIAL_JUDGE_RULES } = await import('../runtime/venture/playbooks/social/judge.ts');
  const { YOUTUBE_DRAFT_RULES } = await import('../runtime/venture/playbooks/youtube/judge.ts');
  const signal = (reason: string) => ({ id: `signal_${reason}`, kind: 'venture-signal', ventureId: 'venture_1', memberId: 'owner', epoch: 1, at: '2026-10-21T10:00:00.000Z', source: 'check-failed', runId: 'delivery_1', reason, scenarioId: null }) as any;
  for (const [flagship, serviceType, rules, ruleId, step] of [
    ['social-agency', 'agency', SOCIAL_JUDGE_RULES, 'on-brand-voice', 'drafts'],
    ['youtube', 'studio', YOUTUBE_DRAFT_RULES, 'faithful-to-source', 'package'],
  ] as const) {
    const diagnosis = diagnose([signal(ruleId)], [], new Set());
    assert.deepEqual(diagnosis.clusters.map(cluster => [cluster.reason, cluster.level, cluster.step]), [[ruleId, 'harness', step]]);
    const steps = flagshipDelivery(flagship)!.steps.map(item => structuredClone(item));
    for (const rule of rules) {
      const found = (RULES as Record<string, any>)[rule.id];
      assert.ok(found && 'op' in found, `${rule.id} has a change the loop can try`);
      const body = applyPatch({ steps: structuredClone(steps), limits: { ...DEFAULT_LIMITS }, aliases: {} }, {
        id: `patch_${rule.id}`, level: found.level, op: found.op, stepId: ruleStep(found.stepId, flagship), value: found.value,
        note: { hypothesis: 'h', expectedFixes: [rule.id], likelyRegressions: [] }, proposedBy: 'chausar', parentHash: 'hash',
      }, { serviceType, entryIds: [], flagship });
      assert.ok(body.steps.find((item: any) => item.id === ruleStep(found.stepId, flagship))!.guidance!.includes(found.value), `${rule.id} applies to ${flagship}`);
    }
  }
});

test('the gate again before a standing send: the setting must be on with its consent', async () => {
  const env = await business(PLAIN_IDEA);
  await env.call('venture.judge.auto.set', { auto: false });
  const run = await readyDraft(env);
  const preview = await env.call('venture.delivery.judge', { runId: run.id });
  const held = runOf(env, run.id).judge!.preview!;
  assert.equal(held.digest, preview.digest);
  const ventureId = runOf(env, run.id).ventureId;
  assert.throws(() => recheckJudgeSend(env.deps, ventureId, run.id, held, true), code('POLICY_DENIED'), 'off: nothing goes on its own');
  assert.doesNotThrow(() => recheckJudgeSend(env.deps, ventureId, run.id, held, false), "the owner's own send");
  await ventureAction(env.deps, desktop, 'admin', 'seed.setting', tx => { tx.put({ ...tx.base('venture-judge-setting'), auto: true, consent: null }); });
  assert.throws(() => recheckJudgeSend(env.deps, ventureId, run.id, held, true), code('POLICY_DENIED'), 'on with no consent: nothing goes on its own');
  await env.call('venture.judge.auto.set', { auto: true });
  assert.doesNotThrow(() => recheckJudgeSend(env.deps, ventureId, run.id, held, true));
});

test("the judge's cost bound is priced with the owner's rate card, as the port prices the call", async () => {
  const listed = await business(PLAIN_IDEA);
  listed.models.replay = false;
  const listOrder = await listed.call('venture.order.create', { clientId: listed.client.id, offerId: 'offer_1', request: ORDER });
  const atList = (await listed.call('venture.delivery.run', { orderId: listOrder.id })).judgeNotice as string;

  const carded = await business(PLAIN_IDEA);
  carded.models.replay = false;
  await carded.call('venture.spend.policy.set', { rates: [{
    item: 'model:anthropic-haiku-5-5', unit: 'per-million-tokens', inputMicrosPerMillion: '10000000', outputMicrosPerMillion: '50000000',
    source: 'My own contract', checkedOn: '2026-10-20',
  }] });
  const cardOrder = await carded.call('venture.order.create', { clientId: carded.client.id, offerId: 'offer_1', request: ORDER });
  const atCard = (await carded.call('venture.delivery.run', { orderId: cardOrder.id })).judgeNotice as string;
  const cost = (line: string) => Number(/USD (\d+\.\d{4})/.exec(line)![1]);
  assert.ok(cost(atCard) > cost(atList) * 50, `${atCard} against ${atList}`);
});

// ---------------------------------------------------------------------------
// Third review: the bound shown before the spend, the gap before the judge, Today as the consent path, the guards
// ---------------------------------------------------------------------------

test('judgeAuto: approving in Work shows the notice but gives no standing consent; the first judge call then waits for the owner', async () => {
  const env = await business(PLAIN_IDEA);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: ORDER });
  const waiting = await env.call('venture.delivery.run', { orderId: order.id });
  assert.ok(waiting.judgeNotice.startsWith(JUDGE_AUTO_ON_LINE));
  const run = await env.call('venture.delivery.approve', { runId: waiting.id, digest: waiting.preview.digest });
  assert.equal(settings(env).length, 0, 'delivery.approve does not bind the notice, so it gives no consent');
  assert.equal(run.judge.status, 'waiting');
  assert.equal(run.judge.line, JUDGE_AUTO_ON_LINE);
  assert.equal(env.models.rulesTasks().length, 0);
  const judged = await env.call('venture.delivery.judgeSend', { runId: run.id, digest: run.judge.preview.digest });
  assert.equal(judgeOf(judged).passed, true);
  assert.equal(settings(env).at(-1)!.consent!.how, 'send');
});

test('judgeAuto: a judge call whose cost was not shown before the write turn was approved waits for the owner', async () => {
  // The setting turned on while the write call was out: the approval showed no judge cost.
  const turnedOn = await manual();
  turnedOn.models.onSend = async task => { if (task.purpose === 'delivery') await turnedOn.call('venture.judge.auto.set', { auto: true }); };
  const unshown = await readyDraft(turnedOn);
  assert.equal(unshown.judge.status, 'waiting');
  assert.equal(unshown.judge.line, JUDGE_UNSHOWN_LINE);
  assert.equal(turnedOn.models.rulesTasks().length, 0, 'nothing spent that was not shown');

  // The judge's call came out dearer than the bound shown (a changed AI or rate card): it waits too.
  const dearer = await business(PLAIN_IDEA);
  dearer.models.estimateFor = task => rulesTask(task) ? '999999' : '1000';
  const held = await readyDraft(dearer);
  assert.equal(held.judge.status, 'waiting');
  assert.equal(held.judge.line, JUDGE_UNSHOWN_LINE);
  assert.equal(dearer.models.rulesTasks().length, 0);
  const judged = await dearer.call('venture.delivery.judgeSend', { runId: held.id, digest: held.judge.preview.digest });
  assert.equal(judgeOf(judged).passed, true, 'the owner sends it with its own cost in view');
});

test('judgeAuto: between the ready draft and the judge, Accept waits; an accepted draft the judge never read says so', async () => {
  const env = await business(PLAIN_IDEA);
  let between: any = null;
  env.models.onPreview = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await env.call('venture.delivery.list');
    between = listed;
    await assert.rejects(env.call('venture.delivery.review', { runId: listed.id, verdict: 'accepted' }), code('INVALID_VENTURE_REQUEST'));
  };
  const run = await readyDraft(env);
  assert.equal(between.status, 'ready-for-review');
  assert.equal(between.canAccept, false, 'the judge is due, so Accept waits for it');
  assert.equal(between.acceptBlocked, JUDGE_READING);
  assert.equal(judgeOf(run).passed, true);
  assert.equal(run.canAccept, true);
  assert.equal(run.judgePending ?? null, null, 'the marker is gone once the judge is in');

  const unread = await business(PLAIN_IDEA);
  unread.models.estimateFor = task => rulesTask(task) ? '999999' : '1000';
  const waiting = await readyDraft(unread);
  assert.equal(waiting.canAccept, true, 'a judge call waiting for the owner does not hold Accept');
  await unread.call('venture.delivery.review', { runId: waiting.id, verdict: 'accepted' });
  const view = await unread.call('venture.queue.view', { id: waiting.id, kind: 'draft' });
  assert.ok(view.sections.find((section: any) => section.heading === 'Checks').lines.includes('The judge never read this draft before you accepted it.'));
});

test('judgeAuto: a call left reading after its time is up stops holding Accept and stops saying it is reading', async () => {
  const env = await business(PLAIN_IDEA);
  const run = await readyDraft(env);
  // A judge call that never came back (the app closed while it was out), its preview now past its time.
  await ventureAction(env.deps, desktop, 'admin', 'seed.stuck', tx => {
    const current = tx.find('venture-delivery-run', run.id)!;
    tx.replace({
      ...current, checks: current.checks.filter(item => item.check !== 'rules-judge'),
      judge: { status: 'waiting', callId: 'call_stuck', preview: { ...run.judge.preview ?? {}, callId: 'call_stuck', digest: 'a'.repeat(64), payloadText: '{}', presetId: 'anthropic-haiku-5-5', model: 'stub', endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-21T10:30:00.000Z' }, at: tx.now, draftDigest: 'd', auto: true, estimatedMaxCostDisplay: 'USD 0.0010', line: null },
    });
  });
  const reading = (await env.call('venture.queue.list')).rows.find((item: any) => item.kind === 'draft');
  assert.equal(reading.line, JUDGE_READING, 'while its time lasts, Accept waits');
  env.setNow('2026-10-21T10:31:00.000Z');
  const open = (await env.call('venture.queue.list')).rows.find((item: any) => item.kind === 'draft');
  assert.match(open.line, /The judge has not read this draft\./);
  assert.doesNotMatch(open.line, /reading/);
});

test('judgeAuto: a verdict that comes back after an edit or a reject keeps the run line and never asks to try again', async () => {
  const edited = await business(PLAIN_IDEA);
  edited.models.onSend = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await edited.call('venture.delivery.list');
    await edited.call('venture.delivery.review', { runId: listed.id, verdict: 'edited', editedText: 'My own words for the client.' });
  };
  const run = await readyDraft(edited);
  assert.equal(run.status, 'edited');
  assert.equal(run.judge.line, JUDGE_EDIT_LINE);
  assert.equal(judgeOf(run), undefined);

  const rejected = await business(PLAIN_IDEA);
  rejected.models.onSend = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await rejected.call('venture.delivery.list');
    await rejected.call('venture.delivery.review', { runId: listed.id, verdict: 'rejected', reason: 'tone' });
  };
  const gone = await readyDraft(rejected);
  assert.equal(gone.status, 'rejected');
  assert.equal(gone.judge.line, 'The draft was decided while the judge read it, so its answer is not kept.');
  assert.doesNotMatch(gone.judge.line, /Ask the judge again/);
});

test('the journal: a standing approval is only for the judge\'s own send, and approveAction never makes one', async () => {
  const env = await business(PLAIN_IDEA);
  const { approveAction, approveIn, proposeAction } = await import('../runtime/venture/journal/journal.ts');
  const agent = { ...owner, channel: 'mcp' as const };
  const write = await proposeAction(env.deps, agent, { action: 'connector.write', subject: 'mail_1', target: 'Mail app', actionDigest: 'e'.repeat(64), line: 'Send the reminder email.' });
  await assert.rejects(ventureAction(env.deps, owner, 'approve', 'test.standing', tx => approveIn(tx, owner, env.deps.store, { entryId: write.id, digest: write.actionDigest, standing: true })), code('INVALID_VENTURE_REQUEST'));
  const { entry } = await approveAction(env.deps, owner, { entryId: write.id, digest: write.actionDigest, standing: true } as any);
  assert.equal(entry.approval!.approvedBy, 'owner', 'approveAction drops standing: a person approved it');
  assert.equal((entry as any).decidedBy, 'owner');
});

test('the model port re-checks the judge setting and its consent when it claims a standing judge call', async () => {
  const { createModelPort, handlers: modelHandlers, PRESETS } = await import('../runtime/venture/models/index.ts');
  const { TrustService } = await import('../runtime/trust.ts');
  const { VentureTestStore } = await import('./venture-test-store.ts');
  const store = new VentureTestStore();
  const votes = { votes: [{ rule: 'goal-met', answer: 'yes', cites: ['draft'], quote: '', reason: 'Fine.' }] };
  const reply = { id: 'msg_synthetic', type: 'message', role: 'assistant', model: 'synthetic', content: [{ type: 'text', text: JSON.stringify(votes) }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 812, output_tokens: 64 } };
  const transport = { replay: false, async http() { return { status: 200, body: JSON.stringify(reply) }; }, async process() { throw new Error('No process here.'); } };
  const values = new Map<string, string>();
  const secrets = { get: (name: string) => values.get(name) ?? null, set: (name: string, value: string) => { values.set(name, value); }, delete: (name: string) => { values.delete(name); }, has: (name: string) => values.has(name), clear: () => values.clear() };
  const clock = () => new Date('2026-10-21T10:00:00.000Z');
  const port = createModelPort({ store, clock, transport, secrets, host: 'test', demo: false, claudeCodeTerms: 'accepted' } as any);
  const deps = { store, clock, models: port, services: { trust: new TrustService(store) }, secrets, host: 'test', demo: false, storage: 'experimental-file' } as any;
  await ventureAction(deps, owner, 'admin', 'create', tx => tx.put({
    ...tx.base('venture-record'), idea: 'Pricing advice for small shops', ideaDigest: 'synthetic', workingName: 'Test Business',
    country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2 } as any, serviceType: 'consulting', status: 'live', launchStage: 'approve-each',
    blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  } as any), { create: true });
  const haiku = PRESETS.find(item => item.id === 'anthropic-haiku-5-5')!;
  await (modelHandlers as any)['venture.models.connect'](deps, owner, { presetId: haiku.id, consentDigest: haiku.consentDigest, apiKey: ['sk', 'ant', 'test', 'not', 'a', 'real', 'key'].join('-') });
  const { rulesTask: rules } = await import('../runtime/venture/delivery/judge/rules.ts');
  const task = rules({ rules: [{ id: 'goal-met', question: 'Does it serve the goal?', text: 'The draft must serve the goal.', floor: { kind: 'required-yes' } }], trace: { events: [{ id: 'draft', kind: 'draft', summary: 'A draft.' }] }, draft: 'A draft.', containsClientData: true });
  const first = (await port.preview(owner, task))!;
  await assert.rejects(port.runPreview(owner, first.callId, first.digest, raw => raw, { consent: 'standing-judge' }), code('POLICY_DENIED'), 'no consent recorded: the port refuses');
  await ventureAction(deps, owner, 'approve', 'seed.consent', tx => { tx.put({ ...tx.base('venture-judge-setting'), auto: true, consent: { at: tx.now, by: 'owner', how: 'set', entryId: null } }); });
  const second = (await port.preview(owner, task))!;
  await port.runPreview(owner, second.callId, second.digest, raw => raw, { consent: 'standing-judge' });
  const calls = (store.read().conversations as any[]).filter(record => record.kind === 'venture-model-call');
  const sent = calls.find(call => call.id === second.callId);
  assert.equal(sent.consent, 'standing-judge');
  assert.equal(sent.approvedBy, null);
  await ventureAction(deps, owner, 'approve', 'seed.off', tx => { tx.put({ ...tx.base('venture-judge-setting'), auto: false, consent: null }); });
  const third = (await port.preview(owner, task))!;
  await assert.rejects(port.runPreview(owner, third.callId, third.digest, raw => raw, { consent: 'standing-judge' }), code('POLICY_DENIED'), 'turned off: the port refuses');
});
