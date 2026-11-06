// SEO4 bounded corroboration. loamwright Apache-2.0 ideas; independent implementation.
import {politeFetch,robotsSafe,type PoliteNet} from '../../build/fetch-policy.ts';
import {pinnedSend} from '../../core/net-guard.ts';
import {digest} from '../../records.ts';
import {htmlText} from './ai-access.ts';
import {numberTokens,sourceDomain,validateClaims,claimNumbersMatch,type CorroborationInput} from './content-core.ts';
/** Fetch candidate sources under the shared policy, recording actual page hashes and missing sources. */
export async function corroborateClaims(raw:CorroborationInput,net:PoliteNet={}) {
 const input=validateClaims(raw),competitors=new Set(input.competitors.map(sourceDomain));const guarded={resolve:net.resolve,send:robotsSafe(net.send??pinnedSend,net.resolve)};
 const cache=new Map<string,{url:string;domain:string;text:string;digest:string}|null>();
 const urls=[...new Set(input.claims.flatMap(c=>c.urls))].filter(url=>!competitors.has(sourceDomain(url)));if(urls.length>40)throw Object.assign(new Error('Use at most forty unique source URLs.'),{code:'SEO_INPUT_INVALID'});
 for(const url of urls){try{const response=await politeFetch({url,maxBytes:512*1024,maxRedirects:3,timeoutMs:15000},guarded);const finalUrl=response.url??url;const domain=sourceDomain(String(finalUrl));cache.set(url,response.status===200&&!competitors.has(domain)?{url:String(finalUrl),domain,text:htmlText(response.body.toString('utf8')),digest:digest(response.body.toString('base64'))}:null);}catch{cache.set(url,null);}}
 const claims=input.claims.map(claim=>{const sources=claim.urls.flatMap(url=>{const page=cache.get(url);return page&&numberTokens(page.text).includes(claim.number)?[{url:page.url,domain:page.domain,digest:page.digest}]:[];});const count=new Set(sources.map(s=>s.domain)).size;return {id:claim.id,number:claim.number,status:count>=2?'corroborated':count===1?'single-source':'unverified',sources};});
 const marked=[...input.text.matchAll(/\[claim:([a-z][a-z0-9-]{0,39})\]/g)].map(m=>m[1]);return {pass:claimNumbersMatch(input.text,input.claims)&&claims.length>0&&marked.every(id=>claims.some(c=>c.id===id&&c.status==='corroborated'))&&claims.every(c=>c.status==='corroborated'),claims,sourceGaps:[...cache].filter(([,page])=>page===null).map(([url])=>url)};
}
