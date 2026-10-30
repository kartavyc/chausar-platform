import test from 'node:test';
import assert from 'node:assert/strict';
import { JobCapability } from '../runtime/venture/agent-runtime/scope.ts';
import type { AgentJobScope } from '../runtime/venture/agent-runtime/driver-types.ts';
import { ChausarError, type Context } from '../runtime/contracts.ts';
const scope: AgentJobScope = {jobId:'job_sample',runId:'run_sample',ventureId:'venture_sample',orderId:'order_sample',clientId:'client_sample',agentId:'agent_sample',memberId:'owner',epoch:1,consentId:'consent_sample',consentRevision:1,generation:1};
const owner: Context = {memberId:'owner',role:'owner',epoch:1,channel:'desktop'};
test('job capability freezes scope, strips approval authority, and rechecks its current identity',()=>{
 let checks=0; const input={...scope};const cap=new JobCapability(input,owner,()=>{checks++;});input.orderId='other';
 cap.assert(); assert.equal(checks,1);assert.equal(cap.scope.orderId,'order_sample');assert.equal(cap.context.channel,'mcp');assert.equal(cap.context.sourceTainted,true);
 assert.throws(()=>new JobCapability(scope,{...owner,memberId:'another'},()=>{}).assert(),{code:'JOB_SCOPE_CHANGED'});
 cap.close();assert.throws(()=>cap.assert(),{code:'JOB_CLOSED'});
});
test('withdrawal during an asynchronous read prevents the result from returning',async()=>{
 let granted=true;const cap=new JobCapability(scope,owner,()=>{if(!granted)throw new ChausarError('CLIENT_AI_CONSENT_REQUIRED','Consent is required.');});
 await assert.rejects(cap.guard(async()=>{granted=false;return 'private client data';}),{code:'CLIENT_AI_CONSENT_REQUIRED'});
});
