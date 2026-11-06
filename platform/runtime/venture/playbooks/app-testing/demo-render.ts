// Original local mux. Only the recorded private desktop and source-bound speech enter ffmpeg.
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {check} from '../../../contracts.ts';import type {VentureDeps} from '../../contracts.ts';
import {systemFfmpeg,FILE_ONLY_INPUT,parseFfmpegLog} from '../youtube/finishing.ts';
import {filterPath} from '../kit/ffmpeg-path.ts';import {toSrt} from '../kit/captions.ts';
import type {DemoPlan} from './demo.ts';import {demoCaptionInput} from './demo-captions.ts';
export {demoCaptionInput} from './demo-captions.ts';
type Source={bytes:Buffer;durationMs:number;width:number;height:number};
export async function renderDemoVideo(deps:Pick<VentureDeps,'host'|'closing'|'ffmpeg'>,plan:DemoPlan,source:Source,voices:readonly {bytes:Buffer;format:'mp3'|'wav'}[],rawCues:unknown){
 check(deps.host!=='hosted-web','TIER_UNAVAILABLE','Demo rendering needs desktop ffmpeg.');
 const port=deps.ffmpeg??systemFfmpeg,binary=port.locate();check(binary,'MEDIA_TOOL_UNAVAILABLE','ffmpeg is not installed on this computer.');
 check(source.bytes.length>0&&source.bytes.length<=20*1024*1024&&voices.length<=100&&voices.every(v=>['mp3','wav'].includes(v.format)&&v.bytes.length>0&&v.bytes.length<=20*1024*1024),'DEMO_MEDIA_INVALID','Use bounded recording and narration files.');
 check(plan.aiVoice?voices.length>0:voices.length===0,'DEMO_VOICE_REQUIRED','Use the approved AI voice for an AI-narrated demo, or no added voice for a silent demo.');
 const folder=await mkdtemp(join(tmpdir(),'chausar-demo-')),release=deps.closing?.hold();
 const run=async(args:readonly string[])=>{check(!deps.closing?.signal.aborted,'DEMO_STOPPED','The workspace closed. No new demo was kept.');const result=await port.run(binary,['-hide_banner','-nostats','-nostdin',...args],120000,deps.closing?.signal);check(result.code===0&&!result.timedOut&&!result.startError&&!result.aborted&&!deps.closing?.signal.aborted,'DEMO_MEDIA_INVALID','The local demo media step failed. Nothing was delivered.');return result;};
 const inspect=async(path:string)=>parseFfmpegLog((await run([...FILE_ONLY_INPUT,'-i',path,'-f','null','-'])).stderr,null);
 try{
  const video=join(folder,'source.mp4');await writeFile(video,source.bytes,{flag:'wx'});const measured=await inspect(video);
  check(measured.hasVideo&&!measured.hasAudio&&measured.durationMs!==null&&measured.durationMs>0&&Math.abs(measured.durationMs-source.durationMs)<=100&&measured.width===source.width&&measured.height===source.height,'DEMO_MEDIA_INVALID','The recorded desktop bytes no longer match their measured frame and duration.');
  const captions=demoCaptionInput(plan,rawCues,measured.durationMs),paths:string[]=[];let speechMs=0;
  for(const[index,voice]of voices.entries()){const path=join(folder,`voice-${index}.${voice.format}`);await writeFile(path,voice.bytes,{flag:'wx'});const audio=await inspect(path);check(audio.hasAudio&&audio.durationMs!==null&&audio.durationMs>0,'DEMO_MEDIA_INVALID','Measure every narration file before mixing it.');speechMs+=audio.durationMs;paths.push(path);}
  check(speechMs<=measured.durationMs,'DEMO_VOICE_TOO_LONG','The narration is longer than the recording. Record more time; spoken words will not be cut.');
  const subs=join(folder,'captions.srt'),label=join(folder,'disclosure.srt'),output=join(folder,'demo.mp4');await writeFile(subs,captions.srt);await writeFile(label,toSrt([{id:'ai-label',startMs:0,endMs:measured.durationMs,lines:['AI narration'],words:null}]));
  const inputs=paths.flatMap(path=>[...FILE_ONLY_INPUT,'-i',path]);
  const filters=`subtitles=filename='${filterPath(subs)}':force_style='FontSize=18,Alignment=2,Outline=1'`+(plan.aiVoice?`,subtitles=filename='${filterPath(label)}':force_style='FontSize=12,Alignment=8,MarginV=12,Outline=1'`:'');
  const audioArgs=paths.length?['-filter_complex',paths.map((_,i)=>`[${i+1}:a:0]`).join('')+`concat=n=${paths.length}:v=0:a=1,apad[audio]`,'-map','[audio]','-c:a','aac','-ar','44100','-ac','1']:['-an'];
  await run([...FILE_ONLY_INPUT,'-i',video,...inputs,'-map','0:v:0',...audioArgs,'-t',String(measured.durationMs/1000),'-vf',filters,'-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-map_metadata','-1','-movflags','+faststart','-n',output]);
  const info=await stat(output).catch(()=>null);check(info?.isFile()&&info.size>0&&info.size<=50*1024*1024,'DEMO_MEDIA_INVALID','The rendered demo was not created within the download limit.');
  const final=await inspect(output);check(final.hasVideo&&final.hasAudio===plan.aiVoice&&final.durationMs!==null&&Math.abs(final.durationMs-measured.durationMs)<=100&&final.width===measured.width&&final.height===measured.height,'DEMO_MEDIA_INVALID','The finished demo frame, sound or duration did not match the recording.');
  const bytes=await readFile(output);check(bytes.length>=12&&bytes.subarray(4,8).toString('ascii')==='ftyp','DEMO_MEDIA_INVALID','The finished file is not an MP4.');
  return{bytes,durationMs:final.durationMs,width:final.width!,height:final.height!,captions:captions.srt,captionChecksNotRun:captions.notRun,timing:captions.timing,disclosure:plan.aiVoice?'AI narration':null};
 }finally{await rm(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100});release?.();}
}
