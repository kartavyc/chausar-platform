// Original Chausar Forget: follow opaque client/order links and remove every source-derived translation copy.
import {eraseCaptionSessions,captionOrdersNaming} from './live-captions.ts';
import type {VentureDeps} from '../../contracts.ts';
import type {VentureTx} from '../../records.ts';
import {removeRecords} from '../../network/people.ts';
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
export function eraseTranslationNaming(tx:VentureTx,handles:ReadonlySet<string>,mentions:(text:unknown)=>boolean,clientIds:ReadonlySet<string>,deps?:VentureDeps):void{
 const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(h=>h.length>=3&&text.toLowerCase().includes(h.toLowerCase()));};
 const offers=new Set(tx.list('venture-blueprint').at(-1)?.offers.filter(o=>['document-translation','subtitles','dubbing','live-captions'].includes(o.playbookOffer??'')).map(o=>o.id));
 const orders=new Set(tx.list('venture-order').filter(o=>offers.has(o.offerId)&&(clientIds.has(o.clientId)||named(o))).map(o=>o.id));
 if(deps)for(const id of captionOrdersNaming(deps,tx.venture!.id,named))orders.add(id);
 const ownOrders=new Set(tx.list('venture-order').filter(o=>offers.has(o.offerId)).map(o=>o.id));for(const file of tx.list('venture-upload'))if(file.scope.kind==='order'&&ownOrders.has(file.scope.orderId)&&file.format==='transcript'&&named(Buffer.from(file.contentBase64,'base64').toString('utf8')))orders.add(file.scope.orderId);
 const jobs=tx.list('venture-translation-job').filter(j=>orders.has(j.orderId)||clientIds.has(j.clientId)||named(j)),ids=new Set(jobs.map(j=>j.id));for(const j of jobs)orders.add(j.orderId);
 for(const row of tx.list('venture-order'))if(orders.has(row.id))tx.replace({...row,request:'',intake:undefined,status:'cancelled',chainState:'stopped'});
 if(deps)eraseCaptionSessions(deps,orders);
 const runs=tx.list('venture-delivery-run').filter(r=>orders.has(r.orderId)),runIds=new Set(runs.map(r=>r.id));
 const calls=callIds(runs,new Set(jobs.flatMap(j=>j.state.aiCallIds??[])));for(const call of tx.list('venture-model-call'))if(calls.has(call.id))tx.replace({...call,payloadText:'',payloadTruncated:false,erasedAt:tx.now,error:null,...(call.status==='preview'?{status:'expired' as const}:{} )});
 removeRecords(tx,r=>r.kind==='venture-asset'&&orders.has(String(r.orderId)));
 for(const run of runs){const {judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,harness:null,checks:[],playbookChecks:[],verdict:null});tx.emit('run.stopped',{runId:run.id});}
 const reports=new Set(tx.list('venture-report').filter(r=>runIds.has(r.runId)).map(r=>r.id));
 removeRecords(tx,r=>r.kind==='venture-upload'&&r.scope!==null&&r.scope!==undefined&&typeof r.scope==='object'&&'orderId'in r.scope&&orders.has(String(r.scope.orderId)));
 removeRecords(tx,r=>r.kind==='venture-translation-job'&&ids.has(String(r.id))||(r.kind==='venture-translation-segment'||r.kind==='venture-glossary')&&ids.has(String(r.jobId))||r.kind==='venture-share-link'&&(runIds.has(String(r.deliveryId))||ids.has(String(r.deliveryId)))||r.kind==='venture-report'&&reports.has(String(r.id))||r.kind==='venture-report-share'&&reports.has(String(r.reportId))||(r.kind==='venture-work-receipt'||r.kind==='venture-work-table')&&r.runRef!==null&&r.runRef!==undefined&&typeof r.runRef==='object'&&'runId'in r.runRef&&runIds.has(String(r.runRef.runId)));
 if(orders.size)tx.emit('desk.changed',{playbook:'translation-studio'});
}
