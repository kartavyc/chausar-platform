// Legal disclosure rules hold paid or synthetic client work before any model spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {consentForOrder,SCRIPTED_AGENT_SETTINGS} from './fixtures/venture/scripted-agent.ts';
import {waitForAgentWork} from '../runtime/venture/agent-runtime/runner.ts';
import {ventureAction} from '../runtime/venture/records.ts';
test('paid client social work waits for a lawyer before any preview, but ordinary posts and rehearsal remain usable',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T10:00:00Z')},{idea:'social media agency'});
 let starts=0;env.deps.agentRoute=async()=>({settings:SCRIPTED_AGENT_SETTINGS,driver:{async open(){starts++;return {async run(){return {status:'completed',text:'Synthetic eligibility check only.'};},async interrupt(){},async close(){}};}}});
 await env.deps.services.trust.updatePolicy(owner,{send:'shape'});
 const offer=env.offers.find(o=>o.playbookOffer==='linkedin-ghostwriting')!;
 const make=(paidPromotion:boolean)=>env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Write useful client posts.',intake:{paidPromotion,fields:{postCount:'8'},moneyAmounts:{extraRoundPrice:'100'}}});
 const paid=await make(true);await consentForOrder(env.deps,owner,paid.id);await assert.rejects(env.call('venture.delivery.run',{orderId:paid.id}),{code:'RULE_UNCONFIRMED'});assert.equal(env.models.previewed.length,0);assert.equal(starts,0);
 const ordinary=await env.call('venture.delivery.run',{orderId:(await make(false)).id});await waitForAgentWork(env.store,ordinary.id);assert.equal(starts,1);assert.equal(env.models.previewed.length,0);
 await ventureAction(env.deps,owner,'prepare','fixture.rehearsal',tx=>{tx.replace({...tx.venture!,launchStage:'shadow'});});
 const rehearsal=await env.call('venture.delivery.run',{orderId:paid.id});await waitForAgentWork(env.store,rehearsal.id);assert.equal(starts,2);assert.equal(env.models.previewed.length,0);
});
