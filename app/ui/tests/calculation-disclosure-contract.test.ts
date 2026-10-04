import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyModelPreview, verifyConversationContinuation } from '../src/bridge/conversation-contract.ts';
import { planningPreviewFixture, conversationRequestFixture, continuationFixture } from './conversation-fixtures.ts';
import type { ConversationRequest } from '../src/bridge/conversation-contract.ts';
import type { ReviewedCalculationParameters } from '../src/bridge/calculation-parameters.ts';

// All DTOs below are authored synthetic fixtures. No Engine, provider, native
// database, transport or credentials are used.
// Data remains the deliberately loose shape of raw wire replies so hostile
// mutations stay expressible; the expected owner request is the real contract.
type Data = Record<string, any>;
const sha = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const warning = 'Exact owner-requested periods and scenario assumptions are included separately from evidence Shape. Review them before approving this payload once; scenario inputs never alter source facts.';
const label = 'Owner-requested price assumption in basis points; scenario only, not a measured fact.';
const keys = ['period', 'comparePeriod', 'assumptions'];
const metadataKeys = ['reviewedCalculationParameters', 'calculationParameterOrigins', 'calculationParametersDigest', 'calculationParameterDisclosure', 'calculationParameterDisclosureWarning'];
const current = {from: '2026-09-01', to: '2026-09-30'};
const prior = {from: '2026-08-01', to: '2026-08-31'};
function disclosure(parameters: Data, origins: Data): Data {
  return {kind:'owner-requested-calculation-parameters', period:parameters.period ?? null, comparePeriod:parameters.comparePeriod ?? null,
    assumptions:parameters.assumptions ? {origin:'owner-requested',label,...parameters.assumptions} : null,
    missingInputClarifications:{change:!parameters.period && !parameters.comparePeriod ? 'Which current and comparison periods should I use?' : !parameters.period ? 'Which current period should I use?' : !parameters.comparePeriod ? 'Which comparison period should I use?' : null,
      scenario:parameters.assumptions ? null : 'What price change in basis points should I assume?'}, origins};
}
function fixture(parameters: ReviewedCalculationParameters = {}, inherited: ReviewedCalculationParameters | undefined = undefined): {raw:Data; request:ConversationRequest} {
  // The expected request is readonly, so the continuation id is part of its
  // construction rather than assigned afterwards; inherited inputs stay out of it.
  const request:ConversationRequest = {...conversationRequestFixture(), ...copy(parameters), ...(inherited !== undefined ? {continuationId:'conversation_clarification_fixture'} : {})};
  // The base fixture deliberately supplies only current-period scope. Full
  // authored calculation metadata and the expected request stay independent.
  const baseRequest:ConversationRequest={...conversationRequestFixture(), ...(parameters.period ? {period:parameters.period} : {}), ...(request.continuationId ? {continuationId:request.continuationId} : {})};
  const raw:Data=copy(planningPreviewFixture(baseRequest));
  const reviewed:Data={...copy(parameters)}, origins:Data={};
  if(inherited !== undefined) {
    Object.assign(reviewed,copy(inherited));
    const retained:Data=copy(continuationFixture(request.continuationId));
    const {digest:_oldDigest,...body}=retained;
    body.reviewedCalculationParameters=copy(inherited);
    if(inherited.period) body.requestScope.period=copy(inherited.period);
    raw.continuation={...body,digest:sha(body)};
    raw.continuationDigest=raw.continuation.digest;
    raw.requestScope=copy(raw.continuation.requestScope);
    raw.businessContext.request=copy(raw.requestScope);
    raw.requestScopeDigest=sha(raw.requestScope);
  }
  for(const key of keys) if(Object.hasOwn(reviewed,key)) origins[key]=inherited && Object.hasOwn(inherited,key) ? 'retained-owner-requested' : 'owner-requested';
  raw.reviewedCalculationParameters=reviewed;
  raw.calculationParameterOrigins=origins;
  raw.calculationParametersDigest=sha(reviewed);
  raw.calculationParameterDisclosure=disclosure(reviewed,origins);
  raw.calculationParameterDisclosureWarning=warning;
  const envelope=JSON.parse(raw.payload), content=JSON.parse(envelope.input);
  content.calculationParameters=copy(raw.calculationParameterDisclosure);
  envelope.input=JSON.stringify(content); raw.payload=JSON.stringify(envelope); raw.digest=sha(raw.payload);
  return {raw,request};
}
const invalid=(error:unknown)=>!!error && typeof error==='object' && 'code' in error && error.code==='INVALID_REPLY';
async function refused(raw:unknown, request:ConversationRequest):Promise<void> { await assert.rejects(verifyModelPreview(raw,request),invalid); }
function rehashPayload(raw:Data, mutate:(content:Data)=>void):void {
  const envelope=JSON.parse(raw.payload), content=JSON.parse(envelope.input); mutate(content);
  envelope.input=JSON.stringify(content); raw.payload=JSON.stringify(envelope); raw.digest=sha(raw.payload);
}

test('current complete empty calculation metadata is admitted and retained without mutating exact payload or warning', async()=>{
  const {raw,request}=fixture(), before=JSON.stringify(raw), checked=await verifyModelPreview(raw,request);
  assert.ok(checked.purpose === 'conversation', 'planning preview must verify as a conversation preview');
  assert.deepEqual(checked.reviewedCalculationParameters,{});
  assert.deepEqual(checked.calculationParameterOrigins,{});
  assert.deepEqual(checked.calculationParameterDisclosure,raw.calculationParameterDisclosure);
  assert.equal(checked.calculationParameterDisclosureWarning,warning);
  assert.equal(checked.payload,raw.payload); assert.equal(checked.digest,raw.digest);
  assert.equal(JSON.stringify(raw),before); assert.ok(Object.isFrozen(checked.calculationParameterDisclosure));
});
test('explicit current/comparison periods and scenario inputs preserve exact strings and origin through every supported envelope', async()=>{
  const cases:readonly ReviewedCalculationParameters[]=[{period:current},{period:current,comparePeriod:prior},{assumptions:{priceChangeBps:'00500'}},{assumptions:{priceChangeBps:'-10000'}},{assumptions:{priceChangeBps:'100000'}},{assumptions:{priceChangeBps:'-0'}}];
  for(const parameters of cases) {
    for(const dialect of ['responses','ollama','cli']) {
      const {raw,request}=fixture(parameters), envelope=JSON.parse(raw.payload);
      if(dialect==='ollama') raw.payload=JSON.stringify({model:'synthetic-model',messages:[{role:'system',content:raw.instructions},{role:'user',content:envelope.input}],tools:[]});
      if(dialect==='cli') {raw.receiptBoundary='application-to-official-cli';raw.providerPayloadObserved=false;raw.endpoint='cli://claude/provider-managed';raw.payload=raw.instructions+'\n'+envelope.input;}
      raw.digest=sha(raw.payload);const checked=await verifyModelPreview(raw,request);
      assert.ok(checked.purpose === 'conversation', `${dialect} envelope must verify as a conversation preview`);
      assert.deepEqual(checked.reviewedCalculationParameters,parameters);
      assert.equal(checked.payload,raw.payload); assert.equal(checked.calculationParameterDisclosureWarning,warning);
    }
  }
});
test('retained owner inputs bind to continuation digest and origin while newly supplied missing inputs remain owner-requested', async()=>{
  const inherited:ReviewedCalculationParameters={period:current,assumptions:{priceChangeBps:'00500'}}, {raw,request}=fixture({comparePeriod:prior},inherited);
  const continuationId=request.continuationId;
  assert.ok(continuationId !== undefined, 'retained-input request must carry its continuation id');
  const retained=await verifyConversationContinuation(raw.continuation,continuationId);
  assert.deepEqual(retained.reviewedCalculationParameters,inherited);
  const checked=await verifyModelPreview(raw,request);
  assert.ok(checked.purpose === 'conversation', 'retained-input preview must verify as a conversation preview');
  assert.deepEqual(checked.calculationParameterOrigins,{period:'retained-owner-requested',comparePeriod:'owner-requested',assumptions:'retained-owner-requested'});
  // Retained origins are separate metadata; the disclosed scenario itself still
  // carries the owner-requested origin label.
  const assumptions=checked.calculationParameterDisclosure.assumptions;
  assert.ok(assumptions !== null, 'retained scenario assumptions must be disclosed');
  assert.equal(assumptions.origin,'owner-requested');
  const changed=copy(raw);changed.continuation.reviewedCalculationParameters.assumptions.priceChangeBps='501';
  await refused(changed,request);
  await refused(raw,{...request,period:prior});
});
test('each missing metadata field and every extra nested parameter or origin field refuses before review', async()=>{
  const {raw,request}=fixture({period:current});
  for(const key of metadataKeys) {const changed=copy(raw);delete changed[key];await refused(changed,request);}
  for(const path of ['parameters','origin','period','disclosure']) {
    const changed=copy(raw);
    if(path==='parameters') changed.reviewedCalculationParameters.extra='invented';
    if(path==='origin') changed.calculationParameterOrigins.extra='owner-requested';
    if(path==='period') changed.reviewedCalculationParameters.period.extra='invented';
    if(path==='disclosure') changed.calculationParameterDisclosure.extra='invented';
    await refused(changed,request);
  }
});
test('invalid dates, reversed periods, wrong types and out of range or computed assumption input refuse', async()=>{
  for(const bad of [{period:{from:'2026-02-30',to:'2026-03-01'}},{period:{from:'2026-09-30',to:'2026-09-01'}},{comparePeriod:null},{assumptions:{priceChangeBps:500}},{assumptions:{priceChangeBps:'-10001'}},{assumptions:{priceChangeBps:'100001'}},{assumptions:{priceChangeBps:'1.5'}}]) {
    const {raw,request}=fixture();raw.reviewedCalculationParameters=bad;raw.calculationParametersDigest=sha(bad);
    await refused(raw,request);
  }
  const {raw,request}=fixture({assumptions:{priceChangeBps:'500'}});
  let reads=0;Object.defineProperty(raw.reviewedCalculationParameters.assumptions,'priceChangeBps',{enumerable:true,get(){reads++;return '500';}});
  await refused(raw,request);assert.equal(reads,0);
});
test('changed origins, parameter digest, disclosure or missing-input clarifications refuse even with a correct payload hash', async()=>{
  const {raw,request}=fixture({period:current,assumptions:{priceChangeBps:'500'}});
  for(const mutate of [(v:Data)=>{v.calculationParameterOrigins.period='retained-owner-requested';},(v:Data)=>{v.calculationParametersDigest='0'.repeat(64);},(v:Data)=>{v.calculationParameterDisclosure.period.from='2026-09-02';},(v:Data)=>{v.calculationParameterDisclosure.assumptions.label='Measured source fact';},(v:Data)=>{v.calculationParameterDisclosure.missingInputClarifications.change=null;}]) {const changed=copy(raw);mutate(changed);await refused(changed,request);}
});
test('a rehashed payload cannot substitute the exact reviewed calculation disclosure', async()=>{
  const {raw,request}=fixture({period:current,comparePeriod:prior,assumptions:{priceChangeBps:'500'}});
  rehashPayload(raw,content=>{content.calculationParameters.assumptions.priceChangeBps='501';});
  await refused(raw,request);
});
test('a consistently rehashed metadata and payload cannot change the explicit owner request', async()=>{
  const {raw,request}=fixture({period:current}), changed=fixture({period:prior}).raw;
  // Preserve original request identity/question; every attacker-recomputed digest
  // is individually valid, so refusal depends on expected-request binding.
  assert.equal(sha(changed.payload),changed.digest);
  assert.equal(sha(changed.reviewedCalculationParameters),changed.calculationParametersDigest);
  await refused(changed,request);
  assert.equal(raw.naturalQuestion,changed.naturalQuestion);
});
test('missing or empty warning refuses; an altered nonempty Engine warning remains exact for honest rendering', async()=>{
  const {raw,request}=fixture();const empty=copy(raw);empty.calculationParameterDisclosureWarning='';
  await refused(empty,request);
  raw.calculationParameterDisclosureWarning=warning+'\nAdditional current Engine instruction.';
  const checked=await verifyModelPreview(raw,request);
  assert.ok(checked.purpose === 'conversation', 'altered-warning preview must verify as a conversation preview');
  assert.equal(checked.calculationParameterDisclosureWarning,raw.calculationParameterDisclosureWarning);
});

