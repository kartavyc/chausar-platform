import type { PoolClient } from 'pg';
import { currentScope } from './authority.ts';
import { Denied, digest, metricBindings } from './shared.ts';
import type { Identity, MetricId } from './shared.ts';

export async function publication(db:PoolClient,tenant:string) {
  const r=(await db.query(`SELECT r.*,p.generation FROM chausar_core.publications p JOIN chausar_core.ontology_revisions r USING(tenant_id,definition_id,revision)
    WHERE p.tenant_id=$1 AND p.definition_id='invoice-metrics' AND p.active`,[tenant])).rows[0];
  if(!r||r.content_hash!==digest(r.body))throw new Denied('definition_unavailable',503);
  return r;
}
export async function checkDefinition(db:PoolClient,tenant:string,metrics:MetricId[]) {
  const p=await publication(db,tenant);
  if(p.body.dataset!=='invoices')throw new Denied('unsupported_definition',422);
  for(const id of metrics){const definition=p.body.measures?.[id];const binding=metricBindings[id];
    if(!definition||!Array.isArray(definition.fields)||definition.method!==binding.method||definition.unit!==binding.unit
      ||digest([...definition.fields].sort())!==digest([...binding.fields].sort()))throw new Denied('unsupported_metric',422);}
  return p;
}
export async function readableCatalog(db:PoolClient,who:Identity) {
  const metrics:MetricId[]=[];
  for(const id of Object.keys(metricBindings) as MetricId[]){
    try{await currentScope(db,who,['read'],[id]);metrics.push(id);}
    catch(error){if(!(error instanceof Denied))throw error;}
  }
  if(!metrics.length)throw new Denied('authority_denied');
  return {metrics,definition:await checkDefinition(db,who.tenantId,metrics)};
}
