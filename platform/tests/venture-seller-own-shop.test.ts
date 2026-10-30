// Own-shop orders are internal accounting work, never a customer sale. Original Chausar tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitBusiness,owner } from './fixtures/venture/kit-business.ts';
import { shareCreate } from '../runtime/venture/build/share-links.ts';
import { ONLINE_SELLER_DEFINITION } from '../runtime/venture/playbooks/online-seller/definition.ts';
test('own-shop orders reuse one self client and refuse invoices and client status links',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-27T10:00:00Z')},{idea:'An online seller in Pune'});
 const offer=env.offers.find(o=>o.playbookOffer==='own-shop-back-office');assert.ok(offer,'owner shop offer is on the plan');
 const order=await env.call('venture.order.create',{offerId:offer.id,request:'Check my shop exports.'});
 assert.equal(order.internal,true);
 const others=await Promise.all([1,2].map(()=>env.call('venture.order.create',{offerId:offer.id,request:'Check my next shop export.'})));for(const next of others) assert.equal(next.clientId,order.clientId);
 const clientOffer=env.offers.find(o=>o.playbookOffer==='listing-health-audit')!;await assert.rejects(env.call('venture.order.create',{clientId:order.clientId,offerId:clientOffer.id,request:'Check the seller listing.'}),{code:'INTERNAL_ORDER'});
 const clients=await env.call('venture.client.list');assert.equal(clients.filter((c:any)=>c.self).length,1);assert.equal(clients.find((c:any)=>c.id===order.clientId).name,'Your own shop');
 await assert.rejects(env.call('venture.invoice.prepare',{orderId:order.id}),{code:'INTERNAL_ORDER'});
 await assert.rejects(shareCreate(env.deps,owner,{kind:'order-status',orderId:order.id}),{code:'INTERNAL_ORDER'});
 await assert.rejects(shareCreate(env.deps,owner,{kind:'statement',clientId:order.clientId}),{code:'INTERNAL_ORDER'});
 const delivered=await env.call('venture.order.deliver',{orderId:order.id,deliveredOn:'2026-10-27'});assert.equal(delivered.saleFactId,null);
 assert.equal(ONLINE_SELLER_DEFINITION.offers.find(o=>o.id==='own-shop-back-office')?.audience,'public','buyer-facing potential still gets the automatic judge');
});
