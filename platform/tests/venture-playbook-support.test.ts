// The support playbook and persisted owner desk. Original integration tests, nexusdesk Apache-2.0 ideas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT_DESK_DEFINITION } from '../runtime/venture/playbooks/support-desk/definition.ts';
import { SUPPORT_DESK_REGISTRATION } from '../runtime/venture/playbooks/support-desk/registration.ts';
import { SUPPORT_DESK_DESK } from '../runtime/venture/playbooks/support-desk/desk.ts';
import { runKitBaseline } from '../runtime/venture/playbooks/kit/baseline.ts';
import { setup, owner, phone, code,seedBlueprint,seedOrder } from './venture-views-env.ts';
test('support is a real registered kit with owner-set offers, safety checks and a committed baseline',()=>{
 assert.equal(SUPPORT_DESK_REGISTRATION?.id,'support-desk');
 assert.ok(SUPPORT_DESK_DEFINITION);
 assert.equal(SUPPORT_DESK_DEFINITION.offers.length,5);
 assert.ok(SUPPORT_DESK_DEFINITION.offers.every(o=>o.price==='owner-sets'));
 assert.equal(runKitBaseline(SUPPORT_DESK_DEFINITION).ok,true);
});
test('owner desk proposes, confirms with digest, checks revision, and only records a send after approval',async()=>{
 const env=await setup(); const h=SUPPORT_DESK_DESK.ticket!;const {order}=await seedOrder(env,await seedBlueprint(env));const {ventureAction}=await import('../runtime/venture/records.ts');await ventureAction(env.deps,owner,'prepare','support.fixture',tx=>tx.put({...tx.base('venture-upload'),name:'tracking.csv',format:'csv',bytes:8,digest:'tracking-v1',contentBase64:Buffer.from('State,OK').toString('base64'),scope:{kind:'order',orderId:order.id},clientData:true}));
 assert.ok(h?.act);
 const p=await h.act(env.deps,owner,{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{serviceOrderId:order.id,thread:'thread_test',customerEmail:'buyer@example.com',subject:'Parcel late',language:'en',blocked:false}});
 const id=p.id;
 const view=await h.get!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id});
 await assert.rejects(h.act(env.deps,owner,{playbook:'support-desk',kind:'ticket',id,action:'confirm',payload:{},digest:'wrong'}),code('TICKET_STALE'));
 await assert.rejects(h.act(env.deps,phone,{playbook:'support-desk',kind:'ticket',id,action:'confirm',payload:{},digest:view.digest}),code('APP_APPROVAL_REQUIRED'));
 await h.act(env.deps,owner,{playbook:'support-desk',kind:'ticket',id,action:'confirm',payload:{},digest:view.digest});
 const current=await h.get!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id});
 assert.equal((current.item as any).proposal,null);
 await h.act(env.deps,owner,{playbook:'support-desk',kind:'ticket',id,action:'draft',payload:{original:'Please check tracking.',translated:'Please check tracking.',language:'en',sources:['tracking.csv'],policyChange:false},digest:current.digest});
 const draft=await h.get!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id});
 await assert.rejects(h.act(env.deps,owner,{playbook:'support-desk',kind:'ticket',id,action:'sent',payload:{},digest:draft.digest}),code('SUPPORT_APPROVAL_REQUIRED'));
 await h.act(env.deps,owner,{playbook:'support-desk',kind:'ticket',id,action:'approve-reply',payload:{},digest:draft.digest});
 const approved=await h.get!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id});
 const handoff=await h.act(env.deps,owner,{playbook:'support-desk',kind:'ticket',id,action:'handoff',payload:{},digest:approved.digest});
 assert.equal((handoff.result as any).sent,false);
 await h.act(env.deps,owner,{playbook:'support-desk',kind:'ticket',id,action:'sent',payload:{},digest:approved.digest});
 const sent=await h.get!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id});
 assert.equal((sent.item as any).sentAt,env.now());
});

test('Forget removes the customer ticket, messages, request and rating instead of retaining a support copy',async()=>{
 const {mailEnv}=await import('./venture-mailbox-env.ts');const {net}=await import('./venture-network-env.ts');const {ventureAction,listRecords}=await import('../runtime/venture/records.ts');
 const env=await mailEnv();const h=SUPPORT_DESK_DESK.ticket!;
 const p=await h.act!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{thread:'thread_forget',customerEmail:'priya@acme.example',subject:'Private support matter',language:'en',blocked:false}});
 await ventureAction(env.deps,owner,'prepare','seed.support',tx=>{tx.put({...tx.base('venture-support-message'),ticketId:p.id,messageId:null,sender:'priya@acme.example',text:'Private support words',at:tx.now,kind:'venture-support-message',messageKind:'customer',references:[],untrusted:true} as never);tx.put({...tx.base('venture-support-request'),ticketId:p.id,requestKind:'refund',amountText:'499',currency:'INR',state:'requested, not done'});tx.put({...tx.base('venture-support-rating'),ticketId:p.id,score:5});});
 assert.equal(listRecords(env.store.read(),'venture-support-ticket').length,1);
 await net(env,'venture.network.forget',{id:env.priya.id});
 for(const kind of ['venture-support-ticket','venture-support-message','venture-support-request','venture-support-rating'] as const)assert.equal(listRecords(env.store.read(),kind).length,0,kind);
 assert.ok(!JSON.stringify(env.store.read()).includes('Private support words'));
});

test('support tools prepare a proposal without claiming a write and return only grounded source excerpts',async()=>{
 const {SUPPORT_DESK_TOOLS}=await import('../runtime/venture/delivery/harness/tools-support-desk.ts');
 const env=await setup();
 const toolEnv={deps:env.deps,ventureId:env.venture.id,now:env.now,files:[{id:'f_policy',name:'policy.csv',format:'csv',bytes:40,digest:'policy-digest',contentBase64:Buffer.from('Topic,Rule\nDelivery,Track the parcel with the carrier').toString('base64'),clientData:true}]} as any;
 const result=await SUPPORT_DESK_TOOLS['support.match'].run(toolEnv,{query:'parcel delivery'});
 assert.equal((result.result as any).sources[0].file,'policy.csv');
 const prepared=await SUPPORT_DESK_TOOLS['support.ticket'].run(toolEnv,{operation:'propose',thread:'thread_tool',customerEmail:'buyer@example.com',subject:'Parcel',language:'en'});
 assert.equal((prepared.result as any).created,false);
 assert.equal((prepared.result as any).proposal.dedupKey,'thread_tool');
});

test('a proposed or unmatched support ticket has a real Today notice opening its owner desk',async()=>{
 const env=await setup();const h=SUPPORT_DESK_DESK.ticket!;
 const made=await h.act!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{thread:'needs_match',customerEmail:'buyer@example.com',subject:'An unmatched request',language:'en',blocked:false}});
 const {call}=await import('./venture-views-env.ts');const queue=await call<any>(env,'venture.queue.list',{scope:'current'});
 assert.ok(queue.rows.some((row:any)=>row.notice?.link?.includes(`support=${made.id}`)));
});

test('a cited source must be an actual order file, not a model invented source label',()=>{
 const check=SUPPORT_DESK_DEFINITION.checks[1]!;
 const input={deliverable:{sections:[{parts:[{kind:'text',text:'The order is in transit. Source: invented.csv'}]}]},files:[{name:'tracking.csv'}]} as any;
 assert.equal(check(input)[0]!.outcome,'fail');
 input.deliverable.sections[0].parts[0].text='The order is in transit. Source: tracking.csv';
 assert.equal(check(input)[0]!.outcome,'pass');
});

test('support proposal ingests the screened imported conversation and pauses on a human request',async()=>{
 const env=await setup();const {handlers}=await import('../runtime/venture/build/index.ts');
 await handlers['venture.mail.import']!(env.deps,owner,{name:'person.eml',contentBase64:Buffer.from('From: buyer@example.com\r\nTo: help@shop.example\r\nSubject: Parcel late\r\nMessage-ID: <support-person@example.com>\r\n\r\nPlease connect me to a human.').toString('base64')});
 const {mailThreadsOf}=await import('../runtime/venture/build/mail-in.ts');const thread=mailThreadsOf(env.store.read(),env.venture)[0]!;
 const p=await SUPPORT_DESK_DESK.ticket!.act!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{thread:thread.id,customerEmail:'buyer@example.com',subject:thread.subject,language:'en',blocked:false}});
 const get=await SUPPORT_DESK_DESK.ticket!.get!(env.deps,owner,{playbook:'support-desk',kind:'ticket',id:p.id});
 assert.match((get.item as any).messages[0].text,/connect me to a human/);
 assert.equal((get.item as any).autoDraftsPaused,true);
});

test('the existing repeat-call breaker also stops identical support tool calls on the third attempt',async()=>{
 const {tripBreaker}=await import('../runtime/venture/delivery/harness/breaker.ts');
 const state={toolCalls:[1,2,3].map(n=>({id:`t1.${n}`,tool:'support.ticket',input:{operation:'get',ticketId:'ticket_a'},inputDigest:'same',outcome:'succeeded',envelope:{ok:true,result:{}}})),control:null,breaker:null,alreadyTried:[]} as any;
 assert.equal(tripBreaker(state,'2026-10-27T10:00:00.000Z'),true);
 assert.equal(state.breaker.trigger,'same-action');assert.equal(state.control.stop.by,'chausar');
});
