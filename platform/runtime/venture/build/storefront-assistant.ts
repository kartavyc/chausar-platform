// Public Storefront reads only. No arbitrary query, buyer search, cart mutation or order submission.
import {check} from '../../portable.ts';
import {guardedFetch,pinnedSend,type PinnedSender} from '../core/net-guard.ts';
import {shopifyDomain,SHOPIFY_API_VERSION} from './shopify-admin-core.ts';
import type {ShopifyNetwork} from './shopify-admin.ts';
import {readStorefrontCatalogue,storefrontConnection} from './storefront-assistant-core.ts';
export type StorefrontConnection={domain:string;publicToken:string;maxPages:number};
export function storefrontPort(config:StorefrontConnection,net:ShopifyNetwork){
 const {domain}=storefrontConnection(config);
 const send:PinnedSender=target=>{const guarded:unknown=net.beforeDispatch();if(guarded&&typeof(guarded as {then?:unknown}).then==='function')void Promise.resolve(guarded).catch(()=>undefined);check(guarded===undefined,'INVALID_VENTURE_REQUEST','A dispatch guard must finish synchronously.');return(net.send??pinnedSend)(target);};
 return {read:()=>readStorefrontCatalogue(async(query,variables)=>{const response=await guardedFetch({url:'https://'+domain+'/api/'+SHOPIFY_API_VERSION+'/graphql.json',method:'POST',headers:{'content-type':'application/json','x-shopify-storefront-access-token':config.publicToken,'user-agent':'chausar-local'},body:JSON.stringify({query,variables}),maxRedirects:0,maxBytes:2000000,timeoutMs:15000},{resolve:net.resolve,send});check(response.status===200,'SHOPIFY_API_REFUSED','The public catalogue could not be read. Open the shop for its current products.');let raw:unknown;try{raw=JSON.parse(response.body.toString('utf8'));}catch{check(false,'SHOPIFY_RESPONSE_INVALID','The public catalogue response could not be read.');}return raw;},config.maxPages)};
}
