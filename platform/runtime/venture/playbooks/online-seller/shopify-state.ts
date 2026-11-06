// Original F3 immutable write lifecycle. F2 staging rules are reused; no request is sent here.
import {check,digest} from '../../../portable.ts';
import {decimalMinor} from '../../../currency.ts';
import {shopifyChange,shopifyDomain,type ShopifyProduct} from '../../build/shopify-admin-core.ts';
import {checkSellerApply,type SellerCaps,type SellerChange} from './staging.ts';
export type ShopifyRead={id:string;orderId:string;clientId:string;domain:string;storeId:string;connectionDigest:string;sessionId:string;memberId:string;epoch:number;at:string;product:ShopifyProduct};
export type ShopifyWriteContext={read:ShopifyRead;caps:SellerCaps;breakEvenMinor:string|null;now:string;ownerSku?:string};
export type ShopifyWrite={id:string;read:ShopifyRead;request:ReturnType<typeof shopifyChange>;createdAt:string;expiresAt:string;phase:'staged'|'sending'|'applied'|'rejected'|'unknown';claimedAt:string|null;finishedAt:string|null;liveVerified:string|null};
const time=(value:string)=>{const n=Date.parse(value);check(Number.isFinite(n),'SELLER_INPUT_INVALID','Use a valid operation time.');return n;};
const identity=(read:ShopifyRead)=>{const {product:_product,...scope}=read;return digest(scope);};
/** Complete exact dry preview, scoped to a fresh owner session and the read product/location. */
export function stageShopifyWrite(context:ShopifyWriteContext,change:SellerChange,id:string):ShopifyWrite{
 const {read,now}=context;shopifyDomain(read.domain);check(/^[A-Za-z0-9_.:-]{1,200}$/.test(id)&&read.sessionId.length>0&&read.connectionDigest.length>0&&/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(read.storeId),'SELLER_PROVENANCE_REQUIRED','Read the exact store and product in this session.');
 check(time(now)>=time(read.at)&&time(now)-time(read.at)<1800000,'SELLER_PROVENANCE_REQUIRED','Read the product again before staging it.');
 const request=shopifyChange({product:read.product,breakEvenMinor:context.breakEvenMinor,caps:context.caps,today:now.slice(0,10),operationId:id,ownerSku:context.ownerSku},change);
 return {id,read:structuredClone(read),request,createdAt:now,expiresAt:new Date(time(now)+1800000).toISOString(),phase:'staged',claimedAt:null,finishedAt:null,liveVerified:null};
}
/** Claim must be persisted before any effect. Reopening, a timeout or a failed read-back cannot re-arm it. */
export function claimShopifyWrite(stage:ShopifyWrite,approved:string,current:ShopifyWriteContext):ShopifyWrite{
 check(stage.phase==='staged','SHOPIFY_OUTCOME_UNKNOWN','This change has already moved on. Inspect Shopify; it will not be sent again.');
 check(approved===digest(stage)&&time(current.now)<time(stage.expiresAt)&&time(current.now)>=time(stage.createdAt),'APPROVAL_STALE','Approve the exact current change before it expires.');
 check(identity(stage.read)===identity(current.read),'SELLER_PROVENANCE_REQUIRED','The store, client, connection or session changed. Read and stage again.');
 const p=current.read.product;check(p.variantId===stage.read.product.variantId&&p.productId===stage.read.product.productId&&p.inventoryItemId===stage.read.product.inventoryItemId&&p.locationId===stage.read.product.locationId,'SELLER_PROVENANCE_REQUIRED','Read this exact variant and location again.');
 checkSellerApply(stage.request.proposal,{sku:p.sku??stage.request.proposal.product.sku,channel:'shopify',priceMinor:p.priceMinor,breakEvenMinor:current.breakEvenMinor,stock:p.stock,title:p.title,currency:p.currency},current.caps,current.now.slice(0,10));
 return {...structuredClone(stage),phase:'sending',claimedAt:current.now};
}
/** Actual success needs both a non-error mutation answer and an exact identity/value read-back. */
export function finishShopifyWrite(stage:ShopifyWrite,ack:unknown,readBack:ShopifyProduct|null,at:string):ShopifyWrite{
 check(stage.phase==='sending','SHOPIFY_OUTCOME_UNKNOWN','Only the claimed change can receive an outcome.');time(at);
 let phase:ShopifyWrite['phase']='unknown';const raw=ack as {errors?:unknown[];data?:Record<string,{userErrors?:unknown[];productVariants?:{id?:string;price?:string}[];product?:{id?:string;title?:string};inventoryAdjustmentGroup?:{changes?:{name?:string;delta?:number}[]}}>}|null;
 const key=stage.request.field==='price'?'productVariantsBulkUpdate':stage.request.field==='title'?'productUpdate':'inventoryAdjustQuantities',result=raw?.data?.[key];
 if(!raw?.errors?.length&&result&&Array.isArray(result.userErrors)){
  if(result.userErrors.length)phase='rejected';
  else if(readBack){let acknowledged=false;try{if(stage.request.field==='price'){const row=result.productVariants?.[0];acknowledged=result.productVariants?.length===1&&row?.id===stage.read.product.variantId&&typeof row.price==='string'&&decimalMinor(row.price,stage.read.product.currency)===stage.request.expected;}else if(stage.request.field==='title')acknowledged=result.product?.id===stage.read.product.productId&&result.product.title===stage.request.expected;else{const changes=result.inventoryAdjustmentGroup?.changes?.filter(c=>c.name==='available');acknowledged=changes?.length===1&&changes[0]?.delta===Number(BigInt(stage.request.expected)-BigInt(stage.read.product.stock));}}catch{acknowledged=false;}const p=stage.read.product,b=readBack,same=p.variantId===b.variantId&&p.productId===b.productId&&p.inventoryItemId===b.inventoryItemId&&p.locationId===b.locationId&&p.currency===b.currency&&p.sku===b.sku;const observed=stage.request.field==='price'?b.priceMinor:stage.request.field==='title'?b.title:b.stock;if(acknowledged&&same&&observed===stage.request.expected)phase='applied';}
 }
 return {...stage,phase,finishedAt:at,liveVerified:phase==='applied'?at:null};
}

export const shopifyOrderBinding=(order:{id:string;clientId:string;status:string;offerId:string;intake?:unknown;sellerShopify?:unknown})=>digest({id:order.id,clientId:order.clientId,status:order.status,offerId:order.offerId,intake:order.intake??null,sellerShopify:order.sellerShopify??null});
