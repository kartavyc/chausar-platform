// Original exact-client erasure. Saved sign-in cleanup uses opaque partition IDs, never credentials or page data.
import type {VentureTx} from '../../records.ts';
import type {VentureDeps} from '../../contracts.ts';
import {readVenture,ventureAction} from '../../records.ts';
import type {Context} from '../../../contracts.ts';
import {removeRecords} from '../../network/people.ts';
import {endFormsBrowser} from './browser-state.ts';
function linkedCalls(value:unknown,ids=new Set<string>()):Set<string>{if(Array.isArray(value))for(const part of value)linkedCalls(part,ids);else if(value&&typeof value==='object')for(const [key,part]of Object.entries(value)){if(['callId','modelCallId'].includes(key)&&typeof part==='string')ids.add(part);if(['callIds','modelCallIds'].includes(key)&&Array.isArray(part))for(const id of part)if(typeof id==='string')ids.add(id);linkedCalls(part,ids);}return ids;}
export function eraseFormsNaming(tx:VentureTx,clients:ReadonlySet<string>,handles:ReadonlySet<string>,mentions:(value:unknown)=>boolean){
 const named=(value:unknown)=>{const text=JSON.stringify(value)??'';return mentions(text)||[...handles].some(h=>h.length>=3&&text.toLowerCase().includes(h.toLowerCase()));};
 const rows=tx.list('venture-entry-record').filter(row=>clients.has(row.clientId)||named(row)),orders=new Set(rows.map(row=>row.orderId));
 const blueprint=tx.venture?.acceptedBlueprintId?tx.find('venture-blueprint',tx.venture.acceptedBlueprintId):null;
 for(const order of tx.list('venture-order'))if(clients.has(order.clientId)&&blueprint?.offers.some(offer=>offer.id===order.offerId&&['data-entry-monthly','backlog-project'].includes(String(offer.playbookOffer))))orders.add(order.id);
 const formOrders=new Set(tx.list('venture-order').filter(order=>blueprint?.offers.some(offer=>offer.id===order.offerId&&['data-entry-monthly','backlog-project'].includes(String(offer.playbookOffer)))).map(order=>order.id));
 for(const file of tx.list('venture-upload'))if(file.scope.kind==='order'&&formOrders.has(file.scope.orderId)&&file.format==='csv'&&Buffer.byteLength(file.contentBase64,'base64')<=500000&&named(Buffer.from(file.contentBase64,'base64').toString('utf8')))orders.add(file.scope.orderId);
 const all=tx.list('venture-entry-record').filter(row=>orders.has(row.orderId)),ids=new Set(all.map(row=>row.id));
 const signIns=all.flatMap(row=>[...(row.signIns??[]).map(value=>value.id),...(row.site?.savedSignInId?[row.site.savedSignInId]:[])]);if(signIns.length)tx.touch({formsSignInErasure:[...new Set([...(tx.venture?.formsSignInErasure??[]),...signIns])]});
 const runs=tx.list('venture-delivery-run').filter(run=>orders.has(run.orderId)),runIds=new Set(runs.map(run=>run.id));
 const calls=linkedCalls(runs);for(const call of tx.list('venture-model-call'))if(calls.has(call.id))tx.replace({...call,payloadText:'',payloadTruncated:false,erasedAt:tx.now,error:null,...(call.status==='preview'?{status:'expired' as const}:{})});
 for(const run of runs){const{judge:_judge,...rest}=run;tx.replace({...rest,status:'stopped',callId:null,preview:null,deliverable:null,renderedText:null,editedText:null,harness:null,checks:[],playbookChecks:[],verdict:null});tx.emit('run.stopped',{runId:run.id});}
 const reports=new Set(tx.list('venture-report').filter(report=>runIds.has(report.runId)).map(report=>report.id));
 for(const order of tx.list('venture-order'))if(orders.has(order.id)){const{intake:_intake,...rest}=order;tx.replace({...rest,status:'cancelled',request:'Client data deleted.'});}
 removeRecords(tx,row=>row.kind==='venture-entry-record'&&ids.has(String(row.id))||row.kind==='venture-upload'&&row.scope!==null&&typeof row.scope==='object'&&'orderId'in row.scope&&orders.has(String(row.scope.orderId))||row.kind==='venture-share-link'&&(ids.has(String(row.deliveryId))||runIds.has(String(row.deliveryId)))||row.kind==='venture-report'&&reports.has(String(row.id))||row.kind==='venture-report-share'&&reports.has(String(row.reportId))||(row.kind==='venture-work-receipt'||row.kind==='venture-work-table')&&row.runRef!==null&&typeof row.runRef==='object'&&'runId'in row.runRef&&(runIds.has(String(row.runRef.runId))||ids.has(String(row.runRef.runId))));
 if(orders.size)tx.emit('desk.changed',{playbook:'data-entry-desk'});
}
/** The queue survives worker restart. Failed main-process cleanup is reported and blocks another saved sign-in. */
export async function clearForgottenFormSignIns(deps:VentureDeps,ctx:Context):Promise<boolean>{
 const {venture}=readVenture(deps,ctx),ids=venture.formsSignInErasure??[];await endFormsBrowser(deps);if(!ids.length)return true;if(!deps.formsBrowser)return false;
 try{await deps.formsBrowser.eraseSignIns(ids);await ventureAction(deps,ctx,'approve','forms.finish-forget',tx=>{tx.touch({formsSignInErasure:(tx.venture?.formsSignInErasure??[]).filter(id=>!ids.includes(id))});});return true;}catch{return false;}
}
