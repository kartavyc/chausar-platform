// Independent settlement safety review regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {digest,listRecords,ventureAction} from '../runtime/venture/records.ts';
import {stageSettlementPosting,applySettlementPosting,reconcileSettlementPosting,type SettlementTarget} from '../runtime/venture/build/accounting-settlements.ts';
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

test('settlement confirmation refuses empty provider identity despite a matching digest',async()=>{
 const f=await fixture(),staged=await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id});f.target.readPayment=async externalId=>({id:'',externalId,materialDigest:staged.entry.posting!.prepared[0]!.materialDigest});
 const done=await applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:staged.entry.posting!.reviewDigest});assert.equal(done.entry.posting!.state,'outcome_unknown');
});

test('Forget erases every historical settlement preparation receipt',async()=>{
 const f=await fixture(),first=await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id});await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id});
 const person=await ventureAction(f.env.deps,owner,'approve','test.person',tx=>tx.put({...tx.base('venture-person'),name:'Settlement contact',handles:{emails:[],phones:[],linkedinUrl:null},role:null,roles:[],facts:[],hidden:false,clientId:f.order.clientId,history:[]}));withNetworkKey(f.env.deps.secrets);await networkForget(f.env.deps,owner,{id:person.id});
 assert.equal(listRecords(f.env.deps.store.read(),'venture-work-receipt').some(row=>row.id===first.entry.posting!.receiptId),false);
});

test('an interrupted old apply cannot send under a replacement settlement claim',async()=>{
 const f=await fixture(),prepare=f.target.preparePayment;let calls=0,releaseOld:()=>void=()=>{},oldStarted:()=>void=()=>{},releaseNew:()=>void=()=>{},newStarted:()=>void=()=>{};
 const oldGate=new Promise<void>(r=>{releaseOld=r;}),oldReady=new Promise<void>(r=>{oldStarted=r;}),newGate=new Promise<void>(r=>{releaseNew=r;}),newReady=new Promise<void>(r=>{newStarted=r;});
 f.target.preparePayment=async payment=>{const result=await prepare(payment);if(++calls===2){oldStarted();await oldGate;}return result;};
 const sent:string[]=[];let remote:any=null;
 f.target.sendPayment=async(prepared,beforeSend)=>{if(prepared.payment.accountId==='200'){newStarted();await newGate;}beforeSend();sent.push(prepared.payment.accountId);remote={id:'333',externalId:prepared.payment.externalId,materialDigest:prepared.materialDigest};};f.target.readPayment=async()=>remote;
 const staged=await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id}),oldRun=applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:staged.entry.posting!.reviewDigest}).then(value=>value,error=>error);await oldReady;
 await reconcileSettlementPosting(f.env.deps,owner,f.month.id);
 const replacement=await f.env.call('venture.files.add',{orderId:f.order.id,name:'new-payments.csv',contentBase64:Buffer.from(SETTLEMENT_PAYMENT_COLUMNS.join(',')+'\nshop,new-payout,one,2026-10-28T10:00:00Z,Asia/Kolkata,banktransfer,200,100,New settlement export').toString('base64')});
 const next=await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:replacement.id}),newRun=applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:next.entry.posting!.reviewDigest}).then(value=>value,error=>error);await newReady;
 releaseOld();await oldRun;releaseNew();await newRun;
 assert.deepEqual(sent,['200']);
});

test('recovery cannot replace a settlement after physical send while readback is pending',async()=>{
 const f=await fixture();let ready:()=>void=()=>{},release:()=>void=()=>{};const started=new Promise<void>(r=>{ready=r;}),gate=new Promise<void>(r=>{release=r;});
 const read=f.target.readPayment;f.target.readPayment=async externalId=>{ready();await gate;return read(externalId);};
 const staged=await stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id}),run=applySettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,digest:staged.entry.posting!.reviewDigest});await started;
 try{await assert.rejects(reconcileSettlementPosting(f.env.deps,owner,f.month.id),(error:any)=>error.code==='BOOKS_STILL_RUNNING');await assert.rejects(stageSettlementPosting(f.env.deps,owner,f.target,{id:f.month.id,uploadId:f.payments.id}),(error:any)=>error.code==='APPROVAL_STALE');assert.equal(f.sends,1);}finally{release();}
 const done=await run;assert.equal(done.entry.posting!.state,'recorded');assert.equal(f.sends,1);
});
