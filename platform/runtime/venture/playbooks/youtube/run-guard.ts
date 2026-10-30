import {currentScreencastProof} from './screencast-source.ts';
import {requireCurrentWordSource} from './bound-source.ts';
import {currentBoard} from './board-core.ts';
// Exact current source guards for YouTube services and source-backed agent calls.
import {check,type State} from '../../../contracts.ts';import type {OrderRecord,VentureRecord,VentureDeps,ToolCallRecord} from '../../contracts.ts';import {digest,listRecords,findRecord} from '../../records.ts';import {businessPlaybookId} from '../../build/mail-in.ts';import {currentYoutubeOrder,currentYoutubeResearch} from './research-desk.ts';import {currentYoutubePublic} from './public-desk.ts';import {isYoutubeService} from './service-fields.ts';
const required:Record<string,string>={'after-publish-review':'after-publish','niche-report':'niche','comment-triage':'comments','comment-insights':'comments','channel-audit':'outliers'};
const researchTools=['youtube.afterPublish','youtube.niche','youtube.outliers','youtube.comments','youtube.archive'];
export function refuseYoutubeDraft(state:State,venture:VentureRecord,order:OrderRecord,now:string,calls:readonly ToolCallRecord[]=[]){
 if(businessPlaybookId(state,venture)!=='youtube')return;
 const offer=listRecords(state,'venture-blueprint',venture.id).at(-1)?.offers.find(offer=>offer.id===order.offerId),mode=required[offer?.playbookOffer??''];
 if(isYoutubeService(offer?.playbookOffer)||order.youtubeResearch||order.youtubePublic)currentYoutubeOrder(state,venture.id,order.id,now);
 if(mode||order.youtubeResearch){const {body}=currentYoutubeResearch(state,venture.id,order.id,now);check(!mode||body.mode===mode,'YOUTUBE_SOURCE_REQUIRED','Prepare the source analysis this exact service uses.');}
 if(offer?.playbookOffer==='screencast-tutorial'){
  const call=[...calls].reverse().find(row=>row.tool==='youtube.export');
  if(call?.outcome==='succeeded'&&call.envelope.ok){const result=call.envelope.result as {screencast?:{editId?:string}}|null,proof=result?.screencast,edit=typeof proof?.editId==='string'?findRecord(state,'venture-youtube-edit',proof.editId):undefined;check(edit&&edit.ventureId===venture.id&&edit.orderId===order.id,'DERIVED_STALE','Read the current screencast board again.');requireCurrentWordSource(state,edit);currentBoard(edit.board,edit.document);check(digest(currentScreencastProof(state,venture.id,order,edit,now))===digest(proof),'DERIVED_STALE','The screencast edit, board or approved script changed. Export its reviewed handoff again.');}
 }
 for(const tool of [...researchTools,'youtube.publicStats']){const call=[...calls].reverse().find(row=>row.tool===tool);if(!call||call.outcome!=='succeeded'||!call.envelope.ok)continue;const output=call.envelope.result;check(output&&typeof output==='object'&&!Array.isArray(output),'DERIVED_STALE','Read the current source again.');const body=tool==='youtube.publicStats'?currentYoutubePublic(state,venture.id,order.id,now).body:currentYoutubeResearch(state,venture.id,order.id,now).body;check(output.sourceSeal===digest(body),'DERIVED_STALE','The source analysis changed after the tool read it. Read it again before writing or accepting.');}
}
/** Captured before asynchronous model preparation. The common model port invokes this at physical transport. */
export function youtubeDispatchGuard(deps:VentureDeps,venture:VentureRecord,order:OrderRecord,calls:readonly ToolCallRecord[]=[]){
 const state=deps.store.read();if(businessPlaybookId(state,venture)!=='youtube')return ()=>{};
 refuseYoutubeDraft(state,venture,order,deps.clock().toISOString(),calls);const expected=digest(order);
 return ()=>{const live=findRecord(deps.store.read(),'venture-order',order.id);check(live&&digest(live)===expected,'DERIVED_STALE','The YouTube order changed after this model request was prepared.');refuseYoutubeDraft(deps.store.read(),venture,live,deps.clock().toISOString(),calls);};
}
