import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, turn, openSaved } from './fixtures/conversation-public-flow-acceptance.ts';

// Supplemental acceptance against the exact frozen production tree. Only copied
// public fixture setup is external; no production helper/continuation is invoked.
// Requests go through the real desktop preload and strict IPC, in the order the desktop sends them.
test('user can answer a retained clarification with a short reply after reopening', async t => {
  const original='How much did we invoice in the period I choose?', reply='September, please.';
  // A credential-free route keeps worker restart independent of the fixture's
  // ephemeral synthetic API secret. HTTP is still intercepted in the worker.
  const f=await fixture(t,{[original]:{kind:'clarification'},[reply]:{kind:'clarification'}},'ollama');
  const first=await turn(f,original);
  assert.ok(first.answer.clarification);
  await f.restart(); const fresh=await f.desktop();
  const saved=await openSaved(fresh,original);
  assert.equal(saved.saved.answer.clarification,first.answer.clarification);
  const history=await fresh.exposed.request('conversation.history');
  const pending=history.items.find((item:any)=>item.question===original&&item.kind==='clarification');
  assert.ok(pending); assert.deepEqual((await fresh.exposed.request('conversation.get',{id:pending.id})).answer,first.answer);
  assert.equal(saved.continuationId,pending.id);
  assert.equal((await f.calls()).length,1,'Reopening the clarification must not dispatch.');
  const followup=await turn(f,reply,fresh,saved.continuationId), calls=await f.calls(), call=calls.at(-1);
  const trace={commit:'21bf514f71b49ba761a0be304319a8771dfd5662',tree:'4d72b2cb697a75074e9dc00036ada2478f5f2dbe',original,reply,clarificationId:pending.id,
    originalAnswer:first.answer,followupAnswer:followup.answer,followupPreview:followup.preview,
    providerInput:call.input,desktopFollowupRequests:fresh.calls.filter((item:any)=>item.method==='models.preview'||item.method==='models.approve'||item.method==='conversation.ask'),
    rejectedRequests:fresh.rejected,
    retainedClarificationReadable:true,readbackProviderCalls:1,totalProviderCalls:calls.length,originalIntentDisclosed:call.payload.includes(original),parentTurnBound:call.payload.includes(pending.id)};
  t.diagnostic(JSON.stringify(trace));
  assert.equal(call.input.question,reply); assert.equal(calls.length,2);
  t.diagnostic('Retained clarification reopens exactly; short follow-up reaches provider as a standalone question. Original intent disclosed='+trace.originalIntentDisclosed+', parent bound='+trace.parentTurnBound);
  assert.equal(trace.originalIntentDisclosed,true,'The short reply must reach the planner with its retained original intent, not as a new unrelated question.');
  assert.equal(trace.parentTurnBound,true,'The reviewed follow-up must bind the guarded pending turn.');
});

test('actual gateway warning and retained clarification and all-error bodies remain readable after reopening', async t=>{
  const clarification='Please clarify which period my question needs.', failure='Age the September invoices without required links.';
  const f=await fixture(t,{[clarification]:{kind:'clarification'},[failure]:{calls:['aging']}});
  const first=await turn(f,clarification),second=await turn(f,failure);
  assert.equal(second.answer.results[0].error.code,'AGING_LINK_REQUIRED');
  for(const result of [first,second]) {
    assert.ok(result.preview.definitionDisclosureWarning);
    // The public preview fixture asserts the warning is present on every reviewed preview before approval.
    assert.ok(result.preview.payload.includes('publishedCalculations'));
  }
  await f.restart();const fresh=await f.desktop(),history=await fresh.exposed.request('conversation.history');
  for(const [question,kind,answer] of [
    [clarification,'clarification',first.answer],
    [failure,'grounded-conversation',second.answer],
  ] as const) {
    const matches=history.items.filter((item:any)=>item.question===question&&item.kind===kind);
    assert.equal(matches.length,1);
    assert.deepEqual((await fresh.exposed.request('conversation.get',{id:matches[0].id})).answer,answer);
    const saved=await openSaved(fresh,question);assert.deepEqual(saved.saved.answer,answer);
  }
  assert.equal((await f.calls()).length,2);
});

test('saved mixed answer opens its exact composite binding and both tool results after reopening', async t=>{
  const question='Describe the business and September invoice total.';
  const f=await fixture(t,{[question]:{calls:['business.describe','billed']}}),{answer}=await turn(f,question);
  await f.restart();const fresh=await f.desktop(),saved=await openSaved(fresh,question);
  assert.equal(saved.saved.answer.kind,'grounded-conversation');assert.equal(saved.saved.answer.id,answer.id);
  assert.deepEqual(saved.saved.answer.results.map((result:any)=>result.tool),['business.describe','calculator.calculate']);
  assert.ok(saved.saved.answer.results.every((result:any)=>result.answer));
  assert.deepEqual((await fresh.exposed.request('conversation.get',{id:answer.id})).answer,answer);
  assert.equal((await f.calls()).length,1);
});

test('repeated mixed questions retain distinct previews and exact distinct combined answers after reopening', async t=>{
  const question='Tell me our business and September invoicing.';
  const f=await fixture(t,{[question]:{calls:['business.describe','billed']}}),first=await turn(f,question),second=await turn(f,question);
  assert.notEqual(first.preview.id,second.preview.id);assert.notEqual(first.answer.id,second.answer.id);
  await f.restart();const fresh=await f.desktop(),history=await fresh.exposed.request('conversation.history');
  assert.equal(history.items.filter((item:any)=>item.question===question&&item.kind==='grounded-conversation').length,2);
  for(const expected of [first.answer,second.answer])assert.deepEqual((await fresh.exposed.request('conversation.get',{id:expected.id})).answer,expected);
  assert.equal((await f.calls()).length,2);
});
