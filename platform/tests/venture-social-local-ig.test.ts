import test from 'node:test';
import assert from 'node:assert/strict';
import { keywordDelivery, replyBuckets, warmFollowups, carouselSize } from '../runtime/venture/playbooks/social/local-ig.ts';
test('keyword delivery puts the promise first, asks one short question and is handoff only',()=>{
 assert.deepEqual(keywordDelivery('Here is your menu: https://example.test/menu','Which meal suits you?'),{messages:['Here is your menu: https://example.test/menu','Which meal suits you?'],capability:'handoff'});
 assert.throws(()=>keywordDelivery('','Which meal suits you?'),{code:'SOCIAL_INPUT_INVALID'});
 assert.throws(()=>keywordDelivery('Menu','When? Where?'),{code:'SOCIAL_INPUT_INVALID'});
 assert.deepEqual(carouselSize(),{width:1080,height:1350});
});
test('counts all six reply buckets before drafting, skips noise and stops followups after reply or optout',()=>{
 const out=replyBuckets([{id:'a',text:'Price please, I want to buy'}, {id:'b',text:'Broken order, refund please'}, {id:'c',text:'How do I use this?'},{id:'d',text:'Love this, thanks'},{id:'e',text:'Please send the menu'},{id:'f',text:'Follow for follow'}]);
 assert.equal(Object.keys(out.counts).length,6);assert.equal(out.counts.noise,1);assert.equal(out.drafts.length,5);assert.equal(out.drafts[0].bucket,'complaint');
 assert.deepEqual(warmFollowups({sentOn:'2026-10-01',replied:false,optedOut:false,already:0}),['2026-10-05','2026-10-15']);
 assert.deepEqual(warmFollowups({sentOn:'2026-10-01',replied:false,optedOut:false,already:2,sentDates:['2026-10-01','2026-10-06','2026-10-16']}),[]);
 assert.deepEqual(warmFollowups({sentOn:'2026-10-01',replied:true,optedOut:false,already:0}),[]);
 assert.deepEqual(warmFollowups({sentOn:'2026-10-01',replied:false,optedOut:true,already:0}),[]);
});

test('warm lead dates use the existing C7 weekday and actual-send calendar',()=>{assert.deepEqual(warmFollowups({sentOn:'2026-10-01',replied:false,optedOut:false,already:1,sentDates:['2026-10-01','2026-10-06'],weekdays:[1,2,3,4,5]}),['2026-10-16']);});
