// Chausar audio extraction boundary tests, original code over mocked public responses and local tools.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {extractAudio} from '../runtime/venture/playbooks/youtube/local-media.ts';import type {PinnedTarget} from '../runtime/venture/core/net-guard.ts';
const resolve=async()=>[{address:'142.250.1.10',family:4 as const}];
test('audio checks robots at a redirect before reading that target',async()=>{
 const sent:string[]=[];const deps={host:'desktop',ffmpeg:{locate:()=>'/ffmpeg',run:async()=>{throw Error('Must not run ffmpeg');}},net:{resolve,send:async(target:PinnedTarget)=>{sent.push(target.url.href);if(target.url.href==='https://media.example/source.mp4')return {status:302,headers:{location:'https://blocked.example/private.mp4'},body:Buffer.from('')};if(target.url.href==='https://blocked.example/robots.txt')return {status:200,headers:{},body:Buffer.from('User-agent: *\nDisallow: /private')};if(target.url.pathname==='/robots.txt')return {status:404,headers:{},body:Buffer.from('')};return {status:200,headers:{'content-length':'3'},body:Buffer.from('abc')};}}} as any;
 await assert.rejects(extractAudio(deps,{url:'https://media.example/source.mp4'}),{code:'ROBOTS_REFUSED'});assert.ok(!sent.includes('https://blocked.example/private.mp4'));
});
test('audio refuses an oversized declared source before a media GET',async()=>{
 const methods:string[]=[];const deps={host:'desktop',ffmpeg:{locate:()=>'/ffmpeg'},net:{resolve,send:async(target:PinnedTarget)=>{if(target.url.pathname==='/robots.txt')return {status:404,headers:{},body:Buffer.from('')};methods.push(target.method);return {status:200,headers:{'content-length':'600000000'},body:Buffer.from('')};}}} as any;
 await assert.rejects(extractAudio(deps,{url:'https://media.example/source.mp4'}),{code:'AUDIO_TOO_LARGE'});assert.deepEqual(methods,['HEAD']);
});
test('local extraction returns only completed audio with a digest and bounded file-only arguments',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'youtube-audio-source-'));try{const file=join(folder,'source.mp4');await writeFile(file,'owned source');let args:string[]=[];
 const deps={host:'desktop',ffmpeg:{locate:()=>'/ffmpeg',run:async(_binary:string,input:string[])=>{args=input;await writeFile(input.at(-1)!,'RIFF audio');return {code:0,stdout:'',stderr:'',timedOut:false,startError:null};}}} as any;
 const result=await extractAudio(deps,{file});assert.equal(Buffer.from(result.contentBase64,'base64').toString(),'RIFF audio');assert.equal(result.sha256.length,64);assert.ok(args.includes('1200'));assert.ok(args.includes('-protocol_whitelist'));assert.ok(args.includes('file'));await assert.rejects(extractAudio(deps,{file,url:'https://media.example/source.mp4'}),{code:'AUDIO_INPUT_INVALID'});
 }finally{await rm(folder,{recursive:true,force:true});}
});
