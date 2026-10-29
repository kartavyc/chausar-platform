// Owner-only browser sequence. Every asynchronous step rechecks the exact client source and record claim.
import {keepFormReview,formsScreenshot} from './screenshots.ts';
import {randomUUID} from 'node:crypto';
import {check,type Context} from '../../../contracts.ts';
import {digest,exactPayload,listRecords} from '../../records.ts';
import type {EntryRecordRecord,VentureDeps} from '../../contracts.ts';
import {journalled} from '../../journal/journal.ts';
import {gateEffect,sealApproval} from '../../policy/holds.ts';
import {clearForgottenFormSignIns} from './privacy.ts';
import {requireFormsClientRule} from './rules.ts';
import {approvedFormSite} from './deny.ts';
import {mapFormRecord} from './mapping.ts';
import {compareFormReadback} from './readback.ts';
import {currentEntry,currentSource,currentSession,guardSession,sourceAndSite,newSession,endFormsBrowser,replaceEntry,permissionDigest,formsPort} from './browser-state.ts';
import {formCapture,submitReview,savedCapture,responseEvidence} from './browser-evidence.ts';
export const FORM_BROWSER_ACTIONS=['open','capture','fill','review-submit','review-sign-in','continue','submit','read-back','compare','close','recover'] as const;
const historySubject=(row:EntryRecordRecord)=>'forms.submit.'+digest({clientId:row.clientId,origin:row.site!.origin,sourceRecordId:row.sourceRecordId});
function history(deps:VentureDeps,row:EntryRecordRecord,own?:string,subject=historySubject(row)){check(!listRecords(deps.store.read(),'venture-journal-entry',row.ventureId).some(value=>value.id!==own&&value.subject===subject&&['approved','applied','outcome_unknown'].includes(value.state)),'FORM_ALREADY_SUBMITTED','This client record already has a completed or uncertain submit. Inspect it manually; it will not be sent again.');}
function sameClaim(deps:VentureDeps,ctx:Context,row:EntryRecordRecord){const live=currentEntry(deps,ctx,row.id);check(digest(live)===digest(row),'APPROVAL_STALE','This entry changed while the browser was working.');sourceAndSite(deps,ctx,live);formsScreenshot(deps,ctx,live);return live;}
export async function formsBrowserAction(deps:VentureDeps,ctx:Context,id:unknown,action:unknown,payload:unknown,expected:unknown){
 check(typeof id==='string'&&typeof action==='string'&&(FORM_BROWSER_ACTIONS as readonly string[]).includes(action),'INVALID_VENTURE_REQUEST','Choose an available data-entry action.');
 let row=currentEntry(deps,ctx,id);check(typeof expected==='string'&&expected===digest(row),'APPROVAL_STALE','Review the current client entry.');
 if(action==='close'){exactPayload(payload,[]);await endFormsBrowser(deps,row.id);return row;}
 if(action==='recover'){
  exactPayload(payload,[]);check(row.state==='submitting','FORM_ACTION_HELD','Only an interrupted submission needs an outcome check.');
  const journals=listRecords(deps.store.read(),'venture-journal-entry',row.ventureId).filter(value=>value.subject===(row.journalSubject??historySubject(row)));check(!journals.some(value=>value.state==='approved'),'FORM_STILL_RUNNING','Wait until the active journal claim settles.');
  await endFormsBrowser(deps,row.id);return replaceEntry(deps,ctx,row,{state:journals.some(value=>value.state==='applied'||value.state==='outcome_unknown')?'outcome-unknown':'not-sent',submitReview:null},true);
 }
 currentSource(deps,ctx,row);const port=formsPort(deps);
 if(action==='open'){check(await clearForgottenFormSignIns(deps,ctx),'FORM_PRIVACY_PENDING','Finish clearing the forgotten client sign-in before opening another browser.');requireFormsClientRule();
  const b=exactPayload(payload,['url','permissionFileId','allowed','revocableStaffLogin','savedSignInId']);
  check(['source','open','captured','filled','review','not-sent'].includes(row.state),'FORM_ACTION_HELD','Inspect this existing submit outcome before opening another attempt.');
  check(typeof b.permissionFileId==='string'&&(b.savedSignInId===null||b.savedSignInId==='new'||typeof b.savedSignInId==='string'&&/^[a-f0-9-]{36}$/.test(b.savedSignInId)),'FORM_PERMISSION_REQUIRED','Choose written permission and an explicit saved sign-in, or a fresh browser.');
  let origin='';try{origin=new URL(String(b.url)).origin;}catch{/* Site validator refuses malformed input. */}
  const site=approvedFormSite(b.url,{origin,allowed:b.allowed,revocableStaffLogin:b.revocableStaffLogin});
  const remembered=listRecords(deps.store.read(),'venture-entry-record',row.ventureId).filter(value=>value.clientId===row.clientId).flatMap(value=>[...(value.signIns??[]),...(value.site?.savedSignInId?[{id:value.site.savedSignInId,origin:value.site.origin}]:[])]);
  check(b.savedSignInId===null||b.savedSignInId==='new'||remembered.some(value=>value.id===b.savedSignInId&&value.origin===site.origin),'FORM_SIGNIN_REQUIRED','Choose a saved sign-in for this exact client and origin, or start a fresh one.');
  check(b.savedSignInId!=='new'||new Set(remembered.map(value=>value.id)).size<20,'FORM_SIGNIN_REQUIRED','Use an existing client sign-in. This client already has the supported number of remembered sign-ins.');
  const savedSignInId=b.savedSignInId==='new'?randomUUID():b.savedSignInId as string|null,signIns=[...(row.signIns??[])];if(row.site?.savedSignInId&&!signIns.some(value=>value.id===row.site!.savedSignInId))signIns.push({id:row.site.savedSignInId,origin:row.site.origin});if(savedSignInId&&!signIns.some(value=>value.id===savedSignInId))signIns.push({id:savedSignInId,origin:site.origin});
  const permission=permissionDigest(deps,ctx,row,b.permissionFileId),session=await newSession(deps,row);
  try{row=await replaceEntry(deps,ctx,row,{site:{...site,permissionFileId:b.permissionFileId,permissionDigest:permission,savedSignInId},signIns,browserRunId:session.runId,state:'open',mapping:[],submitReview:null,comparison:null,responseEvidence:null});
   history(deps,row);await port.open({runId:session.runId,...site,savedSignInId},()=>{guardSession(deps,ctx,row,session);},session.abort.signal);sameClaim(deps,ctx,row);return row;
  }catch(error){await endFormsBrowser(deps,row.id);throw error;}
 }
 const session=currentSession(deps,ctx,row);check(!session.busy,'FORM_ACTION_HELD','Wait for the current browser action to finish.');session.busy=true;
 try{
  if(action==='continue'){const b=exactPayload(payload,['url']);check(row.state==='sign-in-response','FORM_ACTION_HELD','Only a separately approved credential response can continue in this browser.');const site=approvedFormSite(b.url,{origin:row.site!.origin,allowed:true,revocableStaffLogin:true});await port.navigate(session.runId,{url:site.url});sameClaim(deps,ctx,row);guardSession(deps,ctx,row,session);session.capture=null;session.saved=null;return replaceEntry(deps,ctx,row,{state:'open',mapping:[],submitIntent:'record',submitReview:null,responseEvidence:null,comparison:null});}
  if(action==='capture'){
   exactPayload(payload,[]);check(['open','captured','filled','review'].includes(row.state),'FORM_ACTION_HELD','This entry cannot capture another form after submission.');
   const capture=formCapture(await port.capture(session.runId),row.site!.origin);sameClaim(deps,ctx,row);guardSession(deps,ctx,row,session);
   row=await replaceEntry(deps,ctx,row,{state:'captured',pageHash:capture.pageHash,submitReview:null});session.capture=capture;return row;
  }
  if(action==='fill'){
   const b=exactPayload(payload,['pageHash','mapping']);check(row.state==='captured'&&session.capture?.pageHash===b.pageHash,'FORM_TARGET_CHANGED','Capture the current client form before mapping.');
   const source=currentSource(deps,ctx,row),capture=session.capture!;
   const values=mapFormRecord({pageHash:b.pageHash,source:source.values,fields:capture.targets,mapping:b.mapping});
   const mapping=(b.mapping as {column:string;targetId:string}[]).map((item,index)=>({column:item.column,name:capture.targets.find(value=>value.id===item.targetId)!.name,value:values[index]!.value}));
   check(new Set(mapping.map(value=>value.name)).size===mapping.length&&mapping.every(value=>value.name.length>0),'FORM_MAPPING_INVALID','Choose unique named fields in one client form.');
   await port.fill(session.runId,{pageHash:b.pageHash,values:values.map(({pageHash,...value})=>value)});sameClaim(deps,ctx,row);guardSession(deps,ctx,row,session);
   row=await replaceEntry(deps,ctx,row,{state:'filled',mapping,submitReview:null});session.capture=null;return row;
  }
  if(action==='review-submit'||action==='review-sign-in'){
   const b=exactPayload(payload,['pageHash','targetId','fingerprint']);check(row.state==='captured'&&(action==='review-sign-in'?!row.mapping?.length:!!row.mapping?.length)&&session.capture?.pageHash===b.pageHash,'FORM_ACTION_HELD','Approve and fill a source mapping, then capture the filled form.');
   const target=session.capture!.targets.find(value=>value.id===b.targetId&&value.fingerprint===b.fingerprint);check(target?.kind==='submit'&&!target.disabled,'FORM_ACTION_HELD','Choose an actual native submit button. Other controls stay manual.');
   const review=submitReview(await port.prepare(session.runId,b),row.site!.origin,deps.clock().getTime());sameClaim(deps,ctx,row);guardSession(deps,ctx,row,session);
   if(action==='review-sign-in')check(review.credential,'FORM_ACTION_HELD','This is not a visible credential form. Use the source mapping approval for client records.');else check(row.mapping!.every(value=>review.review.some(field=>field.name===value.name&&field.value===value.value)),'FORM_MAPPING_INVALID','The prepared form no longer contains the exact source values.');
   return keepFormReview(deps,ctx,row,review,session.capture!,action==='review-sign-in'?'sign-in':'record');
  }
  if(action==='submit'){
   exactPayload(payload,[]);check(row.state==='review'&&row.submitReview&&Date.parse(row.submitReview.expiresAt)>deps.clock().getTime(),'FORM_ACTION_HELD','Review the exact current submit before approving it.');if(row.submitIntent!=='sign-in')history(deps,row);
   const review=row.submitReview,intent=row.submitIntent??'record',subject=intent==='sign-in'?'forms.sign-in.'+digest({clientId:row.clientId,origin:row.site!.origin,run:session.runId,handle:review.handle}):historySubject(row),actionDigest=digest({source:row.sourceDigest,mapping:row.mapping,site:row.site,review,intent}),target=digest({clientId:row.clientId,origin:row.site!.origin});
   row=await replaceEntry(deps,ctx,row,{state:'submitting',journalSubject:subject});let sent=false;let response:EntryRecordRecord['responseEvidence']=null;
   try{const result=await journalled(deps,ctx,{action:'connector.write',subject,target,account:target,operation:intent==='sign-in'?'forms-sign-in':'forms-submit',actionDigest,line:intent==='sign-in'?'Submit these owner-entered credentials to the exact approved client form.':'Submit this exact source record to the approved client form.',descriptionComplete:false,notAfter:review.expiresAt},async handle=>{
    try{sameClaim(deps,ctx,row);const outcome=await port.submit(session.runId,{handle:review.handle,digest:review.digest},()=>{check(!sent,'FORM_ALREADY_SUBMITTED','This exact request was already released.');sameClaim(deps,ctx,row);guardSession(deps,ctx,row,session);history(deps,row,handle.entry.id,subject);handle.fence(target);gateEffect({name:'forms.submit',digest:actionDigest},sealApproval(handle.entry,actionDigest));sent=true;});
     const value=exactPayload(outcome,['status','responseEvidence']);check(sent,'FORM_SEND_UNCONFIRMED','The browser did not confirm the physical submit boundary.');
     if(value.status==='response-received'){response=responseEvidence(value.responseEvidence,row.site!.origin);return {outcome:'applied' as const,line:'A completed response arrived. Read the saved record before calling it correct.',value:true};}
     if(value.status==='not-sent')return {outcome:'not-sent' as const,line:'The browser confirmed that the form was not sent.',value:false};
    }catch{if(!sent)return {outcome:'not-sent' as const,line:'Stopped before the physical submit. Nothing was sent.',value:false};}
    return {outcome:'unknown' as const,line:'Check the client system. This record may have been saved and will not be retried.',value:false};
   },{account:target});
   return await replaceEntry(deps,ctx,row,{state:result.entry.state==='applied'?(intent==='sign-in'?'sign-in-response':'response'):result.entry.state==='outcome_unknown'?'outcome-unknown':'not-sent',responseEvidence:response,submitReview:null},true);
   }catch(error){await endFormsBrowser(deps,row.id);throw error;}
  }
  if(action==='read-back'){
   exactPayload(payload,[]);check(row.state==='response'&&row.responseEvidence,'FORM_READBACK_UNAVAILABLE','A completed response is required for saved-record comparison.');
   const saved=savedCapture(await port.readSaved(session.runId),row.site!.origin);sameClaim(deps,ctx,row);guardSession(deps,ctx,row,session);check(digest(saved.responseEvidence)===digest(row.responseEvidence),'FORM_READBACK_UNAVAILABLE','This is not the response from the approved submit.');session.saved=saved;return row;
  }
  const b=exactPayload(payload,['readbackDigest','recordTargetId','mapping']);check(action==='compare'&&row.state==='response'&&session.saved?.digest===b.readbackDigest&&Array.isArray(b.mapping)&&(b.recordTargetId===null||typeof b.recordTargetId==='string'),'FORM_READBACK_INVALID','Select fields from the actual saved response.');
  const saved=session.saved!,source=currentSource(deps,ctx,row),used=new Set<string>(),columns=new Set<string>(),actual:Record<string,string>={};
  for(const value of b.mapping){const item=exactPayload(value,['column','targetId']);check(typeof item.column==='string'&&typeof item.targetId==='string'&&row.mapping?.some(mapped=>mapped.column===item.column)&&!columns.has(item.column)&&!used.has(item.targetId),'FORM_READBACK_INVALID','Select each original source column and one saved response field.');const target=saved.targets.find(target=>target.id===item.targetId);check(target,'FORM_READBACK_INVALID','Choose a field from this saved response.');columns.add(item.column);used.add(item.targetId);actual[item.column]=target.value;}
  check(columns.size===row.mapping!.length,'FORM_READBACK_INVALID','Compare every mapped source column.');const record=b.recordTargetId===null?null:saved.targets.find(value=>value.id===b.recordTargetId);check(b.recordTargetId===null||record&&record.value.trim().length>0&&record.value.length<=200,'FORM_READBACK_INVALID','Select the actual saved record identity, or leave it unverified.');
  const comparison=compareFormReadback(row.mapping!.map(value=>({targetId:value.column,value:source.values[value.column]!})),{recordId:record?.value??null,fields:actual});return replaceEntry(deps,ctx,row,{state:'checked',comparison});
 }finally{session.busy=false;}
}
