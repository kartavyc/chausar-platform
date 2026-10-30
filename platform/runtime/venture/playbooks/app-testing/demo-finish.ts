import {demoMediaSource,currentDemoRender,expectedDemoReview} from './demo-source.ts';
// Original exact-byte local render and owner review. Export is a download, never automatic client delivery.
import {createHash} from 'node:crypto';
import {check,type Context} from '../../../contracts.ts';import type {VentureDeps} from '../../contracts.ts';
import {digest,exactPayload,ventureAction} from '../../records.ts';
import {liveDemo,demoGuard} from './demo-runtime.ts';import {requireAppTestingClientRule} from './rules.ts';
import {renderDemoVideo} from './demo-render.ts';import type {DemoRendered} from './demo-records.ts';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function source(deps:VentureDeps,ctx:Context,orderId:string){const live=liveDemo(deps,ctx,orderId,'approve');return{...live,...demoMediaSource(live.state,live.venture.id,live.order,live.row,deps.clock().toISOString())};}
export async function finishDemo(deps:VentureDeps,ctx:Context,orderId:string,action:string,expected:unknown,payload:unknown){
 const live=source(deps,ctx,orderId),row=live.row;check(expected===digest(row),'APPROVAL_STALE','Review the current demo before changing it.');
 if(action==='render'){
  const b=exactPayload(payload,['cues'],['cues']);const made=await renderDemoVideo(deps,row.plan,{...row.video!,bytes:live.bytes},live.voices,b.cues);
  demoGuard(deps,ctx,orderId,digest(row));check(source(deps,ctx,orderId).sourceDigest===live.sourceDigest,'APPROVAL_STALE','The recording or narration changed during rendering.');
  const body={sourceDigest:live.sourceDigest,video:{name:'demo.mp4',contentBase64:made.bytes.toString('base64'),bytes:made.bytes.length,digest:sha(made.bytes),durationMs:made.durationMs,width:made.width,height:made.height},captions:made.captions,captionChecksNotRun:made.captionChecksNotRun,timing:made.timing,disclosure:made.disclosure};const rendered:DemoRendered={...body,digest:digest(body)};
  return ventureAction(deps,ctx,'approve','demo.render-save',tx=>{const current=tx.find('venture-demo-project',row.id);check(current&&digest(current)===expected,'APPROVAL_STALE','The demo changed while rendering.');check(source(deps,ctx,orderId).sourceDigest===live.sourceDigest,'APPROVAL_STALE','The saved media changed.');tx.replace({...current,rendered,reviewDigest:null});tx.emit('desk.changed',{playbook:'app-testing'});return{rendered,delivered:false};});
 }
 const rendered=currentDemoRender(row,live.sourceDigest);
 if(action==='review'){
  const b=exactPayload(payload,['watched','audioChecked','shots'],['watched','audioChecked','shots']);check(b.watched===true&&b.audioChecked===true&&Array.isArray(b.shots)&&b.shots.length===row.plan.shots.length&&b.shots.every((s:unknown,i:number)=>!!s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).sort().join(',')==='id,matches'&&(s as {id?:unknown}).id===row.plan.shots[i]!.id&&(s as {matches?:unknown}).matches===true),'DEMO_REVIEW_REQUIRED','Watch the complete rendered file, check its audio and captions, and confirm every planned shot.');
  return ventureAction(deps,ctx,'approve','demo.review',tx=>{const current=tx.find('venture-demo-project',row.id);check(current&&digest(current)===expected,'APPROVAL_STALE','The demo changed before review.');tx.replace({...current,reviewDigest:expectedDemoReview(current)});tx.emit('desk.changed',{playbook:'app-testing'});return{reviewed:true,source:'owner watched and listened',renderDigest:rendered.digest};});
 }
 check(action==='export','INVALID_VENTURE_REQUEST','Choose render, review or export.');exactPayload(payload,[]);requireAppTestingClientRule();check(row.reviewDigest===expectedDemoReview(row),'APPROVAL_REQUIRED','Review this exact rendered demo before exporting it.');
 const file=(name:string,mime:string,bytes:Buffer)=>({name,mime,contentBase64:bytes.toString('base64'),bytes:bytes.length,sha256:sha(bytes)});
 return{files:[file('demo.mp4','video/mp4',Buffer.from(rendered.video.contentBase64,'base64')),file('demo-captions.srt','application/x-subrip',Buffer.from(rendered.captions)),file('demo-description.txt','text/plain',Buffer.from(row.plan.description)),file('demo-review-receipt.json','application/json',Buffer.from(JSON.stringify({sourceDigest:live.sourceDigest,renderDigest:rendered.digest,videoDigest:rendered.video.digest,reviewDigest:row.reviewDigest,review:'owner watched and listened; each shot confirmed',captionTiming:rendered.timing,captionChecksNotRun:rendered.captionChecksNotRun,disclosure:rendered.disclosure},null,2)))],jobDigest:digest(row),delivered:false,line:'Download the reviewed files, then deliver them yourself. No client was contacted.'};
}
