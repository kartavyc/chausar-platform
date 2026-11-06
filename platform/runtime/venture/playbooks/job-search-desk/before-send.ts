// Original conservative handoff checks. Two-fact/voice pattern: JobFinderOS (MIT).
import {careerNeed,careerPlain} from './facts.ts';
export type CareerSendInput={text:string;researchedFact:{text:string;url:string}|null;clientFact:{text:string;factId:string}|null;clientConfirmed:boolean;voiceConfirmed:boolean};
// Evidence addresses are metadata, never fetched here. Literal IPs and local-only hostnames are refused.
function publicEvidence(value:string):boolean{try{const u=new URL(value),host=u.hostname.toLowerCase().replace(/\.$/,'');return u.protocol==='https:'&&!u.username&&!u.password&&host.includes('.')&&!host.includes(':')&&!/^[\d.]+$/.test(host)&&!/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host);}catch{return false;}}
export function beforeCareerSend(input:CareerSendInput):{verdict:'PASS'|'REWRITE'|'DO NOT SEND';reasons:string[]}{
 careerNeed(input&&typeof input.text==='string'&&input.text.length<=30000,'Use a bounded outreach draft.');
 const reasons:string[]=[];
 if(!input.text.trim()||/\[\s*your\s+take\s*\]/i.test(careerPlain(input.text)))reasons.push('your-take-unfilled');
 const research=input.researchedFact,client=input.clientFact;
 if(!research||typeof research.text!=='string'||!research.text.trim()||typeof research.url!=='string'||!publicEvidence(research.url)||!input.text.includes(research.text))reasons.push('researched-fact-missing');
 if(!client||typeof client.text!=='string'||!client.text.trim()||typeof client.factId!=='string'||!client.factId||!input.text.includes(client.text))reasons.push('client-fact-missing');
 if(input.clientConfirmed!==true)reasons.push('client-confirmation-missing');
 if(reasons.length)return {verdict:'DO NOT SEND',reasons};
 if(input.voiceConfirmed!==true)return {verdict:'REWRITE',reasons:['owner-voice-review-needed']};
 return {verdict:'PASS',reasons:[]};
}
export const CAREER_SCORE_CRITERIA=['visible-gap','market-proof','client-evidence','revenue-impact','decision-maker-access','decision-speed','unowned-work'] as const;
export function scoreCareerTarget(rows:readonly {id:string;score:number;evidence:string}[]){
 careerNeed(Array.isArray(rows)&&rows.length===7&&new Set(rows.map(r=>r.id)).size===7,'Score each of the seven criteria once.');
 for(const row of rows)careerNeed(CAREER_SCORE_CRITERIA.some(id=>id===row.id)&&Number.isInteger(row.score)&&row.score>=0&&row.score<=2&&typeof row.evidence==='string'&&row.evidence.length<=2000&&(row.evidence==='guess'||publicEvidence(row.evidence)),'Each criterion needs a score from 0 to 2 and an evidence URL or guess.');
 return {total:rows.reduce((sum,row)=>sum+row.score,0),max:14,guesses:rows.filter(r=>r.evidence==='guess').length,criteria:rows.map(r=>({...r}))};
}
