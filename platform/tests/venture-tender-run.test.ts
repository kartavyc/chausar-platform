// Actual tender run entrance must check desk preparation before previewing or spending.
import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,owner,approveWaiting,draft} from './fixtures/venture/kit-business.ts';
import {ventureAction,digest} from '../runtime/venture/records.ts';
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
 const file=await ventureAction(env.deps,owner,'prepare','tender.run-source',tx=>{const text='We provide support.';return tx.put({...tx.base('venture-upload'),name:'company.csv',format:'csv',bytes:text.length,digest:digest(text),contentBase64:Buffer.from(text).toString('base64'),scope:{kind:'order',orderId:order.id},clientData:true});});
 const base={playbook:'tender-desk',kind:'bid',id:order.id} as const;const get=()=>TENDER_DESK_DESK.bid.get!(env.deps,owner,base) as Promise<any>;const act=(action:string,payload:any,hash?:string)=>TENDER_DESK_DESK.bid.act!(env.deps,owner,{...base,action,payload,...(hash?{digest:hash}:{})});
 await act('import',{rfpFileId:null,documentFileIds:[file.id],issuerFileId:null,mapping:null});let view=await get();await act('answer',{questionId:view.item.rows[0].question.id,answer:'We provide support.'},view.digest);view=await get();await act('approve-type',{kind:'narrative'},view.digest);
 return {env,order,file,get};
}
test('a tender run cannot dispatch an approved model preview after client source changes',async()=>{
 const {env,order,file}=await prepared();
 const run=await env.call('venture.delivery.run',{orderId:order.id});assert.equal(run.status,'waiting-for-you');let sends=0;const original=env.models.runPreview.bind(env.models);env.models.runPreview=async(...args)=>{sends++;return original(...args);};
 await ventureAction(env.deps,owner,'prepare','tender.run-change',tx=>{tx.replace({...tx.find('venture-upload',file.id)!,contentBase64:Buffer.from('Different source.').toString('base64')});});
 await assert.rejects(approveWaiting(env,run,{note:'Read source',calls:[],finished:true} as never),{code:'DERIVED_STALE'});assert.equal(sends,0);
});
test('a prepared bid runs the source tool and reaches review only with the exact handoff',async()=>{
 const {env,order,file,get}=await prepared(),output=tenderDelivery((await get()).item.rows);let run=await env.call('venture.delivery.run',{orderId:order.id});let turns=0,read=false;
 while(run.status==='waiting-for-you'&&turns++<8){const task=env.models.previewed.at(-1)!;const answer=task.purpose==='delivery'?draft(output.title,{Review:[output.sections[0].parts[0].text]}):{note:'Read the approved tender pack.',calls:read?[]:[{tool:'tender.ground',input:'{}'}],finished:read};if(task.purpose!=='delivery')read=true;run=await approveWaiting(env,run,answer as never);}
 assert.equal(run.status,'ready-for-review',JSON.stringify(run));assert.ok(read);
 await ventureAction(env.deps,owner,'prepare','tender.review-source-change',tx=>{tx.replace({...tx.find('venture-upload',file.id)!,contentBase64:Buffer.from('Different source.').toString('base64')});});
 await assert.rejects(env.call('venture.delivery.review',{runId:run.id,verdict:'accepted'}),{code:'DERIVED_STALE'});
});
