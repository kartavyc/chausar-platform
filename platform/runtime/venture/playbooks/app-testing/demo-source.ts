// One exact source validator shared by local rendering, Work and final delivery.
import {createHash} from 'node:crypto';
import {check,type State} from '../../../contracts.ts';
import type {DemoProjectRecord,OrderRecord} from '../../contracts.ts';
import {digest,listRecords} from '../../records.ts';
import {requireDemoPlan} from './demo-runtime.ts';
import {narrationRights} from '../narration-studio/source-core.ts';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function demoMediaSource(state:State,ventureId:string,order:OrderRecord,row:DemoProjectRecord,now:string){
 const orderId=order.id;requireDemoPlan(row.plan,row.approvedPlan);if(row.plan.aiVoice)narrationRights(order,now.slice(0,10));
 check(row.video,'DEMO_RECORDING_REQUIRED','Finish the actual private desktop recording first.');
 const bytes=Buffer.from(row.video.contentBase64,'base64');check(bytes.length===row.video.bytes&&sha(bytes)===row.video.digest,'APPROVAL_STALE','The recorded desktop bytes changed.');
 const files=listRecords(state,'venture-upload',ventureId);
 const voices=row.voiceRows.map(v=>{const attempt=v.attempts.at(-1),file=files.find(f=>f.id===attempt?.audioFileId),script=files.find(f=>f.id===v.fileId);check(v.clientId===row.clientId&&v.orderId===row.orderId&&v.sourceDigest===row.plan.digest&&script?.scope.kind==='order'&&script.scope.orderId===orderId&&Buffer.from(script.contentBase64,'base64').toString('utf8')===row.plan.script&&attempt?.phase==='made'&&file?.scope.kind==='order'&&file.scope.orderId===orderId&&file.format==='audio','DEMO_VOICE_REQUIRED','Make every approved narration segment before mixing the demo.');const audio=Buffer.from(file.contentBase64,'base64');check(audio.length===file.bytes&&sha(audio)===file.digest&&file.digest===attempt.audioDigest,'APPROVAL_STALE','The saved narration audio changed.');return{bytes:audio,format:'mp3' as const,id:file.id,digest:file.digest};});
 check(row.plan.aiVoice?voices.length>0:voices.length===0,'DEMO_VOICE_REQUIRED','Use the exact approved narration or a silent demo.');
 return{bytes,voices,sourceDigest:digest({order:row.orderDigest,plan:row.plan.digest,recording:row.video.digest,voices:voices.map(v=>({id:v.id,digest:v.digest}))})};
}
export const expectedDemoReview=(row:DemoProjectRecord)=>digest({render:row.rendered?.digest,watched:true,audioChecked:true,shots:row.plan.shots.map(s=>({id:s.id,matches:true}))});
export const currentDemoRender=(row:DemoProjectRecord,sourceDigest:string)=>{const r=row.rendered;check(r,'APPROVAL_STALE','Render the current approved demo first.');const{digest:renderDigest,...body}=r;check(r.sourceDigest===sourceDigest&&renderDigest===digest(body)&&sha(Buffer.from(r.video.contentBase64,'base64'))===r.video.digest,'APPROVAL_STALE','Render the current approved recording, narration and captions first.');return r;};
