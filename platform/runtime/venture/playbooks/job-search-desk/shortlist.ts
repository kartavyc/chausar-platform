// Original fixed-word shortlist with coverage before recommendations. Pattern: Pinloop CLI (MIT).
import {careerNeed} from './facts.ts';
export const CAREER_VERDICTS=['no','weak','fair','strong'] as const;
export type CareerVerdict=typeof CAREER_VERDICTS[number];
export type CareerMatch={id:string;verdict:CareerVerdict;reason:string};
export function careerShortlist(total:number,rows:readonly CareerMatch[],threshold:CareerVerdict){
 careerNeed(Number.isSafeInteger(total)&&total>=0&&total<=10000&&Array.isArray(rows)&&rows.length<=total,'Coverage must count actual read listings within the supplied set.');
 careerNeed(CAREER_VERDICTS.includes(threshold),'Choose no, weak, fair or strong as the keep threshold.');
 for(const row of rows)careerNeed(row&&typeof row.id==='string'&&!!row.id&&row.id.length<=200&&CAREER_VERDICTS.includes(row.verdict)&&typeof row.reason==='string'&&!!row.reason.trim()&&row.reason.length<=1000,'Each listing needs a fixed verdict and a reason.');
 careerNeed(new Set(rows.map(r=>r.id)).size===rows.length,'Count each listing once.');
 const floor=CAREER_VERDICTS.indexOf(threshold);
 return {coverage:`Read ${rows.length} of ${total} listings`,read:rows.length,total,threshold,kept:rows.filter(r=>CAREER_VERDICTS.indexOf(r.verdict)>=floor),dropped:rows.filter(r=>CAREER_VERDICTS.indexOf(r.verdict)<floor)};
}
