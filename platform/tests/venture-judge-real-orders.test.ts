import {nativeJudgeBusiness as business,readyNativeDraft as readyDraft,waitNativeDraft} from './native-judge-business.ts';
// The rules judge on real orders (Ink v2 wave 2, package 2C1, catalogue Q1 and the founder's decision of 23 Oct).
// "Ask the judge" (venture.delivery.judge) previews the judge's call on a ready agent draft; "Send to the judge"
// (venture.delivery.judgeSend) sends it once through the action journal and code counts the votes. A failed verdict
// blocks Accept with the judge's reason; a vote code could not check settles nothing and blocks nothing. With judgeAuto
// on (the default), the judge runs on its own on every ready draft that goes to a client or the public, once per draft,
// under the client's recorded AI permission; internal papers for the CA never trigger it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { DRAFT_RULES } from '../runtime/venture/delivery/judge/rules.ts';
import { CA_JUDGE_RULES } from '../runtime/venture/playbooks/ca-firm/claims.ts';
import { autoJudge, JUDGE_EDIT_LINE } from '../runtime/venture/delivery/judge-run.ts';
import { diagnose } from '../runtime/venture/delivery/improve.ts';
import { signalScenario } from '../runtime/venture/delivery/scenarios.ts';
import { draftPostChecks } from '../runtime/venture/build/posting.ts';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { CA_IDEA, code, noOn, owner, phone, plainDraft, PLAIN_IDEA, type Business } from './venture-judge-helpers.ts';
import { consentForOrder } from './fixtures/venture/scripted-agent.ts';

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

test('manual quality refuses a cancelled order before preparing client data', async () => {
  const env = await manual(), run = await readyDraft(env);
  await ventureAction(env.deps, owner, 'prepare', 'test.cancel-manual-quality-order', tx => {
    const { agentJob: _nativeJob, ...prepared } = tx.find('venture-delivery-run', run.id)!;
    tx.replace(prepared);
    tx.replace({ ...tx.find('venture-order', run.orderId)!, status: 'cancelled' });
  });
  const before = env.models.previewed.length;
  await assert.rejects(env.call('venture.delivery.judge', { runId: run.id }), code('JOB_SOURCE_CHANGED'));
  assert.equal(env.models.previewed.length, before);
});

for (const phase of ['preview', 'confirm', 'dispatch', 'response'] as const) test(`manual quality preview binds the original client grant at ${phase}`, async () => {
  const env = await manual(), run = await readyDraft(env);
  // Retained desk model drafts have no native agent job. Exercise their supported quality-check path explicitly.
  await ventureAction(env.deps, owner, 'prepare', 'test.separately-prepared-model-draft', tx => {
    const { agentJob: _nativeJob, ...prepared } = tx.find('venture-delivery-run', run.id)!;
    tx.replace(prepared);
  });
  const replaceGrant = async () => {
    await env.call('venture.client.aiConsent.withdraw', { clientId: env.client.id });
    await consentForOrder(env.deps, owner, run.orderId);
  };
  let preparedCall = '';
  if (phase === 'preview') env.models.onPreview = async () => {
    await env.store.update(state => { const call = state.conversations.filter(row => row.kind === 'venture-model-call').at(-1)!;
      preparedCall = call.id; Object.assign(call, { ventureId: runOf(env, run.id).ventureId, payloadText: 'Private manual quality source.', payloadTruncated: false }); });
    await replaceGrant();
  };
  if (phase === 'preview') {
    await assert.rejects(env.call('venture.delivery.judge', { runId: run.id }), code('CLIENT_AI_CONSENT_CHANGED'));
    const abandoned = listRecords(env.store.read(), 'venture-model-call').find(row => row.id === preparedCall)!;
    assert.equal(abandoned.status, 'expired'); assert.equal(abandoned.payloadText, '');
    return;
  }
  const preview = await env.call('venture.delivery.judge', { runId: run.id });
  if (phase === 'confirm') {
    // The fixture port keeps minimal calls; give this retention assertion the real call's business scope.
    const callId = runOf(env, run.id).judge!.callId, ventureId = runOf(env, run.id).ventureId;
    await env.store.update(state => { const call = state.conversations.find(row => row.id === callId)!; call.ventureId = ventureId; });
  }
  const sent = env.models.sent;
  if (phase === 'confirm') await replaceGrant();
  const send = env.models.runPreview.bind(env.models);
  env.models.runPreview = async (ctx, id, approved, validate, options) => {
    if (phase === 'dispatch') await replaceGrant();
    const outcome = await send(ctx, id, approved, validate, options);
    if (phase === 'response') await replaceGrant();
    return outcome;
  };
  await assert.rejects(env.call('venture.delivery.judgeSend', { runId: run.id, digest: preview.digest }), code('CLIENT_AI_CONSENT_CHANGED'));
  assert.equal(env.models.sent - sent, phase === 'response' ? 1 : 0);
  assert.notEqual(runOf(env, run.id).judge?.status, 'done');
  if (phase === 'confirm') {
    const previousCall = runOf(env, run.id).judge!.callId;
    await env.call('venture.delivery.judge', { runId: run.id });
    assert.notEqual(runOf(env, run.id).judge!.callId, previousCall, 'a fresh explicit request can bind the replacement permission');
    assert.equal(listRecords(env.store.read(), 'venture-model-call').find(row => row.id === previousCall)!.status, 'expired');
  }
});

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
  assert.equal(env.models.sent, 0, 'the native agent produced the draft; the quality call still waits');
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
  assert.equal(failed.status, 'failed', 'the native draft tool refuses a missing heading before saving it');
  await assert.rejects(env.call('venture.delivery.judge', { runId: failed.id }), (error: any) => {
    assert.equal(error.code, 'DRAFT_CHANGED');
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

test('judgeAuto native: one client-authorized quality call per exact draft, with no outside approval invented', async()=>{
 const env=await business(PLAIN_IDEA);const run=await readyDraft(env);
 assert.equal(judgeOf(run).passed,true);assert.equal(run.judge.auto,true);
 assert.deepEqual(env.models.consents,['client-ai']);assert.equal(judgeEntries(env).length,0);
 assert.equal(settings(env).length,0,'client permission does not invent a standing judge consent');
 const before=env.models.rulesTasks().length;await autoJudge(env.deps,desktop,runOf(env,run.id));
 assert.equal(env.models.rulesTasks().length,before,'same draft is not charged twice');
 assert.equal(env.models.rulesTasks()[0].agentId,runOf(env,run.id).agentJob!.scope.agentId,'quality uses the assigned agent cap');
 assert.equal(env.models.rulesTasks()[0].agentJobId,runOf(env,run.id).agentJob!.scope.jobId,'each billed quality call remains bound to its job');
});

test('judgeAuto native: permission withdrawn while preparing the quality call prevents physical dispatch',async()=>{
 const env=await business(PLAIN_IDEA);
 let preparedCall='';
 env.models.onPreview=async task=>{if(rulesTask(task)){
   const ventureId=listRecords(env.store.read(),'venture-record')[0]!.id;
   await env.store.update(state=>{const call=state.conversations.filter(row=>row.kind==='venture-model-call').at(-1)!;preparedCall=call.id;Object.assign(call,{ventureId,payloadText:'Private native quality source.',payloadTruncated:false});});
   await env.call('venture.client.aiConsent.withdraw',{clientId:env.client.id});
 }};
 const run=await readyDraft(env);assert.equal(env.models.sent,0);assert.equal(judgeOf(run),undefined);
 assert.equal(run.judge.status,'failed');assert.match(run.judge.line,/permission|consent|AI/i);
 const abandoned=listRecords(env.store.read(),'venture-model-call').find(row=>row.id===preparedCall)!;
 assert.equal(abandoned.status,'expired');assert.equal(abandoned.payloadText,'');
});



test('judgeAuto: turning it off while the judge call is being prepared stops the send and leaves it off', async () => {
  const env = await business(PLAIN_IDEA);
  env.models.onPreview = async task => { if (rulesTask(task)) await env.call('venture.judge.auto.set', { auto: false }); };
  const run = await readyDraft(env);
  assert.equal(env.models.rulesTasks().length, 0, 'nothing was sent');
  assert.equal(run.judge.status, 'failed');
  assert.match(run.judge.line, /switched off/);
  assert.equal(judgeOf(run), undefined);
  assert.equal((await env.call('venture.judge.auto.get')).auto, false, 'it stays off');
  assert.deepEqual(settings(env).map(item => item.auto), [false], 'client consent does not turn the owner setting back on');
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
    `${counted} of ${counted} checks passed. The quality check settled no rule, so its check is not counted.`);
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
  const papers = await waitNativeDraft(ca, auditWaiting.id);
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
  assert.match(practiceCase.expectedOutcome, /Watch for the quality check's rule right-head\./);
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
  assert.equal(held.judge.status, 'failed', 'a refused call is not reported as running');
  assert.match(held.judge.line, /The quality check did not finish: Your monthly AI limit is reached\./);
  assert.equal(env.models.rulesTasks().length, 0);
  env.models.refuseSend = null;
  const retry = await env.call('venture.delivery.judge', { runId: held.id });
  const judged = await env.call('venture.delivery.judgeSend', { runId: held.id, digest: retry.digest });
  assert.equal(judgeOf(judged).passed, true);
});


test('judgeAuto on: Accept waits while the automatic call is out, and a verdict never lands on a draft decided meanwhile', async () => {
  const env = await business(PLAIN_IDEA);
  env.models.respond['judge-rules'] = noOn('policy-followed', 'The reply offers a discount the plan does not have.');
  let during: any = null;
  env.models.onSend = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await env.call('venture.delivery.list');
    await assert.rejects(env.call('venture.delivery.review', { runId: listed.id, verdict: 'accepted' }), (error: any) => {
      assert.equal(error.code, 'DELIVERY_NOT_READY');
      assert.equal(error.message, 'AI work must finish before you can approve this draft.');
      return true;
    });
    during = listed;
  };
  const run = await readyDraft(env);
  assert.equal(during.canAccept, false);
  assert.equal(during.acceptBlocked, 'AI work must finish before you can approve this draft.');
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
  assert.match(row.line, /Not checked by the quality check\./);
  const view = await refused.call('venture.queue.view', { id: run.id, kind: 'draft' });
  assert.ok(view.sections.find((section: any) => section.heading === 'Checks').lines.some((line: string) => line.includes('Not checked by the quality check.')));

  const capped = await business(PLAIN_IDEA);
  capped.models.refuseSend = task => rulesTask(task) ? new ChausarError('BUDGET_REACHED', 'Your monthly AI limit is reached.') : null;
  const waiting = await readyDraft(capped);
  const cappedRow = (await capped.call('venture.queue.list')).rows.find((item: any) => item.kind === 'draft');
  assert.match(cappedRow.line, /The quality check has not read this draft\. The quality check did not finish: Your monthly AI limit is reached/ );
  const cappedView = await capped.call('venture.queue.view', { id: waiting.id, kind: 'draft' });
  assert.ok(cappedView.sections.find((section: any) => section.heading === 'Checks').lines.some((line: string) => line.startsWith('The quality check has not read this draft.')));

  const passed = await business(PLAIN_IDEA);
  await readyDraft(passed);
  const passedRow = (await passed.call('venture.queue.list')).rows.find((item: any) => item.kind === 'draft');
  assert.doesNotMatch(passedRow.line, /quality check/, 'a passing verdict adds nothing');
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



test("the quality preview uses the owner's rate card in the real model port",async()=>{
 const env=await manual();const run=await readyDraft(env);await env.call('venture.delivery.judge',{runId:run.id});
 const task=env.models.previewed.at(-1)!;
 const {createModelPort,handlers,PRESETS}=await import('../runtime/venture/models/index.ts');
 const values=new Map<string,string>();const secrets={get:(name:string)=>values.get(name)??null,set:(name:string,value:string)=>{values.set(name,value);},delete:(name:string)=>{values.delete(name);},has:(name:string)=>values.has(name),clear:()=>values.clear()};
 const transport={replay:false,async http(){throw new Error('Preview must not dispatch');},async process(){throw new Error('Preview must not dispatch');}};
 const port=createModelPort({...env.deps,transport,secrets,host:'test',demo:false,claudeCodeTerms:'accepted'} as any);
 const deps={...env.deps,models:port,secrets};const preset=PRESETS.find(item=>item.id==='anthropic-haiku-5-5')!;
 await handlers['venture.models.connect']!(deps,owner,{presetId:preset.id,consentDigest:preset.consentDigest,apiKey:['sk','ant','test','not','a','real','key'].join('-')});
 const list=await port.preview(owner,task);assert.ok(list);
 await env.call('venture.spend.policy.set',{rates:[{item:'model:anthropic-haiku-5-5',unit:'per-million-tokens',inputMicrosPerMillion:'10000000',outputMicrosPerMillion:'50000000',source:'My own contract',checkedOn:'2026-10-20'}]});
 const card=await port.preview(owner,task);assert.ok(card);
 assert.ok(BigInt(card.estimatedMaxCostMicros)>BigInt(list.estimatedMaxCostMicros)*50n,'owner pricing applies to the exact quality payload');
});

test('judgeAuto: between the ready draft and the judge, Accept waits; an accepted draft the judge never read says so', async () => {
  const env = await business(PLAIN_IDEA);
  let between: any = null;
  env.models.onPreview = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await env.call('venture.delivery.list');
    between = listed;
    await assert.rejects(env.call('venture.delivery.review', { runId: listed.id, verdict: 'accepted' }), code('DELIVERY_NOT_READY'));
  };
  const run = await readyDraft(env);
  assert.equal(between.status, 'ready-for-review');
  assert.equal(between.canAccept, false, 'the judge is due, so Accept waits for it');
  assert.equal(between.acceptBlocked, 'AI work must finish before you can approve this draft.');
  assert.equal(judgeOf(run).passed, true);
  assert.equal(run.canAccept, true);
  assert.equal(run.judgePending ?? null, null, 'the marker is gone once the judge is in');

  const unread = await business(PLAIN_IDEA);
  unread.models.refuseSend = task => rulesTask(task) ? new ChausarError('BUDGET_REACHED', 'Your monthly AI limit is reached.') : null;
  const waiting = await readyDraft(unread);
  assert.equal(waiting.canAccept, true, 'a judge call waiting for the owner does not hold Accept');
  await unread.call('venture.delivery.review', { runId: waiting.id, verdict: 'accepted' });
  const view = await unread.call('venture.queue.view', { id: waiting.id, kind: 'draft' });
  assert.ok(view.sections.find((section: any) => section.heading === 'Checks').lines.includes('The quality check never read this draft before you accepted it.'));
});



test('judgeAuto: a verdict that comes back after an edit or a reject keeps the run line and never asks to try again', async () => {
  const edited = await business(PLAIN_IDEA);
  edited.models.onSend = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await edited.call('venture.delivery.list');
    await assert.rejects(edited.call('venture.delivery.review', { runId: listed.id, verdict: 'edited', editedText: 'My own words for the client.' }),code('DELIVERY_NOT_READY'));
    await ventureAction(edited.deps,desktop,'approve','test.concurrent-edit',tx=>{const live=tx.find('venture-delivery-run',listed.id)!;tx.replace({...live,status:'edited',verdict:{choice:'edited',reason:null,at:tx.now},renderedText:'My own words for the client.'});});
  };
  const run = await readyDraft(edited);
  assert.equal(run.status, 'edited');
  assert.match(run.judge.line, /draft changed/i);
  assert.equal(judgeOf(run), undefined);

  const rejected = await business(PLAIN_IDEA);
  rejected.models.onSend = async task => {
    if (!rulesTask(task)) return;
    const [listed] = await rejected.call('venture.delivery.list');
    await rejected.call('venture.delivery.review', { runId: listed.id, verdict: 'rejected', reason: 'tone' });
  };
  const gone = await readyDraft(rejected);
  assert.equal(gone.status, 'rejected');
  assert.match(gone.judge.line, /draft changed/i);
  assert.doesNotMatch(gone.judge.line, /Ask the quality check again/);
});

test('the journal: a standing approval is only for the judge\'s own send, and approveAction never makes one', async () => {
  const env = await business(PLAIN_IDEA);
  const { approveAction, approveIn, proposeAction } = await import('../runtime/venture/journal/journal.ts');
  const agent = { ...owner, channel: 'mcp' as const };
  const write = await proposeAction(env.deps, agent, { action: 'connector.write', subject: 'mail_1', target: 'Mail app', actionDigest: 'e'.repeat(64), line: 'Send the reminder email.', operation: 'send-deliverable' });
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
