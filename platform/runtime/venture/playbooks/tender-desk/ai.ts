// Original exact-preview model boundary. Source bytes are rechecked before dispatch and before saving a draft.
import {authorize,check,type Context} from '../../../contracts.ts';
import type {VentureDeps,TenderQuestionRecord} from '../../contracts.ts';
import {digest,exactPayload,listRecords,readVenture,ventureAction,type VentureTx} from '../../records.ts';
import {requireTenderSources,type TenderSourceRead} from './sources.ts';
import {changeTenderAnswer} from './state.ts';
import {tenderTask} from './ai-core.ts';
const binding=(row:TenderQuestionRecord)=>digest({...row,aiRequest:null,aiCallIds:[]});
const rowsOf=(tx:Pick<VentureTx,'list'>,orderId:string)=>tx.list('venture-tender-question').filter(row=>row.orderId===orderId);
/** Caller has checked the owner app channel and exact outer request fields. */
export async function tenderAi(deps:VentureDeps,ctx:Context,p:Record<string,unknown>,orderId:string){
 const body=exactPayload(p.payload,p.action==='ai-preview'?['questionId']:['questionId','callId','approvedDigest'],p.action==='ai-preview'?['questionId']:['questionId','callId','approvedDigest']);
 const currentRead=():TenderSourceRead=>({find:(kind,id)=>{const {state,venture}=readVenture(deps,ctx);return listRecords(state,kind,venture.id).find(row=>row.id===id);}});
 const {state,venture}=readVenture(deps,ctx),rows=listRecords(state,'venture-tender-question',venture.id).filter(row=>row.orderId===orderId);
 check(p.digest===digest(rows),'APPROVAL_CHANGED','Review the current questions before asking AI.');const row=rows.find(row=>row.question.id===body.questionId);check(row,'TENDER_NOT_FOUND','Choose a question from this bid.');
 async function source(read:TenderSourceRead,row:TenderQuestionRecord){const source=await requireTenderSources(deps,read,orderId,row.selection,row.sourceDigest);check(source.order.intake?.fields?.private!==true,'PRIVATE_NEEDS_LOCAL','Private tender sources need a qualified local model. Write the answer manually meanwhile.');return source;}
 // Capture before the asynchronous source read. A source changed during decoding must never become the accepted dispatch snapshot.
 const sourceIds=[row.selection.rfpFileId,...row.selection.documentFileIds,row.selection.issuerFileId].filter((id):id is string=>id!==null),sourceRead=currentRead(),sourceSnapshots=new Map(sourceIds.map(id=>[id,digest(sourceRead.find('venture-upload',id))])),orderSnapshot=digest(sourceRead.find('venture-order',orderId));
 const bucket=await source(currentRead(),row),expected=binding(row),task=tenderTask(row.question,row.controls,bucket.documents);

 async function live(tx:VentureTx){const current=tx.find('venture-tender-question',row!.id);check(current&&binding(current)===expected,'APPROVAL_CHANGED','The question or controls changed. Review again.');await source(tx,current);return current;}
 if(p.action==='ai-preview'){
  const preview=await deps.models.preview(ctx,task);check(preview,'NO_MODEL_CONNECTED','Connect an AI before drafting this answer.');
  try{return await ventureAction(deps,ctx,'approve','tender.ai-preview',async tx=>{const current=await live(tx);check(p.digest===digest(rowsOf(tx,orderId)),'APPROVAL_CHANGED','The bid changed. Review the current questions.');tx.replace({...current,aiRequest:{preview,binding:expected},aiCallIds:[...current.aiCallIds,preview.callId]});tx.emit('desk.changed',{playbook:'tender-desk'});tx.emit('queue.changed',{});return {playbook:'tender-desk' as const,kind:'bid',id:orderId,result:{preview},line:'Review this exact request before client documents leave Chausar.'};});}
  catch(error){await ventureAction(deps,ctx,'approve','tender.ai-expire',tx=>{const call=tx.find('venture-model-call',preview.callId);if(call?.status==='preview')tx.replace({...call,payloadText:'',payloadTruncated:false,status:'expired',erasedAt:tx.now});});throw error;}
 }
 const pending=row.aiRequest;check(pending&&pending.binding===expected&&pending.preview.callId===body.callId&&pending.preview.digest===body.approvedDigest&&Date.parse(pending.preview.expiresAt)>deps.clock().getTime(),'APPROVAL_CHANGED','Approve the exact current AI preview.');
 // Consume the local authority before the asynchronous model call, so concurrent confirmations cannot both send.
 await ventureAction(deps,ctx,'approve','tender.ai-confirm',async tx=>{const current=await live(tx);check(p.digest===digest(rowsOf(tx,orderId))&&current.aiRequest?.preview.callId===pending.preview.callId,'APPROVAL_CHANGED','This AI request changed or was already used.');tx.replace({...current,aiRequest:null});});
 const outcome=await deps.models.runPreview(ctx,pending.preview.callId,pending.preview.digest,task.validate,{beforeDispatch:()=>{authorize(deps.store,ctx,'approve');const {state,venture}=readVenture(deps,ctx),current=listRecords(state,'venture-tender-question',venture.id).find(item=>item.id===row.id),order=listRecords(state,'venture-order',venture.id).find(item=>item.id===orderId);check(current&&binding(current)===expected&&current.aiRequest===null&&Date.parse(pending.preview.expiresAt)>deps.clock().getTime(),'APPROVAL_CHANGED','The exact tender request changed before dispatch.');check(order&&digest(order)===orderSnapshot&&listRecords(state,'venture-client',venture.id).some(client=>client.id===order.clientId),'DERIVED_STALE','The client order changed before dispatch.');const files=listRecords(state,'venture-upload',venture.id);for(const [id,hash]of sourceSnapshots){const file=files.find(item=>item.id===id);check(file&&digest(file)===hash,'DERIVED_STALE','A tender source changed before dispatch.');}}});
 return ventureAction(deps,ctx,'approve','tender.ai-save',async tx=>{const current=await live(tx);check(current.aiRequest===null,'APPROVAL_CHANGED','A newer preview replaced this draft.');const saved=tx.replace(changeTenderAnswer(current,outcome.value.answer,'agent'));tx.emit('desk.changed',{playbook:'tender-desk'});tx.emit('queue.changed',{});return {playbook:'tender-desk' as const,kind:'bid',id:orderId,result:{row:saved,ground:outcome.value.ground},line:'Saved a draft for your review. Nothing was submitted.'};});
}
