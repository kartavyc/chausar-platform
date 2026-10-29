// Original tender groundedness after Countersign (AGPL) workflow ideas only. Uses Chausar's existing lexical checker.
import {check} from '../../../portable.ts';
import {checkClaims,extractClaims,type ClaimMatch,type SourceText} from '../../delivery/judge/claim-check-core.ts';
import {tenderMoneyReceipts} from './money.ts';
export type TenderGround={passed:boolean;gap:boolean;affirmativeGap:boolean;missingTerms:string[];coverage:{matched:number;total:number};claims:ClaimMatch[];sourceIds:string[]};
/** Owner prices come from the owner's source quote. Authorship cannot exempt other factual claims either. */
export function groundTenderCommercial(answer:string,documents:readonly SourceText[]):TenderGround{
 const result=groundTenderAnswer('Please describe',answer,documents);
 return {...result,coverage:{matched:result.claims.filter(claim=>claim.matched).length,total:result.claims.length}};
}
const STOP=new Set('a an the and or of to for from in on at by with without is are was were be been do does did can could will would should have has had we you your our their they it its this that these those what which how when where please describe explain state provide give detail details confirm whether about organisation organization company solution'.split(' '));
const normalized=(text:string)=>text.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function words(value:unknown,max:number):asserts value is string{check(typeof value==='string'&&!!value.trim()&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),'TENDER_INPUT_INVALID','Use bounded readable tender text.');}
/** Compare answer claims only with the supplied client documents, never with the question or a model permission. */
export function groundTenderAnswer(question:string,answer:string,documents:readonly SourceText[]):TenderGround{
 words(question,4000);words(answer,20000);
 check(Array.isArray(documents)&&documents.length<=100&&documents.every(doc=>doc&&typeof doc.id==='string'&&!!doc.id.trim()&&doc.id.length<=200&&typeof doc.text==='string'&&!!doc.text.trim()&&doc.text.length<=200000)&&new Set(documents.map(d=>d.id)).size===documents.length&&documents.reduce((n,d)=>n+d.text.length,0)<=1000000,'TENDER_SOURCE_REQUIRED','Use up to one hundred distinct client documents within the source limit.');
 const claims=checkClaims(answer,documents),questionClaims=extractClaims(question),terms=new Map<string,string>();
 const money=tenderMoneyReceipts(answer,documents);
 for(const claim of claims.claims)if(claim.kind==='figure'&&money.unmatched.some(amount=>amount.includes(claim.text))){claim.matched=false;claim.sourceId=null;}
 claims.unmatched=claims.claims.filter(claim=>!claim.matched);claims.passed=claims.unmatched.length===0;
 const specific=checkClaims(question,documents);for(const claim of specific.claims)terms.set(claim.kind+':'+claim.key,claim.text.replace(/\s+(?:certified|certification|compliant)$/i,''));
 const masked=question.split('');for(const claim of questionClaims)for(let n=claim.at;n<claim.at+claim.text.length;n++)masked[n]=' ';
 for(const match of masked.join('').matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}-]*/gu)){const term=normalized(match[0]);if(term.length>1&&!STOP.has(term))terms.set('word:'+term,match[0]);}
 const sourceWords=new Set(documents.flatMap(doc=>normalized(doc.text).split(' '))),missing=new Map<string,string>();let matched=0;
 for(const [key,term] of terms){const found=key.startsWith('word:')?sourceWords.has(key.slice(5)):specific.claims.some(claim=>claim.kind+':'+claim.key===key&&claim.matched);if(found)matched++;else missing.set(key.startsWith('word:')?key:'claim:'+key,term);}
 for(const claim of claims.unmatched)missing.set('claim:'+claim.kind+':'+claim.key,claim.text.replace(/\s+(?:certified|certification|compliant)$/i,''));
 for(const amount of money.unmatched)missing.set('money:'+amount,amount);
 const missingTerms=[...missing.values()].sort((a,b)=>normalized(a).localeCompare(normalized(b),'en'));
 const gap=documents.length===0||missingTerms.length>0;
 const opening=answer.trimStart().replace(/^[\s*#_`>"'“‘([{]+/u,'');
 const affirmativeGap=gap&&/^(?:yes\b|हाँ(?:\s|[,।.!]|$)|हां(?:\s|[,।.!]|$))/iu.test(opening);
 return {passed:!gap&&claims.passed,gap,affirmativeGap,missingTerms,coverage:{matched,total:terms.size},claims:claims.claims,sourceIds:[...new Set(claims.claims.flatMap(claim=>claim.sourceId?[claim.sourceId]:[]))].sort()};
}
/** One deterministic Today request can list each affected question and terms ranked by affected-answer count. */
export function aggregateTenderGaps(rows:readonly {id:string;result:TenderGround}[]):{questionIds:string[];terms:{term:string;count:number}[]}{
 check(Array.isArray(rows)&&rows.length<=500&&new Set(rows.map(row=>row.id)).size===rows.length,'TENDER_INPUT_INVALID','Use distinct bounded tender question results.');
 const terms=new Map<string,{term:string;count:number}>();
 for(const row of rows.filter(row=>row.result.gap)){const seen=new Set<string>();for(const term of row.result.missingTerms){const key=normalized(term);if(seen.has(key))continue;seen.add(key);const kept=terms.get(key);if(kept)kept.count++;else terms.set(key,{term,count:1});}}
 return {questionIds:rows.filter(row=>row.result.gap).map(row=>row.id).sort(),terms:[...terms.values()].sort((a,b)=>b.count-a.count||normalized(a.term).localeCompare(normalized(b.term),'en'))};
}
