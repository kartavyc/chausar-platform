// Original Chausar source/audio binding. Word scoring is the existing A4 house algorithm, not a model judgement.
import {check,digest} from '../../../portable.ts';
import {scoreBack} from '../kit/transcribe-back.ts';
import type {NarrationTextSegment} from './markup.ts';
export type NarrationVerification={sourceDigest:string;audioDigest:string;durationMs:number;transcript:string;transcriptProvider:string;lastSpeechEndMs:number|null;score:number;verdict:'approved'|'review'|'retry';binding:string;ownerApproval:string|null};
/** Called only with the transcript produced from the stored audio, never owner-entered success scores. */
export function verifyNarrationSegment(source:NarrationTextSegment,input:{audioDigest:string;durationMs:number;transcript:string;transcriptProvider:string;lastSpeechEndMs:number|null}):NarrationVerification{
 check(/^[a-f0-9]{64}$/.test(input.audioDigest)&&Number.isSafeInteger(input.durationMs)&&input.durationMs>0&&input.durationMs<=7200000&&input.transcript.trim()&&input.transcript.length<=20000&&input.transcriptProvider.trim(),'NARRATION_VERIFICATION_REQUIRED','Measure the audio and transcribe it back before review.');
 check(input.lastSpeechEndMs===null||Number.isSafeInteger(input.lastSpeechEndMs)&&input.lastSpeechEndMs>=0&&input.lastSpeechEndMs<=input.durationMs,'NARRATION_TIMING_INVALID','Speech timing must fit the measured audio.');
 const scored=scoreBack(source.text,input.transcript),evidence={sourceDigest:digest(source),...input,...scored};return {...evidence,binding:digest(evidence),ownerApproval:null};
}
/** An owner listening decision approves this exact source, audio and transcript, and never overrides retry. */
export function approveNarrationSegment(source:NarrationTextSegment,verification:NarrationVerification,binding:string,listened:boolean):NarrationVerification{
 check(digest(source)===verification.sourceDigest&&binding===verification.binding,'APPROVAL_STALE','The text or audio changed. Listen to the current segment.');check(verification.verdict!=='retry','NARRATION_RETRY_REQUIRED','Make this segment again before approving it.');check(listened===true,'NARRATION_LISTEN_REQUIRED','Listen to this audio before approving it.');return {...verification,ownerApproval:binding};
}
/** Exact owner review is required even when the automatic word check passed; stress and tone are human checks. */
export function narrationReady(source:NarrationTextSegment,verification:NarrationVerification|null,audioDigest:string):boolean{return !!verification&&verification.verdict!=='retry'&&verification.ownerApproval===verification.binding&&verification.sourceDigest===digest(source)&&verification.audioDigest===audioDigest;}
