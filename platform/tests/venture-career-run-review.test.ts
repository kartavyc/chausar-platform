import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction,listRecords} from '../runtime/venture/records.ts';
import {CAREER_PRIVACY_RULE} from '../runtime/venture/playbooks/job-search-desk/definition-data.ts';
async function setup(){const e=await kitBusiness({now:new Date('2026-10-29T10:00:00Z')},{idea:'Career coaching and job search help'});await ventureAction(e.deps,owner,'approve','test.rehearsal',tx=>tx.touch({launchStage:'rehearsal'}));const order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers.find(o=>o.playbookOffer==='profile-and-tailoring')!.id,request:'A research resume.',intake:{fields:{targetRoles:['Researcher'],locations:['Pune'],facts:'Interviewed customers.',languages:['English']}}});const base={playbook:'job-search-desk',kind:'fact'},made=await e.call('venture.desk.act',{...base,id:order.id,action:'propose',payload:{value:{id:'research',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:[]}}});await e.call('venture.desk.act',{...base,id:made.id,action:'approve',payload:{},digest:(await e.call('venture.desk.get',{...base,id:made.id})).digest});return{e,order};}

test('career judge refuses physical dispatch after owner rejects the current delivery',async t=>{
 const {e,order}=await setup(),base={playbook:'job-search-desk',kind:'thread'};
 const made=await e.call('venture.desk.act',{...base,id:order.id,action:'create-pack',payload:{input:{kind:'resume',claims:[{factId:'research',use:'research'}],sources:[]}}});
 const act=async(action:string)=>e.call('venture.desk.act',{...base,id:made.id,action,payload:{},digest:(await e.call('venture.desk.get',{...base,id:made.id})).digest});
 await act('render');await act('approve-pack');
 const previous=CAREER_PRIVACY_RULE.confirmedBy;CAREER_PRIVACY_RULE.confirmedBy={name:'Synthetic independent reviewer',on:'2026-10-29'};t.after(()=>{CAREER_PRIVACY_RULE.confirmedBy=previous;});
 await ventureAction(e.deps,owner,'approve','review.live',tx=>tx.touch({launchStage:'approve-each'}));
 const run=await e.call('venture.delivery.run',{orderId:order.id});const asked=await e.call('venture.delivery.judge',{runId:run.id});
 let sends=0;
 e.deps.models.runPreview=async(_ctx,_id,_digest,_validate,options)=>{
  await e.call('venture.delivery.review',{runId:run.id,verdict:'rejected',reason:'other'});
  options?.beforeDispatch?.();sends++;throw Object.assign(new Error('The synthetic transport was reached.'),{code:'REVIEW_SENT'});
 };
 await assert.rejects(e.call('venture.delivery.judgeSend',{runId:run.id,digest:asked.digest}));
 assert.equal(sends,0,'a rejected current run must stop the physical judge dispatch');
});


test('career judge refuses physical dispatch after the pending judge identity changes',async t=>{
 const {e,order}=await setup(),base={playbook:'job-search-desk',kind:'thread'};
 const made=await e.call('venture.desk.act',{...base,id:order.id,action:'create-pack',payload:{input:{kind:'resume',claims:[{factId:'research',use:'research'}],sources:[]}}});
 const act=async(action:string)=>e.call('venture.desk.act',{...base,id:made.id,action,payload:{},digest:(await e.call('venture.desk.get',{...base,id:made.id})).digest});
 await act('render');await act('approve-pack');
 const previous=CAREER_PRIVACY_RULE.confirmedBy;CAREER_PRIVACY_RULE.confirmedBy={name:'Synthetic independent reviewer',on:'2026-10-29'};t.after(()=>{CAREER_PRIVACY_RULE.confirmedBy=previous;});
 await ventureAction(e.deps,owner,'approve','review.live',tx=>tx.touch({launchStage:'approve-each'}));
 const run=await e.call('venture.delivery.run',{orderId:order.id});const asked=await e.call('venture.delivery.judge',{runId:run.id});
 let sends=0;
 e.deps.models.runPreview=async(_ctx,_id,_digest,_validate,options)=>{
  await ventureAction(e.deps,owner,'approve','review.replace-claim',tx=>{const live=tx.find('venture-delivery-run',run.id)!;tx.replace({...live,judge:{...live.judge!,callId:'call_replaced'}});});
  options?.beforeDispatch?.();sends++;throw Object.assign(new Error('The synthetic transport was reached.'),{code:'REVIEW_SENT'});
 };
 await assert.rejects(e.call('venture.delivery.judgeSend',{runId:run.id,digest:asked.digest}));
 assert.equal(sends,0,'a changed pending judge identity must stop dispatch');
});
