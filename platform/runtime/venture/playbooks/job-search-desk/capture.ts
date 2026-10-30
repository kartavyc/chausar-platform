// Original bounded listing capture. JobOS (Apache-2.0) inspired revision checks; parse5 (MIT) parses inert HTML.
import {parse,type DefaultTreeAdapterTypes as Tree} from 'parse5';
import {ChausarError,check,hash} from '../../../portable.ts';
import {politeFetch,robotsSafe,type PoliteNet} from '../../build/fetch-policy.ts';
import {pinnedSend} from '../../core/net-guard.ts';
export type CareerPagePart={start:number;end:number;text:string;revision:string};
/** Every slice must cover one unchanged text snapshot exactly, including the final character. */
export function completeCareerCapture(total:number,revision:string,parts:readonly CareerPagePart[]){
 const need=(condition:unknown)=>check(condition,'CAREER_CAPTURE_INCOMPLETE','No job was saved.');
 need(Number.isSafeInteger(total)&&total>0&&total<=500000&&typeof revision==='string'&&/^[a-f0-9]{64}$/.test(revision)&&Array.isArray(parts)&&parts.length>0&&parts.length<=100);
 let end=0;const text:string[]=[];
 for(const part of parts){need(part&&Number.isSafeInteger(part.start)&&Number.isSafeInteger(part.end)&&part.start===end&&part.end>part.start&&part.end<=total&&part.revision===revision&&typeof part.text==='string'&&part.text.length===part.end-part.start);end=part.end;text.push(part.text);}
 const result=text.join('');need(end===total&&hash(result)===revision);
 return {text:result,revision,complete:true as const,segments:parts.map(part=>({...part}))};
}
function visiblePage(html:string):string{
 const words:string[]=[];const visit=(node:Tree.Node):void=>{
  if('tagName'in node){const attrs=new Map(node.attrs.map(a=>[a.name,a.value]));if(['script','style','template','noscript','head'].includes(node.tagName)||attrs.has('hidden')||attrs.get('aria-hidden')==='true'||/(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.get('style')??''))return;}
  if('value'in node)words.push(node.value);if('childNodes'in node)node.childNodes.forEach(visit);
 };visit(parse(html));return words.join(' ').replace(/\s+/gu,' ').trim();
}
/** Static public pages only. No login, browser automation, application or partial save occurs here.
 * Two identical complete HTTP responses establish one observed revision; later site changes remain possible.
 */
export async function captureCareerListing(url:string,net:PoliteNet={}){
 try{
  check(typeof url==='string'&&url.length<=2000,'INVALID_VENTURE_REQUEST','No job was saved.');
  const host=new URL(url).hostname.toLowerCase().replace(/\.$/,'');
  if(['linkedin.com','naukri.com'].some(name=>host===name||host.endsWith('.'+name)))throw new ChausarError('FETCH_POLICY_REFUSED','Paste the job text instead. No job was saved.');
  const transport={...net,send:robotsSafe(net.send??pinnedSend,net.resolve)};
  const read=()=>politeFetch({url,maxBytes:1000000,timeoutMs:15000,maxRedirects:3,headers:{accept:'text/plain, text/html'}},transport);
  const first=await read(),second=await read();
  check(first.status===200&&second.status===200,'CAREER_CAPTURE_INCOMPLETE','No job was saved.');
  check(first.url===second.url&&hash([...first.body])===hash([...second.body])&&first.headers['content-type']===second.headers['content-type'],'CAREER_CAPTURE_CHANGED','No job was saved.');
  const type=first.headers['content-type']??'';check(/^(?:text\/plain|text\/html)(?:;|$)/i.test(type),'CAREER_CAPTURE_INCOMPLETE','No job was saved.');
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(first.body),text=/^text\/html/i.test(type)?visiblePage(raw):raw.trim(),revision=hash(text),segments:CareerPagePart[]=[];
  for(let start=0;start<text.length;start+=10000){const end=Math.min(start+10000,text.length);segments.push({start,end,text:text.slice(start,end),revision});}
  return {...completeCareerCapture(text.length,revision,segments),url:first.url,kind:'static-page' as const};
 }catch(error){
  if(error instanceof ChausarError)throw new ChausarError(error.code,error.code==='FETCH_POLICY_REFUSED'?'Paste the job text instead. No job was saved.':'No job was saved.');
  throw new ChausarError('CAREER_CAPTURE_INCOMPLETE','No job was saved.');
 }
}
