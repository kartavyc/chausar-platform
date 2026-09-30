import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Pool } from 'pg';
import type { Server } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { currentScope, lockTenant, mandateAuthority } from './authority.ts';
import { Denied, digest, metricBindings, subset, transaction } from './shared.ts';
import type { Identity, MetricId } from './shared.ts';
import type { CubeAdapter } from './cube.ts';
import { checkDefinition, readableCatalog } from './ontology.ts';
import { metricFindings } from './planning.ts';
import { investigateQuestion, authorizeModelArtifact } from './natural-investigation.ts';
import type { ModelGateway } from './model-gateway.ts';

const metricSchema=z.enum(['gross_inr','shipment_quantity','refund_inr']);
const createSchema=z.object({mandateId:z.string().min(1).max(120),metricIds:z.array(metricSchema).min(1).max(3),requestId:z.string().min(1).max(120)}).strict();
const executeSchema=z.object({operationId:z.string().min(1).max(240)}).strict();
const hashToken=(s:string)=>createHash('sha256').update(s).digest('hex');
type AuthEntry=Identity & {token:string};
type Handler=(req:Request,res:Response)=>Promise<void>;
const wrap=(handler:Handler)=>(req:Request,res:Response,next:NextFunction)=>{handler(req,res).catch(next);};

export async function startCore(options:{pool:Pool;cube:CubeAdapter;identities:AuthEntry[];internalToken:string;tenantId:string;port?:number;gateway?:ModelGateway}) {
  const {pool,cube}=options;
  const identityRegistry=new Map(options.identities.map(({token,...id})=>[hashToken(token),id]));
  const internalDigest=Buffer.from(hashToken(options.internalToken),'hex');
  const identity=(req:Request):Identity=>{const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];const found=token?identityRegistry.get(hashToken(token)):null;if(!found)throw new Denied('authentication_required',401);return found;};
  const app=express();app.disable('x-powered-by');app.use(express.json({limit:'32kb'}));

  app.get('/v1/ontology',wrap(async(req,res)=>{
    const who=identity(req);const result=await transaction(pool,async db=>{
      const {definition:p,metrics}=await readableCatalog(db,who);
      return {definitionId:p.definition_id,revision:Number(p.revision),metrics:Object.fromEntries(metrics.map(id=>[id,p.body.measures[id]]))};
    });res.json(result);
  }));

  app.post('/v1/investigations/question',wrap(async(req,res)=>{
    const who=identity(req);
    if(!options.gateway)throw new Denied('model_gateway_unconfigured',503);
    const result=await investigateQuestion(pool,options.gateway,who,req.body);
    res.status(result.status==='queued'&&!result.duplicate?201:200).json(result);
  }));

  app.post('/v1/investigations',wrap(async(req,res)=>{
    const who=identity(req);const input=createSchema.parse(req.body);const metrics=[...new Set(input.metricIds)].sort() as MetricId[];
    const created=await transaction(pool,async db=>{
      await currentScope(db,who,['read'],metrics);await checkDefinition(db,who.tenantId,metrics);
      const {mandate,owners}=await mandateAuthority(db,who.tenantId,input.mandateId);
      if(!owners.includes(who.principalId))throw new Denied('authority_denied');
      const requestDigest=digest({mandateId:input.mandateId,metricIds:metrics});
      // Serialize one principal/request pair without inventing an agent workflow scheduler.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`${who.tenantId}/${who.principalId}/${input.requestId}`]);
      const old=(await db.query('SELECT investigation_id,request_digest FROM chausar_core.investigations WHERE tenant_id=$1 AND requested_by=$2 AND request_id=$3',[who.tenantId,who.principalId,input.requestId])).rows[0];
      if(old){if(old.request_digest!==requestDigest)throw new Denied('idempotency_conflict',409);return {investigationId:old.investigation_id,duplicate:true};}
      const investigationId=randomUUID();
      await db.query(`INSERT INTO chausar_core.investigations(tenant_id,investigation_id,principal_id,grant_id,purpose,mandate_id,state,requested_by,request_id,metric_ids,request_digest)
        VALUES($1,$2,$3,$4,'profitability',$5,'queued',$6,$7,$8,$9)`,[who.tenantId,investigationId,mandate.principal_id,mandate.grant_id,input.mandateId,who.principalId,input.requestId,metrics,requestDigest]);
      await db.query("INSERT INTO chausar_core.tasks(tenant_id,task_id,investigation_id,state) VALUES($1,$2,$2,'queued')",[who.tenantId,investigationId]);
      await db.query('INSERT INTO chausar_core.work_outbox(tenant_id,investigation_id) VALUES($1,$2)',[who.tenantId,investigationId]);
      return {investigationId,duplicate:false};
    });res.status(created.duplicate?200:201).json(created);
  }));

  app.get('/v1/investigations/:id',wrap(async(req,res)=>{
    const who=identity(req);const result=await transaction(pool,async db=>{
      await lockTenant(db,who.tenantId);
      const i=(await db.query('SELECT * FROM chausar_core.investigations WHERE tenant_id=$1 AND investigation_id=$2',[who.tenantId,req.params.id])).rows[0];
      if(!i)throw new Denied('not_found',404);
      await currentScope(db,who,['read'],i.metric_ids);
      if(i.requested_by!==who.principalId)throw new Denied('authority_denied');
      const r=(await db.query('SELECT result_id FROM chausar_core.retained_results WHERE tenant_id=$1 AND task_id=$2 AND retired_at IS NULL',[who.tenantId,i.investigation_id])).rows[0];
      return {investigationId:i.investigation_id,status:i.state,...(i.failure_code?{reason:i.failure_code}:{}),...(r?{resultId:r.result_id}:{})};
    });res.json(result);
  }));

  app.get('/v1/results/:id',wrap(async(req,res)=>{
    const who=identity(req);const data=await transaction(pool,async db=>{
      await lockTenant(db,who.tenantId);
      const saved=(await db.query(`SELECT r.*,b.dataset_id,b.source_revision,b.grant_id,b.grant_revision,b.policy_id,b.policy_revision,b.fields,b.regions,
        i.metric_ids,i.principal_id,i.model_invocation_id FROM chausar_core.retained_results r JOIN chausar_core.result_bindings b USING(tenant_id,result_id)
        JOIN chausar_core.tasks t ON t.tenant_id=r.tenant_id AND t.task_id=r.task_id
        JOIN chausar_core.investigations i ON i.tenant_id=t.tenant_id AND i.investigation_id=t.investigation_id
        WHERE r.tenant_id=$1 AND r.result_id=$2 AND r.retired_at IS NULL AND r.expires_at>clock_timestamp()`,[who.tenantId,req.params.id])).rows;
      if(saved.length!==1)throw new Denied('not_found',404);
      const r=saved[0];const viewer=await currentScope(db,who,['release'],r.metric_ids);
      if(r.model_invocation_id)await authorizeModelArtifact(db,who.tenantId,r.model_invocation_id);
      const source=await currentScope(db,{tenantId:who.tenantId,principalId:r.principal_id},['release'],r.metric_ids,r.grant_id);
      if(!subset(r.regions,viewer.regions)||!subset(r.fields,viewer.fields)||!subset(r.regions,source.regions)||!subset(r.fields,source.fields)
        ||source.policyRevision!==Number(r.policy_revision)||source.grantRevision!==Number(r.grant_revision))throw new Denied('authority_denied');
      // A narrowed/changed source policy invalidates the retained answer. Viewer grants
      // are re-evaluated independently and do not inherit the company agent's scope.
      return {resultId:r.result_id,...r.payload};
    });res.json(data);
  }));

  app.post('/internal/investigations/:id/execute',wrap(async(req,res)=>{
    const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]??'';
    if(!timingSafeEqual(internalDigest,Buffer.from(hashToken(token),'hex')))throw new Denied('authentication_required',401);
    const {operationId}=executeSchema.parse(req.body);
    if(operationId!==`${req.params.id}/execute`)throw new Denied('operation_identity_mismatch',409);
    const outcome=await transaction(pool,async db=>{
      const tenant=options.tenantId;await lockTenant(db,tenant);
      const task=(await db.query('SELECT * FROM chausar_core.tasks WHERE tenant_id=$1 AND task_id=$2 FOR UPDATE',[tenant,req.params.id])).rows[0];
      const i=(await db.query('SELECT * FROM chausar_core.investigations WHERE tenant_id=$1 AND investigation_id=$2',[tenant,req.params.id])).rows[0];
      if(!task||!i||['cancelled','failed'].includes(i.state))throw new Denied('authority_denied');
      if(i.mandate_id){
        const {mandate,owners}=await mandateAuthority(db,tenant,i.mandate_id);
        if(!owners.length){await db.query("UPDATE chausar_core.mandates SET state='suspended_owner' WHERE tenant_id=$1 AND mandate_id=$2",[tenant,i.mandate_id]);return {status:'owner_missing' as const};}
        if(i.principal_id!==mandate.principal_id||i.grant_id!==mandate.grant_id)throw new Denied('authority_denied');
      }else if(i.principal_id!==i.requested_by||!i.model_invocation_id)throw new Denied('authority_denied');
      const scope=await currentScope(db,{tenantId:tenant,principalId:i.principal_id},['read','retain','release'],i.metric_ids,i.grant_id);
      if(i.query_regions){
        if(!i.query_regions.length||!subset(i.query_regions,scope.regions))throw new Denied('authority_denied');
        scope.regions=i.query_regions;
      }
      if(task.state==='succeeded'){
        const r=(await db.query('SELECT result_id FROM chausar_core.retained_results WHERE tenant_id=$1 AND task_id=$2',[tenant,i.investigation_id])).rows[0];
        if(!r)throw new Denied('result_state_conflict',409);
        return {status:'completed' as const,resultId:r.result_id,revision:Number(i.revision)};
      }
      if(task.state!=='queued')throw new Denied('task_state_conflict',409);
      const definition=await checkDefinition(db,tenant,i.metric_ids);
      if(i.model_invocation_id)await authorizeModelArtifact(db,tenant,i.model_invocation_id);
      if(i.definition_revision&&Number(i.definition_revision)!==Number(definition.revision))throw new Denied('investigation_definition_changed',409);
      if(i.input_expires_at&&new Date(i.input_expires_at).getTime()<=Date.now())throw new Denied('investigation_plan_expired',410);
      const fence=Number(task.fence)+1;
      await db.query("UPDATE chausar_core.tasks SET state='running',fence=$3,lease_until=clock_timestamp()+interval '60 seconds',revision=revision+1 WHERE tenant_id=$1 AND task_id=$2",[tenant,i.investigation_id,fence]);
      const metrics=await cube.query(scope,i.metric_ids,`${definition.definition_id}@${definition.revision}:${definition.content_hash}`);
      // Locks serialize policy changes, but expiry still advances with the clock.
      // Recheck after analytical work, immediately before the result commit.
      await currentScope(db,{tenantId:tenant,principalId:i.principal_id},['read','retain','release'],i.metric_ids,i.grant_id);
      if(i.model_invocation_id)await authorizeModelArtifact(db,tenant,i.model_invocation_id);
      const resultId=randomUUID();const fields=[...new Set((i.metric_ids as MetricId[]).flatMap(id=>[...metricBindings[id].fields]))];
      const payload={metrics,findings:metricFindings(metrics),evidence:{definitionId:definition.definition_id,definitionRevision:Number(definition.revision),sourceRevision:scope.sourceRevision,scopeRegions:scope.regions,
        metricIds:i.metric_ids,method:'registered_cube_profile_v1',limitations:['Synthetic connected source fixture; no claim of complete company coverage']}};
      await db.query(`INSERT INTO chausar_core.retained_results(tenant_id,result_id,task_id,task_fence,definition_id,policy_epoch,definition_revision,payload,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,LEAST(clock_timestamp()+($9::text||' seconds')::interval,$10::timestamptz))`,[tenant,resultId,i.investigation_id,fence,definition.definition_id,scope.policyEpoch,definition.revision,payload,scope.retentionSeconds,i.input_expires_at??null]);
      await db.query(`INSERT INTO chausar_core.result_bindings(tenant_id,result_id,dataset_id,source_revision,grant_id,grant_revision,policy_id,policy_revision,fields,regions)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[tenant,resultId,scope.datasetId,scope.sourceRevision,scope.grantId,scope.grantRevision,scope.policyId,scope.policyRevision,fields,scope.regions]);
      const updated=await db.query("UPDATE chausar_core.tasks SET state='succeeded',lease_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND task_id=$2 AND fence=$3 AND state='running' AND lease_until>clock_timestamp()",[tenant,i.investigation_id,fence]);
      if(updated.rowCount!==1)throw new Denied('stale_attempt',409);
      await db.query("UPDATE chausar_core.investigations SET state='completed' WHERE tenant_id=$1 AND investigation_id=$2",[tenant,i.investigation_id]);
      await db.query("UPDATE chausar_core.mandates SET state='active' WHERE tenant_id=$1 AND mandate_id=$2 AND state='suspended_owner'",[tenant,i.mandate_id]);
      return {status:'completed' as const,resultId,revision:Number(i.revision)};
    }).catch(async(error:unknown)=>{
      if(error instanceof Denied&&['authority_denied','model_artifact_unavailable','investigation_definition_changed','investigation_plan_expired','analytical_result_incomplete'].includes(error.code)){
        // A terminal refusal must not leave a personal question appearing queued forever.
        // Owner suspension uses the separate successful owner_missing outcome above.
        await transaction(pool,async db=>{
          await db.query('SELECT tenant_id FROM chausar_core.tenants WHERE tenant_id=$1 FOR SHARE',[options.tenantId]);
          const r=await db.query("UPDATE chausar_core.tasks SET state='failed',revision=revision+1,fence=fence+1,lease_until=NULL WHERE tenant_id=$1 AND task_id=$2 AND state='queued'",[options.tenantId,req.params.id]);
          if(r.rowCount)await db.query("UPDATE chausar_core.investigations SET state='failed',failure_code=$3 WHERE tenant_id=$1 AND investigation_id=$2 AND state='queued'",[options.tenantId,req.params.id,error.code]);
        });
      }
      throw error;
    });if(outcome.status==='owner_missing'){res.status(409).json({code:'owner_missing'});return;}res.json(outcome);
  }));
  app.use((error:unknown,_req:Request,res:Response,_next:NextFunction)=>{
    if(error instanceof Denied){res.status(error.status).json({code:error.code});return;}
    if(error instanceof z.ZodError){res.status(400).json({code:'invalid_request'});return;}
    // Only sanitized type is returned. Raw source values, SQL and tokens are not logged.
    res.status(500).json({code:'internal_error'});
  });
  const server=await new Promise<Server>(resolve=>{const s=app.listen(options.port??0,'127.0.0.1',()=>resolve(s));});
  const address=server.address();if(!address||typeof address==='string')throw Error('Core address unavailable');
  return {url:`http://127.0.0.1:${address.port}`,stop:()=>new Promise<void>(r=>server.close(()=>r()))};
}
