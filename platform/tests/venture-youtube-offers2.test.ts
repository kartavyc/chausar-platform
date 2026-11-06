import assert from 'node:assert/strict';
import {test} from 'node:test';
import {YOUTUBE_OFFERS2,checkChannelAudit,checkWeeklyPlan,queryTest} from '../runtime/venture/playbooks/youtube/offers2.ts';
import {triageComments} from '../runtime/venture/playbooks/youtube/comments.ts';
import {teleprompterPlan,thumbnailVariation} from '../runtime/venture/playbooks/youtube/teleprompter.ts';
test('every new offer has owner-set price and named workflow stages',()=>{assert.equal(YOUTUBE_OFFERS2.length,8);for(const offer of YOUTUBE_OFFERS2){assert.equal(offer.price,'owner-sets');assert.ok(offer.stages.length>=3);}});
test('audit and weekly plan enforce the exact promised shape and measured time allowance',()=>{
 assert.equal(checkChannelAudit({fixes:['fix'],keep:['a','b','c'],notYet:['later']}).passed,true);
 assert.equal(checkChannelAudit({fixes:['one','two'],keep:['a','b','c'],notYet:['later']}).passed,false);
 const pieces=[{id:'anchor',kind:'anchor',minutes:120},{id:'cheap',kind:'cheap',minutes:30},...[1,2,3].map(i=>({id:'short-'+i,kind:'short',minutes:30}))];
 assert.equal(checkWeeklyPlan(pieces,240,'cheap').passed,true);assert.equal(checkWeeklyPlan(pieces,239,'cheap').passed,false);assert.equal(checkWeeklyPlan(pieces,240,'unknown').passed,false);
});
test('query test uses word sequences in both title and only the first two description lines',()=>{assert.equal(queryTest('Shop sales cash flow stock count','Shop sales and cash flow\nStock count helps',['shop sales','cash flow','stock count']).passed,true);assert.equal(queryTest('shopping sales cash flow stock count','Shop sales\nCash flow\nStock count',['shop sales','cash flow','stock count']).passed,false);});
test('comments have counts first, no bait reply, bounded replies and repeated-question ideas',()=>{
 const comments=[...['a','b','c'].map(id=>({id,text:'How do I count stock?'})),{id:'d',text:'तुम बेवकूफ हो'},{id:'e',text:'Thank you'}];
 const result=triageComments(comments,[{id:'a',reply:'Count each shelf before opening.'}],'e');assert.deepEqual(result.counts,{questions:3,praise:1,actionable:0,bait:1});assert.equal(result.ideas[0]?.count,3);
 assert.throws(()=>triageComments(comments,[{id:'d',reply:'No thanks'}],'e'),{code:'YOUTUBE_REPLY_BAIT'});
 assert.throws(()=>triageComments(comments,[{id:'a',reply:Array(31).fill('word').join(' ')}],'e'),{code:'YOUTUBE_REPLY_TOO_LONG'});
});
test('teleprompter measures speech only and thumbnail variations need supported words and direction',()=>{
 const blocks=[{kind:'speech' as const,text:Array(100).fill('hello').join(' ')},{kind:'cue' as const,text:'Show the shop outside'}];const plan=teleprompterPlan(blocks,100,24);assert.equal(plan.spokenWords,100);assert.equal(plan.durationMs,60000);
 assert.throws(()=>teleprompterPlan(blocks,201,24),{code:'YOUTUBE_RESEARCH_INVALID'});
 assert.throws(()=>thumbnailVariation({direction:'',words:'Shop tour',shown:'Shop tour'}),{code:'YOUTUBE_RESEARCH_INVALID'});
 assert.equal(thumbnailVariation({direction:'Show entrance',words:'Shop tour',shown:'This shop tour shows the entrance'}).passed,true);assert.equal(thumbnailVariation({direction:'Show entrance',words:'Double income',shown:'Shop tour'}).passed,false);
});

test('Hindi questions without punctuation enter question pile and repeated suggestions',()=>{
 const comments=['one','two','three'].map(id=>({id,text:'कैसे गिनें दुकान का सामान'}));
 const result=triageComments(comments);
 assert.equal(result.counts.questions,3);assert.equal(result.ideas[0]?.count,3);
 assert.equal(triageComments([{id:'four',text:'कैसेभी गलत है'}]).counts.questions,0);
});
