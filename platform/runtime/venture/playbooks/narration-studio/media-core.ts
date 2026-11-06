// Original narration measurements from ffmpeg logs; duration and silence parsing reuse the established media checker.
import {check} from '../../../portable.ts';
import {parseFfmpegLog} from '../youtube/finishing.ts';
import type {NarrationMeasurements} from './master-core.ts';
/** Missing detector values remain null. Digital silence uses a conservative -120 dB numeric bound, not an exact noise measurement. */
export function parseNarrationMeasurements(log:string,format:string):NarrationMeasurements{
 const base=parseFfmpegLog(log,log);check(base.hasAudio&&base.durationMs!==null,'NARRATION_VERIFICATION_REQUIRED','The audio duration could not be measured.');
 const head=log.split(/\r?\n(?:Stream mapping:|Output #)/)[0],audio=head.split(/\r?\n/).find(l=>/: Audio:/.test(l))??'',rate=/,\s*(\d+) Hz/.exec(audio),bitrate=/,\s*(\d+) kb\/s/.exec(audio);
 const noise=[...log.matchAll(/Noise floor dB:\s*(-?inf|-?\d+(?:\.\d+)?)/g)].at(-1)?.[1];
 const silence=base.silence,first=silence.find(s=>s.startMs===0),last=silence.find(s=>s.endMs>=base.durationMs!-50);
 const depth=/Audio:\s*pcm_[su](8|16|24|32)(?:le|be)?\b/.exec(audio);
 return {durationMs:base.durationMs,format,sampleRate:rate?Number(rate[1]):0,bitrateKbps:bitrate?Number(bitrate[1]):null,constantBitrate:null,bitDepth:depth?Number(depth[1]):null,channels:/\bmono\b/.test(audio)?1:/\bstereo\b/.test(audio)?2:0,rmsTenths:base.meanTenthsDb,peakTenths:base.maxTenthsDb,noiseTenths:noise===undefined?null:noise==='-inf'?-1200:Number.isFinite(Number(noise))?Math.round(Number(noise)*10):null,headMs:first?.endMs??0,tailMs:last?base.durationMs-last.startMs:0};
}
/** Trim only after the last transcribed speech interval plus a margin, then add measured-delivery room tone. */
export function narrationMasterFilters(m:NarrationMeasurements,lastSpeechEndMs:number|null,pauseAfterMs=0):string{
 check(Number.isSafeInteger(pauseAfterMs)&&pauseAfterMs>=0&&pauseAfterMs<=7000,'NARRATION_TIMING_INVALID','Use an approved pause from zero to seven seconds.');
 check(lastSpeechEndMs!==null&&Number.isSafeInteger(lastSpeechEndMs)&&lastSpeechEndMs>0&&lastSpeechEndMs<=m.durationMs,'NARRATION_TIMING_INVALID','A measured speech interval is required before trimming the tail.');
 check(m.rmsTenths!==null&&Number.isFinite(m.rmsTenths),'NARRATION_VERIFICATION_REQUIRED','Measure the audio level before mastering.');
 check(m.headMs!==null&&Number.isSafeInteger(m.headMs)&&m.headMs>=0&&m.headMs<lastSpeechEndMs,'NARRATION_TIMING_INVALID','Measure leading silence before normalizing room tone.');
 const start=Math.max(0,m.headMs-50),end=Math.min(m.durationMs,lastSpeechEndMs+250),gain=Math.max(-200,Math.min(200,-200-m.rmsTenths))/10;
 return `atrim=start=${start/1000}:end=${end/1000},asetpts=PTS-STARTPTS,volume=${gain}dB,alimiter=limit=0.707945784:level=false,adelay=700:all=1,apad=pad_dur=${(1500+pauseAfterMs)/1000}`;
}
