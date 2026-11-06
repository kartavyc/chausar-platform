// Mail readiness, ResolveHQ (source-available) ideas only; original DNS adapter and evidence states.
import { resolveMx, resolveTxt } from 'node:dns/promises';
import { check } from '../../../contracts.ts';
export type MailResolver={mx(name:string):Promise<readonly {exchange:string;priority:number}[]>;txt(name:string):Promise<readonly (readonly string[])[]>};
export type MailReadiness={checks:{kind:'MX'|'SPF'|'DKIM'|'DMARC';state:'ready'|'missing'|'unknown';evidence:string[];fix:string}[];line:string;recheck:true};
const resolver:MailResolver={mx:resolveMx,txt:resolveTxt};
/** Queries only records the owner named; lookup failure never becomes evidence of absence. */
export async function mailReadiness(domain:string,selector:string,dns:MailResolver=resolver):Promise<MailReadiness>{
 check(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)&&/^[a-z0-9_-]{1,63}$/i.test(selector),'SUPPORT_DOMAIN_INVALID','Choose a mail domain and its DKIM selector.');
 const specs=[{kind:'MX' as const,name:domain,fix:'Ask your mail provider for the domain mail-exchanger records.',match:(s:string)=>s.length>0},{kind:'SPF' as const,name:domain,fix:'Add the SPF record supplied by your mail provider.',match:(s:string)=>/^v=spf1(?:\s|$)/i.test(s)},{kind:'DKIM' as const,name:`${selector}._domainkey.${domain}`,fix:'Add the DKIM public key supplied for this selector.',match:(s:string)=>/\bp=[A-Za-z0-9+/]+={0,2}(?:;|\s|$)/i.test(s)},{kind:'DMARC' as const,name:`_dmarc.${domain}`,fix:'Ask your mail provider to help publish a DMARC policy.',match:(s:string)=>/^v=DMARC1(?:;|\s|$)/i.test(s)}];
 const checks=await Promise.all(specs.map(async s=>{try{const evidence=s.kind==='MX'?(await dns.mx(s.name)).map(v=>v.exchange):(await dns.txt(s.name)).map(v=>v.join(''));return {kind:s.kind,state:evidence.some(s.match)?'ready' as const:'missing' as const,evidence,fix:s.fix};}catch{return {kind:s.kind,state:'unknown' as const,evidence:[],fix:s.fix};}}));
 return {checks,line:'A failed lookup does not mean the record is missing. Re-check after fixing records with your mail provider.',recheck:true};
}
