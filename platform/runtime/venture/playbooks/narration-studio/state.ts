// Original exact quote and durable one-attempt state. No side effects or credential values live here.
import {check,digest} from '../../../portable.ts';
import {parseNarrationMarkup} from './markup.ts';
import type {NarrationQuote,NarrationSegmentBody} from './records.ts';
import type {NarrationDestination} from './master-core.ts';
export const NARRATION_VOICES=[{id:'hi-IN-Standard-A',language:'hi-IN',licence:'Google Cloud terms for stock voice output'},{id:'en-IN-Standard-A',language:'en-IN',licence:'Google Cloud terms for stock voice output'}] as const;
/** Google publishes its API revision, but does not expose an immutable Standard voice model revision. */
export function prepareNarrationRows(input:{orderId:string;clientId:string;sourceDigest:string;fileId:string;destination:NarrationDestination;source:string;voice:string;language:string}):NarrationSegmentBody[]{
 check(['client','spotify','acx','google-play'].includes(input.destination),'NARRATION_DESTINATION_INVALID','Choose the client or a listed distributor.');
 check(input.destination!=='acx'&&input.destination!=='google-play','NARRATION_DISTRIBUTOR_BLOCKED','This route is not qualified for external synthetic narration. Choose direct client delivery or Spotify and review its disclosure rules.');
 return parseNarrationMarkup(input.source,{voices:NARRATION_VOICES,voice:input.voice,language:input.language,requestRevision:'google-texttospeech-v1:20260827',providerModelRevision:null,maxBytes:5000}).map((segment,sequence)=>({orderId:input.orderId,clientId:input.clientId,sourceDigest:input.sourceDigest,fileId:input.fileId,destination:input.destination,sequence,segment,explainer:null,pending:null,attempts:[],verification:null,measurements:null,masterFileId:null,masterDigest:null,exportApproval:null,aiRequest:null,aiCallIds:[],reel:null}));
}
export const narrationRowDigest=(row:NarrationSegmentBody)=>digest(row);
function quoteBinding(row:NarrationSegmentBody,quote:NarrationQuote,keyVersion:string){return digest({orderId:row.orderId,clientId:row.clientId,sourceDigest:row.sourceDigest,segment:row.segment,destination:row.destination,quote,keyVersion,generation:row.attempts.length});}
/** A new paid retry is offered only after verification specifically marked the previous audio retry. */
export function quoteNarration(row:NarrationSegmentBody,quote:NarrationQuote,keyVersion:string,now:string):NarrationSegmentBody{
 check(!row.attempts.some(a=>a.phase==='sending'||a.phase==='unknown'),'NARRATION_OUTCOME_UNKNOWN','A previous call may have been charged. Check provider usage; Chausar will not retry it.');
 check(row.attempts.length===0||row.verification?.verdict==='retry','NARRATION_AUDIO_EXISTS','Review the existing audio before making another paid call.');
 check(quote.provider==='google-tts'&&quote.voice===row.segment.voice&&/^\d+$/.test(quote.micros)&&quote.chars===[...row.segment.text].length&&keyVersion.length>0,'NARRATION_QUOTE_REQUIRED','Make a quote for this exact voice and text.');
 return {...structuredClone(row),pending:{quote:structuredClone(quote),keyVersion,binding:quoteBinding(row,quote,keyVersion),expiresAt:new Date(Date.parse(now)+30*60000).toISOString()}};
}
/** Persist this claim before entering the provider path; a restart cannot reuse its approval. */
export function claimNarration(row:NarrationSegmentBody,approvedBinding:string,keyVersion:string,now:string):NarrationSegmentBody{
 const pending=row.pending;check(pending,'NARRATION_QUOTE_REQUIRED','Review and approve the exact speech quote first.');
 check(pending.keyVersion===keyVersion&&pending.binding===approvedBinding&&quoteBinding(row,pending.quote,keyVersion)===approvedBinding&&Date.parse(pending.expiresAt)>Date.parse(now),'APPROVAL_STALE','The source, voice, account or quote changed. Make a fresh quote.');
 check(!row.attempts.some(a=>a.phase==='sending'||a.phase==='unknown'),'NARRATION_OUTCOME_UNKNOWN','A previous call may have been charged. Check provider usage; Chausar will not retry it.');
 const next=structuredClone(row);next.attempts.push({id:digest({approvedBinding,generation:row.attempts.length}),keyVersion:pending.keyVersion,phase:'sending',quote:pending.quote,audioFileId:null,audioDigest:null,failure:null});next.pending=null;next.verification=null;next.measurements=null;next.masterFileId=null;next.masterDigest=null;next.exportApproval=null;return next;
}
