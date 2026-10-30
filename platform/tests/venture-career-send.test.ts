import test from 'node:test';
import assert from 'node:assert/strict';
import {beforeCareerSend,scoreCareerTarget} from '../runtime/venture/playbooks/job-search-desk/before-send.ts';
const input={text:'Your launch targets independent shops. I interviewed shop owners during my internship.',researchedFact:{text:'Your launch targets independent shops.',url:'https://example.org/launch'},clientFact:{text:'I interviewed shop owners during my internship.',factId:'fact-1'},clientConfirmed:true,voiceConfirmed:true};
test('both actual facts and owner voice review are required before a handoff',()=>{
 assert.equal(beforeCareerSend(input).verdict,'PASS');
 assert.equal(beforeCareerSend({...input,researchedFact:null}).verdict,'DO NOT SEND');
 assert.equal(beforeCareerSend({...input,clientFact:null}).verdict,'DO NOT SEND');
 assert.equal(beforeCareerSend({...input,text:input.text+' [YOUR TAKE]'}).verdict,'DO NOT SEND');
 assert.equal(beforeCareerSend({...input,voiceConfirmed:false}).verdict,'REWRITE');
 assert.equal(beforeCareerSend({...input,clientConfirmed:false}).verdict,'DO NOT SEND');
 assert.equal(beforeCareerSend({...input,text:'An unrelated message'}).verdict,'DO NOT SEND');
});
test('target scoring requires seven bounded scores with evidence or an explicit guess',()=>{
 const criteria=['visible-gap','market-proof','client-evidence','revenue-impact','decision-maker-access','decision-speed','unowned-work'];
 const rows=criteria.map((id,i)=>({id,score:i%3,evidence:i===0?'https://example.org/launch':'guess'}));
 assert.equal(scoreCareerTarget(rows).total,6);
 assert.equal(scoreCareerTarget(rows).max,14);
 assert.throws(()=>scoreCareerTarget(rows.slice(1)));
 assert.throws(()=>scoreCareerTarget(rows.map((r,i)=>i===0?{...r,score:3}:r)));
 assert.throws(()=>scoreCareerTarget(rows.map((r,i)=>i===0?{...r,evidence:'trust me'}:r)));
});
