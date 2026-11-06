// SEO8 local evidence and owner handoffs. beyondseo MIT ideas; independently written.
import {politeFetch,robotsSafe,type PoliteNet} from '../../build/fetch-policy.ts';
import {pinnedSend} from '../../core/net-guard.ts';
import {htmlText} from './ai-access.ts';
import {digest} from '../../records.ts';
import {seoNeed,seoText} from './content-core.ts';
export {localTemplates} from './templates.ts';
const normal=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
/** Compare only the owner's listed URLs under fetch and robots policy; no Maps scraping. */
export async function auditLocal(input:{name:string;address:string;phone:string;urls:string[];review:string},net:PoliteNet={}) {
 for(const value of [input.name,input.address,input.phone])seoNeed(seoText(value,1000).trim().length>=3,'SEO_INPUT_INVALID','Give the recorded business name, address and phone.');seoText(input.review,5000);seoNeed(Array.isArray(input.urls)&&input.urls.length<=20,'SEO_INPUT_INVALID','List at most twenty citation URLs.');
 const guarded={resolve:net.resolve,send:robotsSafe(net.send??pinnedSend,net.resolve)};const citations=[];
 for(const url of [...new Set(input.urls)]){try{const response=await politeFetch({url,maxBytes:512*1024,timeoutMs:15000,maxRedirects:3},guarded);seoNeed(response.status===200,'SEO_SOURCE_GAP','This citation did not load.');const text=htmlText(response.body.toString('utf8')),words=normal(text);citations.push({url,matches:{name:words.includes(normal(input.name)),address:words.includes(normal(input.address)),phone:text.replace(/\D/g,'').includes(input.phone.replace(/\D/g,''))},receipt:digest(response.body.toString('base64')),gap:null});}catch(error){citations.push({url,matches:null,receipt:null,gap:error instanceof Error?error.message:'This citation could not be checked.'});}}
 return {citations,profile:{mode:'handoff' as const,line:'Open Google Business Profile and apply each reviewed correction yourself.'},review:{mode:'handoff' as const,text:input.review?'Thank you for sharing your experience. Please contact our team directly if you need help.':'',line:'Review this reply and post it yourself.'},limits:'Only the citation URLs you supplied were checked. Missing pages stay unknown.'};
}
