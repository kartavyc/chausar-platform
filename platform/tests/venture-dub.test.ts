// Original J2 timing and retry contracts. No provider or network is used.
import test from 'node:test';import assert from 'node:assert/strict';
import {alignDub,quietSegments} from '../runtime/venture/playbooks/translation-studio/dub-align.ts';
import {newDubGroup,finishDubSentence,claimDubSentence} from '../runtime/venture/playbooks/translation-studio/dub-core.ts';
const source=[{id:'a',speaker:'Asha',text:'Hello world',startMs:0,endMs:2000},{id:'b',speaker:'Dev',text:'Good morning',startMs:3000,endMs:5000}];
const voices=[{speaker:'Asha',consentId:'consent-a',voice:'en-IN-Standard-A'},{speaker:'Dev',consentId:'consent-b',voice:'hi-IN-Standard-A'}];
test('alignment fits, then speeds up within 1.25, then borrows only real silence, otherwise reports without truncating',()=>{
 assert.deepEqual(alignDub(0,2000,3000,1500),{mode:'fit',tempo:1,startMs:0,endMs:1500,overflowMs:0});
 assert.equal(alignDub(0,2000,3000,2400).mode,'tempo');assert.equal(alignDub(0,2000,3000,2400).tempo,1.2);
 const extended=alignDub(0,2000,3000,3500);assert.equal(extended.mode,'extended');assert.equal(extended.endMs,2800);assert.equal(extended.tempo,1.25);
 const long=alignDub(0,2000,3000,5000);assert.equal(long.mode,'overlong');assert.equal(long.endMs,null);assert.equal(long.overflowMs,1000);
 assert.throws(()=>alignDub(0,2000,1999,2400),{code:'DUB_TIMING_INVALID'});
});
test('quiet segmentation covers every sample, uses minimum energy inside a bounded window and never exceeds ten seconds',()=>{
 const energy=Array.from({length:230},(_,i)=>({atMs:i*100,energy:i===80?0:1}));const spans=quietSegments(23000,energy);assert.equal(spans[0]!.endMs,8000);assert.equal(spans[0]!.startMs,0);assert.equal(spans.at(-1)!.endMs,23000);for(let i=0;i<spans.length;i++){assert.ok(spans[i]!.endMs-spans[i]!.startMs<=10000);if(i)assert.equal(spans[i]!.startMs,spans[i-1]!.endMs);}
 assert.throws(()=>quietSegments(23000,[]),{code:'DUB_AUDIO_REQUIRED'});
});
test('groups bind every speaker to one consent and voice, never substitute, retain old groups and only retry failed sentences',()=>{
 const group=newDubGroup('group-1','job','source-digest',source,voices);assert.equal(group.sentences.length,2);
 assert.throws(()=>newDubGroup('group-2','job','source-digest',source,voices.slice(0,1)),{code:'CONSENT_REQUIRED'});
 assert.throws(()=>claimDubSentence(group,'a','hi-IN-Standard-A'),{code:'VOICE_MISMATCH'});
 const started=claimDubSentence(group,'a','en-IN-Standard-A');assert.equal(started.sentences[0]!.state,'sending');
 const first=finishDubSentence(started,'a',{audioFileId:'audio-1',durationMs:1500,heard:'Wrong words'});assert.equal(first.sentences[0]!.state,'retry');assert.equal(first.sentences[0]!.attempts,1);
 const second=finishDubSentence(claimDubSentence(first,'a','en-IN-Standard-A'),'a',{audioFileId:'audio-2',durationMs:1600,heard:'Wrong words'});assert.equal(second.sentences[0]!.state,'review');assert.throws(()=>claimDubSentence(second,'a','en-IN-Standard-A'),{code:'DUB_RETRY_REFUSED'});
 const good=finishDubSentence(claimDubSentence(group,'a','en-IN-Standard-A'),'a',{audioFileId:'audio-3',durationMs:1500,heard:'Hello world'});assert.equal(good.sentences[0]!.state,'approved');assert.throws(()=>claimDubSentence(good,'a','en-IN-Standard-A'),{code:'DUB_RETRY_REFUSED'});assert.equal(group.sentences[0]!.state,'pending');
});
