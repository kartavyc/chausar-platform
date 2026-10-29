import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction,listRecords} from '../runtime/venture/records.ts';
import {net,personNamed} from './venture-network-env.ts';

async function approvedVa(){
 const e=await kitBusiness(undefined,{idea:'A virtual assistant service'}),order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers[0]!.id,request:'Research venues',intake:{fields:{scope:'Research venues',deliverable:'A comparison table',deadline:'2026-11-02',hoursBand:'Agreed monthly band'}}});
 const base={playbook:'virtual-assistant',kind:'room'},made=await e.call('venture.desk.act',{...base,id:order.id,action:'create',payload:{}}),get=()=>e.call('venture.desk.get',{...base,id:made.id}),act=async(action:string,payload:unknown)=>e.call('venture.desk.act',{...base,id:made.id,action,payload,digest:(await get()).digest});
 await act('request',{text:'Compare venues'});const requestId=(await get()).item.requests[0].id;
 const revise=()=>act('draft',{requestId,fields:{scope:'Research venues',deliverable:'A comparison table',deadline:'2026-11-02'}});
 await revise();await act('approve',{});return{e,order,revise};
}

for(const identity of ['linked-client','order-handle'] as const)test(`Forget erases opaque approved-brief deliveries and linked model payloads for ${identity} while keeping financial totals`,async()=>{
 const {e,order}=await approvedVa();
 const ready=await e.call('venture.delivery.run',{orderId:order.id,useTemplate:true});
 const waiting=await e.call('venture.delivery.run',{orderId:order.id,useTemplate:false});
 const opaque='Opaque private venue source without a contact name';
 await net(e,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nNina Sen,contact881@guest.example'});
 const person=personNamed(e as never,'Nina Sen');
 await ventureAction(e.deps,owner,'approve','test.link-private-room',tx=>{
  if(identity==='linked-client')tx.replace({...tx.find('venture-person',person.id)!,clientId:order.clientId});
  else tx.replace({...tx.find('venture-order',order.id)!,request:'Contact contact881@guest.example for the venue sources.'});
  const run=tx.find('venture-delivery-run',waiting.id)!;
  tx.put({...tx.base('venture-model-call'),id:run.callId!,payloadText:opaque,payloadTruncated:false,status:'preview',costMicros:'17'} as any);
 });
 await net(e,'venture.network.forget',{id:person.id});
 const state=e.store.read();
 assert.equal(listRecords(state,'venture-room-brief').length,0);
 for(const id of [ready.id,waiting.id]){
  const run=listRecords(state,'venture-delivery-run').find(r=>r.id===id)!;
  assert.equal(run.status,'stopped');assert.equal(run.deliverable,null);assert.equal(run.renderedText,null);assert.equal(run.preview,null);assert.equal(run.harness,null);
 }
 const call=listRecords(state,'venture-model-call').find(r=>r.costMicros==='17')!;
 assert.equal(call.payloadText,'');assert.equal(call.costMicros,'17');assert.equal(call.status,'expired');
 const kept=listRecords(state,'venture-order').find(r=>r.id===order.id)!;
 assert.equal(kept.status,'cancelled');assert.equal(kept.request,'Client data deleted.');assert.equal(kept.intake,undefined);assert.equal(kept.priceReceiptId,order.priceReceiptId);
});

test('VA delivery needs the current approved room, carries its exact fields, and refuses an old accepted draft after revision',async()=>{
 const e=await kitBusiness(undefined,{idea:'A virtual assistant service'});
 const order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers[0]!.id,request:'Research venues',intake:{fields:{scope:'Research venues',deliverable:'A comparison table',deadline:'2026-11-02',hoursBand:'Agreed monthly band'}}});
 await assert.rejects(e.call('venture.delivery.run',{orderId:order.id,useTemplate:true}),{code:'APPROVAL_STALE'});
 const base={playbook:'virtual-assistant',kind:'room'},made=await e.call('venture.desk.act',{...base,id:order.id,action:'create',payload:{}});
 const get=()=>e.call('venture.desk.get',{...base,id:made.id}),act=async(action:string,payload:unknown)=>e.call('venture.desk.act',{...base,id:made.id,action,payload,digest:(await get()).digest});
 await act('request',{text:'Compare venues'});const requestId=(await get()).item.requests[0].id;
 await act('draft',{requestId,fields:{scope:'Research venues',deliverable:'A comparison table',deadline:'2026-11-02'}});await act('approve',{});
 const run=await e.call('venture.delivery.run',{orderId:order.id,useTemplate:true});
 assert.equal(run.status,'ready-for-review');assert.equal(run.playbookChecks.find((row:{check:string})=>row.check==='brief-bounded').outcome,'pass');
 assert.equal(run.canAccept,true,JSON.stringify(run.checks));
 for(const text of ['Research venues','A comparison table','2026-11-02'])assert.ok(run.renderedText.includes(text));
 assert.ok(run.deliverable.sections.flatMap((s:{parts:unknown[]})=>s.parts).some((p:{kind:string;receiptId?:string})=>p.kind==='figure'&&p.receiptId===order.priceReceiptId));
 await act('draft',{requestId,fields:{scope:'Changed scope',deliverable:'A comparison table',deadline:'2026-11-02'}});
 await assert.rejects(e.call('venture.delivery.review',{runId:run.id,verdict:'accepted'}),{code:'APPROVAL_STALE'});
 await act('approve',{});
 await assert.rejects(e.call('venture.delivery.review',{runId:run.id,verdict:'accepted'}),{code:'APPROVAL_STALE'});
 const fresh=await e.call('venture.delivery.run',{orderId:order.id,useTemplate:true});assert.ok(fresh.renderedText.includes('Changed scope'));
});

test('VA judge rechecks the brief immediately before transport, after asynchronous preparation',async()=>{
 const {e,order,revise}=await approvedVa(),run=await e.call('venture.delivery.run',{orderId:order.id,useTemplate:true});
 await ventureAction(e.deps,owner,'prepare','test.synthetic-agent-draft',tx=>{const live=tx.find('venture-delivery-run',run.id)!;tx.replace({...live,servedBy:'model'});});
 const asked=await e.call('venture.delivery.judge',{runId:run.id});let sends=0;
 e.deps.models.runPreview=async(_ctx,_id,_digest,_validate,options)=>{await revise();options?.beforeDispatch?.();sends++;throw new Error('Synthetic transport reached');};
 await assert.rejects(e.call('venture.delivery.judgeSend',{runId:run.id,digest:asked.digest}));
 assert.equal(sends,0,'a changed brief must stop the judge before transport');
});

test('configured AI receives the approved room scope and produces an acceptable sourced brief with date and price references',async()=>{
 const {e,order}=await approvedVa(),run=await e.call('venture.delivery.run',{orderId:order.id,useTemplate:false});
 const request=JSON.parse(run.preview.payloadText).input;assert.match(request.clientRequest,/A comparison table/);assert.ok(request.dates.some((d:{ref:string})=>d.ref==='room.deadline'));
 e.models.drafts.push({title:'Work notes',sections:[{heading:'Brief',parts:[{kind:'text',text:'Research venues. A comparison table.',ref:''},{kind:'date',text:'',ref:'room.deadline'},{kind:'figure',text:'',ref:'order.total'}]},{heading:'Work notes',parts:[{kind:'text',text:'Please supply the venue sources before the comparison is prepared.',ref:''}]}],questionsForClient:[]});
 const done=await e.call('venture.delivery.approve',{runId:run.id,digest:run.preview.digest});
 assert.equal(done.canAccept,true,JSON.stringify({checks:done.checks,playbookChecks:done.playbookChecks}));
 const accepted=await e.call('venture.delivery.review',{runId:done.id,verdict:'accepted'});assert.equal(accepted.status,'accepted');
});
