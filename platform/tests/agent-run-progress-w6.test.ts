import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setup,seedBlueprint,seedOrder,seedRun,owner} from './venture-views-env.ts';
import {agreeClientAiConsent,getClientAiConsent} from '../runtime/venture/clients/ai-consent.ts';
import {createNativeJob} from '../runtime/venture/agent-runtime/native-job.ts';
import {runsGetHandler} from '../runtime/venture/views/runs.ts';
import {ventureAction} from '../runtime/venture/records.ts';

test('tool-owned run steps only complete from actual tool or checked draft evidence',async()=>{
 const env=await setup(),{client,order}=await seedOrder(env,await seedBlueprint(env)),run=await seedRun(env,order,{});
 await env.deps.services.trust.updatePolicy(owner,{send:'shape'});
 const consent=await getClientAiConsent(env.deps,owner,{clientId:client.id});await agreeClientAiConsent(env.deps,owner,{clientId:client.id,disclosureDigest:consent.disclosureDigest});
 const job=await createNativeJob(env.deps,owner,run.id,{agentId:'delivery',sections:['Reply'],check:()=>undefined});
 try {
  const initial=await runsGetHandler(env.deps,owner,{runId:run.id});
  assert.equal(initial.steps.filter(step=>step.state==='done').length,0,'starting a job does not prove any work happened');
  assert.equal(initial.gate,undefined,'native jobs never expose the retired round gate');
  assert.equal(initial.scope,undefined,'old harness budget and tool claims are not a native job scope');
  assert.ok(initial.steps.some(step=>step.purpose.toLowerCase().includes('read')),'read step remains visible');
  await ventureAction(env.deps,owner,'prepare','test.tool',tx=>{const current=tx.find('venture-delivery-run',run.id)!;tx.replace({...current,agentJob:{...current.agentJob!,tools:[{id:'tool_read',name:'mcp__chausar__read_order',status:'running'}]}});});
  const reading=await runsGetHandler(env.deps,owner,{runId:run.id});assert.ok(reading.steps.some(step=>step.purpose.toLowerCase().includes('read')&&step.state==='current'));
  await ventureAction(env.deps,owner,'prepare','test.tool.done',tx=>{const current=tx.find('venture-delivery-run',run.id)!;tx.replace({...current,agentJob:{...current.agentJob!,tools:[{id:'tool_read',name:'mcp__chausar__read_order',status:'done'}]}});});
  const read=await runsGetHandler(env.deps,owner,{runId:run.id});assert.ok(read.steps.some(step=>step.purpose.toLowerCase().includes('read')&&step.state==='done'));assert.ok(read.steps.filter(step=>step.state==='done').length<read.steps.length);
  await ventureAction(env.deps,owner,'prepare','test.owner-note',tx=>{const current=tx.find('venture-delivery-run',run.id)!;tx.replace({...current,agentJob:{...current.agentJob!,ownerNotes:[{text:'Use plain words.',at:tx.now,by:owner.memberId}]}});});
  assert.equal((await runsGetHandler(env.deps,owner,{runId:run.id})).steer?.[0]?.text,'Use plain words.');
 }finally{job.capability.close();}
});
