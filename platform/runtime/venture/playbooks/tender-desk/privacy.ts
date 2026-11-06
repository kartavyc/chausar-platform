// Original tender erasure follows explicit client, source and run links, including opaque model payloads.
import type {VentureTx} from '../../records.ts';
import {removeRecords} from '../../network/people.ts';
import {orderChain} from '../kit/chain.ts';
function calls(value:unknown,ids=new Set<string>()):Set<string>{
 if(Array.isArray(value))for(const item of value)calls(item,ids);
 else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
  if(['callId','modelCallId'].includes(key)&&typeof item==='string')ids.add(item);
  if(['callIds','modelCallIds','aiCallIds'].includes(key)&&Array.isArray(item))for(const id of item)if(typeof id==='string')ids.add(id);
  calls(item,ids);
 }return ids;
}
/** Only the exact owner Forget invokes this; cost metadata is retained without the client payload. */
export function eraseTenderNaming(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(value:unknown)=>boolean){
 const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(h=>h.length>=3&&text.toLowerCase().includes(h.toLowerCase()));};
 const rows=tx.list('venture-tender-question').filter(row=>clientIds.has(row.clientId)||named(row)),orders=new Set(rows.map(row=>row.orderId));
 for(const order of tx.list('venture-order'))if(clientIds.has(order.clientId)&&tx.venture&&orderChain(tx.state,tx.venture,order)?.definition.registration.id==='tender-desk')orders.add(order.id);
 // A reference in one answer removes the complete bid, so no partial approved export survives.
 const all=tx.list('venture-tender-question').filter(row=>orders.has(row.orderId)),ids=new Set(all.map(row=>row.id));
 const runs=tx.list('venture-delivery-run').filter(run=>orders.has(run.orderId)),runIds=new Set(runs.map(run=>run.id)),linked=calls([...all,...runs]),reports=new Set(tx.list('venture-report').filter(r=>runIds.has(r.runId)).map(r=>r.id));
 for(const call of tx.list('venture-model-call'))if(linked.has(call.id))tx.replace({...call,payloadText:'',payloadTruncated:false,error:null,erasedAt:tx.now,...(call.status==='preview'?{status:'expired' as const}:{})});
 for(const run of runs){const {judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,harness:null,checks:[],playbookChecks:[],verdict:null});tx.emit('run.stopped',{runId:run.id});}
 for(const order of tx.list('venture-order'))if(orders.has(order.id)){const {intake:_intake,...rest}=order;tx.replace(rest);}
 removeRecords(tx,r=>r.kind==='venture-tender-question'&&ids.has(String(r.id))||r.kind==='venture-upload'&&r.scope!==null&&typeof r.scope==='object'&&'orderId'in r.scope&&orders.has(String(r.scope.orderId))||r.kind==='venture-share-link'&&runIds.has(String(r.deliveryId))||r.kind==='venture-report'&&reports.has(String(r.id))||r.kind==='venture-report-share'&&reports.has(String(r.reportId))||(r.kind==='venture-work-receipt'||r.kind==='venture-work-table')&&r.runRef!==null&&typeof r.runRef==='object'&&'runId'in r.runRef&&runIds.has(String(r.runRef.runId)));
 if(orders.size){tx.emit('desk.changed',{playbook:'tender-desk'});tx.emit('queue.changed',{});}
}
