// Original read-only narration evidence tools. No tool spends, approves, exports or invents measurements.
import {check} from '../../../contracts.ts';
import {findRecord} from '../../records.ts';
import type {Spec,ToolEnv} from './tools.ts';
import {narrationRunSource} from '../../playbooks/narration-studio/run-source.ts';
import {narrationDelivery} from '../../playbooks/narration-studio/checks.ts';
async function scoped(env:ToolEnv){const run=env.runRef.kind==='delivery'?findRecord(env.deps.store.read(),'venture-delivery-run',env.runRef.runId):null;check(run&&run.ventureId===env.ventureId,'NARRATION_NOT_FOUND','Use this client order narration run.');return narrationRunSource(env.deps,env.ventureId,run.orderId);}
export const NARRATION_STUDIO_TOOLS:Readonly<Record<'narration.markup'|'narration.verify',Spec>>=Object.freeze({
 'narration.markup':{name:'narration.markup',effect:'compute',tier:'code',endsTurn:false,summary:'Read the current source-bound pauses and licensed stock voice choices saved in the narration desk.',input:{},async run(env){const data=await scoped(env);return {result:{rows:data.rows,saved:false}};}},
 'narration.verify':{name:'narration.verify',effect:'compute',tier:'code',endsTurn:false,summary:'Read actual audio measurements, local transcription and owner listening approval. Missing checks stay incomplete.',input:{},async run(env){const data=await scoped(env);return {result:{...data,delivery:data.ready?narrationDelivery(data.rows):null,exported:false,submitted:false}};}}
});
