// One exact non-credential approval image per source record, kept in the existing client media store.
import {check,type Context} from '../../../contracts.ts';
import {digest,listRecords,readVenture,ventureAction} from '../../records.ts';
import type {EntryRecordRecord,UploadRecord,VentureDeps} from '../../contracts.ts';
import {cleanPng} from '../kit/media-intake.ts';
import {currentSource} from './browser-state.ts';
import type {FormCapture} from './browser-types.ts';
import type {FormSubmitReview} from './records.ts';
import {removeRecords} from '../../network/people.ts';
export function formsScreenshot(deps:VentureDeps,ctx:Context,row:EntryRecordRecord){
 if(!row.screenshot||row.screenshot.origin!==row.site?.origin)return [];if(row.state==='review')check(row.submitReview?.digest===row.screenshot.requestDigest,'FORM_SOURCE_CHANGED','Review the screenshot for this exact request.');const {state}=readVenture(deps,ctx),file=listRecords(state,'venture-upload',row.ventureId).find(file=>file.id===row.screenshot!.fileId);check(file?.format==='image'&&file.scope.kind==='media'&&file.scope.orderId===row.orderId&&file.digest===row.screenshot.digest&&digest(file.contentBase64)===row.screenshot.digest,'FORM_SOURCE_CHANGED','The approved screenshot changed. Review the record again.');return [{phase:'approved-form' as const,pageHash:row.screenshot.pageHash,screenshot:{mime:'image/png',base64:file.contentBase64}}];
}
export async function keepFormReview(deps:VentureDeps,ctx:Context,row:EntryRecordRecord,review:FormSubmitReview,capture:FormCapture,intent:'record'|'sign-in'){
 const image=intent==='record'&&!review.credential?capture.screenshot:null;
 const encoded=image?Buffer.from(cleanPng(Buffer.from(image.base64,'base64')).bytes).toString('base64'):null;
 check(encoded===null||Buffer.byteLength(encoded,'base64')<=1450000,'FORM_CAPTURE_INCOMPLETE','This review screenshot is too large. Resize the client window and capture it again.');
 return ventureAction(deps,ctx,'approve','forms.review',tx=>{const live=tx.find('venture-entry-record',row.id);check(live&&digest(live)===digest(row),'APPROVAL_STALE','This client entry changed. Review the current record.');currentSource(deps,ctx,live);
  let screenshot:EntryRecordRecord['screenshot']=null;
  if(encoded){const file:UploadRecord={...tx.base('venture-upload'),name:'approved-form.png',format:'image',bytes:Buffer.byteLength(encoded,'base64'),digest:digest(encoded),contentBase64:encoded,scope:{kind:'media',orderId:row.orderId},clientData:true};tx.put(file);screenshot={fileId:file.id,digest:file.digest,pageHash:capture.pageHash,origin:row.site!.origin,requestDigest:review.digest};}
  if(live.screenshot)removeRecords(tx,value=>value.kind==='venture-upload'&&value.id===live.screenshot!.fileId);
  const next={...live,state:'review' as const,submitIntent:intent,submitReview:review,screenshot};tx.replace(next);tx.emit('desk.changed',{playbook:'data-entry-desk',kind:'entries',id:next.id});return next;
 });
}
