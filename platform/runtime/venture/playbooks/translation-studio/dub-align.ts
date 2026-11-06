// Original timing rules. BaoCut (source available, learn only) and Index-Translate (Apache-2.0) informed the ladder.
import {check} from '../../../portable.ts';
export type DubAlignment={mode:'fit'|'tempo'|'extended'|'overlong';tempo:number;startMs:number;endMs:number|null;overflowMs:number};
/** Preserve every millisecond of speech. Speed never exceeds 1.25; silence borrowing stops at the next sentence. */
export function alignDub(startMs:number,endMs:number,nextStartMs:number,durationMs:number):DubAlignment{
 check([startMs,endMs,nextStartMs,durationMs].every(Number.isSafeInteger)&&startMs>=0&&endMs>startMs&&nextStartMs>=endMs&&durationMs>0,'DUB_TIMING_INVALID','Use ordered whole millisecond timings.');
 const slot=endMs-startMs;if(durationMs<=slot)return {mode:'fit',tempo:1,startMs,endMs:startMs+durationMs,overflowMs:0};
 if(durationMs<=slot*1.25)return {mode:'tempo',tempo:durationMs/slot,startMs,endMs,overflowMs:0};
 const length=Math.ceil(durationMs/1.25);return length<=nextStartMs-startMs?{mode:'extended',tempo:1.25,startMs,endMs:startMs+length,overflowMs:0}:{mode:'overlong',tempo:1.25,startMs,endMs:null,overflowMs:length-(nextStartMs-startMs)};
}
/** Split measured PCM energy at its quietest point within each ten-second cap, without dropping samples. */
export function quietSegments(durationMs:number,energy:readonly {atMs:number;energy:number}[]):{startMs:number;endMs:number}[]{
 check(Number.isSafeInteger(durationMs)&&durationMs>0&&durationMs<=3600000&&energy.length>0&&energy.length<=36000&&energy.every((p,i)=>Number.isSafeInteger(p.atMs)&&p.atMs>=0&&p.atMs<durationMs&&Number.isFinite(p.energy)&&p.energy>=0&&(!i||p.atMs>energy[i-1]!.atMs)),'DUB_AUDIO_REQUIRED','Measure bounded ordered audio energy before splitting.');
 const spans:{startMs:number;endMs:number}[]=[];let startMs=0;while(durationMs-startMs>10000){const choices=energy.filter(p=>p.atMs>=startMs+2000&&p.atMs<=startMs+10000);check(choices.length,'DUB_AUDIO_REQUIRED','Audio energy is missing from a segment.');const quiet=choices.reduce((a,b)=>b.energy<a.energy?b:a);spans.push({startMs,endMs:quiet.atMs});startMs=quiet.atMs;}spans.push({startMs,endMs:durationMs});return spans;
}
