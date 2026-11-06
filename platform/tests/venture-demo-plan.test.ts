// Original demo disclosure and real shared caption validation.
import test from 'node:test';import assert from 'node:assert/strict';
import {demoPlan,checkDemoCaptions} from '../runtime/venture/playbooks/app-testing/demo.ts';
const input={title:'Stock app walk-through',script:'Open the stock list.',shots:[{id:'stock',action:'Open the stock list',seconds:5}],clientTestAccount:true,aiVoice:true,description:'Recorded with fictional data.\nThis video uses an AI voice.'};
test('demo plans require the client test account and keep AI disclosure in the description',()=>{const plan=demoPlan(input);assert.match(plan.description,/AI voice/);assert.throws(()=>demoPlan({...input,clientTestAccount:false}),{code:'TEST_ACCOUNT_REQUIRED'});assert.throws(()=>demoPlan({...input,description:'A stock list demo.'}),{code:'AI_DISCLOSURE_REQUIRED'});});
test('caption checks actually use the 5A4 validator',()=>{assert.equal(checkDemoCaptions([{id:'c1',startMs:0,endMs:2000,lines:['Open the stock list.'],words:null}]).findings.length,0);assert.ok(checkDemoCaptions([{id:'c1',startMs:0,endMs:5,lines:['Open the stock list.'],words:null}]).findings.some(f=>f.code==='too-short'));});
