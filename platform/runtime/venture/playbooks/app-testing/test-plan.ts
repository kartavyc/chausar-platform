// Original typed test plan. phone-harness (MIT) and ZCode (Apache-2.0) informed workflow only, no code copied.
import {check,digest} from '../../../portable.ts';
export type AppTestPlan={description:string;packageName:string;apk:{uploadId:string;sha256:string;fromClient:true};steps:{id:string;title:string;expected:string}[];digest:string};
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{check(!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),'INVALID_VENTURE_REQUEST','Use only the named test plan fields.');}
function text(value:unknown,max:number):asserts value is string{check(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'INVALID_VENTURE_REQUEST','Use bounded plain words for the test plan.');}
/** A proposal names expected behavior, never a shell command or permission grant. */
export function appTestPlan(input:unknown):AppTestPlan{
 exact(input,['description','packageName','apk','steps']);text(input.description,4000);text(input.packageName,200);check(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(input.packageName),'INVALID_VENTURE_REQUEST','Use the Android package name supplied by the client.');
 exact(input.apk,['uploadId','sha256','fromClient']);text(input.apk.uploadId,160);check(typeof input.apk.sha256==='string'&&/^[a-f0-9]{64}$/.test(input.apk.sha256),'INVALID_VENTURE_REQUEST','Use the stored client APK fingerprint.');check(input.apk.fromClient===true,'CLIENT_APK_REQUIRED','The APK must come from this client order.');
 check(Array.isArray(input.steps)&&input.steps.length>=1&&input.steps.length<=30,'INVALID_VENTURE_REQUEST','Choose one to thirty test steps.');const ids=new Set<string>();
 const steps=input.steps.map(row=>{exact(row,['id','title','expected']);text(row.id,60);text(row.title,200);text(row.expected,1000);check(/^[a-z][a-z0-9-]*$/.test(row.id)&&!ids.has(row.id),'INVALID_VENTURE_REQUEST','Give every test step its own short name.');ids.add(row.id);return {id:row.id,title:row.title,expected:row.expected};});
 const plan={description:input.description,packageName:input.packageName,apk:{uploadId:input.apk.uploadId,sha256:input.apk.sha256,fromClient:true as const},steps};return {...plan,digest:digest(plan)};
}
/** Recompute the proposal before using the owner's saved decision; no caller-made digest is trusted. */
export function requireTestPlan(plan:AppTestPlan,approvedDigest:string|null):AppTestPlan{check(approvedDigest,'APPROVAL_REQUIRED','Approve the exact test plan first.');const {digest:claimed,...body}=plan,current=appTestPlan(body);check(current.digest===claimed&&current.digest===approvedDigest,'APPROVAL_STALE','The test plan or APK changed. Review it again.');return current;}
