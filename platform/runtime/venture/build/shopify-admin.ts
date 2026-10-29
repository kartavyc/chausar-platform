// Native owner-store Shopify transport. Official client-credentials and GraphQL 2026-10 docs, independently written.
import {check} from '../../portable.ts';
import {guardedFetch,pinnedSend,type NetResolver,type PinnedSender} from '../core/net-guard.ts';
import {shopifyAccount,SHOPIFY_API_VERSION} from './shopify-admin-core.ts';
export type ShopifyAccount={domain:string;clientId:string;clientSecret:string};
export type ShopifyNetwork={resolve?:NetResolver;send?:PinnedSender;beforeDispatch:()=>void};
/** Credentials remain in the caller's secret store. No redirect, generic target URL, retry or log payload is supported. */
export function shopifyAdminPort(account:ShopifyAccount,net:ShopifyNetwork){
 const {domain}=shopifyAccount(account);
 const send: PinnedSender=target=>{const guarded:unknown=net.beforeDispatch();if(guarded&&typeof (guarded as {then?:unknown}).then==='function')void Promise.resolve(guarded).catch(()=>undefined);check(guarded===undefined,'INVALID_VENTURE_REQUEST','A dispatch guard must finish synchronously.');return (net.send??pinnedSend)(target);};
 const request=async(path:string,body:string,headers:Record<string,string>)=>{
  const response=await guardedFetch({url:'https://'+domain+path,method:'POST',body,headers:{...headers,'user-agent':'chausar-local'},maxRedirects:0,maxBytes:2000000,timeoutMs:15000},{resolve:net.resolve,send});
  check(response.status>=200&&response.status<300,'SHOPIFY_API_REFUSED','Shopify did not confirm this request. Check its admin before trying any change again.');
  let raw:unknown;try{raw=JSON.parse(response.body.toString('utf8'));}catch{check(false,'SHOPIFY_RESPONSE_INVALID','Shopify returned an unreadable response.');}
  check(!!raw&&typeof raw==='object'&&!Array.isArray(raw),'SHOPIFY_RESPONSE_INVALID','Shopify returned an incomplete response.');return raw as Record<string,unknown>;
 };
 return {
  async authenticate(){const body=new URLSearchParams({grant_type:'client_credentials',client_id:account.clientId,client_secret:account.clientSecret}).toString(),raw=await request('/admin/oauth/access_token',body,{'content-type':'application/x-www-form-urlencoded'});check(typeof raw.access_token==='string'&&raw.access_token.length>0&&raw.access_token.length<=2000&&!/\s/.test(raw.access_token)&&Number.isInteger(raw.expires_in)&&Number(raw.expires_in)>0&&Number(raw.expires_in)<=86400,'SHOPIFY_SETUP_REQUIRED','Shopify did not issue a valid owner-app token. Check the app, store and scopes.');return {accessToken:raw.access_token,expiresIn:Number(raw.expires_in)};},
  async query(accessToken:string,query:string,variables:Record<string,unknown>){check(typeof accessToken==='string'&&accessToken.length>0&&accessToken.length<=2000&&!/\s/.test(accessToken),'SHOPIFY_SETUP_REQUIRED','Reconnect your owner app.');check(typeof query==='string'&&query.length<=15000,'INVALID_VENTURE_REQUEST','Use a supported Shopify operation.');return request('/admin/api/'+SHOPIFY_API_VERSION+'/graphql.json',JSON.stringify({query,variables}),{'content-type':'application/json','x-shopify-access-token':accessToken});},
 };
}
