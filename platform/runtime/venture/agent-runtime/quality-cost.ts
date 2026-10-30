import type { Context } from '../../contracts.ts';
import type { State } from '../../contracts.ts';
import type { SumReceiptSubject, VentureDeps, VentureRecord } from '../contracts.ts';
import { formatMicros, listRecords, ventureAction } from '../records.ts';
import { sumReceiptIn, type SumPlan } from '../money/sums.ts';
import { nativeJobSpends } from './job-spend.ts';
import { agentCostPlan } from './cost-proof.ts';

export function nativeJobCostPlan(state:State,venture:VentureRecord,subject:Extract<SumReceiptSubject,{type:'agent-job-cost'}>):SumPlan{
  const run=listRecords(state,'venture-delivery-run',venture.id).find(row=>row.id===subject.runId);
  const addends:SumPlan['addends']=[];
  for(const spend of run?nativeJobSpends(state,run):[]){
    if(spend.phase==='released')continue;
    if(spend.agentUsage){addends.push(...agentCostPlan(state,venture,{type:'agent-cost',spendId:spend.id}).addends);continue;}
    const call=listRecords(state,'venture-model-call',venture.id).find(row=>row.id===spend.ref);
    if(spend.phase==='settled'&&spend.settledBy==='usage'&&spend.settledMicros!==null&&call?.usage&&call.costMicros===spend.settledMicros){
      addends.push({recordId:spend.id,label:`Quality check with ${call.model}: ${call.usage.inputTokens} input and ${call.usage.outputTokens} output tokens, priced by the model call's saved rate.`,amount:spend.settledMicros,display:formatMicros(spend.settledMicros),estimate:!call.priceConfirmed});
    }
  }
  return {subject,currency:'USD',unit:'micros',words:{label:'AI job and quality check',one:'priced call',many:'priced calls',none:'No priced calls.'},estimateWords:'A model price is unconfirmed.',addends};
}

/** Reuse ModelPort's charge; never reserve or infer free usage after a failed provider call. */
export async function projectNativeQualityCost(deps:VentureDeps,ctx:Context,runId:string,callId:string|null):Promise<void>{
  if(!callId)return;
  await ventureAction(deps,ctx,'prepare','agent.quality.cost',tx=>{
    const run=tx.find('venture-delivery-run',runId);
    if(!run?.agentJob||run.ventureId!==tx.venture!.id)return;
    const call=tx.find('venture-model-call',callId);
    if(call?.ventureId!==run.ventureId||call.purpose!=='judge'||call.agentId!==run.agentJob.scope.agentId||call.agentJobId!==run.agentJob.scope.jobId)return;
    const charges=nativeJobSpends(tx.state,run);if(!charges.length)return;
    const plan=nativeJobCostPlan(tx.state,tx.venture!,{type:'agent-job-cost',runId});
    const unknown=charges.some(row=>row.phase!=='released'&&(row.phase!=='settled'||row.settledBy!=='usage'||!plan.addends.some(item=>item.recordId===row.id)));
    const spendId=charges[0].id;
    const receipt=unknown?undefined:sumReceiptIn(tx,plan);
    const cost=unknown?{spendId,state:'unknown' as const,display:'Some AI costs are not known. The allowance stays held.'}:{spendId,state:'priced' as const,receiptId:receipt!.id,display:`${formatMicros(receipt!.totalMinor)}${plan.addends.some(row=>row.estimate)?' (estimate, price unconfirmed)':''}`};
    tx.replace({...run,agentJob:{...run.agentJob,cost}});tx.emit('run.step',{runId});
  });
}
