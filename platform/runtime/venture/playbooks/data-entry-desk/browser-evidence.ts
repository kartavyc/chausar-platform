// Strict private-host response boundaries. No renderer-provided page content is trusted as browser evidence.
import {check} from '../../../portable.ts';
import type {FormCapture,SavedCapture,FormSubmitReview} from './browser-state.ts';
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v:unknown,max=4000):v is string=>typeof v==='string'&&v.length<=max;
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function need(ok:unknown):asserts ok{check(ok,'FORM_CAPTURE_INCOMPLETE','The private browser response is incomplete. Stop and inspect the client record manually.');}
function localUrl(value:unknown,origin:string):value is string{try{const u=new URL(String(value));return typeof value==='string'&&u.protocol==='https:'&&u.origin===origin&&!u.username&&!u.password&&!u.hash&&value.length<=2048;}catch{return false;}}
export function formCapture(value:unknown,origin:string):FormCapture{
 need(obj(value)&&value.complete===true&&hash(value.pageHash)&&localUrl(value.url,origin)&&text(value.title,500)&&Array.isArray(value.pages)&&value.pages.length>0&&value.pages.length<=25&&Array.isArray(value.targets)&&value.targets.length<=100);
 need(value.pages.every((page,index)=>obj(page)&&page.index===index&&page.pageHash===value.pageHash&&text(page.text)));
 need(value.targets.every(field=>obj(field)&&Object.keys(field).sort().join(',')==='disabled,fingerprint,id,inForm,kind,name,pageHash'&&id(field.id)&&hash(field.fingerprint)&&field.pageHash===value.pageHash&&text(field.name,200)&&typeof field.disabled==='boolean'&&typeof field.inForm==='boolean'&&typeof field.kind==='string'&&['text','textarea','select','checkbox','submit','button','role-button','password','file','download','link','unknown'].includes(field.kind)));
 need(new Set(value.targets.map((field:any)=>field.id)).size===value.targets.length);
 need(value.screenshot===null||obj(value.screenshot)&&value.screenshot.mime==='image/png'&&typeof value.screenshot.base64==='string'&&value.screenshot.base64.length<=8000000&&/^[A-Za-z0-9+/]*={0,2}$/.test(value.screenshot.base64));
 return structuredClone(value) as FormCapture;
}
export function submitReview(value:unknown,origin:string,now:number):FormSubmitReview{
 need(obj(value)&&Object.keys(value).sort().join(',')==='credential,digest,expiresAt,handle,method,review,sensitive,url'&&id(value.handle)&&hash(value.digest)&&localUrl(value.url,origin)&&value.method==='POST'&&typeof value.sensitive==='boolean'&&typeof value.credential==='boolean'&&typeof value.expiresAt==='string'&&Date.parse(value.expiresAt)>now&&Date.parse(value.expiresAt)<=now+120000&&Array.isArray(value.review)&&value.review.length>0&&value.review.length<=100);
 need(value.review.every(row=>obj(row)&&Object.keys(row).sort().join(',')==='name,value'&&text(row.name,120)&&(row.value===null||text(row.value))));need(new Set(value.review.map((row:any)=>row.name)).size===value.review.length);
 return structuredClone(value) as FormSubmitReview;
}
export function responseEvidence(value:unknown,origin:string):SavedCapture['responseEvidence']{need(obj(value)&&Object.keys(value).sort().join(',')==='requestId,statusCode,url'&&(typeof value.requestId==='string'&&value.requestId.length<=100||typeof value.requestId==='number'&&Number.isSafeInteger(value.requestId))&&localUrl(value.url,origin)&&typeof value.statusCode==='number'&&Number.isInteger(value.statusCode)&&value.statusCode>=200&&value.statusCode<300);return structuredClone(value) as SavedCapture['responseEvidence'];}
export function savedCapture(value:unknown,origin:string):SavedCapture{need(obj(value)&&Object.keys(value).sort().join(',')==='digest,responseEvidence,targets'&&hash(value.digest)&&Array.isArray(value.targets)&&value.targets.length<=200);responseEvidence(value.responseEvidence,origin);need(value.targets.every(row=>obj(row)&&Object.keys(row).sort().join(',')==='fingerprint,id,kind,name,value'&&id(row.id)&&hash(row.fingerprint)&&text(row.name,200)&&text(row.kind,30)&&text(row.value)));need(new Set(value.targets.map((row:any)=>row.id)).size===value.targets.length);return structuredClone(value) as SavedCapture;}
