// Legal disclosure rules hold paid or synthetic client work before any model spend.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction} from '../runtime/venture/records.ts';
test('paid client social work waits for a lawyer before any preview, but ordinary posts and rehearsal remain usable',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T10:00:00Z')},{idea:'social media agency'});
 const offer=env.offers.find(o=>o.playbookOffer==='linkedin-ghostwriting')!;
 const make=(paidPromotion:boolean)=>env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Write useful client posts.',intake:{paidPromotion,fields:{postCount:'8'},moneyRupees:{extraRoundPrice:'100'}}});
 const paid=await make(true);await assert.rejects(env.call('venture.delivery.run',{orderId:paid.id}),{code:'RULE_UNCONFIRMED'});assert.equal(env.models.previewed.length,0);
 await env.call('venture.delivery.run',{orderId:(await make(false)).id});assert.equal(env.models.previewed.length,1);
 await ventureAction(env.deps,owner,'prepare','fixture.rehearsal',tx=>{tx.replace({...tx.venture!,launchStage:'shadow'});});
 await env.call('venture.delivery.run',{orderId:paid.id});assert.equal(env.models.previewed.length,2);
});
