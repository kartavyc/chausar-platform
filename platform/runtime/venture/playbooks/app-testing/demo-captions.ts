// Original manual timing boundary over the A4 caption validator. No fabricated word timings.
import {check} from '../../../portable.ts';
import {validateCues,toSrt,type CaptionCue} from '../kit/captions.ts';
import type {DemoPlan} from './demo.ts';
const words=(value:string)=>value.normalize('NFKC').replace(/\s+/gu,' ').trim();
export function demoCaptionInput(plan:DemoPlan,input:unknown,durationMs:number){
 check(Array.isArray(input)&&input.length>0&&input.length<=300&&Number.isInteger(durationMs)&&durationMs>0&&durationMs<=301000,'DEMO_CAPTIONS_INVALID','Add timed captions within this actual recording.');
 const ids=new Set<string>();const cues:CaptionCue[]=input.map(raw=>{
  check(!!raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).sort().join(',')==='endMs,id,lines,startMs,words','INVALID_VENTURE_REQUEST','Use only the caption id, times, lines and null word timing.');
  const r=raw as Record<string,unknown>;
  check(typeof r.id==='string'&&/^[a-z][a-z0-9-]{0,59}$/.test(r.id)&&!ids.has(r.id)&&Number.isInteger(r.startMs)&&Number.isInteger(r.endMs)&&Number(r.startMs)>=0&&Number(r.endMs)>Number(r.startMs)&&Array.isArray(r.lines)&&r.lines.length>0&&r.lines.length<=2&&r.lines.every(s=>typeof s==='string'&&s.trim().length>0&&s.length<=200)&&r.words===null,'INVALID_VENTURE_REQUEST','Use unique bounded caption rows. Manual timing does not provide measured word intervals.');
  check(Number(r.endMs)<=durationMs,'DEMO_CAPTIONS_INVALID','Keep every caption within the actual recording.');
  ids.add(r.id);return{id:r.id,startMs:Number(r.startMs),endMs:Number(r.endMs),lines:[...r.lines] as string[],words:null};
 });
 check(words(cues.flatMap(c=>c.lines).join(' '))===words(plan.script),'DEMO_CAPTIONS_INVALID','Caption words must match the complete approved demo script.');
 const checked=validateCues(cues,'web');check(checked.findings.length===0,'DEMO_CAPTIONS_INVALID','Fix the caption reading speed, lines, order and gaps before rendering.');
 return{cues,srt:toSrt(cues),notRun:checked.notRun,timing:'owner-timed; final listening review required' as const};
}
