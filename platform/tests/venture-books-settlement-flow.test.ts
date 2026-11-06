import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {digest,listRecords,ventureAction} from '../runtime/venture/records.ts';
import {stageSettlementPosting,applySettlementPosting,type SettlementTarget} from '../runtime/venture/build/accounting-settlements.ts';
import {SETTLEMENT_PAYMENT_COLUMNS} from '../runtime/venture/playbooks/bookkeeping-cfo/settlement-payments.ts';
import {networkForget} from '../runtime/venture/network/forget.ts';
import {withNetworkKey} from './venture-network-env.ts';
async function fixture(){
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'}),order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Keep these client books.',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 const base={playbook:'bookkeeping-cfo',kind:'finance'},cycle=await env.call('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 const add=(name:string,text:string)=>env.call('venture.files.add',{orderId:order.id,name,contentBase64:Buffer.from(text).toString('base64')});
 const file=await add('monthly.csv','kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Orders,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlements,100,100,');
 const month=await env.call('venture.desk.act',{...base,id:'new',action:'monthly-seller',payload:{cycleId:cycle.id,orderId:order.id,uploadId:file.id,month:'2026-10'}});
 const payments=await add('payments.csv',SETTLEMENT_PAYMENT_COLUMNS.join(',')+'\nshop,payout,one,2026-10-28T10:00:00Z,Asia/Kolkata,banktransfer,100,100,Settlement export');
 let remote:any=null,sends=0;const target:SettlementTarget={identity:'zoho:fixture',companyId:'12345',preparePayment:async payment=>{const value={kind:'settlement-payment' as const,connectionIdentity:'zoho:fixture',payment,customerId:'77',invoiceId:'123',method:'POST' as const,path:'customerpayments' as const,query:{},body:JSON.stringify(payment),evidenceDigest:digest('current'),materialDigest:digest(payment),digest:''};value.digest=digest(value);return value;},sendPayment:async(prepared,beforeSend)=>{beforeSend();sends++;remote={id:'333',externalId:prepared.payment.externalId,materialDigest:prepared.materialDigest};},readPayment:async()=>remote};
 return {env,order,cycle,month,payments,file,target,get sends(){return sends;}};
}
test('settlements require exact owner dry-run approval, receipt readback and durable dedupe',async()=>{
 const f=await fixture(),staged=await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id});assert.equal(f.sends,0);assert.equal(staged.entry.kind,'seller-month');assert.equal(staged.entry.posting?.state,'staged');
 const proof=listRecords(f.env.deps.store.read(),'venture-work-receipt').find(row=>row.id===staged.entry.posting?.receiptId)!;assert.equal(proof.figures[0]!.minor,'10000');
 await assert.rejects(applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:'old'}),{code:'APPROVAL_STALE'});
 const done=await applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:staged.entry.posting!.reviewDigest});assert.equal(f.sends,1);assert.equal(done.entry.posting!.state,'recorded');assert.equal(done.entry.posting!.outcomes[0]!.remoteId,'333');
 await assert.rejects(stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id}));assert.equal(f.sends,1);
 const person=await ventureAction(f.env.deps,owner,'approve','test.person',tx=>tx.put({...tx.base('venture-person'),name:'Settlement contact',handles:{emails:[],phones:[],linkedinUrl:null},role:null,roles:[],facts:[],hidden:false,clientId:f.order.clientId,history:[]}));withNetworkKey(f.env.deps.secrets);await networkForget(f.env.deps,owner,{id:person.id});
 assert.equal(listRecords(f.env.deps.store.read(),'venture-upload').some(value=>value.id===f.payments.id),false);assert.equal(listRecords(f.env.deps.store.read(),'venture-work-receipt').some(value=>value.id===proof.id),false);
});
test('unknown payment readback cannot be retried or replaced with another dry run',async()=>{
 const f=await fixture();f.target.readPayment=async()=>null;const staged=await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id}),done=await applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:staged.entry.posting!.reviewDigest});assert.equal(done.entry.posting!.state,'outcome_unknown');assert.equal(f.sends,1);
 await assert.rejects(applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:done.entry.posting!.reviewDigest}));await assert.rejects(stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id}));assert.equal(f.sends,1);
});
test('live consent and exact source bytes are rechecked at the physical send gate',async()=>{
 const f=await fixture(),staged=await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id});const original=f.target.sendPayment;f.target.sendPayment=async(prepared,beforeSend)=>{await ventureAction(f.env.deps,owner,'approve','test.revoke',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,intake:{...order.intake!,fields:{...order.intake?.fields,'data-consent':false}}});});return original(prepared,beforeSend);};
 const done=await applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:staged.entry.posting!.reviewDigest});assert.equal(done.entry.posting!.state,'stopped');assert.equal(f.sends,0);
});
