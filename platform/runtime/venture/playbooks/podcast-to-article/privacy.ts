// Forget follows explicit client, source and order links. Transcript copies never survive by omitting a person's name.
import type {VentureTx} from '../../records.ts';import {removeRecords} from '../../network/people.ts';
/** Collect explicit model-call references before their enclosing run snapshots are erased. */
function callIds(value:unknown,found=new Set<string>()):Set<string>{
 if(Array.isArray(value)){for(const item of value)callIds(item,found);}
 else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
  if(['callId','modelCallId'].includes(key)&&typeof item==='string')found.add(item);
  if(['callIds','modelCallIds'].includes(key)&&Array.isArray(item))for(const id of item)if(typeof id==='string')found.add(id);
  callIds(item,found);
 }
 return found;
}
export function eraseArticleNaming(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(value:unknown)=>boolean){const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(h=>h.length>=3&&text.toLowerCase().includes(h.toLowerCase()));},records=tx.list('venture-article-ledger').filter(r=>clientIds.has(r.clientId)||named(r)),ids=new Set(records.map(r=>r.id)),sourceIds=new Set(records.map(r=>r.source.fileId)),orderIds=new Set(records.flatMap(r=>[r.orderId,r.source.orderId])),runs=tx.list('venture-delivery-run').filter(r=>orderIds.has(r.orderId)),runIds=new Set(runs.map(r=>r.id)),reports=new Set(tx.list('venture-report').filter(r=>runIds.has(r.runId)).map(r=>r.id));const linked=callIds(runs);for(const call of tx.list('venture-model-call'))if(linked.has(call.id))tx.replace({...call,payloadText:'',payloadTruncated:false,erasedAt:tx.now,error:null,...(call.status==='preview'?{status:'expired' as const}:{})});for(const run of runs){const {judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,harness:null,checks:[],playbookChecks:[],verdict:null});tx.emit('run.stopped',{runId:run.id});}
 removeRecords(tx,r=>r.kind==='venture-article-ledger'&&ids.has(String(r.id))||r.kind==='venture-upload'&&(sourceIds.has(String(r.id))||r.scope!==null&&typeof r.scope==='object'&&'orderId'in r.scope&&orderIds.has(String(r.scope.orderId)))||r.kind==='venture-share-link'&&runIds.has(String(r.deliveryId))||r.kind==='venture-report'&&reports.has(String(r.id))||r.kind==='venture-report-share'&&reports.has(String(r.reportId))||(r.kind==='venture-work-receipt'||r.kind==='venture-work-table')&&r.runRef!==null&&typeof r.runRef==='object'&&'runId'in r.runRef&&runIds.has(String(r.runRef.runId)));if(ids.size)tx.emit('desk.changed',{playbook:'podcast-to-article'});
}
