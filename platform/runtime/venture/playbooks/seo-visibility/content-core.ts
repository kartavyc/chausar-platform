// Browser-safe SEO4 validation. loamwright (Apache-2.0) ideas; independent code, no source copied.
import { getDomain } from 'tldts';
export function seoNeed(ok:unknown,code:string,words:string):asserts ok {if(!ok)throw Object.assign(new Error(words),{code});}
export function seoText(value:unknown,max=100000):string {seoNeed(typeof value==='string'&&value.length<=max,'SEO_INPUT_INVALID','Give bounded text for this check.');return value;}
/** Public suffix data avoids treating two subdomains of one organisation as independent. */
export function sourceDomain(raw:string):string {let url:URL;try{url=new URL(raw);}catch{throw Object.assign(new Error('Give a full public web address.'),{code:'SEO_INPUT_INVALID'});}seoNeed(/^https?:$/.test(url.protocol)&&!url.username&&!url.password,'SEO_INPUT_INVALID','Give a full public web address.');const domain=getDomain(url.hostname,{allowPrivateDomains:true});seoNeed(domain,'SEO_INPUT_INVALID','A source needs a registrable domain.');return domain;}
export type LocalElements={programme:string;caseOrPress:string;landmark:string;priceOrLogistics:string};
export type ClaimInput={id:string;number:string;urls:string[]};
export type CorroborationInput={text:string;claims:ClaimInput[];competitors:string[]};
/** Bind every numeric occurrence, not just a marker somewhere in the article, to one exact number. */
export function claimNumbersMatch(text:string,claims?:readonly ClaimInput[]):boolean {
 const masked=text.replace(/\[claim:[a-z][a-z0-9-]{0,39}\]/g,m=>' '.repeat(m.length));
 const declared=claims?new Map(claims.map(c=>[c.id,c.number])):null,inferred=new Map<string,string>();
 for(const match of masked.matchAll(/(?<![\p{L}\p{N}])\d+(?:[,.]\d+)*(?:%|\s*percent)?(?![\p{L}\p{N}])/gu)){
  const marker=/^\s*\[claim:([a-z][a-z0-9-]{0,39})\]/.exec(text.slice(match.index!+match[0].length));
  if(!marker)return false;const number=match[0].replace(/\s+/g,' '),id=marker[1]!;
  if(declared&&declared.get(id)!==number)return false;
  if(inferred.has(id)&&inferred.get(id)!==number)return false;inferred.set(id,number);
 }
 return true;
}
/** Numeric tokens are matched whole, never 35 inside 135. */
export function numberTokens(text:string):string[]{return [...text.matchAll(/(?<![\p{L}\p{N}])\d+(?:[,.]\d+)*(?:%|\s*percent)?(?![\p{L}\p{N}])/gu)].map(m=>m[0].replace(/\s+/g,' '));}
export function validateClaims(input:CorroborationInput):CorroborationInput {
 seoText(input.text);seoNeed(Array.isArray(input.claims)&&input.claims.length<=50&&Array.isArray(input.competitors)&&input.competitors.length<=30,'SEO_INPUT_INVALID','Use at most fifty claims and thirty competitor domains.');
 const seen=new Set<string>();for(const claim of input.claims){seoNeed(claim&&/^[a-z][a-z0-9-]{0,39}$/.test(claim.id)&&!seen.has(claim.id),'SEO_INPUT_INVALID','Each claim needs a unique marker.');seen.add(claim.id);seoNeed(numberTokens(claim.number).length===1&&numberTokens(claim.number)[0]===claim.number&&input.text.includes('[claim:'+claim.id+']')&&numberTokens(input.text).includes(claim.number),'SEO_INPUT_INVALID','Each claim must name a number and marker present in the article.');seoNeed(Array.isArray(claim.urls)&&claim.urls.length>=1&&claim.urls.length<=5,'SEO_INPUT_INVALID','Give one to five source URLs per claim.');claim.urls.forEach(sourceDomain);}
 input.competitors.forEach(sourceDomain);return input;
}
