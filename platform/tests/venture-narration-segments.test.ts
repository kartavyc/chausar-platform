// Original source-bound narration checks, reusing A4 word scoring.
import test from 'node:test';import assert from 'node:assert/strict';
import {verifyNarrationSegment,approveNarrationSegment,narrationReady} from '../runtime/venture/playbooks/narration-studio/segments.ts';
import {narrationTail} from '../runtime/venture/playbooks/narration-studio/tails.ts';
import {narrationMasterCheck} from '../runtime/venture/playbooks/narration-studio/master-core.ts';
const source={id:'s1',text:'one two three four five six seven eight nine ten',voice:'hi',language:'hi-IN',pauseAfterMs:0,requestRevision:'v1',providerModelRevision:null,timing:'unconfirmed' as const};
test('actual transcript is scored and bound to exact audio/source; retry cannot be approved',()=>{
 const review=verifyNarrationSegment(source,{audioDigest:'a'.repeat(64),durationMs:5000,transcript:'one two three four five six seven eight nine',transcriptProvider:'local-whisper',lastSpeechEndMs:4500});
 assert.equal(review.verdict,'review');assert.equal(review.score,90);assert.equal(narrationReady(source,review,'a'.repeat(64)),false);
 const approved=approveNarrationSegment(source,review,review.binding,true);assert.equal(narrationReady(source,approved,'a'.repeat(64)),true);assert.equal(narrationReady({...source,text:'changed'},approved,'a'.repeat(64)),false);assert.equal(narrationReady(source,approved,'b'.repeat(64)),false);
 assert.throws(()=>approveNarrationSegment(source,review,'stale',true),{code:'APPROVAL_STALE'});
 const bad=verifyNarrationSegment(source,{audioDigest:'a'.repeat(64),durationMs:5000,transcript:'other words',transcriptProvider:'local-whisper',lastSpeechEndMs:4500});assert.equal(bad.verdict,'retry');assert.throws(()=>approveNarrationSegment(source,bad,bad.binding,true),{code:'NARRATION_RETRY_REQUIRED'});
});
test('tail keeps margin, never assumes unmeasured timing and rejects impossible bounds',()=>{
 assert.deepEqual(narrationTail(6000,4000),{cutAtMs:4250,removedMs:1750,marginMs:250,status:'cut-proposed'});
 assert.equal(narrationTail(4500,4000).status,'keep');assert.equal(narrationTail(6000,null).status,'unconfirmed');assert.throws(()=>narrationTail(3000,4000),{code:'NARRATION_TIMING_INVALID'});
});
test('master checks are dated, missing measurements never pass and ACX policy remains blocked',()=>{
 const measured={durationMs:5000,format:'mp3',sampleRate:44100,bitrateKbps:192,constantBitrate:true,bitDepth:16,channels:1,rmsTenths:-200,peakTenths:-40,noiseTenths:-650,headMs:700,tailMs:1500};
 assert.equal(narrationMasterCheck('spotify',measured).pass,true);assert.equal(narrationMasterCheck('spotify',null).pass,false);
 const acx=narrationMasterCheck('acx',measured);assert.equal(acx.pass,false);assert.ok(acx.findings.some(f=>f.id==='synthetic-permission'&&f.outcome==='fail'));
 assert.equal(narrationMasterCheck('spotify',{...measured,rmsTenths:null}).pass,false);
 assert.equal(narrationMasterCheck('spotify',{...measured,sampleRate:22050}).pass,false);
 assert.equal(narrationMasterCheck('spotify',{...measured,bitDepth:24}).pass,false);
 assert.equal(narrationMasterCheck('spotify',{...measured,bitDepth:null}).pass,false);
});
