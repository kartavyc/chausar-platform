// Original S10 privacy: copied creator evidence and linked drafts are erased together, regardless of their words.
import type {VentureTx} from '../../records.ts';
import {acceptedBlueprintOrNull} from '../../delivery/shared.ts';
import {removeRecords} from '../../network/people.ts';
/** Forget invalidates every campaign approval whose personal source evidence it removes. */
export function eraseInfluencerNaming(tx:VentureTx,clientIds:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(text:unknown)=>boolean):void{
 const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(h=>h.length>=3&&text.toLowerCase().includes(h.toLowerCase()));};
 const eligible=tx.list('venture-order').filter(o=>tx.venture&&acceptedBlueprintOrNull(tx.state,tx.venture)?.offers.find(v=>v.id===o.offerId)?.playbookOffer==='influencer-campaign'),orders=new Set(eligible.filter(o=>clientIds.has(o.clientId)||named(o)).map(o=>o.id)),cases=tx.list('venture-influencer-case').filter(c=>orders.has(c.orderId)||named(c));for(const row of cases)orders.add(row.orderId);
 const ids=new Set(cases.map(c=>c.id)),leadIds=new Set(cases.flatMap(c=>c.creators.flatMap(v=>v.outreach?[v.outreach.leadId]:[]))),runs=tx.list('venture-delivery-run').filter(r=>orders.has(r.orderId)),runIds=new Set(runs.map(r=>r.id)),calls=new Set<string>();
 const collect=(v:unknown):void=>{if(Array.isArray(v))for(const x of v)collect(x);else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(['callId','modelCallId'].includes(k)&&typeof x==='string')calls.add(x);if(['callIds','modelCallIds'].includes(k)&&Array.isArray(x))for(const id of x)if(typeof id==='string')calls.add(id);collect(x);}};collect(runs);
 for(const call of tx.list('venture-model-call'))if(calls.has(call.id))tx.replace({...call,payloadText:'',payloadTruncated:false,error:null,erasedAt:tx.now,...(call.status==='preview'?{status:'expired' as const}:{})});
 for(const run of runs){const {judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,harness:null,checks:[],playbookChecks:[],verdict:null});tx.emit('run.stopped',{runId:run.id});}
 for(const order of eligible)if(orders.has(order.id)){const {intake:_intake,...rest}=order;tx.replace({...rest,request:'',status:'cancelled'});}
 const reports=new Set(tx.list('venture-report').filter(r=>runIds.has(r.runId)).map(r=>r.id));
 removeRecords(tx,r=>r.kind==='venture-influencer-case'&&ids.has(String(r.id))||r.kind==='venture-lead'&&leadIds.has(String(r.id))||r.kind==='venture-upload'&&r.scope!==null&&typeof r.scope==='object'&&'orderId'in r.scope&&orders.has(String(r.scope.orderId))||r.kind==='venture-share-link'&&runIds.has(String(r.deliveryId))||r.kind==='venture-report'&&reports.has(String(r.id))||r.kind==='venture-report-share'&&reports.has(String(r.reportId))||(r.kind==='venture-work-receipt'||r.kind==='venture-work-table')&&r.runRef!==null&&typeof r.runRef==='object'&&'runId'in r.runRef&&runIds.has(String(r.runRef.runId)));
 for(const row of cases)tx.emit('desk.changed',{playbook:'social-agency',kind:'influencer',id:row.id});
}
