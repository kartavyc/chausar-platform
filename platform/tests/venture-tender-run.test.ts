import {consentForOrder,scriptedAgent,SCRIPTED_AGENT_SETTINGS} from './fixtures/venture/scripted-agent.ts';
import {waitForAgentWork} from '../runtime/venture/agent-runtime/runner.ts';
// Actual tender run entrance must check desk preparation before previewing or spending.
import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {TENDER_DESK_DESK} from '../runtime/venture/playbooks/tender-desk/desk.ts';
import {tenderDelivery} from '../runtime/venture/playbooks/tender-desk/checks.ts';
test('a tender delivery run refuses missing desk sources before any model preview',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-29T12:00:00Z')},{idea:'A tender response business in Pune'});
 const offer=env.offers.find(offer=>offer.playbookOffer==='bid-response')!;assert.ok(offer);
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Prepare a source-backed tender pack.',intake:{fields:{rfpText:'Describe support.',deadline:'2026-11-15',portal:'CPPP',documents:['company.csv'],private:false}}});
 const before=env.models.previewed.length;await assert.rejects(env.call('venture.delivery.run',{orderId:order.id}),{code:'TENDER_NOT_FOUND'});assert.equal(env.models.previewed.length,before);
});
async function prepared(){
 const env=await kitBusiness({now:new Date('2026-10-29T12:00:00Z')},{idea:'A tender response business in Pune'}),offer=env.offers.find(o=>o.playbookOffer==='bid-response')!;
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Prepare a source-backed tender pack.',intake:{fields:{rfpText:'Describe support.',deadline:'2026-11-15',portal:'CPPP',documents:['company.csv'],private:false}}});
 const file=await env.call('venture.files.add',{orderId:order.id,name:'company.csv',contentBase64:Buffer.from('We provide support.').toString('base64')});
 const base={playbook:'tender-desk',kind:'bid',id:order.id} as const;const get=()=>TENDER_DESK_DESK.bid.get!(env.deps,owner,base) as Promise<any>;const act=(action:string,payload:any,hash?:string)=>TENDER_DESK_DESK.bid.act!(env.deps,owner,{...base,action,payload,...(hash?{digest:hash}:{})});
 await act('import',{rfpFileId:null,documentFileIds:[file.id],issuerFileId:null,mapping:null});let view=await get();await act('answer',{questionId:view.item.rows[0].question.id,answer:'We provide support.'},view.digest);view=await get();await act('approve-type',{kind:'narrative'},view.digest);
 return {env,order,file,get};
}
test('a tender run cannot continue to draft after its scoped client source changes',async()=>{
 const {env,order,file,get}=await prepared();await consentForOrder(env.deps,owner,order.id);await env.deps.services.trust.updatePolicy(owner,{send:'shape'});
 let release!:()=>void,enter!:()=>void;const waiting=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>enter=resolve),calls:string[]=[];
 const output=tenderDelivery((await get()).item.rows);
 env.deps.agentRoute=async()=>({settings:SCRIPTED_AGENT_SETTINGS,driver:scriptedAgent(()=>({...output,sections:output.sections.map(section=>({...section,parts:section.parts.map(part=>({...part,ref:''}))}))}),async()=>{enter();await waiting;},name=>calls.push(name))});
 const run=await env.call('venture.delivery.run',{orderId:order.id});await started;
 await ventureAction(env.deps,owner,'prepare','tender.run-change',tx=>{tx.replace({...tx.find('venture-upload',file.id)!,contentBase64:Buffer.from('Different source.').toString('base64')});});
 release();await waitForAgentWork(env.store,run.id);const current=(await env.call('venture.delivery.list')).find((row:any)=>row.id===run.id);
 assert.equal(current.status,'failed');assert.equal(calls.includes('draft_document'),false);assert.equal(calls.includes('propose_action'),false);assert.equal(env.models.previewed.length,0);
});

test('a prepared bid runs the source tool and reaches review only with the exact handoff',async()=>{
 const {env,order,file,get}=await prepared(),output=tenderDelivery((await get()).item.rows);await consentForOrder(env.deps,owner,order.id);await env.deps.services.trust.updatePolicy(owner,{send:'shape'});await env.call('venture.judge.auto.set',{auto:false});const calls:{name:string;data:any}[]=[];
 await ventureAction(env.deps,owner,'prepare','tender.foreign-source',tx=>{const own=tx.list('venture-tender-question').find(row=>row.orderId===order.id)!;tx.put({...own,...tx.base('venture-tender-question'),orderId:'another-order',clientId:order.clientId});tx.put({...own,...tx.base('venture-tender-question'),orderId:'another-order',clientId:'another-client'});});
 env.deps.agentRoute=async()=>({settings:SCRIPTED_AGENT_SETTINGS,driver:scriptedAgent(()=>({...output,sections:output.sections.map(section=>({...section,parts:section.parts.map(part=>({...part,ref:''}))}))}),undefined,(name,data)=>calls.push({name,data}),async call=>{const result=await call('calculate',{operation:'tender_ground',arguments:{}});assert.equal(result.result.ok,true,JSON.stringify(result));assert.deepEqual(result.result.result.delivery,output);assert.ok(result.result.result.rows.length>0);assert.ok(result.result.result.rows.every((row:any)=>row.orderId===order.id&&row.clientId===order.clientId),'calculator must exclude other client/order sources');})});
 const started=await env.call('venture.delivery.run',{orderId:order.id});await waitForAgentWork(env.store,started.id);const run=(await env.call('venture.delivery.list')).find((row:any)=>row.id===started.id);
 assert.equal(run.status,'ready-for-review',JSON.stringify(calls.filter(row=>row.name==='tool_error')));assert.equal(run.canAccept,true,JSON.stringify(run));assert.ok(calls.some(row=>row.name==='calculate'&&row.data.result?.result?.delivery));
 await ventureAction(env.deps,owner,'prepare','tender.review-source-change',tx=>{tx.replace({...tx.find('venture-upload',file.id)!,contentBase64:Buffer.from('Different source.').toString('base64')});});
 await assert.rejects(env.call('venture.delivery.review',{runId:run.id,verdict:'accepted'}),{code:'JOB_FILE_CHANGED'});
});
