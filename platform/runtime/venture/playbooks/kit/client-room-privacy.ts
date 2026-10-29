// Original identity-based erasure of all client room versions, including words that contain no person's name.
import type {VentureTx} from '../../records.ts';
import {removeRecords} from '../../network/people.ts';
import {orderChain} from './chain.ts';
function modelCalls(value:unknown,found=new Set<string>()):Set<string>{
 if(Array.isArray(value))for(const item of value)modelCalls(item,found);
 else if(value&&typeof value==='object')for(const[key,item]of Object.entries(value)){
  if(['callId','modelCallId'].includes(key)&&typeof item==='string')found.add(item);
  if(['callIds','modelCallIds'].includes(key)&&Array.isArray(item))for(const id of item)if(typeof id==='string')found.add(id);
  modelCalls(item,found);
 }
 return found;
}
export function eraseClientRooms(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(value:unknown)=>boolean){
 const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(handle=>handle.length>=3&&text.toLowerCase().includes(handle.toLowerCase()));};
 const allRooms=tx.list('venture-room-brief'),orders=new Set(allRooms.filter(r=>clientIds.has(r.clientId)||named(r)).map(r=>r.orderId));
 for(const order of tx.list('venture-order'))if((clientIds.has(order.clientId)||named(order))&&tx.venture&&orderChain(tx.state,tx.venture,order)?.definition.clientRoom===true)orders.add(order.id);
 const rooms=allRooms.filter(r=>orders.has(r.orderId)),ids=new Set(rooms.map(r=>r.id));
 const runs=tx.list('venture-delivery-run').filter(r=>orders.has(r.orderId)),runIds=new Set(runs.map(r=>r.id)),calls=modelCalls(runs),reports=new Set(tx.list('venture-report').filter(r=>runIds.has(r.runId)).map(r=>r.id));
 for(const call of tx.list('venture-model-call'))if(calls.has(call.id))tx.replace({...call,payloadText:'',payloadTruncated:false,erasedAt:tx.now,error:null,...(call.status==='preview'?{status:'expired' as const}:{})});
 for(const run of runs){const{judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,harness:null,checks:[],playbookChecks:[],verdict:null});tx.emit('run.stopped',{runId:run.id});}
 for(const order of tx.list('venture-order'))if(orders.has(order.id)){const{intake:_intake,...rest}=order;tx.replace({...rest,request:'Client data deleted.',status:'cancelled',chainState:'stopped'});}
 removeRecords(tx,r=>r.kind==='venture-asset'&&orders.has(String(r.orderId))||r.kind==='venture-upload'&&r.scope!==null&&typeof r.scope==='object'&&'orderId'in r.scope&&orders.has(String(r.scope.orderId))||r.kind==='venture-share-link'&&runIds.has(String(r.deliveryId))||r.kind==='venture-report'&&reports.has(String(r.id))||r.kind==='venture-report-share'&&reports.has(String(r.reportId))||(r.kind==='venture-work-receipt'||r.kind==='venture-work-table')&&r.runRef!==null&&typeof r.runRef==='object'&&'runId'in r.runRef&&runIds.has(String(r.runRef.runId)));
 // A private report can mix several clients' records. It is regenerable, so Forget drops the whole summary.
 removeRecords(tx,r=>r.kind==='venture-room-brief'&&ids.has(String(r.id))||r.kind==='venture-share-link'&&typeof r.roomId==='string'&&ids.has(r.roomId)||r.kind==='venture-chief-message'&&r.recordReport===true);
 for(const playbook of new Set(rooms.map(r=>r.playbook)))tx.emit('desk.changed',{playbook});
}
