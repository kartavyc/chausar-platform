import test from 'node:test';
import assert from 'node:assert/strict';
import {careerTask} from '../runtime/venture/playbooks/job-search-desk/ai.ts';
const facts=[{id:'research',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:['management']}];
test('career AI can select only approved bounded evidence, never introduce experience or rewrite facts',()=>{
 const task=careerTask('resume',facts,[{id:'job1',text:'Customer research role',url:'https://jobs.example/one',revision:'r1'}]);assert.equal(task.containsClientData,true);assert.match(JSON.stringify(task.input),/as an intern/);
 const result=task.validate({kind:'resume',claims:[{factId:'research',use:'customer research'}],sources:[{listingId:'job1',quote:'Customer research'}]});assert.equal(result.claims[0].factId,'research');
 assert.throws(()=>task.validate({kind:'resume',claims:[{factId:'research',use:'management'}],sources:[]}),{code:'CAREER_CLAIM_BOUNDARY'});
 assert.throws(()=>task.validate({kind:'resume',claims:[{factId:'new',use:'research'}],sources:[]}),{code:'CAREER_UNSTATED_FACT'});
 assert.throws(()=>task.validate({kind:'resume',claims:[{factId:'research',use:'research',claim:'Managed fifty people'}],sources:[]}),{code:'INVALID_VENTURE_REQUEST'});
 assert.throws(()=>task.validate({kind:'cover-letter',claims:[{factId:'research',use:'research'}],sources:[]}),{code:'INVALID_VENTURE_REQUEST'});
});
