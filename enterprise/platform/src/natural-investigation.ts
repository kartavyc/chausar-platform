import { createHmac, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { currentScope, lockTenant } from './authority.ts';
import { readableCatalog } from './ontology.ts';
import { ModelGateway, endpointSchema } from './model-gateway.ts';
import { clarificationText, validatePlan } from './planning.ts';
import { Denied, digest, metricBindings, subset, transaction } from './shared.ts';
import type { Identity } from './shared.ts';

export const questionSchema=z.object({requestId:z.string().min(1).max(120),question:z.string().trim().min(1).max(4000)}).strict();
const policySchema=z.object({
  datasetId:z.literal('invoices'),purpose:z.literal('profitability'),
  endpointRefs:z.array(z.string().min(1)).min(1).max(16),
  fields:z.array(z.string()).min(1),regions:z.array(z.string()).min(1),
  allowUnclassifiedQuestion:z.boolean(),allowOntologyMetadata:z.boolean(),
  executionLocation:z.literal('customer_deployment'),
  artifactClasses:z.array(z.enum(['planning_receipt','investigation_plan'])),
  endpointClasses:z.array(z.enum(['private','external'])).min(1),
  providerRetention:z.array(z.enum(['no_content_retention','reviewed_provider_policy'])).min(1),
  retentionSeconds:z.number().int().min(1).max(86400),expiresAt:z.string().datetime({offset:true}),
}).strict();

async function context(db:PoolClient,who:Identity) {
  await lockTenant(db,who.tenantId);
  const human=(await db.query("SELECT principal_id FROM chausar_core.principals WHERE tenant_id=$1 AND principal_id=$2 AND kind='human' AND active",[who.tenantId,who.principalId])).rows[0];
  if(!human)throw new Denied('authority_denied');
  const row=(await db.query(`SELECT p.revision,r.body FROM chausar_core.model_policies p
    JOIN chausar_core.model_policy_revisions r USING(tenant_id,principal_id,revision)
    WHERE p.tenant_id=$1 AND p.principal_id=$2 AND p.active`,[who.tenantId,who.principalId])).rows[0];
  const parsed=policySchema.safeParse(row?.body);
  if(!parsed.success)throw new Denied('model_disclosure_denied');
  const policy=parsed.data;
  const dbNow=Number((await db.query('SELECT extract(epoch from clock_timestamp())*1000 AS now')).rows[0].now);
  if(Date.parse(policy.expiresAt)<=dbNow||!policy.allowUnclassifiedQuestion||!policy.allowOntologyMetadata
    ||!subset(['planning_receipt','investigation_plan'],policy.artifactClasses))throw new Denied('model_disclosure_denied');
  const catalog=await readableCatalog(db,who);
  const metrics=catalog.metrics.filter(id=>subset([...metricBindings[id].fields],policy.fields));
  if(!metrics.length||!subset(['region','invoice_id'],policy.fields))throw new Denied('model_disclosure_denied');
  const scope=await currentScope(db,who,['read','model','retain','release'],metrics);
  // Never silently narrow the user's authorized population at disclosure time.
  if(!subset(scope.regions,policy.regions))throw new Denied('model_disclosure_denied');
  const endpointRef=policy.endpointRefs[0]!; // One explicit route. No hidden retry/fallback.
  const r=(await db.query('SELECT * FROM chausar_core.model_endpoint_revisions WHERE tenant_id=$1 AND endpoint_ref=$2',[who.tenantId,endpointRef])).rows[0];
  const endpoint=endpointSchema.safeParse(r?.body);
  if(!endpoint.success||r.content_hash!==digest(r.body))throw new Denied('no_eligible_endpoint',503);
  if(!policy.endpointClasses.includes(endpoint.data.classification)||!policy.providerRetention.includes(endpoint.data.providerRetention))throw new Denied('no_eligible_endpoint');
  const definition=catalog.definition;
  const authorityDigest=digest({scope,policyRevision:Number(row.revision),policy,endpointRef,endpoint:r.content_hash,
    definition:definition.content_hash,revision:Number(definition.revision),metrics});
  const ttl=Math.min(scope.retentionSeconds,policy.retentionSeconds,Math.floor((Date.parse(policy.expiresAt)-dbNow)/1000));
  if(ttl<1)throw new Denied('model_disclosure_denied');
  return {scope,metrics,definition,policyRevision:Number(row.revision),endpointRef,endpoint:endpoint.data,authorityDigest,ttl};
}

function replay(row:any,requestDigest:string,authorityDigest:string) {
  if(new Date(row.expires_at).getTime()<=Date.now()||row.state==='expired')throw new Denied('investigation_request_expired',410);
  if(row.request_digest!==requestDigest)throw new Denied('idempotency_conflict',409);
  if(row.authority_digest!==authorityDigest)throw new Denied('model_authority_changed');
  if(row.state==='accepted')return {status:'queued',investigationId:row.investigation_id,invocationId:row.invocation_id,duplicate:true};
  if(row.state==='clarify')return {status:'clarification_required',reason:row.reason,
    message:clarificationText[row.reason as keyof typeof clarificationText],invocationId:row.invocation_id,duplicate:true};
  if(row.state==='dispatched'||row.state==='outcome_unknown')throw new Denied('provider_outcome_unknown',409);
  throw new Denied('model_attempt_rejected',422);
}

/** Retained plans and answers inherit their contributing model-artifact policy. */
export async function authorizeModelArtifact(db:PoolClient,tenantId:string,invocationId:string) {
  const row=(await db.query(`SELECT m.expires_at FROM chausar_core.model_invocations m
    JOIN chausar_core.model_policies p ON p.tenant_id=m.tenant_id AND p.principal_id=m.principal_id AND p.revision=m.policy_revision
    WHERE m.tenant_id=$1 AND m.invocation_id=$2 AND m.state='accepted' AND p.active AND m.expires_at>clock_timestamp()`,[tenantId,invocationId])).rows[0];
  if(!row)throw new Denied('model_artifact_unavailable');
  return row.expires_at as Date;
}

/** Explicit customer-local maintenance entrypoint. Content expiry also fails closed before this sweep. */
export async function retireExpiredModelArtifacts(pool:Pool,tenantId:string) {
  return transaction(pool,async db=>{
    await db.query('SELECT tenant_id FROM chausar_core.tenants WHERE tenant_id=$1 FOR UPDATE',[tenantId]);
    await db.query(`UPDATE chausar_core.retained_results SET payload=NULL,retired_at=clock_timestamp(),retirement_reason='expired'
      WHERE tenant_id=$1 AND expires_at<=clock_timestamp() AND retired_at IS NULL`,[tenantId]);
    await db.query(`UPDATE chausar_core.investigations SET metric_ids=ARRAY[]::text[],query_regions=NULL,request_digest='',
      state=CASE WHEN state IN ('queued','running') THEN 'failed' ELSE state END
      WHERE tenant_id=$1 AND input_expires_at<=clock_timestamp()`,[tenantId]);
    await db.query(`UPDATE chausar_core.tasks t SET state='failed',lease_until=NULL,fence=fence+1
      FROM chausar_core.investigations i WHERE t.tenant_id=$1 AND i.tenant_id=t.tenant_id AND i.investigation_id=t.investigation_id
      AND i.input_expires_at<=clock_timestamp() AND t.state IN ('queued','running')`,[tenantId]);
    const r=await db.query(`UPDATE chausar_core.model_invocations SET state='expired',request_digest='',payload_digest='',authority_digest='',reason=NULL
      WHERE tenant_id=$1 AND expires_at<=clock_timestamp() AND state<>'expired'`,[tenantId]);
    return r.rowCount;
  });
}

/** A question is personal authority. Creating a company mandate is a different API. */
export async function investigateQuestion(pool:Pool,gateway:ModelGateway,who:Identity,raw:unknown) {
  const input=questionSchema.parse(raw);
  const protect=(value:string)=>createHmac('sha256',gateway.receiptKey).update(value).digest('hex');
  const requestDigest=protect(JSON.stringify({version:1,question:input.question}));
  const requestKey=protect(JSON.stringify({tenantId:who.tenantId,principalId:who.principalId,requestId:input.requestId}));
  const initial=await transaction(pool,async db=>{
    const c=await context(db,who);
    const old=(await db.query('SELECT * FROM chausar_core.model_invocations WHERE tenant_id=$1 AND principal_id=$2 AND request_id=$3',
      [who.tenantId,who.principalId,requestKey])).rows[0];
    return {c,old};
  });
  if(initial.old)return replay(initial.old,requestDigest,initial.c.authorityDigest);
  const c=initial.c;const invocationId=randomUUID();let recorded=false;
  const modelContext={question:input.question,definition:{id:c.definition.definition_id,revision:Number(c.definition.revision)},
    catalog:Object.fromEntries(c.metrics.map(id=>[id,c.definition.body.measures[id]])),authorizedRegions:c.scope.regions,
    coverage:'Current synchronized dataset only; company completeness not established'};
  const fresh=async(db:PoolClient)=>{
    const now=await context(db,who);
    if(now.authorityDigest!==c.authorityDigest)throw new Denied('model_authority_changed');return now;
  };
  try{
    const rawPlan=await gateway.plan(c.endpointRef,c.endpoint,modelContext,async exactBody=>{
      // A committed dispatch receipt precedes sending. Concurrent repeats cannot send twice.
      await transaction(pool,async db=>{
        await fresh(db);
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`model/${who.tenantId}/${who.principalId}/${requestKey}`]);
        const old=(await db.query('SELECT invocation_id FROM chausar_core.model_invocations WHERE tenant_id=$1 AND principal_id=$2 AND request_id=$3',
          [who.tenantId,who.principalId,requestKey])).rows[0];
        if(old)throw new Denied('model_request_in_progress',409);
        await db.query(`INSERT INTO chausar_core.model_invocations(tenant_id,invocation_id,principal_id,request_id,request_digest,
          endpoint_ref,payload_digest,authority_digest,policy_revision,state,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'dispatched',clock_timestamp()+($10::text||' seconds')::interval)`,
          [who.tenantId,invocationId,who.principalId,requestKey,requestDigest,c.endpointRef,protect(exactBody),c.authorityDigest,c.policyRevision,c.ttl]);
      });recorded=true;
      // Fresh dispatch authorization after receipt commit. No policy lock held while awaiting provider output.
      await transaction(pool,async db=>{await fresh(db);});
    });
    const plan=validatePlan(rawPlan,c.metrics,c.scope.regions);
    return await transaction(pool,async db=>{
      await fresh(db);
      const attempt=(await db.query('SELECT * FROM chausar_core.model_invocations WHERE tenant_id=$1 AND invocation_id=$2 FOR UPDATE',[who.tenantId,invocationId])).rows[0];
      if(attempt.state!=='dispatched'||new Date(attempt.expires_at).getTime()<=Date.now())throw new Denied('model_attempt_expired',410);
      if(plan.outcome==='clarify'){
        await db.query("UPDATE chausar_core.model_invocations SET state='clarify',reason=$3,finished_at=clock_timestamp() WHERE tenant_id=$1 AND invocation_id=$2",[who.tenantId,invocationId,plan.reason]);
        return {status:'clarification_required',reason:plan.reason,message:clarificationText[plan.reason],invocationId,duplicate:false};
      }
      await currentScope(db,who,['read','retain','release'],plan.metricIds,c.scope.grantId);
      const investigationId=randomUUID();
      await db.query(`INSERT INTO chausar_core.investigations(tenant_id,investigation_id,principal_id,grant_id,purpose,
        state,requested_by,request_id,metric_ids,request_digest,query_regions,definition_revision,model_invocation_id,input_expires_at)
        VALUES($1,$2,$3,$4,'profitability','queued',$3,$5,$6,$7,$8,$9,$10,$11)`,
        [who.tenantId,investigationId,who.principalId,c.scope.grantId,`model:${invocationId}`,plan.metricIds,requestDigest,plan.regions,c.definition.revision,invocationId,attempt.expires_at]);
      await db.query("INSERT INTO chausar_core.tasks(tenant_id,task_id,investigation_id,state) VALUES($1,$2,$2,'queued')",[who.tenantId,investigationId]);
      await db.query('INSERT INTO chausar_core.work_outbox(tenant_id,investigation_id) VALUES($1,$2)',[who.tenantId,investigationId]);
      await db.query("UPDATE chausar_core.model_invocations SET state='accepted',investigation_id=$3,finished_at=clock_timestamp() WHERE tenant_id=$1 AND invocation_id=$2",[who.tenantId,invocationId,investigationId]);
      return {status:'queued',investigationId,invocationId,duplicate:false};
    });
  }catch(error){
    if(recorded){
      // Content-free terminal receipt; a database failure leaves dispatched/uncertain,
      // which also prohibits implicit replay. Never save raw provider exceptions.
      const unknown=error instanceof Denied&&error.code==='provider_outcome_unknown';
      await pool.query("UPDATE chausar_core.model_invocations SET state=$3,reason=$4,finished_at=clock_timestamp() WHERE tenant_id=$1 AND invocation_id=$2 AND state='dispatched'",
        [who.tenantId,invocationId,unknown?'outcome_unknown':'rejected',error instanceof Denied?error.code:'model_attempt_failed']);
    }
    throw error;
  }
}
