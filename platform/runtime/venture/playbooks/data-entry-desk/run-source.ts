// Delivery reads persisted exact source and comparison evidence. It never performs browser actions.
import {check,type State} from '../../../contracts.ts';
import {digest,findRecord,listRecords} from '../../records.ts';
import type {Deliverable,DeliveryRunRecord,VentureDeps} from '../../contracts.ts';
import {loadFormsSource} from './source.ts';
import {formArtifact,formsMappingCheck,type FormsReportRow} from './checks.ts';
export function formsDeliverable(rows:readonly FormsReportRow[],chainStage?:number):Deliverable{const stage=chainStage===2?'report':'mapping',heading=stage==='mapping'?'Field mapping':'Saved records';return {title:heading,sections:[{heading,parts:[{kind:'text',text:formArtifact(rows,stage)}]}],questionsForClient:[]};}
export function formsRunSource(state:State,ventureId:string,orderId:string){
 const venture=findRecord(state,'venture-record',ventureId),entries=listRecords(state,'venture-entry-record',ventureId).filter(row=>row.orderId===orderId).sort((a,b)=>a.id.localeCompare(b.id));
 check(venture&&entries.length>0,'FORM_SOURCE_INVALID','Prepare the exact client source rows in the data-entry desk first.');
 const rows:FormsReportRow[]=entries.map(row=>{const source=loadFormsSource({venture,find:(kind,id)=>listRecords(state,kind,ventureId).find(value=>value.id===id)},orderId,row.fileId,row.identityColumn,row.rowIndex);check(source.sourceDigest===row.sourceDigest&&source.rowDigest===row.rowDigest&&source.order.clientId===row.clientId,'FORM_SOURCE_CHANGED','The client source changed. Prepare a new source-bound delivery.');
 return {id:row.id,sourceRecordId:row.sourceRecordId,values:source.values,mapping:row.mapping??[],proposal:row.mappingProposal?.sourceDigest===row.sourceDigest&&row.mappingProposal.pageHash===row.pageHash?row.mappingProposal.mapping:null,state:row.state,comparison:row.comparison??null};});
 return {rows,binding:digest(entries.map(row=>({id:row.id,sourceDigest:row.sourceDigest,rowDigest:row.rowDigest,clientId:row.clientId})))};
}
export function formsRunCurrent(state:State,ventureId:string,run:DeliveryRunRecord){
 if(!run.formsSourceBinding)return null;
 const source=formsRunSource(state,ventureId,run.orderId);check(source.binding===run.formsSourceBinding,'FORM_SOURCE_CHANGED','The current source rows differ from this delivery. Start it again.');
 if(run.deliverable)check(formsMappingCheck({formsEntries:source.rows,stageId:run.chainStage===2?'report':'mapping',deliverable:run.deliverable})[0].outcome==='pass','FORM_SOURCE_CHANGED','The saved mapping or outcome changed. Read the current evidence again.');
 return source;
}
export function formsDispatchGuard(deps:VentureDeps,ventureId:string,run:DeliveryRunRecord){return ()=>{if(!run.formsSourceBinding)return;const state=deps.store.read(),live=findRecord(state,'venture-delivery-run',run.id);check(live&&live.status==='waiting-for-you'&&live.callId===run.callId&&live.formsSourceBinding===run.formsSourceBinding,'APPROVAL_STALE','This source approval no longer waits on that call.');formsRunCurrent(state,ventureId,live);};}
