// Exact career AI request approval. Only approved fact selections become code-rendered draft packs.
import {authorize,check,type Context} from '../../../contracts.ts';
import type {CareerThreadRecord,VentureDeps} from '../../contracts.ts';
import {digest,exactPayload,listRecords,readVenture,ventureAction} from '../../records.ts';
import {careerOrder} from './order.ts';
import {careerEvidence} from './source-state.ts';
import {careerTask} from './ai.ts';
import {careerPack} from './pack.ts';
import {requireCareerClientRule} from './rules.ts';
const binding=(row:CareerThreadRecord)=>digest({...row,aiRequest:null,aiCallIds:[]});
export async function careerAi(deps:VentureDeps,ctx:Context,p:Record<string,unknown>){
 const {state,venture}=readVenture(deps,ctx),row=listRecords(state,'venture-career-thread',venture.id).find(r=>r.id===p.id);check(row?.pack,'CAREER_NOT_FOUND','Choose a career pack.');check(p.digest===digest(row),'APPROVAL_STALE','Review the current career pack.');requireCareerClientRule();
 const expected=binding(row),live=()=>{authorize(deps.store,ctx,'approve');requireCareerClientRule();const scope=careerOrder(deps,ctx,row.orderId),current=listRecords(deps.store.read(),'venture-career-thread',venture.id).find(r=>r.id===row.id),evidence=careerEvidence(deps.store.read(),venture.id,row.orderId);check(current?.pack&&binding(current)===expected&&digest(scope.order)===current.pack.orderDigest&&evidence.factsDigest===current.pack.factsDigest&&evidence.sourcesDigest===current.pack.sourcesDigest,'CAREER_SOURCE_CHANGED','The career facts, source or pack changed. Review a new pack.');return{current,evidence};};
 check(row.pack.input.kind!=='weekly-shortlist'&&row.pack.input.kind!=='career-coaching','INVALID_VENTURE_REQUEST','Choose a resume, cover letter, interview preparation or title audit for AI evidence selection.');
 const first=live(),task=careerTask(row.pack.input.kind,first.evidence.facts,first.evidence.listings);
 if(p.action==='ai-preview'){
  exactPayload(p.payload,[]);const preview=await deps.models.preview(ctx,task);check(preview,'NO_MODEL_CONNECTED','Connect an AI before preparing this career request.');
  try{return await ventureAction(deps,ctx,'approve','career.ai-preview',tx=>{const {current}=live();const next=tx.replace({...current,aiRequest:{preview,binding:expected},aiCallIds:[...(current.aiCallIds??[]),preview.callId]});tx.emit('desk.changed',{playbook:'job-search-desk'});return{playbook:'job-search-desk' as const,kind:'thread',id:row.id,result:{preview,thread:next},line:'Review the exact client facts, source text, model and cost before sending.'};});}
  catch(error){await ventureAction(deps,ctx,'approve','career.ai-expire',tx=>{const call=tx.find('venture-model-call',preview.callId);if(call?.status==='preview')tx.replace({...call,status:'expired',payloadText:'',payloadTruncated:false,erasedAt:tx.now});});throw error;}
 }
 const b=exactPayload(p.payload,['callId','approvedDigest'],['callId','approvedDigest']),pending=row.aiRequest;
 const exact=()=>{const found=live();check(pending&&pending.binding===expected&&pending.preview.callId===b.callId&&pending.preview.digest===b.approvedDigest&&Date.parse(pending.preview.expiresAt)>deps.clock().getTime()&&found.current.aiRequest?.preview.callId===pending.preview.callId&&found.current.aiRequest.preview.digest===pending.preview.digest,'APPROVAL_STALE','Approve the exact current career AI request.');return found;};exact();
 const result=await deps.models.runPreview(ctx,pending!.preview.callId,pending!.preview.digest,task.validate,{beforeDispatch:()=>{exact();}});
 return ventureAction(deps,ctx,'approve','career.ai-result',tx=>{const {current,evidence}=exact(),made=careerPack(evidence.facts,evidence.listings,result.value),next=tx.replace({...current,aiRequest:null,pack:{...current.pack!,input:structuredClone(result.value),text:made.text,files:[],generation:current.pack!.generation+1,note:null,ownerApproval:null,clientShareId:null}});tx.emit('desk.changed',{playbook:'job-search-desk'});return{playbook:'job-search-desk' as const,kind:'thread',id:row.id,result:next,line:'Review meaning and voice. No application or message was sent.'};});
}
