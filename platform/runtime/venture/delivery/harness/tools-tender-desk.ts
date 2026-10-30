// Original read-only tender tools. They never save answers, grant approval, export or submit a bid.
import {check} from '../../../contracts.ts';
import {findRecord} from '../../records.ts';
import type {Spec,ToolEnv} from './tools.ts';
import {tenderRunSource} from '../../playbooks/tender-desk/run-source.ts';
import {tenderDelivery} from '../../playbooks/tender-desk/checks.ts';
async function scoped(env:ToolEnv){const run=env.runRef.kind==='delivery'?findRecord(env.deps.store.read(),'venture-delivery-run',env.runRef.runId):null;check(run&&run.ventureId===env.ventureId,'TENDER_NOT_FOUND','Use this client order tender run.');return tenderRunSource(env.deps,env.ventureId,run.orderId);}
export const TENDER_DESK_TOOLS:Readonly<Record<'tender.questions'|'tender.ground',Spec>>=Object.freeze({
 'tender.questions':{name:'tender.questions',effect:'compute',tier:'code',endsTurn:false,summary:'Read this order imported source questions and their code classifications. The owner prepares sources in the tender desk.',input:{},async run(env){const data=await scoped(env);return {result:{rows:data.rows,saved:false}};}},
 'tender.ground':{name:'tender.ground',effect:'compute',tier:'code',endsTurn:false,summary:'Read current answer coverage, missing terms and the exact approved pack handoff. This never approves, exports or submits.',input:{},async run(env){const data=await scoped(env);return {result:{...data,delivery:data.ready?tenderDelivery(data.rows):null,exported:false,submitted:false}};}}
});
