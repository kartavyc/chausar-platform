// Original bounded tail proposal after LocalText2Voice MIT workflow ideas. No code copied.
import {check} from '../../../portable.ts';
/** Keep 250 ms after the last measured word. Short gaps are retained; unmeasured timings never trigger a cut. */
export function narrationTail(durationMs:number,lastSpeechEndMs:number|null):{cutAtMs:number|null;removedMs:number; marginMs:number;status:'cut-proposed'|'keep'|'unconfirmed'}{
 check(Number.isSafeInteger(durationMs)&&durationMs>0&&durationMs<=7200000&&(lastSpeechEndMs===null||Number.isSafeInteger(lastSpeechEndMs)&&lastSpeechEndMs>=0&&lastSpeechEndMs<=durationMs),'NARRATION_TIMING_INVALID','Speech timing must fit the measured audio.');
 if(lastSpeechEndMs===null)return {cutAtMs:null,removedMs:0,marginMs:250,status:'unconfirmed'};
 if(durationMs-lastSpeechEndMs<=1000)return {cutAtMs:durationMs,removedMs:0,marginMs:250,status:'keep'};
 return {cutAtMs:lastSpeechEndMs+250,removedMs:durationMs-lastSpeechEndMs-250,marginMs:250,status:'cut-proposed'};
}
