// Chausar actual seller report prerequisites, original integration tests.
import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
test('research checks run before a model preview and malformed exports cannot spend',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T10:00:00Z')},{idea:'Online seller back office'});const offer=env.offers.find(o=>o.playbookOffer==='product-research')!;
 const create=(text:string)=>env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Assess the product shortlist.',intake:{fields:{permission:true,researchDate:'2026-10-28',researchProfile:'beginner',trademarks:['Disney']}},intakeFiles:{exports:{name:'research.csv',contentBase64:Buffer.from(text).toString('base64')}}});
 const bad=await create('item,status\nbag,ready');const before=env.models.previewed.length;await assert.rejects(env.call('venture.delivery.run',{orderId:bad.id}),{code:'SELLER_INPUT_INVALID'});assert.equal(env.models.previewed.length,before);
 const good=await create('id,title,keyword,priceMinor,feeMinor,reviews,ratingBps,recentReviewSpike,seasonMonths,source\np1,Disney bag,bag,10000,2000,20,400,no,10,Owner export');const run=await env.call('venture.delivery.run',{orderId:good.id});assert.equal(run.status,'waiting-for-you');assert.equal(env.models.previewed.length,before+1);assert.match(JSON.stringify(env.models.previewed.at(-1)),/NO-GO/);assert.equal(env.models.previewed.at(-1)?.purpose,'delivery');
});
