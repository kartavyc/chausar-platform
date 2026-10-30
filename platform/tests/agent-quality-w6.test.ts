import test from 'node:test';
import assert from 'node:assert/strict';
import { deliver, draft, installKitFixture, kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { withdrawClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { deliveryJudgeHandler, deliveryJudgeSendHandler } from '../runtime/venture/delivery/judge-run.ts';
import { startRevision, undoRevision } from '../runtime/venture/delivery/revise.ts';
import { waitForAgentWork } from '../runtime/venture/agent-runtime/runner.ts';
import { scriptedAgent, SCRIPTED_AGENT_SETTINGS, consentForOrder } from './fixtures/venture/scripted-agent.ts';
import type { DeliveryModelOutput, DeliveryRunView } from '../runtime/venture/contracts.ts';

test('native quality sees and cites only its current run receipts and source proofs', async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id,
    request: 'A voice sheet for Sunrise Bakery with the supplied cost total.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const file = await env.call('venture.files.add', { orderId: order.id, name: 'sample-costs.csv', contentBase64: Buffer.from('Item,Amount\nPaper,12.34\nInk,5.66\n').toString('base64') });
  let receiptId = '', label = '', sourceId = '', sourceDigest = '', qualityInput: any;
  const answer: DeliveryModelOutput = draft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for Sunrise Bakery.'] });
  answer.sections[0].parts.push({ kind: 'figure', text: '', ref: 'work-total' });
  env.deps.agentRoute = async () => ({ settings: SCRIPTED_AGENT_SETTINGS, driver: scriptedAgent(() => answer, undefined, undefined, async call => {
    const result = await call('calculate', { operation: 'sum_rows', arguments: { fileId: file.id, amountColumn: 'Amount' } });
    const receipt = listRecords(env.store.read(), 'venture-work-receipt').find(row => row.id === result.receipts[0].id)!;
    receiptId = receipt.id; label = receipt.figures.find(figure => figure.key === 'total')!.label;
    sourceId = receipt.inputs.tables[0].id; sourceDigest = receipt.inputs.tables[0].digest;
    await ventureAction(env.deps, owner, 'prepare', 'fixture.foreignReceipt', tx => {
      tx.put({ ...receipt, id: 'work_foreign_quality', runRef: { kind: 'delivery', runId: 'another-run' }, explanation: 'Foreign private receipt must not reach this quality call.' });
      // A calculation persists before currentReceipt/output screening can reject its result.
      // This same-run artifact never became an authorized reference in the saved draft.
      tx.put({ ...receipt, id: 'work_unreleased_quality', explanation: 'Unreleased calculation must not establish quality evidence.',
        inputs: { ...receipt.inputs, tables: [{ id: 'unreleased-source', name: 'Held source proof', digest: 'unreleased-source-digest' }] } });
    });
    return { 'work-total': result.refs.figures.find((figure: any) => figure.receiptId === receiptId && figure.figureKey === 'total').ref };
  }) });
  env.models.runPreview = async (_ctx, callId, _digest, validate, options) => {
    options?.beforeDispatch?.(); qualityInput = env.models.previewed.at(-1)!.input;
    const value = validate({ votes: qualityInput.rules.map((rule: any) => ({ rule: rule.id, answer: 'yes', cites: [receiptId], quote: '', reason: 'The current run calculator receipt supports this draft.' })) });
    return { value, by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'synthetic', costMicros: '0', priceConfirmed: true };
  };
  await env.deps.services.trust.updatePolicy(owner, { send: 'shape' });
  await consentForOrder(env.deps, owner, order.id);
  const started = await env.call('venture.delivery.run', { orderId: order.id });
  await waitForAgentWork(env.store, started.id);
  const ready: DeliveryRunView = (await env.call('venture.delivery.list')).find((run: DeliveryRunView) => run.id === started.id);
  assert.ok(qualityInput, 'the production native completion requests quality');
  assert.ok(qualityInput.trace.some((event: any) => event.id === receiptId && event.kind === 'receipt'), 'current work receipt is citable');
  assert.ok(qualityInput.trace.some((event: any) => event.kind === 'source' && event.summary.includes(sourceId) && event.summary.includes(sourceDigest)), 'source proof retains exact scoped table identity and digest');
  assert.ok(qualityInput.trace.some((event: any) => event.kind === 'tool' && event.summary.includes('calculate')), 'actual job tool evidence is present');
  assert.ok(qualityInput.draft.includes(`${label}: [price from Chausar]`), 'rendering resolves the current native receipt label');
  assert.doesNotMatch(JSON.stringify(qualityInput), /work_foreign_quality|Foreign private receipt/);
  assert.doesNotMatch(JSON.stringify(qualityInput), /work_unreleased_quality|Unreleased calculation|unreleased-source|Held source proof/);
  assert.ok(!qualityInput.trace.some((event: any) => event.id === order.priceReceiptId), 'an unused order price is not evidence for the saved draft');
  const saved = listRecords(env.store.read(), 'venture-delivery-run').find(run => run.id === ready.id)!;
  assert.ok(saved.checks.some(check => check.check === 'rules-judge' && check.passed && !check.notChecked), 'the receipt citation is verified by code');
});

test('a replaced native revision gets a new quality check while pending Undo keeps the old verdict', async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id,
    request: 'A voice sheet for Sunrise Bakery.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const calls: string[] = [];
  env.models.runPreview = async (_ctx, callId, _digest, validate, options) => {
    options?.beforeDispatch?.(); calls.push(callId);
    const input = env.models.previewed.at(-1)!.input as any;
    const value = validate({ votes: input.rules.map((rule: any) => ({ rule: rule.id, answer: 'yes', cites: [input.trace[0].id], quote: '', reason: 'Matches the supplied draft.' })) });
    return { value, by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'synthetic', costMicros: '17', priceConfirmed: true };
  };
  const ready = await deliver(env, order.id, draft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for Sunrise Bakery.'] }));
  const saved = () => listRecords(env.store.read(), 'venture-delivery-run').find(run => run.id === ready.id)!;
  const oldJudge = structuredClone(saved().judge);
  assert.equal(oldJudge?.status, 'done'); assert.equal(calls.length, 1);
  const settled = await ventureAction(env.deps, owner, 'prepare', 'fixture.qualityCharge', tx => tx.put({
    ...tx.base('venture-spend'), key: `model:${oldJudge!.callId}`, item: 'model:anthropic-sonnet-5-5', label: 'Completed quality check',
    agent: saved().agentJob!.scope.agentId, connector: 'anthropic-sonnet-5-5', payer: 'connection:synthetic', draftDigest: 'proof', rate: null,
    reservedMicros: '17', settledMicros: '17', settledBy: 'usage', phase: 'settled', quoteId: null, ref: oldJudge!.callId!, refusal: null, settledAt: tx.now,
  }));
  const route = env.deps.agentRoute!;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  env.deps.agentRoute = async (...args) => { entered(); await held; return route(...args); };
  const pending = startRevision(env.deps, owner, { runId: ready.id, words: 'Make the voice more direct.', by: 'send-back', rowId: null });
  await waiting;
  assert.deepEqual(saved().judge, oldJudge, 'pending revision does not discard the current draft verdict');
  await undoRevision(env.deps, owner, ready.id, null);
  release(); await assert.rejects(pending, { code: 'JOB_CLOSED' });
  assert.deepEqual(saved().judge, oldJudge, 'Undo preserves the verdict for the restored draft');
  env.deps.agentRoute = route;
  env.models.queueAgentDraft(draft('Voice sheet', { 'Voice sheet': ['A clear, direct voice for Sunrise Bakery.'] }));
  await startRevision(env.deps, owner, { runId: ready.id, words: 'Make the voice more direct.', by: 'send-back', rowId: null });
  await waitForAgentWork(env.store, ready.id);
  assert.equal(calls.length, 2, 'the changed draft requires its own quality check');
  assert.notEqual(saved().judge?.callId, oldJudge?.callId);
  assert.equal(saved().judge?.status, 'done');
  assert.ok(saved().checks.some(check => check.check === 'rules-judge' && check.passed));
  assert.deepEqual(listRecords(env.store.read(), 'venture-spend').find(row => row.id === settled.id), settled, 'the previous settled charge is retained');
});

for (const change of ['none', 'before-dispatch', 'after-response'] as const) test(`native quality check binds current client consent and draft: ${change}`, async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id,
    request: 'A voice sheet for Sunrise Bakery.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  let dispatched = 0;
  let consent: unknown;
  env.models.runPreview = async (_ctx, callId, _digest, validate, options) => {
    consent = options?.consent;
    if (change === 'before-dispatch') await withdrawClientAiConsent(env.deps, owner, { clientId: env.client.id });
    options?.beforeDispatch?.();
    dispatched++;
    const input = env.models.previewed.at(-1)!.input as any;
    const value = validate({ votes: input.rules.map((rule: any) => ({ rule: rule.id, answer: 'yes', cites: [input.trace[0].id], quote: '', reason: 'Matches the supplied draft.' })) });
    if (change === 'after-response') await ventureAction(env.deps, owner, 'prepare', 'fixture.sourceChanged', tx => {
      const current = tx.find('venture-order', order.id)!;
      tx.replace({ ...current, request: 'A changed request that needs a new draft.' });
    });
    return { value, by: 'model', callId, presetId: 'anthropic-sonnet-5-5', model: 'synthetic', costMicros: '0', priceConfirmed: true };
  };
  const ready = await deliver(env, order.id, draft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for Sunrise Bakery.'] }));
  assert.equal(consent, 'client-ai', 'no business standing consent or invented per-turn approval');
  assert.equal(dispatched, change === 'before-dispatch' ? 0 : 1);
  const saved = listRecords(env.store.read(), 'venture-delivery-run').find(run => run.id === ready.id)!;
  assert.equal(saved.status, change === 'after-response' ? 'failed' : 'ready-for-review');
  if (change === 'none') {
    assert.equal(saved.judge?.status, 'done');
    assert.ok(saved.checks.some(check => check.check === 'rules-judge' && check.passed));
  } else {
    assert.notEqual(saved.judge?.status, 'done');
    assert.ok(!saved.checks.some(check => check.check === 'rules-judge' && check.passed));
  }
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry').filter(entry => entry.action === 'delivery.send').length, 0);
});

test('asking for a quality check manually cannot bypass withdrawn client permission', async t => {
  t.after(installKitFixture());
  const env = await kitBusiness();
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0].id,
    request: 'A voice sheet for Sunrise Bakery.', intake: { fields: { 'brand-name': 'Sunrise Bakery', 'consent-data': true } } });
  const ready = await deliver(env, order.id, draft('Voice sheet', { 'Voice sheet': ['A warm, plain voice for Sunrise Bakery.'] }));
  await ventureAction(env.deps, owner, 'prepare', 'fixture.clearJudge', tx => {
    const run = tx.find('venture-delivery-run', ready.id)!;
    tx.replace({ ...run, judge: undefined });
  });
  await withdrawClientAiConsent(env.deps, owner, { clientId: env.client.id });
  const before = env.models.previewed.length;
  await assert.rejects(deliveryJudgeHandler(env.deps, owner, { runId: ready.id }), { code: 'CLIENT_AI_CONSENT_REQUIRED' });
  assert.equal(env.models.previewed.length, before);
});

test('manual native quality retry keeps its exact agent and job accounting binding',async t=>{
 t.after(installKitFixture());const env=await kitBusiness();
 await env.call('venture.judge.auto.set',{auto:false});
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0].id,request:'A voice sheet for Sunrise Bakery.',intake:{fields:{'brand-name':'Sunrise Bakery','consent-data':true}}});
 const ready=await deliver(env,order.id,draft('Voice sheet',{'Voice sheet':['A warm, plain voice for Sunrise Bakery.']}));
 const saved=()=>listRecords(env.store.read(),'venture-delivery-run').find(run=>run.id===ready.id)!;
 for(let attempt=0;attempt<2;attempt++){
   const preview=await deliveryJudgeHandler(env.deps,owner,{runId:ready.id});
   const task=env.models.previewed.at(-1)!;
   assert.equal(task.agentId,saved().agentJob!.scope.agentId);
   assert.equal(task.agentJobId,saved().agentJob!.scope.jobId);
   env.models.runPreview=async(_ctx,callId,_digest,validate,options)=>{
     options?.beforeDispatch?.();const input=task.input as any;
     const value=validate({votes:input.rules.map((rule:any)=>({rule:rule.id,answer:'yes',cites:[input.trace[0].id],quote:'',reason:'Matches the supplied draft.'}))});
     await ventureAction(env.deps,owner,'prepare','fixture.manual-charge',tx=>{
       tx.put({...tx.base('venture-model-call'),id:callId,purpose:'judge',agentId:task.agentId,agentJobId:task.agentJobId,tier:'fast',presetId:'anthropic-sonnet-5-5',connectionId:null,routeKind:'anthropic-messages',model:'synthetic',consent:'approved-preview',endpoint:'https://api.anthropic.com/v1/messages',payloadText:'synthetic',payloadDigest:'proof',payloadTruncated:false,containsClientData:true,status:'completed',approvedDigest:preview.digest,approvedAt:tx.now,approvedBy:owner.memberId,estimatedMaxCostMicros:'100',priceConfirmed:true,usage:{inputTokens:100,outputTokens:0},costMicros:'100',outputDigest:null,error:null,replay:true});
       tx.put({...tx.base('venture-spend'),key:`model:${callId}`,item:'model:anthropic-sonnet-5-5',label:'Synthetic quality',agent:task.agentId!,connector:'anthropic-sonnet-5-5',payer:'connection:synthetic',draftDigest:'proof',rate:null,reservedMicros:'100',settledMicros:'100',settledBy:'usage',phase:'settled',quoteId:null,ref:callId,refusal:null,settledAt:tx.now});
     });
     return {value,by:'model',callId,presetId:'anthropic-sonnet-5-5',model:'synthetic',costMicros:'100',priceConfirmed:true};
   };
   await deliveryJudgeSendHandler(env.deps,owner,{runId:ready.id,digest:preview.digest});
   const receipt=listRecords(env.store.read(),'venture-sum-receipt').find(row=>row.id===saved().agentJob!.cost?.receiptId);
   assert.equal(receipt?.totalMinor,String((attempt+1)*100));
   if(!attempt)await ventureAction(env.deps,owner,'prepare','fixture.retry',tx=>{const run=tx.find('venture-delivery-run',ready.id)!;tx.replace({...run,judge:{...run.judge!,status:'failed',line:'Synthetic retry requested'}});});
 }
});
