// SEO4 lints. loamwright Apache-2.0 ideas only; stock list and threshold are Chausar house rules.
import {seoNeed,seoText,sourceDomain,claimNumbersMatch,type LocalElements} from './content-core.ts';
export const AI_TELLS=Object.freeze(['delve','game changer','ever-evolving landscape','unlock the potential','in conclusion','seamlessly','revolutionize','tapestry','navigate the complexities','testament to']);
export const AI_TELL_THRESHOLD=20;
/** Remove competitor URLs from Markdown, HTML links and bare addresses before writing. */
export function stripCompetitors(text:string,competitors:string[]):string {
 const domains=new Set(competitors.map(sourceDomain));const bad=(url:string)=>{try{return domains.has(sourceDomain(url));}catch{return false;}};
 return text.replace(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi,(whole,label,url)=>bad(url)?label:whole).replace(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,(whole,url,label)=>bad(url)?label:whole).replace(/https?:\/\/[^\s<>"')]+/gi,url=>bad(url)?'':url);
}
/** Every numeric assertion needs an adjacent marker; declared local evidence must actually occur in the article. */
export function lintArticle(input:{text:string;local:LocalElements|null}) {
 const text=seoText(input.text),lower=text.toLocaleLowerCase();let aiTellCount=0;for(const phrase of AI_TELLS){let offset=0;while((offset=lower.indexOf(phrase,offset))!==-1){aiTellCount++;offset+=phrase.length;}}
 const marked=claimNumbersMatch(text);
 const checks=[{id:'claim-markers',pass:marked,detail:marked?'Every number has a claim marker.':'Add a claim marker beside every number.'},{id:'ai-tell',pass:aiTellCount<AI_TELL_THRESHOLD,detail:aiTellCount<AI_TELL_THRESHOLD?'Below our stock-phrase threshold.':'Rewrite the repeated stock phrases.'}];
 if(input.local!==null){seoNeed(typeof input.local==='object','SEO_INPUT_INVALID','Give the four local evidence elements.');const keys=['programme','caseOrPress','landmark','priceOrLogistics'] as const;const pass=keys.every(key=>typeof input.local![key]==='string'&&input.local![key].trim().length>=3&&lower.includes(input.local![key].trim().toLocaleLowerCase()));checks.push({id:'doorway-page',pass,detail:pass?'The page includes all four local evidence elements.':'Add a local programme or licence, case or press, landmark, and price or logistics.'});}
 return {pass:checks.every(c=>c.pass),checks,aiTellCount,threshold:AI_TELL_THRESHOLD,label:'our house rules'};
}
