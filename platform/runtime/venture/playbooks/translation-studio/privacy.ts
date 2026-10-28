// Original Chausar Forget: follow opaque client/order links and remove every source-derived translation copy.
import type {VentureTx} from '../../records.ts';
import {removeRecords} from '../../network/people.ts';
export function eraseTranslationNaming(tx:VentureTx,handles:ReadonlySet<string>,mentions:(text:unknown)=>boolean,clientIds:ReadonlySet<string>):void{
 const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(h=>h.length>=3&&text.toLowerCase().includes(h.toLowerCase()));};
 const jobs=tx.list('venture-translation-job').filter(j=>clientIds.has(j.clientId)||named(j.state)),ids=new Set(jobs.map(j=>j.id)),orders=new Set(jobs.map(j=>j.orderId));
 const calls=new Set(jobs.flatMap(j=>j.state.aiCallIds??[]));for(const call of tx.list('venture-model-call'))if(calls.has(call.id))tx.replace({...call,payloadText:'',payloadTruncated:false,erasedAt:tx.now,error:null,...(call.status==='preview'?{status:'expired' as const}:{} )});
 const runs=tx.list('venture-delivery-run').filter(r=>orders.has(r.orderId)),runIds=new Set(runs.map(r=>r.id));
 for(const run of runs){const {judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,harness:null,checks:[],playbookChecks:[],verdict:null});tx.emit('run.stopped',{runId:run.id});}
 const reports=new Set(tx.list('venture-report').filter(r=>runIds.has(r.runId)).map(r=>r.id));
 removeRecords(tx,r=>r.kind==='venture-upload'&&r.scope!==null&&r.scope!==undefined&&typeof r.scope==='object'&&'orderId'in r.scope&&orders.has(String(r.scope.orderId)));
 removeRecords(tx,r=>r.kind==='venture-translation-job'&&ids.has(String(r.id))||(r.kind==='venture-translation-segment'||r.kind==='venture-glossary')&&ids.has(String(r.jobId))||r.kind==='venture-share-link'&&(runIds.has(String(r.deliveryId))||ids.has(String(r.deliveryId)))||r.kind==='venture-report'&&reports.has(String(r.id))||r.kind==='venture-report-share'&&reports.has(String(r.reportId))||(r.kind==='venture-work-receipt'||r.kind==='venture-work-table')&&r.runRef!==null&&r.runRef!==undefined&&typeof r.runRef==='object'&&'runId'in r.runRef&&runIds.has(String(r.runRef.runId)));
 if(ids.size)tx.emit('desk.changed',{playbook:'translation-studio'});
}
