// Original boundary ledger. JobOS inspired explicit proposals; no source code is copied.
import {check} from '../../../portable.ts';
export function careerNeed(value:unknown,message:string):asserts value {
 check(value,'INVALID_VENTURE_REQUEST',message);
}
export type CareerFact={id:string;statement:string;qualifiers:string[];forbiddenUses:string[]};
export const careerPlain=(value:string)=>value.normalize('NFKC').replace(/\p{Cf}/gu,'').trim().toLocaleLowerCase('en-IN');
export function validateFact(fact:CareerFact):void {
 careerNeed(fact&&typeof fact==='object'&&!Array.isArray(fact)&&Object.keys(fact).length===4&&Object.keys(fact).every(key=>['id','statement','qualifiers','forbiddenUses'].includes(key)),'Use only the fact statement and its named boundaries.');
 careerNeed(fact&&typeof fact.id==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(fact.id),'A fact needs a bounded ID.');
 careerNeed(typeof fact.statement==='string'&&!!careerPlain(fact.statement)&&fact.statement.length<=2000,'State one bounded client fact.');
 for(const values of [fact.qualifiers,fact.forbiddenUses]){
  careerNeed(Array.isArray(values)&&values.length<=30&&values.every(v=>typeof v==='string'&&!!careerPlain(v)&&v.length<=500),'Use bounded, nonempty fact restrictions.');
  careerNeed(new Set(values.map(careerPlain)).size===values.length,'Each restriction must be unique.');
 }
}
/** Only adding forbidden uses is mechanically provable tightening. Qualifier prose can introduce new claims. */
export function factChange(before:CareerFact|null,after:CareerFact):{approvalRequired:boolean}{
 validateFact(after);if(!before)return {approvalRequired:true};validateFact(before);
 careerNeed(before.id===after.id,'A fact proposal cannot change its identity.');
 const retained=(old:string[],next:string[])=>old.every(v=>next.includes(v));
 return {approvalRequired:before.statement!==after.statement||JSON.stringify(before.qualifiers)!==JSON.stringify(after.qualifiers)||!retained(before.forbiddenUses,after.forbiddenUses)};
}
export type CareerClaim={factId:string;use:string};
/** Rendering selects approved facts instead of accepting rewritten claims as verified experience.
 * Declared uses are checked literally. Owners still review the context and meaning before sharing.
 */
export function renderClaims(facts:readonly CareerFact[],claims:readonly CareerClaim[]):{ok:true;lines:string[]}|{ok:false;code:'claim-boundary'|'unstated-fact';factId:string}{
 careerNeed(Array.isArray(facts)&&facts.length<=200&&Array.isArray(claims)&&claims.length<=100,'Use bounded facts and claims.');
 facts.forEach(validateFact);careerNeed(new Set(facts.map(f=>f.id)).size===facts.length,'Fact IDs must be unique.');
 const lines:string[]=[];
 for(const claim of claims){
  careerNeed(claim&&Object.keys(claim).sort().join(',')==='factId,use'&&typeof claim.factId==='string'&&typeof claim.use==='string'&&!!careerPlain(claim.use)&&claim.use.length<=500,'Each claim needs only a fact and its intended use.');
  const fact:CareerFact|undefined=facts.find((f:CareerFact)=>f.id===claim.factId);if(!fact)return {ok:false,code:'unstated-fact',factId:claim.factId};
  if(fact.forbiddenUses.some(use=>careerPlain(claim.use).includes(careerPlain(use))))return {ok:false,code:'claim-boundary',factId:fact.id};
  lines.push(fact.statement+(fact.qualifiers.length?' ('+fact.qualifiers.join('; ')+')':''));
 }
 return {ok:true,lines};
}
