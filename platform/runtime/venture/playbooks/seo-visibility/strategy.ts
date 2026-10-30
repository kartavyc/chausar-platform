// SEO7 evidence promotion. GEOHub AGPL ideas only; independently rebuilt, no source copied.
import {seoDay} from './impact.ts';
export type StrategyChain={candidate:{digest:string};fidelity:{candidateDigest:string;digest:string;passed:boolean};experiment:{fidelityDigest:string;digest:string;panelDigest:string;windowEnds:string};publication:{experimentDigest:string;digest:string};receipt:{publicationDigest:string;digest:string;publishedAt:string};panelDigest:string;asOf:string;windows:number[]};
/** A tactic is memory only after the full unchanged experiment and an actual publication receipt. */
export function evaluateStrategy(input:StrategyChain) {
 const {candidate:c,fidelity:f,experiment:e,publication:p,receipt:r}=input;
 const bound=!!c?.digest&&!!f?.digest&&!!e?.digest&&!!p?.digest&&!!r?.digest&&f.candidateDigest===c.digest&&e.fidelityDigest===f.digest&&p.experimentDigest===e.digest&&r.publicationDigest===p.digest&&f.passed&&e.panelDigest===input.panelDigest;
 if(!bound)return {state:'held',line:'Keep every evidence digest bound and the approved panel unchanged.'};
 if(seoDay(input.asOf)<seoDay(e.windowEnds)||seoDay(r.publishedAt)>=seoDay(e.windowEnds))return {state:'held',line:'Wait for the observation window after publication.'};
 if(!Array.isArray(input.windows)||!input.windows.length||input.windows.length>100||input.windows.some(n=>!Number.isFinite(n)))return {state:'held',line:'Record the measured experiment windows.'};
 if(input.windows.length>=2&&input.windows.slice(-2).every(n=>n<=0))return {state:'stopped',line:'Stop this experiment after two flat windows.'};
 return input.windows.at(-1)!>0?{state:'remembered',line:'The bound experiment improved in its completed window.'}:{state:'held',line:'A flat window does not establish a successful strategy.'};
}
