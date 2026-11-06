// Original shared Zoho Books v3 pinned transport. Official API schemas checked 28 October 2026.
import {check,digest,ChausarError} from '../../portable.ts';
import {guardedFetch,pinnedSend} from '../../venture/core/net-guard.ts';
import type {PoliteNet} from '../../venture/build/fetch-policy.ts';
import {parseExactJson,object} from './common.ts';
import {ZOHO_HOSTS,type ZohoDataCenter} from './zoho.ts';
export type ZohoWriteConnection={dataCenter:ZohoDataCenter;organizationId:string;accessToken:string;revision:string};
/** One immutable session connection. Callers validate their resource-specific nested evidence. */
export function createZohoTransport(raw:ZohoWriteConnection,net:PoliteNet={}){
 check(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===4&&['dataCenter','organizationId','accessToken','revision'].every(key=>Object.hasOwn(raw,key))&&typeof raw.dataCenter==='string'&&Object.hasOwn(ZOHO_HOSTS,raw.dataCenter),'BOOKS_CONNECTION_INVALID','Choose the Zoho account data centre.');
 check(typeof raw.organizationId==='string'&&/^\d{1,100}$/.test(raw.organizationId),'BOOKS_READ_FAILED','The accounting source needs a numeric provider ID.');
 check(typeof raw.revision==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(raw.revision),'BOOKS_CONNECTION_INVALID','Use the saved accounting connection revision.');check(typeof raw.accessToken==='string'&&raw.accessToken.length>0&&raw.accessToken.length<=10000&&!/[\r\n]/.test(raw.accessToken),'BOOKS_CONNECTION_INVALID','Connect the owner-created Zoho self client.');
 const config=Object.freeze({...raw}),base='https://'+ZOHO_HOSTS[config.dataCenter]+'/books/v3/';
 const connectionIdentity='zoho:'+digest({provider:'zoho',dataCenter:config.dataCenter,organizationId:config.organizationId,revision:config.revision});
 function urlFor(path:string,query:Record<string,string>){check(typeof path==='string'&&/^[a-z][a-z0-9]*(?:\/[a-z0-9_-]+)*$/.test(path),'BOOKS_CONNECTION_INVALID','Use a fixed accounting API resource.');check(query&&typeof query==='object'&&!Array.isArray(query)&&Object.entries(query).every(([key,value])=>key!=='organization_id'&&/^[a-z_]+$/.test(key)&&typeof value==='string'&&value.length<=500),'BOOKS_CONNECTION_INVALID','Use bounded accounting query fields.');const url=new URL(path,base);url.searchParams.set('organization_id',config.organizationId);for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);return url;}
 function response(body:Buffer,code:string){let value:Record<string,unknown>;try{value=object(parseExactJson(body.toString('utf8')));}catch{throw new ChausarError(code,'The accounting provider returned unreadable evidence. Inspect the client books.');}check(value.code==='0',code,'The accounting provider refused this action.');check(value.organization_id===undefined||value.organization_id===config.organizationId,code,'The provider evidence belongs to another company.');return value;}
 async function get(path:string,query:Record<string,string>={}){const url=urlFor(path,query),answer=await guardedFetch({url:url.href,method:'GET',headers:{authorization:'Zoho-oauthtoken '+config.accessToken},maxRedirects:0,maxBytes:1024*1024,timeoutMs:15000},net);check(answer.status===200,'BOOKS_READ_FAILED','The existing accounting records could not be read.');return response(answer.body,'BOOKS_READ_FAILED');}
 async function post(path:string,query:Record<string,string>,body:string,beforeSend:()=>void){const url=urlFor(path,query);check(typeof body==='string'&&Buffer.byteLength(body)<=1024*1024&&typeof beforeSend==='function','BOOKS_CONNECTION_INVALID','Use the reviewed bounded request and owner approval.');let sent=false;const send=net.send??pinnedSend;
  const answer=await guardedFetch({url:url.href,method:'POST',body,headers:{authorization:'Zoho-oauthtoken '+config.accessToken,'content-type':'application/json'},maxRedirects:0,maxBytes:1024*1024,timeoutMs:15000},{...net,send:target=>{check(!sent,'BOOKS_ALREADY_SENT','This provider request was already sent.');beforeSend();sent=true;return send(target);}});
  check(answer.status===200||answer.status===201,'BOOKS_WRITE_UNCONFIRMED','The Zoho action was not confirmed. Check the client books before doing anything else.');return response(answer.body,'BOOKS_WRITE_UNCONFIRMED');
 }
 return {connectionIdentity,get,post};
}
