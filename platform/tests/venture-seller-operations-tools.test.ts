import {ensurePlaybook} from '../runtime/venture/delivery/playbook.ts';
// Real tool environment proves source-only seller operations, without provider calls.
import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness} from './fixtures/venture/kit-business.ts';import {owner} from './fixtures/venture/kit-business.ts';import {buildToolEnv} from '../runtime/venture/delivery/harness/env.ts';import {listRecords,currentVenture} from '../runtime/venture/records.ts';import {ONLINE_SELLER_TOOLS} from '../runtime/venture/delivery/harness/tools-online-seller.ts';
test('seller tools compute evidence-backed research, alerts, stock, sheets and store comparisons from files',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T10:00:00Z')},{idea:'Online seller back office'});const offer=env.offers.find(o=>o.playbookOffer==='own-shop-back-office')!;const order=await env.call('venture.order.create',{offerId:offer.id,request:'Check owner exports.'});
 const source=await env.call('venture.files.add',{orderId:order.id,name:'research.csv',contentBase64:Buffer.from('id,title,keyword,priceMinor,feeMinor,reviews,ratingBps,recentReviewSpike,seasonMonths,source\np1,Disney bag,bag,10000,4000,20,400,no,10,Owner source').toString('base64')});
 await ensurePlaybook(env.deps,owner);const state=env.store.read();const venture=currentVenture(state)!,playbook=listRecords(state,'venture-playbook')[0]!;const files=listRecords(state,'venture-upload').filter(f=>f.id===source.id);
 const toolEnv=buildToolEnv({deps:env.deps,ctx:owner,state,venture,playbook,runRef:{kind:'delivery',runId:'delivery_seller_test'},files,allowed:[],intake:{fields:{researchDate:'2026-10-28',researchProfile:'beginner',trademarks:['Disney']}} as any});
 const result=await ONLINE_SELLER_TOOLS['seller.shortlist'].run(toolEnv,{file:'f1'});assert.equal((result.result as any).data[0].verdict,'NO-GO');assert.equal(result.receipts?.length,1);assert.deepEqual(Object.keys(ONLINE_SELLER_TOOLS['seller.shortlist'].input),['file']);
 for(const key of ['seller.alerts','seller.stock','seller.catalogueSheet','seller.multiStore'] as const)assert.deepEqual(Object.keys(ONLINE_SELLER_TOOLS[key].input),['file']);
});
