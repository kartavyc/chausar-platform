import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,installKitFixture,deliver,draft} from './fixtures/venture/kit-business.ts';
import {getClientAiConsent} from '../runtime/venture/clients/ai-consent.ts';
import {owner} from './fixtures/venture/kit-business.ts';

test('kit delivery fixture uses a real scoped broker and explicitly grants only its client',async t=>{
 t.after(installKitFixture());const env=await kitBusiness(),other=await env.call('venture.client.add',{name:'Other Client',email:'other@example.com',countryCode:'IN'});
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0].id,request:'A warm voice for Sunrise Bakery.',intake:{fields:{'brand-name':'Sunrise Bakery','consent-data':true}}});
 await assert.rejects(env.call('venture.delivery.run',{orderId:order.id}),{code:'CLIENT_AI_CONSENT_REQUIRED'});
 const ready=await deliver(env,order.id,draft('Voice sheet',{'Voice sheet':['A warm, plain voice for Sunrise Bakery.']}));
 assert.equal(ready.status,'ready-for-review',JSON.stringify(ready));assert.equal(ready.preview,null);assert.ok(ready.agentJob?.proposal);assert.equal(env.models.previewed.filter(task=>task.purpose==='delivery').length,0);
 assert.equal((await getClientAiConsent(env.deps,owner,{clientId:other.id})).status,'required');assert.equal(env.store.read().actions.length,0);
});
