import assert from 'node:assert/strict';
import test from 'node:test';
import { registeredJobCalculations } from '../runtime/venture/agent-runtime/trusted-calculators.ts';
test('only the current workflow pure calculators are exposed, never shell, delegates or outside effects', () => {
  const available = registeredJobCalculations(['tax.gst', 'tax.income', 'books.reconcile', 'agent.delegate', 'outbox.prepare', 'sandbox.run', 'cfo.scenarios']);
  assert.deepEqual(available.map(row => row.name), ['tax_gst', 'tax_income', 'books_reconcile', 'cfo_scenarios']);
  for (const row of available) assert.equal(row.inputSchema.additionalProperties, false);
  assert.deepEqual(registeredJobCalculations([]), []);
});

import { kitBusiness, owner } from './fixtures/venture/kit-business.ts';
import { ensurePlaybook } from '../runtime/venture/delivery/playbook.ts';
import { findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { createNativeJob } from '../runtime/venture/agent-runtime/native-job.ts';
import { calculatorAgent } from './fixtures/venture/calculator-agent.ts';
import { calculatorSources } from '../runtime/venture/agent-runtime/trusted-calculators.ts';
import { waitForAgentWork } from '../runtime/venture/agent-runtime/runner.ts';
import { consentForOrder } from './fixtures/venture/scripted-agent.ts';
import { answerAgentFacts } from '../runtime/venture/agent-runtime/facts.ts';
import { withdrawClientAiConsent } from '../runtime/venture/clients/ai-consent.ts';
import { queueListHandler, queueDecideHandler } from '../runtime/venture/views/queue.ts';
import { MCP_PROTOCOL_VERSION } from '../runtime/mcp.ts';

async function taxJob(t: {after(fn:()=>unknown):void}) {
  const env = await kitBusiness(undefined, { idea: 'An AI-native CA firm for GST filing and income tax returns in Pune' });
  await env.deps.services.trust.updatePolicy(owner, { send:'shape' });
  await env.call('venture.ca.setOfRecord', {name:'CA Asha Rao',membershipNo:'123456'});
  await env.call('venture.ca.confirmRates', {tableIds:['in-gst-rates@2'],membershipNo:'123456'});
  await ventureAction(env.deps,owner,'prepare','test.tax-id',tx=>tx.replace({...tx.find('venture-client',env.client.id)!,taxId:'27ABCDE1234F1Z0'}));
  const order = await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers.find((row:any)=>row.playbookOffer==='gst-working')!.id,request:'Prepare GST from the attached sales register.'});
  const file=await env.call('venture.files.add',{orderId:order.id,name:'sales.csv',contentBase64:Buffer.from('Invoice,Date,GSTIN,State,HSN,Taxable,Rate\nINV-101,03/10/2026,27AAAFS1234K1ZB,27,998222,10000.00,18%').toString('base64')});
  const playbook=await ensurePlaybook(env.deps,owner);
  const run=await ventureAction(env.deps,owner,'prepare','test.calculation-job',tx=>tx.put({...tx.base('venture-delivery-run'),orderId:order.id,playbookId:playbook.id,playbookHash:playbook.hash,status:'waiting-for-you',servedBy:'model',practice:false,callId:null,preview:null,deliverable:null,renderedText:null,checks:[],verdict:null,editedText:null}));
  await consentForOrder(env.deps,owner,order.id);
  async function open(runId:string, resumeFrom?:string) {
  const job=await createNativeJob(env.deps,owner,runId,{agentId:'accountant',sections:['Working papers'],check:()=>undefined,resumeFrom});t.after(()=>job.close());
  let id=0;await job.service.handle(owner,{jsonrpc:'2.0',id:++id,method:'initialize',params:{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'fixture',version:'1'}}});
  await job.service.handle(owner,{jsonrpc:'2.0',method:'notifications/initialized'});
  const call=async(name:string,args:Record<string,unknown>={})=>{const reply:any=await job.service.handle(owner,{jsonrpc:'2.0',id:++id,method:'tools/call',params:{name,arguments:args}});assert.equal(reply.error,undefined,JSON.stringify(reply));return reply.result.structuredContent.data;};
  return {job,call};
  }
  return {...env,request:env.call,order,file,run,open,...await open(run.id)};
}
const gstArgs={period:'2026-10',outward:{table:'f1',invoice:'Invoice',date:'Date',counterpartyGstin:'GSTIN',placeOfSupply:'State',hsnSac:'HSN',taxable:'Taxable',rate:'Rate'}};
test('native tax calculator persists exact code evidence and refuses foreign aliases or injected scope',async t=>{
 const env=await taxJob(t),out=await env.call('calculate',{operation:'tax_gst',arguments:gstArgs});
 assert.equal(out.result.ok,true,JSON.stringify(out.result));assert.equal(out.receipts.length,1);
 const otherClient=await env.request('venture.client.add',{name:'Another client',email:'other@example.com',countryCode:'IN'});
 const otherOrder=await env.request('venture.order.create',{clientId:otherClient.id,offerId:env.order.offerId,request:'Another client tax papers.'});
 const foreignFile=await env.request('venture.files.add',{orderId:otherOrder.id,name:'foreign-sales.csv',contentBase64:Buffer.from('Item,Amount\nPrivate,999999').toString('base64')});
 assert.equal((await env.call('list_files')).files.some((row:any)=>row.id===foreignFile.id),false);
 const denied:any=await env.job.service.handle(owner,{jsonrpc:'2.0',id:88,method:'tools/call',params:{name:'read_file',arguments:{fileId:foreignFile.id,offset:0,limit:100}}});
 assert.equal(denied.error?.data?.code,'JOB_FILE_FORBIDDEN');
 const receipt=out.receipts[0];assert.equal(receipt.figures.find((row:any)=>row.key==='net-payable').minor,'180000');
 assert.equal(findRecord(env.store.read(),'venture-work-receipt',receipt.id)!.digest,receipt.digest);
 assert.equal(findRecord(env.store.read(),'venture-delivery-run',env.run.id)!.agentJob!.calculations!.length,1);
 assert.ok(out.refs.figures.some((row:any)=>row.receiptId===receipt.id));
 const foreign=await env.call('calculate',{operation:'tax_gst',arguments:{...gstArgs,outward:{...gstArgs.outward,table:'f2'}}});
 assert.equal(foreign.result.ok,false);assert.deepEqual(foreign.receipts,[]);
 const injected:any=await env.job.service.handle(owner,{jsonrpc:'2.0',id:90,method:'tools/call',params:{name:'calculate',arguments:{operation:'tax_gst',arguments:{...gstArgs,clientId:'another-client'}}}});
 assert.equal(injected.error?.data?.code,'INVALID_ARGUMENTS');
 assert.equal(listRecords(env.store.read(),'venture-work-receipt').length,1);
});
test('native missing facts wait durably for an exact owner answer and fresh session, never a guessed retry',async t=>{
 const env=await taxJob(t);const {period:_period,...missing}=gstArgs;
 await assert.rejects(env.call('calculate',{operation:'tax_gst',arguments:missing}));
 const held=findRecord(env.store.read(),'venture-delivery-run',env.run.id)!;
 assert.equal(held.status,'needs-answer');assert.equal(held.agentJob!.calculations!.at(-1)!.envelope.ok,false);
 assert.deepEqual(held.agentJob!.pendingFacts!.missing,[{field:'period'}]);assert.equal(Object.hasOwn(held.agentJob!.pendingFacts!,'expiresAt'),false);
 assert.throws(()=>env.job.capability.assert(),{code:'JOB_CLOSED'});
 assert.equal(listRecords(env.store.read(),'venture-work-receipt').length,0);
 const question=(await queueListHandler(env.deps,owner,{scope:'current'})).rows.find(row=>row.kind==='question'&&row.viewRef?.id===held.id)!;
 assert.equal(question.line,held.agentJob!.pendingFacts!.question);assert.deepEqual(question.actions.map(row=>row.id),['answer']);
 await assert.rejects(answerAgentFacts(env.deps,owner,held.id,'changed-question','October 2026'),{code:'APPROVAL_STALE'});
 await assert.rejects(answerAgentFacts(env.deps,{...owner,channel:'mcp',sourceTainted:true},held.id,held.agentJob!.pendingFacts!.digest,'October 2026'),{code:'APP_APPROVAL_REQUIRED'});
 await answerAgentFacts(env.deps,owner,held.id,held.agentJob!.pendingFacts!.digest,'October 2026');
 const stopped=findRecord(env.store.read(),'venture-delivery-run',held.id)!;assert.equal(stopped.status,'stopped');
 const next=await ventureAction(env.deps,owner,'prepare','test.next-job',tx=>tx.put({...stopped,...tx.base('venture-delivery-run'),agentJob:undefined,status:'waiting-for-you'}));
 const continued=await env.open(next.id,stopped.id),result=await continued.call('calculate',{operation:'tax_gst',arguments:gstArgs});
 assert.equal(result.result.ok,true,JSON.stringify(result));assert.equal(result.receipts[0].runRef.runId,next.id);
 assert.equal(findRecord(env.store.read(),'venture-delivery-run',next.id)!.agentJob!.factAnswers!.length,1);
});

for(const change of ['source','consent'] as const)test(`pending facts refuse an answer after ${change} changes`,async t=>{
 const env=await taxJob(t);const {period:_period,...missing}=gstArgs;
 await assert.rejects(env.call('calculate',{operation:'tax_gst',arguments:missing}));
 const held=findRecord(env.store.read(),'venture-delivery-run',env.run.id)!;
 if(change==='source')await ventureAction(env.deps,owner,'prepare','test.changed-client',tx=>tx.replace({...tx.find('venture-client',env.client.id)!,taxId:'27AAACL1234F1ZZ'}));
 else await withdrawClientAiConsent(env.deps,owner,{clientId:env.client.id});
 await assert.rejects(answerAgentFacts(env.deps,owner,held.id,held.agentJob!.pendingFacts!.digest,'October 2026'),{code:change==='source'?'JOB_SOURCE_CHANGED':'CLIENT_AI_CONSENT_REQUIRED'});
 assert.equal(findRecord(env.store.read(),'venture-delivery-run',held.id)!.agentJob!.factAnswers?.length??0,0);
});

test('Today answer resumes native calculation in a fresh session and keeps the checked papers',async t=>{
 const env=await taxJob(t);const {period:_period,...missing}=gstArgs;
 await env.request('venture.judge.auto.set',{auto:false});
 await assert.rejects(env.call('calculate',{operation:'tax_gst',arguments:missing}));
 const row=(await queueListHandler(env.deps,owner,{scope:'current'})).rows.find(row=>row.kind==='question'&&row.viewRef?.id===env.run.id)!;
 const text=(text:string)=>({kind:'text',text,ref:''});
 calculatorAgent(env.deps,[{calls:[{tool:'tax.gst',input:JSON.stringify(gstArgs)}]}],{title:'GST working',questionsForClient:[],sections:[
  {heading:'Summary',parts:[text('The working papers use the sales register you sent.')]},
  {heading:'Working papers',parts:[text('The cash to pay follows.'),{kind:'figure',ref:'w1.net-payable',text:''}]},
  {heading:'Open items for you',parts:[text('Please confirm the place of supply on each sale.')]},
  {heading:'What your CA does next',parts:[text('Your CA checks these papers and signs them before filing.')]}
 ]});
 const result=await queueDecideHandler(env.deps,owner,{id:row.id,digest:row.digest,action:'answer',answer:'October 2026'});
 assert.equal(result.outcome,'done',JSON.stringify(result));
 const next=listRecords(env.store.read(),'venture-delivery-run').find(row=>row.id!==env.run.id)!;assert.ok(next);
 await waitForAgentWork(env.store,next.id);
 const saved=findRecord(env.store.read(),'venture-delivery-run',next.id)!;
 assert.equal(saved.status,'ready-for-review',JSON.stringify({checks:saved.checks,agentJob:saved.agentJob}));assert.equal(saved.agentJob!.factAnswers!.length,1);
 assert.equal(findRecord(env.store.read(),'venture-delivery-run',env.run.id)!.status,'stopped');
 assert.ok(listRecords(env.store.read(),'venture-work-receipt').some(row=>row.runRef.kind==='delivery'&&row.runRef.runId===next.id));
 assert.equal((await queueListHandler(env.deps,owner,{scope:'current'})).rows.some(item=>item.id===row.id),false);
});

test('YouTube calculator context includes only this order named source receipt, never another order receipt',()=>{
 const order={id:'order-a',kind:'venture-order',ventureId:'venture-a',clientId:'client-a',youtubeResearch:{receiptId:'receipt-a'}};
 const receipt={id:'receipt-a',kind:'venture-work-receipt',ventureId:'venture-a',runRef:{kind:'delivery',runId:'order-a'}};
 const foreign={...receipt,id:'receipt-b',runRef:{kind:'delivery',runId:'order-b'}};
 const state={conversations:[order,receipt,foreign]} as any;
 assert.deepEqual(calculatorSources(state,'venture-a','client-a','order-a').map(row=>row.id),['receipt-a']);
 assert.deepEqual(calculatorSources(state,'venture-a','different-client','order-a'),[]);
 order.youtubeResearch.receiptId='receipt-b';
 assert.deepEqual(calculatorSources(state,'venture-a','client-a','order-a'),[]);
});
