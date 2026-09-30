import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { digest, metricBindings, transaction, Denied } from './shared.ts';

export const supportedDefinition={dataset:'invoices',measures:Object.fromEntries(Object.entries(metricBindings).map(([id,b])=>[id,{fields:[...b.fields],method:b.method,unit:b.unit}]))};
export async function validateDefinition(python:string,body:unknown) {
  const path=fileURLToPath(new URL('../analytics/validate_definition.py',import.meta.url));
  return new Promise<void>((resolve,reject)=>{
    const child=spawn(python,[path],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let out='';let size=0;const timer=setTimeout(()=>{child.kill();reject(new Denied('definition_validation_timeout',503));},10000);
    child.stdout.on('data',data=>{size+=data.length;if(size>16384){child.kill();return;}out+=data;});
    child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Denied('definition_validator_unavailable',503));});
    child.on('exit',code=>{clearTimeout(timer);try{if(code===0&&JSON.parse(out).valid===true){resolve();return;}}catch{}reject(new Denied('unsupported_definition',422));});
    child.stdin.end(JSON.stringify(body));
  });
}
/** Internal trusted publication entrypoint; no public administration API yet. */
export async function publishSupportedDefinition(pool:Pool,python:string,tenant:string,publisher:string,body:unknown=supportedDefinition) {
  await validateDefinition(python,body);
  return transaction(pool,async db=>{
    await db.query('SELECT tenant_id FROM chausar_core.tenants WHERE tenant_id=$1 AND active FOR UPDATE',[tenant]);
    const valid=(await db.query("SELECT principal_id FROM chausar_core.principals WHERE tenant_id=$1 AND principal_id=$2 AND active AND kind='human' AND capabilities @> ARRAY['publish_ontology']::text[]",[tenant,publisher])).rows[0];
    if(!valid)throw new Denied('publisher_inactive');
    const revision=Number((await db.query("SELECT coalesce(max(revision),0)+1 AS revision FROM chausar_core.ontology_revisions WHERE tenant_id=$1 AND definition_id='invoice-metrics'",[tenant])).rows[0].revision);
    await db.query("INSERT INTO chausar_core.ontology_revisions(tenant_id,definition_id,revision,body,content_hash,published_by) VALUES($1,'invoice-metrics',$2,$3,$4,$5)",[tenant,revision,body,digest(body),publisher]);
    await db.query("INSERT INTO chausar_core.publications(tenant_id,definition_id,revision) VALUES($1,'invoice-metrics',$2) ON CONFLICT(tenant_id,definition_id) DO UPDATE SET revision=EXCLUDED.revision,generation=chausar_core.publications.generation+1",[tenant,revision]);
    return revision;
  });
}
