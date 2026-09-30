import { readFileSync,writeFileSync,mkdirSync,openSync,closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash,randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { CubeAdapter } from '../src/cube.ts';
import { startCore } from '../src/core.ts';
import { dispatchPending } from '../src/dispatcher.ts';
import { publishSupportedDefinition,supportedDefinition } from '../src/publication.ts';
import { transaction } from '../src/shared.ts';
import { verifyConnected } from './verify-connected.ts';
import { ModelGateway } from '../src/model-gateway.ts';
import { startModelFixture } from './model-fixture.ts';
import { installModelFixtures,verifyModelConnected } from './verify-model-connected.ts';

const base=fileURLToPath(new URL('..',import.meta.url));
const local=path.join(base,'.local');const evidence=path.join(base,'evidence');mkdirSync(local,{recursive:true});mkdirSync(evidence,{recursive:true});
const python=process.env.CHAUSAR_PYTHON??'python3';
const runId=Date.now().toString();
const secrets=Array.from({length:6},()=>randomBytes(24).toString('hex'));
const [adminPassword,corePassword,readerPassword,leaderToken,regionalToken,internalToken]=secrets;
const hash=(file:string)=>createHash('sha256').update(readFileSync(file)).digest('hex');
let worker:ChildProcess|undefined,temporal:TestWorkflowEnvironment|undefined;
let admin:pg.Pool|undefined,pool:pg.Pool|undefined,core:Awaited<ReturnType<typeof startCore>>|undefined,cube:CubeAdapter|undefined;
let workerLog:number|undefined;let checks:unknown[]=[];let phase='setup';let successful=false;
let modelFixture:Awaited<ReturnType<typeof startModelFixture>>|undefined;
const cleanup:Record<string,boolean>={};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function terminate(child:ChildProcess|undefined){if(child&&child.exitCode===null){const stopped=new Promise<void>(r=>child!.once('exit',()=>r()));child.kill('SIGKILL');await Promise.race([stopped,delay(5000)]);}}
function sanitize(error:unknown){let message=error instanceof Error?error.message:String(error);for(const secret of secrets)message=message.replaceAll(secret,'[redacted]');return message;}
async function mutate(fn:(db:pg.PoolClient)=>Promise<void>){await transaction(pool!,async db=>{await db.query("SELECT tenant_id FROM chausar_core.tenants WHERE tenant_id='demo' FOR UPDATE");await fn(db);await db.query("UPDATE chausar_core.tenants SET policy_epoch=policy_epoch+1 WHERE tenant_id='demo'");});}
try {
  // The caller provisions and removes a dedicated disposable PostgreSQL service.
  // No Docker socket, local research binaries or company database credentials enter this process.
  assert.equal(process.env.CHAUSAR_TEST_DATABASE_DISPOSABLE,'1','Use the disposable development test service');
  const databaseUrl=new URL(process.env.CHAUSAR_TEST_DATABASE_URL??'');
  assert.ok(['postgres:','postgresql:'].includes(databaseUrl.protocol),'Use a PostgreSQL test connection');
  assert.ok(['127.0.0.1','::1','[::1]','localhost'].includes(databaseUrl.hostname),'Tests only use an explicit loopback disposable service');
  assert.equal(databaseUrl.pathname,'/chausar_test','Tests only use the dedicated chausar_test database');
  const dbConfig={host:databaseUrl.hostname,port:Number(databaseUrl.port||5432),database:'chausar_test'};
  admin=new pg.Pool({...dbConfig,user:decodeURIComponent(databaseUrl.username),password:decodeURIComponent(databaseUrl.password),connectionTimeoutMillis:1500});
  for(let attempt=0;;attempt++){try{await admin.query('SELECT 1');break;}catch(error){if(attempt>=30)throw error;await delay(500);}}
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name IN ('chausar_core','chausar_source')")).rows[0].n,0,'Refusing to reuse a populated test database');
  phase='database schema and publication';
  await admin.query(readFileSync(path.join(base,'storage/schema.sql'),'utf8'));await admin.query(readFileSync(path.join(base,'storage/seed.sql'),'utf8'));
  // Random local test passwords contain hex only. Roles are confined to this new database/container.
  await admin.query(`CREATE ROLE chausar_core_app LOGIN PASSWORD '${corePassword}'; CREATE ROLE chausar_source_reader LOGIN PASSWORD '${readerPassword}';
    GRANT USAGE ON SCHEMA chausar_core TO chausar_core_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA chausar_core TO chausar_core_app;
    GRANT USAGE ON SCHEMA chausar_source TO chausar_source_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA chausar_source TO chausar_source_reader;`);
  pool=new pg.Pool({...dbConfig,user:'chausar_core_app',password:corePassword,max:8});
  await publishSupportedDefinition(pool,python,'demo','owner');
  await assert.rejects(()=>publishSupportedDefinition(pool!,python,'demo','leader'));
  const wrong=structuredClone(supportedDefinition);(wrong.measures.gross_inr as any).method='arbitrary_formula';
  await assert.rejects(()=>publishSupportedDefinition(pool!,python,'demo','owner',wrong));
  checks.push({name:'publication validates semantic profile and specialist capability',passed:true});
  phase='Cube and core services';
  cube=new CubeAdapter();await cube.start({...dbConfig,user:'chausar_source_reader',password:readerPassword});
  modelFixture=await startModelFixture();
  const receiptKey=randomBytes(32).toString('hex');
  const gateway=new ModelGateway({credentials:{'private-chat@1':'synthetic-key','external-responses@1':'synthetic-key'},receiptKey,allowLoopbackHttp:true});
  core=await startCore({pool,cube,gateway,tenantId:'demo',internalToken,identities:[{tenantId:'demo',principalId:'leader',token:leaderToken},{tenantId:'demo',principalId:'north-leader',token:regionalToken}]});
  phase='Temporal startup';
  temporal=await TestWorkflowEnvironment.createLocal({server:{ip:'127.0.0.1',ui:false,dbFilename:path.join(local,`temporal-${runId}.sqlite`),executable:{type:'existing-path',path:process.env.CHAUSAR_TEMPORAL_CLI??'/usr/local/bin/temporal'}}});
  workerLog=openSync(path.join(evidence,'worker.log'),'w');
  worker=fork(path.join(base,'src/runtime-worker.ts'),[],{env:{...process.env,CHAUSAR_CORE_URL:core.url,CHAUSAR_INTERNAL_SERVICE_TOKEN:internalToken,
    TEMPORAL_ADDRESS:temporal.connection.options.address,TEMPORAL_TASK_QUEUE:'chausar-connected'},stdio:['ignore',workerLog,workerLog,'ipc'],windowsHide:true} as import('node:child_process').ForkOptions & {windowsHide:boolean});
  await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Worker readiness timeout')),45000);
    worker!.once('message',message=>{clearTimeout(timeout);if((message as any).type==='ready')resolve();else reject(Error('Worker failed'));});
    worker!.once('exit',()=>{clearTimeout(timeout);reject(Error('Worker exited before ready'));});});
  phase='connected acceptance';
  checks.push(...await verifyConnected({baseUrl:core.url,leaderToken,regionalToken,db:pool,
    createWorkflow:()=>dispatchPending(pool!,temporal!.client,'chausar-connected','demo'),
    signalOwnerAssigned:id=>temporal!.client.workflow.getHandle(id).signal('ownerAssigned'),
    queryWorkflow:id=>temporal!.client.workflow.getHandle(id).query('state'),
    isWaitingForOwner:state=>(state as any).phase==='waiting-owner',timeoutMs:60000,
    fixtures:{
      removeMandateOwners:()=>mutate(async db=>{await db.query("UPDATE chausar_core.mandate_owners SET active=false WHERE tenant_id='demo' AND mandate_id='watch-profit'");}),
      assignReplacementOwner:()=>mutate(async db=>{await db.query("UPDATE chausar_core.mandate_owners SET active=true WHERE tenant_id='demo' AND mandate_id='watch-profit' AND owner_id='leader'");}),
      revokeLeaderGrant:()=>mutate(async db=>{await db.query("UPDATE chausar_core.grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE tenant_id='demo' AND grant_id='broad'");}),
      restore:()=>mutate(async db=>{await db.query("UPDATE chausar_core.mandate_owners SET active=true WHERE tenant_id='demo' AND mandate_id='watch-profit'; UPDATE chausar_core.grants SET revoked_at=NULL,revision=revision+1 WHERE tenant_id='demo' AND grant_id='broad'");})
    }}));
  // Re-delivery after workflow completion must not start another run or result.
  const completed=(await pool.query("SELECT investigation_id FROM chausar_core.investigations WHERE tenant_id='demo' AND state='completed' ORDER BY investigation_id LIMIT 1")).rows[0].investigation_id;
  const before=(await pool.query("SELECT count(*)::int AS n FROM chausar_core.retained_results WHERE tenant_id='demo'")).rows[0].n;
  await pool.query("UPDATE chausar_core.work_outbox SET dispatched_at=NULL WHERE tenant_id='demo' AND investigation_id=$1",[completed]);
  await dispatchPending(pool,temporal.client,'chausar-connected','demo');
  const after=(await pool.query("SELECT count(*)::int AS n FROM chausar_core.retained_results WHERE tenant_id='demo'")).rows[0].n;assert.equal(after,before);
  checks.push({name:'outbox redelivery after completion preserves one workflow identity and result',passed:true});
  phase='model gateway and natural-language acceptance';
  await installModelFixtures(pool,modelFixture);
  checks.push(...await verifyModelConnected({pool,fixture:modelFixture,baseUrl:core.url,leaderToken,regionalToken,internalToken,receiptKey,
    dispatch:()=>dispatchPending(pool!,temporal!.client,'chausar-connected','demo')}));
  const sample=(await pool.query("SELECT result_id,payload FROM chausar_core.retained_results WHERE tenant_id='demo' AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1")).rows[0];
  writeFileSync(path.join(evidence,'sample-result.json'),JSON.stringify(sample,null,2));
  const counts=await pool.query("SELECT (SELECT count(*) FROM chausar_core.investigations) AS investigations,(SELECT count(*) FROM chausar_core.retained_results) AS results");
  writeFileSync(path.join(evidence,'database-counts.json'),JSON.stringify(counts.rows[0],null,2));
  writeFileSync(path.join(evidence,'model-receipt-summary.json'),JSON.stringify((await pool.query("SELECT endpoint_ref,state,count(*)::int AS count FROM chausar_core.model_invocations GROUP BY endpoint_ref,state ORDER BY endpoint_ref,state")).rows,null,2));
  const sourceFiles=['src/core.ts','src/authority.ts','src/shared.ts','src/ontology.ts','src/model-gateway.ts','src/natural-investigation.ts','src/planning.ts','storage/schema.sql','scripts/verify-model-connected.ts','scripts/run-connected.ts','package-lock.json'];
  writeFileSync(path.join(evidence,'implementation-hashes.json'),JSON.stringify(Object.fromEntries(sourceFiles.map(file=>[file,hash(path.join(base,file))])),null,2));
  writeFileSync(path.join(evidence,'workflow-history.json'),JSON.stringify(await temporal.client.workflow.getHandle(completed).fetchHistory(),null,2));
  successful=true;
} catch(error) {writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({phase,error:sanitize(error),checks},null,2));console.error(`Connected verification failed during ${phase}: ${sanitize(error)}`);process.exitCode=1;}
finally {
  try{await terminate(worker);cleanup.worker=true;}catch{cleanup.worker=false;}
  if(workerLog!==undefined)closeSync(workerLog);
  try{if(temporal)await temporal.teardown();cleanup.temporal=true;}catch{cleanup.temporal=false;}
  try{if(core)await core.stop();if(cube)await cube.stop();cleanup.http=true;}catch{cleanup.http=false;}
  try{await modelFixture?.stop();cleanup.modelFixture=true;}catch{cleanup.modelFixture=false;}
  try{await pool?.end();await admin?.end();cleanup.databaseClients=true;}catch{cleanup.databaseClients=false;}
  writeFileSync(path.join(evidence,'results.json'),JSON.stringify({executedAt:new Date().toISOString(),successful,checks,cleanup,
    runtime:{node:process.version,cube:'1.7.29',temporalSdk:'1.13.2',temporalCli:'1.8.3',openaiSdk:'7.15.0',databaseLifecycle:'Caller-owned disposable PostgreSQL service'},
    limitations:['Local integration credentials, not enterprise identity','Fixed registered semantic profile, not full ontology language','Instrumented synthetic HTTP model responses, no real LLM or external provider calls','Temporal development SQLite, Cube in-memory cache, no production topology','No customer systems or data']},null,2));
  console.log(JSON.stringify({successful,checks:checks.length,cleanup}));
}
// Evaluation-only entrypoint: Cube/SDK background timers can keep Node alive after
// their shutdown APIs and all owned services have closed. Do not leave a runner behind.
process.exit(successful&&Object.values(cleanup).every(Boolean)?0:1);
