// Original R2 site boundary. Qwen-CUA (Apache-2.0) informed explicit permission; government/marketplace exclusions are Chausar house rules.
import {check} from '../../../portable.ts';
function refuse(ok:unknown):asserts ok{check(ok,'SITE_NOT_ALLOWED','Use an allowed client system with current written permission and a revocable staff login.');}

/** This syntactic gate does not replace DNS/socket checks at the desktop's physical network boundary. */
export function approvedFormSite(value:unknown,permission:unknown):{url:string;origin:string}{
 refuse(typeof value==='string'&&value.length<=2048);
 let url:URL;try{url=new URL(value as string);}catch{refuse(false);throw new Error('Unreachable');}
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 refuse(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&host===url.hostname.toLowerCase());
 refuse(host.includes('.')&&!host.includes(':')&&!/^\d+(?:\.\d+)*$/.test(host)&&!/(?:^|\.)(?:localhost|local|internal|test|invalid|gov\.in|nic\.in)$/.test(host));
 refuse(!/(?:^|\.)sellercentral\.amazon\./.test(host)&&!/(?:^|\.)(?:seller|sellers)\.flipkart\.com$/.test(host)&&!/(?:^|\.)(?:supplier|suppliers|seller)\.meesho\.com$/.test(host));
 refuse(permission&&typeof permission==='object'&&!Array.isArray(permission));
 const p=permission as Record<string,unknown>;
 refuse(Object.keys(p).sort().join(',')==='allowed,origin,revocableStaffLogin'&&p.origin===url.origin&&p.allowed===true&&p.revocableStaffLogin===true);
 return {url:url.href,origin:url.origin};
}
