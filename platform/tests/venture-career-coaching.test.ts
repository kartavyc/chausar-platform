import test from 'node:test';
import assert from 'node:assert/strict';
import {careerCoaching} from '../runtime/venture/playbooks/job-search-desk/coaching.ts';
import {CAREER_SCORE_CRITERIA} from '../runtime/venture/playbooks/job-search-desk/before-send.ts';
const fact={id:'research',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:['managed a team']};
const terms={startsOn:'2026-11-01',weeks:2,hypothesis:'Test research fit',measure:{what:'Client approved interviews',target:'two',by:'2026-11-12'},ownerHours:2,clientHours:1,priceMinor:'500000',reference:false};
test('coaching retains stop-claiming boundaries, evidence scores, two-fact draft and paid pilot',()=>{
 const result=careerCoaching([fact],{claims:[{factId:'research',use:'research'}],targets:[{name:'Local research team',criteria:CAREER_SCORE_CRITERIA.map(id=>({id,score:1,evidence:'guess'}))}],research:{text:'The team studies local shops.',url:'https://company.example/research'},clientFactId:'research',pilot:terms});
 assert.match(result.positioning,/What to stop claiming/);assert.match(result.positioning,/managed a team/);assert.equal(result.targets[0].score.total,7);assert.equal(result.targets[0].score.guesses,7);assert.match(result.outreach,/as an intern/);assert.equal(result.send.verdict,'DO NOT SEND');assert.match(result.outreach,/\[YOUR TAKE\]/);assert.equal(result.pilot.priceMinor,'500000');assert.ok(result.callPlan.length>=3);
 assert.throws(()=>careerCoaching([fact],{claims:[{factId:'research',use:'research'}],targets:[],research:null,clientFactId:'research',pilot:{...terms,priceMinor:'0'}}),{code:'PILOT_UNPRICED'});
});
