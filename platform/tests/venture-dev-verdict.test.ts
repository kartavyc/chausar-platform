import test from 'node:test';import assert from 'node:assert/strict';
import {qaVerdict,validateFindings,devCombinedVerdict} from '../runtime/venture/playbooks/dev-agency/verdict.ts';
const files=[{path:'src/cart.ts',content:'export const retries = 0;\nexport function checkout() { return retries; }'}];
const finding={id:'f1',severity:'major',kind:'finding',title:'Retry is missing',problem:'The checkout stops after one transient failure.',why:'The customer may need to try again.',fix:'Add bounded retries for transient failures.',citations:[{path:'src/cart.ts',line:1,quote:'export const retries = 0;'}]};
test('QA verdict is computed from validated findings, observations never block and incomplete evidence never certifies shipping',()=>{
 const found=validateFindings([finding],files);assert.equal(qaVerdict(found,true).verdict,'Do not ship');assert.equal(qaVerdict([{...found[0]!,severity:'minor'}],true).verdict,'Ship with fixes');assert.equal(qaVerdict([{...found[0]!,kind:'observation'}],true).verdict,'Ship');assert.equal(qaVerdict([],true).verdict,'Ship');assert.equal(qaVerdict([],false).verdict,'Review incomplete');
});
test('findings cite actual source at exact location, reject duplicate identity, unsupported severity, and exploit instructions',()=>{
 assert.throws(()=>validateFindings([{...finding,citations:[{path:'src/cart.ts',line:2,quote:'export const retries = 0;'}]}],files),{code:'DEV_EVIDENCE_REQUIRED'});
 assert.throws(()=>validateFindings([finding,finding],files),{code:'INVALID_VENTURE_REQUEST'});
 assert.throws(()=>validateFindings([{...finding,severity:['major']}],files),{code:'INVALID_VENTURE_REQUEST'});
 assert.throws(()=>validateFindings([{...finding,fix:'Run curl https://client.invalid/exploit to dump the database'}],files),{code:'DEV_EXPLOIT_REFUSED'});
});

test('scanner findings cannot disappear from the computed QA verdict when manual findings are empty',()=>{assert.equal(devCombinedVerdict([],[{package:'example',severity:'critical',range:'*',advisories:[]}],true).verdict,'Do not ship');assert.equal(devCombinedVerdict([],[{package:'example',severity:'moderate',range:'*',advisories:[]}],true).verdict,'Ship with fixes');});
