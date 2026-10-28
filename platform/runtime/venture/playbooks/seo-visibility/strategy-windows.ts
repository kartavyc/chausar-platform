// SEO7 original deterministic measurement, shared by the engine and demo.
import type {SeoPanelBody,SeoObservationBody} from './records.ts';
import {measuredPanel} from './panel-core.ts';
/** A complete baseline and post-publication windows use identical frozen slots. Missing is never zero. */
export function strategyWindows(panel:SeoPanelBody,observations:readonly SeoObservationBody[],publishedAt:string,asOf:string){
 const held={complete:false,windows:[] as number[],windowEnds:'',receipt:''};
 if(!Number.isFinite(Date.parse(publishedAt))||!Number.isFinite(Date.parse(asOf)))return held;
 try{const metrics=measuredPanel(panel,observations);if(!metrics.live)return held;}catch{return held;}
 const periods=[...panel.spec.timepoints].sort((a,b)=>a.from.localeCompare(b.from));
 if(periods.length<2||periods.some((p,i)=>i>0&&p.from<=periods[i-1]!.to))return held;
 const before=periods.filter(p=>p.to<publishedAt),after=periods.filter(p=>p.from>publishedAt);
 if(before.length!==1||after.length!==periods.length-1)return held;
 const completed=after.filter(p=>p.to<=asOf);if(!completed.length)return held;
 const denominator=panel.spec.questions.length*panel.spec.engines.length*panel.spec.repeats;
 const counted=[before[0]!,...completed];if(counted.some(p=>observations.filter(o=>o.timepointId===p.id).length!==denominator))return held;
 const counts=counted.map(p=>({id:p.id,count:observations.filter(o=>o.timepointId===p.id&&o.mentioned).length}));
 const baseline=counts[0]!.count/denominator;
 return {complete:true,windows:counts.slice(1).map(c=>c.count/denominator-baseline),windowEnds:completed.at(-1)!.to.slice(0,10),receipt:counts.map(c=>`${c.id}:${c.count}/${denominator}`).join('|')};
}
