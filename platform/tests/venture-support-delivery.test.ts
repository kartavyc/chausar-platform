// Live support delivery regression. Original Chausar tests, no outside code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,deliver,draft,owner} from './fixtures/venture/kit-business.ts';
import {consentForOrder,scriptedAgent,SCRIPTED_AGENT_SETTINGS} from './fixtures/venture/scripted-agent.ts';
import {waitForAgentWork} from '../runtime/venture/agent-runtime/runner.ts';
import {SUPPORT_RULES} from '../runtime/venture/playbooks/support-desk/rules.ts';
import {SUPPORT_DESK_DEFINITION} from '../runtime/venture/playbooks/support-desk/definition.ts';
import {listRecords} from '../runtime/venture/records.ts';

test('support holds unconfirmed legal rules, then each starter offer Accept finishes exactly one real delivery',async t=>{
 const env=await kitBusiness({now:new Date('2026-10-27T10:00:00Z')},{idea:'Support desk for small shops'});
 assert.deepEqual(env.offers.map(o=>o.playbookOffer).sort(),[...SUPPORT_DESK_DEFINITION.planPicks.offers].sort());
 const rules=SUPPORT_RULES.filter(r=>r.needs!==null).map(rule=>({rule,before:rule.confirmedBy}));t.after(()=>{for(const {rule,before} of rules)rule.confirmedBy=before;});
 const intakeFor=(id:string)=>{const keys=SUPPORT_DESK_DEFINITION.offers.find(o=>o.id===id)!.intake;return {intake:{fields:Object.fromEntries(Object.entries({languages:['en']}).filter(([key])=>keys.includes(key)))},...(keys.includes('policies')?{intakeFiles:{policies:{name:'policy.csv',contentBase64:Buffer.from('Topic,Rule\nParcel,Track').toString('base64')}}}:{})};};
 const first=env.offers.find(o=>o.playbookOffer==='monthly-support')!;
 const held=await env.call('venture.order.create',{clientId:env.client.id,offerId:first.id,request:'Draft a reply from the shop policy.',...intakeFor(first.playbookOffer!)});
 await assert.rejects(env.call('venture.delivery.run',{orderId:held.id}),{code:'RULE_UNCONFIRMED'});assert.equal(env.models.previewed.length,0);
 // Test-local trusted rule confirmation only. Restore immediately after the test; production rules stay unconfirmed.
 for(const {rule} of rules)rule.confirmedBy={name:'Fixture lawyer',on:'2026-10-27'};
 for(const offer of env.offers){
  const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Draft the requested support artifact with shop sources and open questions.',...intakeFor(offer.playbookOffer!)});
  const run=await deliver(env,order.id,draft('Support draft',{Reply:['Please check the parcel with the carrier. Nothing has been sent.'],'Sources':['Source: policy.csv'],'Open questions':['The shop owner will review this draft.']}));
  assert.equal(run.status,'ready-for-review',JSON.stringify({offer:offer.playbookOffer,status:run.status,checks:run.checks,errors:env.models.agentReads.filter(row=>row.name==='tool_error')}));const before:number=env.models.previewed.length;
  await env.call('venture.delivery.review',{runId:run.id,verdict:'accepted'});
  assert.equal(listRecords(env.store.read(),'venture-delivery-run').find(r=>r.id===run.id)?.status,'accepted');assert.equal(listRecords(env.store.read(),'venture-delivery-run').filter(r=>r.orderId===order.id).length,1,offer.playbookOffer);assert.equal(env.models.previewed.length,before);
 }
});

test('public support order intake supplies ticket due targets unless the owner overrides them',async()=>{const env=await kitBusiness({now:new Date('2026-10-27T10:00:00Z')},{idea:'Support desk for small shops'});const offer=env.offers.find(o=>o.playbookOffer==='monthly-support')!;const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Support parcel queries.',intake:{fields:{languages:['en'],firstReplyHours:'2',resolutionHours:'4',shopHours:'Mon-Sat 09:00-17:00',timeZone:'UTC',holidays:['2026-10-27']}},intakeFiles:{policies:{name:'policy.csv',contentBase64:Buffer.from('Topic,Rule\nParcel,Track').toString('base64')}}});for(const override of [false,true]){const made=await env.call('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{serviceOrderId:order.id,thread:'intake_targets_'+override,customerEmail:'buyer@example.com',subject:'Parcel',language:'en',blocked:false,...(override?{firstReplyHours:1,holidays:[]}: {})}});const view=await env.call('venture.desk.get',{playbook:'support-desk',kind:'ticket',id:made.id});assert.equal(view.item.dueAt,override?'2026-10-27T11:00:00.000Z':'2026-10-28T11:00:00.000Z');assert.equal(view.item.resolutionDueAt,override?'2026-10-27T14:00:00.000Z':'2026-10-28T13:00:00.000Z');}});
test('blocked support targets are held before any delivery preview even with confirmed legal rules',async t=>{const env=await kitBusiness({now:new Date('2026-10-27T10:00:00Z')},{idea:'Support desk for small shops'});const rules=SUPPORT_RULES.filter(r=>r.needs!==null).map(rule=>({rule,before:rule.confirmedBy}));t.after(()=>{for(const {rule,before} of rules)rule.confirmedBy=before;});for(const {rule} of rules)rule.confirmedBy={name:'Fixture lawyer',on:'2026-10-27'};const offer=env.offers.find(o=>o.playbookOffer==='monthly-support')!;const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Draft a reply to blocked@example.com about the parcel.',intake:{fields:{languages:['en'],blockedCustomers:['blocked@example.com']}},intakeFiles:{policies:{name:'policy.csv',contentBase64:Buffer.from('Topic,Rule\nParcel,Track').toString('base64')}}});await assert.rejects(env.call('venture.delivery.run',{orderId:order.id}),{code:'SUPPORT_PERSON_REQUIRED'});assert.equal(env.models.previewed.length,0);assert.equal(listRecords(env.store.read(),'venture-delivery-run').length,0);});

test('a native support delivery taken over while dispatched settles stopped and discards the returned draft',async t=>{
 const env=await kitBusiness({now:new Date('2026-10-27T10:00:00Z')},{idea:'Support desk for small shops'});const rules=SUPPORT_RULES.filter(r=>r.needs!==null).map(rule=>({rule,before:rule.confirmedBy}));t.after(()=>{for(const {rule,before} of rules)rule.confirmedBy=before;});for(const {rule} of rules)rule.confirmedBy={name:'Fixture lawyer',on:'2026-10-27'};
 const offer=env.offers.find(o=>o.playbookOffer==='monthly-support')!;const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Draft a support reply.',intake:{fields:{languages:['en']}},intakeFiles:{policies:{name:'policy.csv',contentBase64:Buffer.from('Topic,Rule\nParcel,Track').toString('base64')}}});
 const p=await env.call('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:'new',action:'propose',payload:{serviceOrderId:order.id,thread:'dispatch_takeover',customerEmail:'buyer@example.com',subject:'Parcel',language:'en',blocked:false}});const act=async(action:string)=>{const view=await env.call('venture.desk.get',{playbook:'support-desk',kind:'ticket',id:p.id});return env.call('venture.desk.act',{playbook:'support-desk',kind:'ticket',id:p.id,action,payload:{},digest:view.digest});};await act('confirm');
 await consentForOrder(env.deps,owner,order.id);await env.deps.services.trust.updatePolicy(owner,{send:'shape'});
 let entered!:()=>void,release!:()=>void,dispatched=0;
 const started=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 env.deps.agentRoute=async()=>({settings:SCRIPTED_AGENT_SETTINGS,driver:scriptedAgent(async()=>{dispatched++;entered();await held;return draft('Support draft',{Reply:['Please review this parcel.'],Sources:['Source: policy.csv'],'Open questions':['The owner can check.']});})});
 const run=await env.call('venture.delivery.run',{orderId:order.id});assert.equal(run.harness??null,null);
 try{assert.equal(await Promise.race([started.then(()=>true),waitForAgentWork(env.store,run.id).then(()=>false)]),true,'the native agent reached draft generation before takeover');await act('take-over');assert.equal(listRecords(env.store.read(),'venture-delivery-run').find(r=>r.id===run.id)!.status,'stopped');}finally{release();}
 await waitForAgentWork(env.store,run.id);
 const result=listRecords(env.store.read(),'venture-delivery-run').find(r=>r.id===run.id)!;
 assert.equal(result.status,'stopped');assert.equal(result.callId,null);assert.equal(result.deliverable,null);assert.equal(result.agentJob!.proposal,null);assert.equal(dispatched,1);assert.equal(env.models.previewed.length,0);await assert.rejects(env.call('venture.delivery.run',{orderId:order.id}),{code:'SUPPORT_PERSON_REQUIRED'});
});
