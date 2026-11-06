import test from 'node:test';
import assert from 'node:assert/strict';
import {careerResearchPack} from '../runtime/venture/playbooks/job-search-desk/research-pack.ts';
const facts=[{id:'research',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:['management']}];
const listings=[{id:'listing1',url:'https://jobs.example/1',text:'We research customer needs.',revision:'hash'}];
test('research reports cannot inflate coverage by repeating one saved listing or coerce a report kind',()=>{
 const match={id:'listing1',verdict:'fair' as const,reason:'Owner assessment: review the scope.'};
 assert.throws(()=>careerResearchPack(facts,listings,{kind:'weekly-shortlist',matches:[match,match],threshold:'fair'},2),{code:'INVALID_VENTURE_REQUEST'});
 assert.throws(()=>careerResearchPack(facts,listings,{kind:['weekly-shortlist'],matches:[match],threshold:'fair'} as any,2),{code:'INVALID_VENTURE_REQUEST'});
 assert.throws(()=>careerResearchPack(facts,listings,{kind:'weekly-shortlist',matches:[{...match,id:'another-order-listing'}],threshold:'fair'},2),{code:'CAREER_NOT_FOUND'});
});
test('coaching report rejects forged review booleans and preserves every qualifier in its selected fact',()=>{
 const input={claims:[{factId:'research',use:'research'}],targets:[],research:{url:listings[0].url,text:listings[0].text},clientFactId:'research',pilot:{startsOn:null,weeks:null,hypothesis:null,measure:{what:null,target:null,by:null},ownerHours:null,clientHours:null,priceMinor:'100000',reference:null}};
 const text='We research customer needs. Interviewed customers. I am interested in this work.';
 const result=careerResearchPack(facts,listings,{kind:'career-coaching',input,outreach:{text,clientConfirmed:true,voiceConfirmed:true}},1);
 assert.equal(result.ready,false);assert.match(result.text,/DO NOT SEND/);
 assert.throws(()=>careerResearchPack(facts,listings,{kind:'career-coaching',input,outreach:{text,clientConfirmed:['true'],voiceConfirmed:true}} as any,1),{code:'INVALID_VENTURE_REQUEST'});
});
