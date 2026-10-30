import test from 'node:test';
import assert from 'node:assert/strict';
import {factChange} from '../runtime/venture/playbooks/job-search-desk/facts.ts';
import {beforeCareerSend,scoreCareerTarget,CAREER_SCORE_CRITERIA} from '../runtime/venture/playbooks/job-search-desk/before-send.ts';
test('new qualifier claims need owner approval even when existing boundaries are retained',()=>{
 const before={id:'f1',statement:'Helped with research',qualifiers:['as an intern'],forbiddenUses:['team management']};
 assert.equal(factChange(before,{...before,qualifiers:[...before.qualifiers,'and managed a team of ten']}).approvalRequired,true);
 assert.equal(factChange(before,{...before,forbiddenUses:[...before.forbiddenUses,'executive leadership']}).approvalRequired,false);
});
test('private IP addresses cannot stand in for public research evidence',()=>{
 for(const url of ['https://172.16.0.1/launch','https://100.64.0.1/launch','https://192.0.2.1/launch']){
  assert.equal(beforeCareerSend({text:'A new launch. I researched shops.',researchedFact:{text:'A new launch.',url},clientFact:{text:'I researched shops.',factId:'f1'},clientConfirmed:true,voiceConfirmed:true}).verdict,'DO NOT SEND');
  assert.throws(()=>scoreCareerTarget(CAREER_SCORE_CRITERIA.map(id=>({id,score:1,evidence:url}))));
 }
});
