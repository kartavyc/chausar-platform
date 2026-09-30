import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import { digest,transaction } from '../src/shared.ts';
import type { ModelFixture } from './model-fixture.ts';
import { retireExpiredModelArtifacts } from '../src/natural-investigation.ts';

export async function installModelFixtures(pool:Pool,fixture:ModelFixture){
  for(const [ref,api,classification] of [['private-chat@1','chat_completions','private'],['external-responses@1','responses','external']] as const){
    const body={api,baseUrl:fixture.url,model:'synthetic-test-model',classification,handlingReview:'Synthetic loopback fixture only; no provider handling claim',providerRetention:'no_content_retention',timeoutMs:800,maxOutputTokens:1024};
    await pool.query('INSERT INTO chausar_core.model_endpoint_revisions VALUES($1,$2,$3,$4)',['demo',ref,body,digest(body)]);
  }
  await pool.query("UPDATE chausar_core.grants SET operations=operations||ARRAY['model'] WHERE tenant_id='demo'");
  for(const [principal,regions] of [['leader',['north','south']],['north-leader',['north']]] as const){
    const body={datasetId:'invoices',purpose:'profitability',endpointRefs:['private-chat@1'],
      fields:['invoice_id','region','amount','fx_to_inr','shipment_quantity','refund'],regions,
      allowUnclassifiedQuestion:true,allowOntologyMetadata:true,executionLocation:'customer_deployment',
      artifactClasses:['planning_receipt','investigation_plan'],endpointClasses:['private','external'],providerRetention:['no_content_retention'],
      retentionSeconds:600,expiresAt:new Date(Date.now()+3600000).toISOString()};
    await pool.query('INSERT INTO chausar_core.model_policy_revisions VALUES($1,$2,1,$3)',['demo',principal,body]);
    await pool.query('INSERT INTO chausar_core.model_policies VALUES($1,$2,1,true)',['demo',principal]);
  }
}

export async function verifyModelConnected(ctx:{pool:Pool;fixture:ModelFixture;baseUrl:string;leaderToken:string;regionalToken:string;internalToken:string;receiptKey:string;dispatch:()=>Promise<unknown>}){
  const {pool,fixture}=ctx;const checks:{name:string;passed:true}[]=[];
  const pass=(name:string)=>checks.push({name,passed:true});
  const request=async(path:string,token=ctx.leaderToken,body?:unknown)=>{
    const r=await fetch(ctx.baseUrl+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});return {status:r.status,body:await r.json() as any};};
  const ask=(question:string,token=ctx.leaderToken,requestId=randomUUID())=>request('/v1/investigations/question',token,{question,requestId});
  const mutate=(fn:(db:PoolClient)=>Promise<unknown>)=>transaction(pool,async db=>{
    await db.query("SELECT tenant_id FROM chausar_core.tenants WHERE tenant_id='demo' FOR UPDATE");await fn(db);
    await db.query("UPDATE chausar_core.tenants SET policy_epoch=policy_epoch+1 WHERE tenant_id='demo'");});
  const policy=async(principal:string,patch:Record<string,unknown>)=>mutate(async db=>{
    const current=(await db.query(`SELECT p.revision,r.body FROM chausar_core.model_policies p JOIN chausar_core.model_policy_revisions r USING(tenant_id,principal_id,revision)
      WHERE p.tenant_id='demo' AND p.principal_id=$1`,[principal])).rows[0];const revision=Number(current.revision)+1;
    await db.query("INSERT INTO chausar_core.model_policy_revisions VALUES('demo',$1,$2,$3)",[principal,revision,{...current.body,...patch}]);
    await db.query("UPDATE chausar_core.model_policies SET revision=$2 WHERE tenant_id='demo' AND principal_id=$1",[principal,revision]);
  });
  const result=async(id:string,token:string)=>{
    await ctx.dispatch();const end=Date.now()+60000;
    while(Date.now()<end){const r=await request(`/v1/investigations/${id}`,token);assert.equal(r.status,200);
      if(r.body.resultId)return request(`/v1/results/${r.body.resultId}`,token);
      await new Promise(r=>setTimeout(r,100));}
    throw Error('Natural investigation did not complete');
  };
  const northern=await ask('What is the gross invoice value in my authorized regions?',ctx.regionalToken);
  assert.equal(northern.status,201);const north=await result(northern.body.investigationId,ctx.regionalToken);
  assert.equal(north.status,200);assert.equal(north.body.metrics.gross_inr,300);assert.deepEqual(north.body.evidence.scopeRegions,['north']);
  const identity=(await pool.query("SELECT principal_id,mandate_id FROM chausar_core.investigations WHERE tenant_id='demo' AND investigation_id=$1",[northern.body.investigationId])).rows[0];
  assert.equal(identity.principal_id,'north-leader');assert.equal(identity.mandate_id,null);
  pass('Chat adapter question runs through Temporal and Cube under personal regional authority');
  const captured=fixture.received.at(-1)!;assert.equal(captured.path,'/v1/chat/completions');
  const payload=JSON.parse(captured.body);assert.equal(payload.store,false);assert.equal(payload.stream,false);assert.equal(payload.tools,undefined);
  const disclosed=JSON.parse(payload.messages[1].content);assert.deepEqual(disclosed.authorizedRegions,['north']);
  assert.equal(disclosed.records,undefined);assert.equal(disclosed.metrics,undefined);assert.ok(!captured.body.includes('SECRET'));
  const receipt=(await pool.query("SELECT payload_digest FROM chausar_core.model_invocations WHERE invocation_id=$1",[northern.body.invocationId])).rows[0];
  assert.equal(receipt.payload_digest,createHmac('sha256',ctx.receiptKey).update(captured.body).digest('hex'));
  pass('Exact captured bytes match protected receipt and contain catalog/question, no raw records or values');

  await policy('leader',{endpointRefs:['external-responses@1']});
  const duplicateId=randomUUID();const first=await ask('Show gross invoice value.',ctx.leaderToken,duplicateId);
  assert.equal(first.status,201);const sent=fixture.received.length;
  const second=await ask('Show gross invoice value.',ctx.leaderToken,duplicateId);
  assert.equal(second.body.investigationId,first.body.investigationId);assert.equal(fixture.received.length,sent);
  assert.equal((await ask('Different question',ctx.leaderToken,duplicateId)).status,409);
  const broad=await result(first.body.investigationId,ctx.leaderToken);assert.equal(broad.body.metrics.gross_inr,24700);
  assert.equal(broad.body.findings[0].evidenceRef,'metric:gross_inr');assert.equal(fixture.received.at(-1)!.path,'/v1/responses');
  assert.equal((await request(`/v1/results/${broad.body.resultId}`,ctx.regionalToken)).status,403);
  pass('Responses adapter produces evidence-bound totals; repeat request does not repeat model call');

  fixture.setBehavior(async()=>({outcome:'clarify',metricIds:[],regions:[],reason:'ambiguous_metric'}));
  const ambiguous=await ask('How are we doing?');assert.equal(ambiguous.body.status,'clarification_required');assert.ok(!ambiguous.body.investigationId);
  const noTask=await pool.query('SELECT investigation_id FROM chausar_core.model_invocations WHERE invocation_id=$1',[ambiguous.body.invocationId]);assert.equal(noTask.rows[0].investigation_id,null);
  pass('Ambiguous question returns trusted clarification without analytical dispatch');
  for(const invalid of [
    {outcome:'execute',metricIds:['profit'],regions:['north'],reason:'none'},
    {outcome:'execute',metricIds:['gross_inr'],regions:['south'],reason:'none'},
    {outcome:'execute',metricIds:['gross_inr'],regions:['north'],reason:'none',sql:'SELECT secret'},
  ]){fixture.setBehavior(async()=>invalid);assert.equal((await ask('Attempt a forged operation',ctx.regionalToken)).status,422);}
  fixture.setBehavior(undefined);pass('Unknown metrics, over-scoped regions and injected SQL rejected');

  let count=fixture.received.length;
  await policy('leader',{allowUnclassifiedQuestion:false});
  assert.equal((await ask('fixture-private-question')).status,403);assert.equal(fixture.received.length,count);
  assert.equal((await request('/v1/ontology')).status,200);
  await policy('leader',{allowUnclassifiedQuestion:true});
  pass('Local read permission does not grant model disclosure; denied question sends zero requests');
  count=fixture.received.length;
  assert.equal((await request('/v1/investigations/question',ctx.leaderToken,{question:'x',requestId:randomUUID(),endpoint:'https://attacker.invalid'})).status,400);
  assert.equal(fixture.received.length,count);pass('Caller cannot supply provider URL or extra authority parameters');

  await policy('north-leader',{fields:['invoice_id','region','amount','fx_to_inr']});
  const limited=await ask('Show gross invoice value',ctx.regionalToken);assert.equal(limited.status,201);
  const limitedPayload=JSON.parse(fixture.received.at(-1)!.body);assert.deepEqual(Object.keys(JSON.parse(limitedPayload.messages[1].content).catalog),['gross_inr']);
  pass('Disclosure field restrictions remove ineligible metric metadata before serialization');

  fixture.setBehavior(async context=>{
    await mutate(db=>db.query("UPDATE chausar_core.model_policies SET active=false WHERE tenant_id='demo' AND principal_id='leader'"));
    return {outcome:'execute',metricIds:['gross_inr'],regions:context.authorizedRegions,reason:'none'};
  });
  const revoked=await ask('Gross invoice value while policy is revoked');assert.equal(revoked.status,403);
  await mutate(db=>db.query("UPDATE chausar_core.model_policies SET active=true WHERE tenant_id='demo' AND principal_id='leader'"));
  fixture.setBehavior(undefined);pass('Policy revocation commits during HTTP call and prevents model output acceptance');

  // A real socket timeout and replay cannot cause a second potentially paid computation.
  fixture.setBehavior(async()=>undefined);const timeoutId=randomUUID();count=fixture.received.length;
  assert.equal((await ask('Timeout question',ctx.leaderToken,timeoutId)).status,502);
  assert.equal((await ask('Timeout question',ctx.leaderToken,timeoutId)).status,409);
  assert.equal(fixture.received.length,count+1);
  pass('Provider timeout is uncertain, durably recorded, and not retried on repeated submission');

  await policy('leader',{endpointRefs:['private-chat@1','external-responses@1'],endpointClasses:['private']});
  fixture.setBehavior(async(_body,res)=>{res.writeHead(503);res.end('sensitive provider error');return undefined;});count=fixture.received.length;
  assert.equal((await ask('Private endpoint outage')).status,502);assert.equal(fixture.received.length,count+1);assert.equal(fixture.received.at(-1)!.path,'/v1/chat/completions');
  pass('Private route failure has one attempt and no fallback to external endpoint');
  fixture.setBehavior(async(_body,res)=>{res.writeHead(307,{Location:fixture.url+'responses'});res.end();return undefined;});count=fixture.received.length;
  assert.equal((await ask('Redirect question')).status,502);assert.equal(fixture.received.length,count+1);
  fixture.setBehavior(undefined);pass('Provider redirect cannot retarget disclosure');

  const concurrentId=randomUUID();count=fixture.received.length;
  const concurrent=await Promise.all([ask('Concurrent question',ctx.leaderToken,concurrentId),ask('Concurrent question',ctx.leaderToken,concurrentId)]);
  assert.ok(concurrent.some(x=>x.status===201));assert.ok(concurrent.every(x=>[200,201,409].includes(x.status)));
  assert.equal(fixture.received.length,count+1);pass('Concurrent identical requests dispatch at most one model attempt');
  const rows=(await pool.query("SELECT row_to_json(m) AS data FROM chausar_core.model_invocations m WHERE tenant_id='demo'")).rows;
  const receipts=JSON.stringify(rows);assert.ok(!receipts.includes('fixture-private-question'));assert.ok(!receipts.includes('sensitive provider error'));
  assert.ok(!receipts.includes('What is the gross'));pass('Persisted receipts exclude prompts and raw provider errors');

  for(const responseBody of [
    {choices:[{finish_reason:'length',message:{content:'{}'}}]},
    {choices:[{finish_reason:'stop',message:{content:'{}',refusal:'refused'}}]},
    {choices:[{finish_reason:'tool_calls',message:{tool_calls:[{function:{name:'write_source'}}]}}]},
  ]){
    fixture.setBehavior(async(_body,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(responseBody));return undefined;});
    assert.equal((await ask('Invalid provider completion')).status,422);
  }
  fixture.setBehavior(async(_body,res)=>{res.end('x'.repeat(70000));return undefined;});
  assert.equal((await ask('Oversized provider response')).status,502);
  fixture.setBehavior(undefined);pass('Refusal, truncation, tool calls and oversized response never become accepted plans');

  await policy('leader',{endpointRefs:['external-responses@1'],endpointClasses:['private']});count=fixture.received.length;
  assert.equal((await ask('Private policy with external route')).status,403);assert.equal(fixture.received.length,count);
  await policy('leader',{endpointRefs:['private-chat@1'],endpointClasses:['private']});
  pass('Private-only disclosure policy rejects externally classified endpoint before transmission');
  await mutate(db=>db.query("UPDATE chausar_core.grants SET operations=array_remove(operations,'model') WHERE tenant_id='demo' AND grant_id='broad'"));count=fixture.received.length;
  assert.equal((await ask('Model operation absent')).status,403);assert.equal(fixture.received.length,count);
  await mutate(db=>db.query("UPDATE chausar_core.grants SET operations=operations||ARRAY['model'] WHERE tenant_id='demo' AND grant_id='broad'"));
  pass('Source grant must separately permit the model operation');

  const bounded=await ask('Gross invoice value in my regions',ctx.regionalToken);assert.equal(bounded.status,201);
  await mutate(db=>db.query("UPDATE chausar_core.grants SET regions=ARRAY['north','south'],revision=revision+1 WHERE tenant_id='demo' AND grant_id='north'"));
  const boundedResult=await result(bounded.body.investigationId,ctx.regionalToken);assert.equal(boundedResult.status,200);
  assert.equal(boundedResult.body.metrics.gross_inr,300);assert.deepEqual(boundedResult.body.evidence.scopeRegions,['north']);
  await mutate(db=>db.query("UPDATE chausar_core.grants SET regions=ARRAY['north'],revision=revision+1 WHERE tenant_id='demo' AND grant_id='north'"));
  pass('Grant expansion after planning cannot expand the queued analytical population');

  const pinned=await ask('Gross invoice value before definition changes');assert.equal(pinned.status,201);
  const oldRevision=Number((await pool.query("SELECT revision FROM chausar_core.publications WHERE tenant_id='demo'")).rows[0].revision);
  await mutate(async db=>{
    await db.query(`INSERT INTO chausar_core.ontology_revisions(tenant_id,definition_id,revision,body,content_hash,published_by)
      SELECT tenant_id,definition_id,revision+1,body,content_hash,published_by FROM chausar_core.ontology_revisions WHERE tenant_id='demo' AND revision=$1`,[oldRevision]);
    await db.query("UPDATE chausar_core.publications SET revision=revision+1 WHERE tenant_id='demo'");
  });
  const stale=await request(`/internal/investigations/${pinned.body.investigationId}/execute`,ctx.internalToken,{operationId:`${pinned.body.investigationId}/execute`});
  assert.equal(stale.status,409);assert.equal(stale.body.code,'investigation_definition_changed');
  const staleState=await request(`/v1/investigations/${pinned.body.investigationId}`);assert.equal(staleState.body.status,'failed');
  assert.equal(staleState.body.reason,'investigation_definition_changed');
  await mutate(db=>db.query("UPDATE chausar_core.publications SET revision=$1 WHERE tenant_id='demo'",[oldRevision]));
  pass('Changed published ontology blocks a queued plan instead of silently reinterpreting it');

  const expiringRequest=randomUUID();const expiring=await ask('A result with inherited retention',ctx.leaderToken,expiringRequest);
  assert.equal(expiring.status,201);const retained=await result(expiring.body.investigationId,ctx.leaderToken);assert.equal(retained.status,200);
  const lifetimes=(await pool.query(`SELECT r.expires_at<=m.expires_at AS inherited FROM chausar_core.retained_results r
    JOIN chausar_core.model_invocations m ON m.tenant_id=r.tenant_id AND m.investigation_id=r.task_id WHERE m.invocation_id=$1`,[expiring.body.invocationId])).rows[0];
  assert.equal(lifetimes.inherited,true);
  await policy('leader',{allowOntologyMetadata:false});
  assert.equal((await request(`/v1/results/${retained.body.resultId}`)).status,403);
  await policy('leader',{allowOntologyMetadata:true});
  pass('Saved model-derived answer inherits artifact lifetime and current policy revision');

  await mutate(async db=>{
    await db.query("UPDATE chausar_core.model_invocations SET created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE invocation_id=$1",[expiring.body.invocationId]);
    await db.query("UPDATE chausar_core.investigations SET input_expires_at=clock_timestamp()-interval '1 second' WHERE investigation_id=$1",[expiring.body.investigationId]);
    await db.query("UPDATE chausar_core.retained_results SET created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' WHERE result_id=$1",[retained.body.resultId]);
  });
  assert.equal((await request(`/v1/results/${retained.body.resultId}`)).status,404);
  assert.ok((await retireExpiredModelArtifacts(pool,'demo'))!>=1);count=fixture.received.length;
  assert.equal((await ask('A result with inherited retention',ctx.leaderToken,expiringRequest)).status,410);assert.equal(fixture.received.length,count);
  const erased=(await pool.query('SELECT state,payload_digest,request_digest,authority_digest FROM chausar_core.model_invocations WHERE invocation_id=$1',[expiring.body.invocationId])).rows[0];
  assert.deepEqual(erased,{state:'expired',payload_digest:'',request_digest:'',authority_digest:''});
  const erasedResult=(await pool.query('SELECT payload FROM chausar_core.retained_results WHERE result_id=$1',[retained.body.resultId])).rows[0];assert.equal(erasedResult.payload,null);
  pass('Expiry denies reads before sweep; maintenance erases content and preserves no-resend tombstone');

  const revokedBeforeRun=await ask('A question before source grant revocation');assert.equal(revokedBeforeRun.status,201);
  await mutate(db=>db.query("UPDATE chausar_core.grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE tenant_id='demo' AND grant_id='broad'"));
  const revokedExecution=await request(`/internal/investigations/${revokedBeforeRun.body.investigationId}/execute`,ctx.internalToken,{operationId:`${revokedBeforeRun.body.investigationId}/execute`});
  assert.equal(revokedExecution.status,403);
  await mutate(db=>db.query("UPDATE chausar_core.grants SET revoked_at=NULL,revision=revision+1 WHERE tenant_id='demo' AND grant_id='broad'"));
  const failed=await request(`/v1/investigations/${revokedBeforeRun.body.investigationId}`);assert.equal(failed.body.status,'failed');assert.equal(failed.body.reason,'authority_denied');assert.ok(!failed.body.resultId);
  pass('Source revocation before execution prevents a result and persists a terminal failure reason');

  fixture.setBehavior(async context=>({outcome:'execute',metricIds:['gross_inr','shipment_quantity','refund_inr'],regions:context.authorizedRegions,reason:'none'}));
  const finalExample=await ask('Show gross invoice value, shipped quantity and refunds for my authorized regions.');assert.equal(finalExample.status,201);
  const finalResult=await result(finalExample.body.investigationId,ctx.leaderToken);assert.equal(finalResult.status,200);
  assert.deepEqual(finalResult.body.metrics,{gross_inr:24700,shipment_quantity:20,refund_inr:75});assert.equal(finalResult.body.findings.length,3);
  fixture.setBehavior(undefined);pass('Final natural-language path returns all three supported calculations with evidence');
  return checks;
}
