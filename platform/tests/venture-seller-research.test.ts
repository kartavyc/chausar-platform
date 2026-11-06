// Original Chausar seller operations regressions, MIT/Apache commerce ideas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewSellerShortlist} from '../runtime/venture/playbooks/online-seller/research.ts';
test('every candidate stays visible with deterministic evidence and GO, CAUTION or NO-GO before a model opinion',()=>{
 const item={id:'one',title:'Cotton bag',keyword:'bag',priceMinor:'10000',feeMinor:'2000',reviews:'20',ratingBps:'400',recentReviewSpike:false,seasonMonths:[10],source:'owner research export'};
 const rows=reviewSellerShortlist([item,{...item,id:'two',title:'Disney bag'},{...item,id:'three',feeMinor:'4000'},{...item,id:'four',title:'Metal spoon'}],{month:10,trademarks:['Disney'],profile:'beginner'});
 assert.deepEqual(rows.map((r:any)=>r.verdict),['GO','NO-GO','CAUTION','NO-GO']);assert.equal(rows.length,4);assert.ok(rows.every((r:any)=>r.evidence.length));assert.ok(rows[2].badges.includes('fee-share'));
});
