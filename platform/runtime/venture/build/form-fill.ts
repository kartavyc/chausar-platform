// Source-bound agent assistance for the desktop form workflow. This module never submits or fills a browser.
import {check,type Context} from '../../contracts.ts';
import {digest,findRecord,listRecords,ventureAction} from '../records.ts';
import type {VentureDeps} from '../contracts.ts';
import {currentSource,formsTransient} from '../playbooks/data-entry-desk/browser-state.ts';
import {formsRunCurrent,formsRunSource} from '../playbooks/data-entry-desk/run-source.ts';
import {formArtifact} from '../playbooks/data-entry-desk/checks.ts';
import {mapFormRecord} from '../playbooks/data-entry-desk/mapping.ts';
export function formWorkEntry(deps:VentureDeps,ctx:Context,ventureId:string,runId:string,entryId:string){
 const state=deps.store.read(),run=findRecord(state,'venture-delivery-run',runId),row=findRecord(state,'venture-entry-record',entryId);
 check(run&&run.ventureId===ventureId&&run.status==='waiting-for-you'&&row&&row.ventureId===ventureId&&row.orderId===run.orderId,'FORM_ORDER_REQUIRED','Choose a current entry from this exact active data-entry run.');
 formsRunCurrent(state,ventureId,run);const source=currentSource(deps,ctx,row);return {row,source,capture:formsTransient(deps,row).capture};
}
export function formWorkRows(deps:VentureDeps,ctx:Context,ventureId:string,runId:string){const state=deps.store.read(),run=findRecord(state,'venture-delivery-run',runId);check(run&&run.ventureId===ventureId&&run.status==='waiting-for-you','FORM_ORDER_REQUIRED','Use an active data-entry run.');return listRecords(state,'venture-entry-record',ventureId).filter(row=>row.orderId===run.orderId).map(row=>{const source=currentSource(deps,ctx,row);return {id:row.id,sourceRecordId:row.sourceRecordId,state:row.state,columns:source.columns};});}
export async function proposeFormMapping(deps:VentureDeps,ctx:Context,ventureId:string,runId:string,entryId:string,mapping:unknown){
 const current=formWorkEntry(deps,ctx,ventureId,runId,entryId);check(current.row.state==='captured'&&current.capture,'FORM_TARGET_CHANGED','Capture the current client form before proposing its mapping.');
 const values=mapFormRecord({pageHash:current.capture.pageHash,source:current.source.values,fields:current.capture.targets,mapping});
 return ventureAction(deps,ctx,'prepare','forms.propose-mapping',tx=>{const live=formWorkEntry(deps,ctx,ventureId,runId,entryId);check(digest(live.row)===digest(current.row)&&live.capture?.pageHash===current.capture!.pageHash,'APPROVAL_STALE','The source or form changed before the proposal was saved.');const proposal={pageHash:current.capture!.pageHash,sourceDigest:current.row.sourceDigest,mapping:structuredClone(mapping) as {column:string;targetId:string}[]};const row=tx.find('venture-entry-record',entryId);check(row&&digest(row)===digest(current.row),'APPROVAL_STALE','Review the current source mapping.');tx.replace({...row,mappingProposal:proposal});tx.emit('desk.changed',{playbook:'data-entry-desk',kind:'entries',id:row.id});return {entryId,pageHash:proposal.pageHash,values,needsOwnerApproval:true,filled:false,submitted:false};});
}

export function formWorkArtifact(deps:VentureDeps,ventureId:string,runId:string){const state=deps.store.read(),run=findRecord(state,'venture-delivery-run',runId);check(run&&run.ventureId===ventureId,'FORM_ORDER_REQUIRED','Use this data-entry run.');formsRunCurrent(state,ventureId,run);const source=formsRunSource(state,ventureId,run.orderId),stage=run.chainStage===2?'report':'mapping';return {heading:stage==='mapping'?'Field mapping':'Saved records',text:formArtifact(source.rows,stage)};}
