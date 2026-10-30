import type { State } from '../../contracts.ts';
import type { DeliveryRunRecord, SpendRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';

/** Durable charges belonging to this exact job and its quality call. No display strings are parsed. */
export function nativeJobSpends(state:State,run:DeliveryRunRecord):SpendRecord[]{
  const job=run.agentJob;if(!job)return [];
  const rows=listRecords(state,'venture-spend',run.ventureId);
  const main=rows.find(row=>row.key===`agent:${job.scope.jobId}`&&row.ref===run.id&&row.agent===job.scope.agentId);
  const calls=new Set(listRecords(state,'venture-model-call',run.ventureId).filter(row=>row.purpose==='judge'&&row.agentId===job.scope.agentId&&row.agentJobId===job.scope.jobId).map(row=>row.id));
  const quality=rows.filter(row=>row.ref&&calls.has(row.ref)&&row.key===`model:${row.ref}`&&row.agent===job.scope.agentId);
  return [...new Map([main,...quality].filter((row):row is SpendRecord=>!!row).map(row=>[row.id,row])).values()];
}
