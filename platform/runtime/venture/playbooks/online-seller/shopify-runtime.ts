// Native F3 owner desk helpers. Original implementation, secret values never enter records or replies.
import {authorize,check,newId,type Context} from '../../../contracts.ts';
import type {OrderRecord,VentureDeps,SecretName} from '../../contracts.ts';
import {digest,findRecord,readVenture} from '../../records.ts';import {readAs} from '../../delivery/shared.ts';import {pausedNow} from '../../delivery/run-guards.ts';
import {sellerOrder} from './operations-store.ts';
import {shopifyAdminPort} from '../../build/shopify-admin.ts';import {shopifyData,shopifyVariant,SHOPIFY_VARIANT_QUERY} from '../../build/shopify-admin-core.ts';
export const shopifySecret=(ventureId:string,orderId:string):SecretName=>`shopify:${ventureId}:${orderId}`;
const sessions=new WeakMap<object,string>();
export function shopifySession(deps:VentureDeps,ctx:Context){let id=sessions.get(deps.store);if(!id){id=newId('shopsession');sessions.set(deps.store,id);}return id+':'+ctx.memberId+':'+ctx.epoch;}
import {shopifyOrderBinding} from './shopify-state.ts';
export {shopifyOrderBinding} from './shopify-state.ts';
/** Every send checks live permission, business/order binding, pause and immutable credential version synchronously. */
export function currentShopify(deps:VentureDeps,ctx:Context,id:string){readAs(deps,ctx,'approve');check(ctx.role==='owner','OWNER_REQUIRED','Only the owner can connect or change this store.');const found=sellerOrder(deps,ctx,id);check(!pausedNow(found.state,found.venture.id),'BUSINESS_PAUSED','This business is paused.');return found;}
export function shopifyPortFor(deps:VentureDeps,ctx:Context,order:OrderRecord,ventureId:string,binding:()=>string){
 const connection=order.sellerShopify?.connection,key=shopifySecret(ventureId,order.id),secret=deps.secrets.get(key);check(connection&&secret,'SHOPIFY_SETUP_REQUIRED','Reconnect the owner app for this session.');let credentials:{clientId:string;clientSecret:string};try{credentials=JSON.parse(secret);}catch{check(false,'SHOPIFY_SETUP_REQUIRED','Reconnect the owner app.');}
 const port=shopifyAdminPort({domain:connection.domain,...credentials!},{...deps.net,beforeDispatch:()=>{const live=currentShopify(deps,ctx,order.id);check(live.venture.id===ventureId&&shopifyOrderBinding(live.order)===binding(),'APPROVAL_STALE','The store settings, source or approval changed. Read and approve again.');check(deps.secrets.get(key)===secret&&digest(secret)===connection.credentialDigest,'SHOPIFY_SETUP_REQUIRED','The account key changed. Reconnect and review again.');}});
 return port;
}
/** Verify the returned variant and selected location; the token remains bound to the verified store hostname. */
export async function readShopifyVariant(port:ReturnType<typeof shopifyAdminPort>,token:string,variantId:string,locationId:string){const data=shopifyData(await port.query(token,SHOPIFY_VARIANT_QUERY,{id:variantId,location:locationId})),shop=data.shop as {currencyCode?:unknown}|undefined;check(typeof shop?.currencyCode==='string','SHOPIFY_RESPONSE_INVALID','Shopify did not return its currency.');const value=shopifyVariant(data.productVariant,shop.currencyCode,locationId);check(value.variantId===variantId,'SELLER_PROVENANCE_REQUIRED','Shopify returned a different product.');return value;}
