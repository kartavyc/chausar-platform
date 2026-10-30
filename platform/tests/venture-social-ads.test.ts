import test from 'node:test';import assert from 'node:assert/strict';
import { adStyle, videoQuote, approveStoryboard } from '../runtime/venture/playbooks/social/ad-style.ts';
import { adLedger } from '../runtime/venture/playbooks/social/ad-ledger.ts';
test('product photo, exact storyboard approval and declared clip limits precede a paid video quote',()=>{
 assert.throws(()=>adStyle('restaurant',null),{code:'PRODUCT_PHOTO_REQUIRED'});
 assert.equal(adStyle('restaurant',{id:'photo',digest:'bytes',kind:'client'}).style,'food-detail');
 assert.throws(()=>videoQuote({durationMs:21000,maxClipMs:8000,unitMinor:'2500',storyboardDigest:'s',approvedDigest:null,synthetic:true,customerPretence:false}),{code:'SOCIAL_APPROVAL_REQUIRED'});
 const digest=approveStoryboard({digest:'s',stills:['one','two']},'s');
 const q=videoQuote({durationMs:21000,maxClipMs:8000,unitMinor:'2500',storyboardDigest:'s',approvedDigest:digest,synthetic:true,customerPretence:false});assert.equal(q.units,3);assert.equal(q.totalMinor,'7500');assert.equal(q.disclosure,'Made with AI');assert.equal(q.capability,'handoff');
 assert.throws(()=>videoQuote({durationMs:21000,maxClipMs:8000,unitMinor:'2500',storyboardDigest:'s',approvedDigest:digest,synthetic:true,customerPretence:true}),{code:'CUSTOMER_PRETENCE'});
});
test('competitor ledger has no scraped data, no zero for an empty sample and no thin-sample percentages',()=>{
 assert.equal(adLedger([]).state,'empty');assert.equal(adLedger([]).live,null);
 const row={id:'ad1',capturedBy:'owner',status:'live',format:'video'} as const;
 assert.equal(adLedger([row]).live,1);assert.equal(adLedger([row]).percentages,null);
 const enough=adLedger(Array.from({length:20},(_,i)=>({...row,id:String(i),status:i<10?'live':'stopped'})) as any);assert.equal(enough.live,10);assert.equal(enough.stopped,10);assert.equal(enough.percentages!.video,100);
 assert.throws(()=>adLedger([{...row,capturedBy:'scraper'} as any]),{code:'SOCIAL_INPUT_INVALID'});
});
