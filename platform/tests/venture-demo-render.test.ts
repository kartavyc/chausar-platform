// Synthetic ffmpeg port tests actual file boundaries, not installed media qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,access} from 'node:fs/promises';
import {dirname} from 'node:path';
import {renderDemoVideo,demoCaptionInput} from '../runtime/venture/playbooks/app-testing/demo-render.ts';
import {demoPlan} from '../runtime/venture/playbooks/app-testing/demo.ts';
const plan=demoPlan({title:'Home',script:'Open the home page.',shots:[{id:'home',action:'Open Home',seconds:3}],clientTestAccount:true,aiVoice:true,description:'This video uses an AI voice.'});
const cues=[{id:'c1',startMs:0,endMs:2000,lines:['Open the home page.'],words:null}];
const bytes=Buffer.from([0,0,0,20,102,116,121,112,105,115,111,109]);
const log=(audio:boolean,duration='00:00:03.00')=>`Input #0, mov, from 'source':\n Duration: ${duration}, start: 0.0\n Stream #0:0: Video: h264, yuv420p, 1280x720, 25 fps\n${audio?' Stream #0:1: Audio: aac, 44100 Hz, mono\n':''}`;
test('demo caption input validates the actual script, bounds and A4 findings without inventing word timing',()=>{
 const good=demoCaptionInput(plan,cues,3000);assert.equal(good.cues.length,1);assert.equal(good.notRun[0]?.check,'pause-breaks');
 assert.throws(()=>demoCaptionInput(plan,[{...cues[0],lines:['Unrelated claim.']}],3000),{code:'DEMO_CAPTIONS_INVALID'});
 assert.throws(()=>demoCaptionInput(plan,[{...cues[0],endMs:4000}],3000),{code:'DEMO_CAPTIONS_INVALID'});
 assert.throws(()=>demoCaptionInput(plan,[{...cues[0],words:[{text:'Open',startMs:0,endMs:50}]}],3000),{code:'INVALID_VENTURE_REQUEST'});
});
test('demo render probes actual inputs, burns captions and AI disclosure, checks output and removes scratch',async()=>{
 let folder='',held=0,released=0;const calls:string[][]=[];
 const result=await renderDemoVideo({host:'desktop',closing:{signal:new AbortController().signal,hold(){held++;return()=>{released++;};}},ffmpeg:{locate:()=>'/fixture/ffmpeg',run:async(_binary,args)=>{calls.push([...args]);folder=dirname(args[args.indexOf('-i')+1]!);if(args.includes('libx264')){assert.equal(held,1);assert.ok(args.join(' ').includes('disclosure.srt'));assert.ok(args.includes('-map_metadata'));await writeFile(args.at(-1)!,bytes);}return{code:0,timedOut:false,startError:null,stderr:args.some(v=>v.endsWith('voice-0.mp3'))?log(true,'00:00:02.00'):log(args.some(v=>v.endsWith('demo.mp4')))};}}},plan,{bytes,durationMs:3000,width:1280,height:720},[{bytes:Buffer.from('synthetic speech'),format:'mp3'}],cues);
 assert.equal(result.durationMs,3000);assert.equal(result.disclosure,'AI narration');assert.equal(result.bytes.toString('base64'),bytes.toString('base64'));assert.equal(released,1);assert.ok(calls.every(c=>c.includes('-protocol_whitelist')));await assert.rejects(access(folder));
});
test('demo refuses voice longer than actual recording before rendering instead of cutting words',async()=>{
 let rendered=false;await assert.rejects(renderDemoVideo({host:'desktop',ffmpeg:{locate:()=>'/fixture/ffmpeg',run:async(_binary,args)=>{if(args.includes('libx264'))rendered=true;return{code:0,timedOut:false,startError:null,stderr:log(args.some(v=>v.endsWith('.mp3')),args.some(v=>v.endsWith('.mp3'))?'00:00:04.00':'00:00:03.00')};}}},plan,{bytes,durationMs:3000,width:1280,height:720},[{bytes:Buffer.from('speech'),format:'mp3'}],cues),{code:'DEMO_VOICE_TOO_LONG'});assert.equal(rendered,false);
});
