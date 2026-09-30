import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import { Denied, digest, metricBindings } from './shared.ts';
import type { MetricId, Scope } from './shared.ts';
const require=createRequire(import.meta.url);

export class CubeAdapter {
  private tokens=new Map<string,{scope:Scope;expires:number}>();
  private core: any;
  private server?:Server;
  private url='';
  async start(dbConfig: Record<string,unknown>, port=0):Promise<void> {
    process.env.NODE_ENV='production';process.env.CUBEJS_DEV_MODE='false';process.env.CUBEJS_TELEMETRY='false';process.env.CUBEJS_DB_TYPE='postgres';
    const Core=require('@cubejs-backend/server-core').default;
    const Driver=require('@cubejs-backend/postgres-driver').default;
    const key=(c:any)=>'scope_'+digest(c.securityContext);
    this.core=new Core({apiSecret:randomBytes(32).toString('hex'),telemetry:false,scheduledRefreshTimer:false,cacheAndQueueDriver:'memory',
      contextToAppId:key,contextToOrchestratorId:key,driverFactory:()=>new Driver(dbConfig),logger:()=>{},
      checkAuth:async(req:any,token:string)=>{const record=this.tokens.get(token);if(!record||record.expires<Date.now())throw Error('Denied');req.securityContext=record.scope;},
      repositoryFactory:({securityContext}:{securityContext:Scope})=>({dataSchemaFiles:async()=>[{fileName:'business.js',content:this.model(securityContext)}]})});
    const app=express();app.disable('x-powered-by');app.use(express.json({limit:'64kb'}));
    // Ensure rejected internal tokens yield a controlled denial before Cube handling.
    app.use((req,res,next)=>{const token=req.headers.authorization??'';const r=this.tokens.get(token);if(!r||r.expires<Date.now()){res.status(403).json({code:'authority_denied'});return;}next();});
    await this.core.initApp(app);
    this.server=await new Promise(resolve=>{const s=app.listen(port,'127.0.0.1',()=>resolve(s));});
    const address=this.server.address();if(!address||typeof address==='string')throw Error('No Cube address');
    this.url=`http://127.0.0.1:${address.port}`;
  }
  private model(scope:Scope):string {
    // Source identifiers and SQL are registered code, never caller-provided SQL.
    const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'";
    const where=`tenant_id=${literal(scope.tenantId)} AND region IN (${scope.regions.map(literal).join(',')})`;
    const allowed=['invoice_id','region','customer_id','amount','discount','cost','currency','fx_to_inr','invoice_date','order_id'].filter(field=>scope.fields.includes(field));
    const invoices=`SELECT tenant_id,${allowed.join(',')} FROM chausar_source.invoices WHERE ${where}`;
    const child=(table:string)=>`SELECT child.* FROM chausar_source.${table} child JOIN (${invoices}) i ON child.tenant_id=i.tenant_id AND child.invoice_id=i.invoice_id`;
    return `cube('Invoices',{sql:${JSON.stringify(invoices)},joins:{Shipments:{sql: \`\${CUBE}.invoice_id = \${Shipments}.invoice_id AND \${CUBE}.tenant_id = \${Shipments}.tenant_id\`,relationship:'one_to_many'},Returns:{sql:\`\${CUBE}.invoice_id = \${Returns}.invoice_id AND \${CUBE}.tenant_id = \${Returns}.tenant_id\`,relationship:'one_to_many'}},measures:{grossInr:{sql:\`\${CUBE}.amount * \${CUBE}.fx_to_inr\`,type:'sum'}},dimensions:{id:{sql:'invoice_id',type:'number',primaryKey:true}}});
    cube('Shipments',{sql:${JSON.stringify(child('shipments'))},measures:{quantity:{sql:'quantity',type:'sum'}},dimensions:{id:{sql:'shipment_id',type:'number',primaryKey:true}}});
    cube('Returns',{sql:${JSON.stringify(child('returns'))},measures:{refund:{sql:'refund',type:'sum'}},dimensions:{id:{sql:'return_id',type:'number',primaryKey:true}}});`;
  }
  async query(scope:Scope,metrics:MetricId[],definitionIdentity:string):Promise<Record<string,number>> {
    const context={...scope,definitionIdentity};
    const deadline=Date.now()+35000;
    const token=randomBytes(32).toString('hex');this.tokens.set(token,{scope:context,expires:Date.now()+45000});
    try {
      for(let i=0;i<100;i++) {
        if(Date.now()>=deadline)throw new Denied('analytical_query_timeout',504);
        const response=await fetch(this.url+'/cubejs-api/v1/load',{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},
          body:JSON.stringify({query:{measures:metrics.map(m=>metricBindings[m].member)}}),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
        const body=await response.json() as any;
        if(body.error==='Continue wait'){await new Promise(r=>setTimeout(r,100));continue;}
        if(!response.ok||!body.data||body.data.length!==1)throw new Denied('analytical_query_failed',502);
        const result:Record<string,number>={};
        for(const id of metrics){const raw=body.data[0][metricBindings[id].member];if(raw===null||raw===undefined||!Number.isFinite(Number(raw)))throw new Denied('analytical_result_incomplete',422);result[id]=Number(raw);}
        return result;
      }throw new Denied('analytical_query_timeout',504);
    } finally {this.tokens.delete(token);}
  }
  async stop(){if(this.server)await new Promise<void>(r=>this.server!.close(()=>r()));if(this.core)await this.core.shutdown();}
}
