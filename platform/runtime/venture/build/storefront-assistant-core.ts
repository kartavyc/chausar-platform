// Catalogue-only Storefront answer contracts, independently written from Shopify's documented GraphQL shape.
import {check,digest} from '../../portable.ts';
import {decimalMinor,formatMinor} from '../../currency.ts';
import {shopifyData,shopifyDomain,type ShopifyQuery} from './shopify-admin-core.ts';
export type StorefrontProduct={variantId:string;productId:string;title:string;variantTitle:string;available:boolean;currency:string;priceMinor:string};
export type StorefrontCatalogue={rows:StorefrontProduct[];truncated:boolean;total:number|null;reason:'page-limit'|'variants-limited'|'read-failed'|'rows-changed'|'cursor-repeated'|null};
export function storefrontConnection(config:{domain:string;publicToken:string;maxPages:number}){const domain=shopifyDomain(config.domain);check(typeof config.publicToken==='string'&&config.publicToken.length>=8&&config.publicToken.length<=2000&&!/\s/.test(config.publicToken),'STOREFRONT_SETUP_REQUIRED','Add the public Storefront token for this owner shop.');check(Number.isInteger(config.maxPages)&&config.maxPages>=1&&config.maxPages<=10,'SELLER_INPUT_INVALID','Read one to ten public catalogue pages.');return {...config,domain};}
export const STOREFRONT_PRODUCTS_QUERY='query ChausarStorefront($after: String) { products(first: 50, after: $after) { nodes { id title variants(first: 100) { nodes { id title availableForSale price { amount currencyCode } } pageInfo { hasNextPage } } } pageInfo { hasNextPage endCursor } } }';
const object=(raw:unknown):Record<string,unknown>=>{check(!!raw&&typeof raw==='object'&&!Array.isArray(raw),'SHOPIFY_RESPONSE_INVALID','The public catalogue is incomplete.');return raw as Record<string,unknown>;};
const text=(raw:unknown,max=2000)=>{check(typeof raw==='string'&&raw.length>0&&raw.length<=max,'SHOPIFY_RESPONSE_INVALID','The public catalogue has an invalid field.');return raw;};
const id=(raw:unknown,kind:string)=>{const value=text(raw,200);check(new RegExp('^gid://shopify/'+kind+'/[1-9][0-9]*$').test(value),'SHOPIFY_RESPONSE_INVALID','The public catalogue has an invalid identifier.');return value;};
/** A bounded public-products read. More than100 variants on one product remains explicitly partial. */
export async function readStorefrontCatalogue(request:ShopifyQuery,maxPages=2):Promise<StorefrontCatalogue>{
 check(Number.isInteger(maxPages)&&maxPages>=1&&maxPages<=10,'SELLER_INPUT_INVALID','Read one to ten public catalogue pages.');
 const rows:StorefrontProduct[]=[],ids=new Set<string>(),products=new Set<string>(),cursors=new Set<string>();let after:string|null=null,variantsLimited=false;
 const partial=(reason:StorefrontCatalogue['reason']):StorefrontCatalogue=>({rows,truncated:true,total:null,reason});
 for(let page=0;page<maxPages;page++){
  let raw:unknown;try{raw=await request(STOREFRONT_PRODUCTS_QUERY,{after});}catch{return partial('read-failed');}
  const connection=object(shopifyData(raw).products),info=object(connection.pageInfo);check(Array.isArray(connection.nodes)&&connection.nodes.length<=50&&typeof info.hasNextPage==='boolean','SHOPIFY_RESPONSE_INVALID','The public catalogue page is incomplete.');
  for(const entry of connection.nodes){
   const product=object(entry),productId=id(product.id,'Product'),title=text(product.title);if(products.has(productId))return partial('rows-changed');products.add(productId);
   const variants=object(product.variants),variantPage=object(variants.pageInfo);check(Array.isArray(variants.nodes)&&variants.nodes.length<=100&&typeof variantPage.hasNextPage==='boolean','SHOPIFY_RESPONSE_INVALID','The public variant page is incomplete.');variantsLimited||=variantPage.hasNextPage;
   for(const entry of variants.nodes){const row=object(entry),price=object(row.price),variantId=id(row.id,'ProductVariant');if(ids.has(variantId))return partial('rows-changed');ids.add(variantId);check(typeof row.availableForSale==='boolean','SHOPIFY_RESPONSE_INVALID','The public variant has no availability.');const currency=text(price.currencyCode,3),priceMinor=decimalMinor(text(price.amount,80),currency);check(BigInt(priceMinor)>=0n,'SHOPIFY_RESPONSE_INVALID','The public variant has a negative price.');rows.push({productId,variantId,title,variantTitle:text(row.title),available:row.availableForSale,currency,priceMinor});}
  }
  if(!info.hasNextPage)return variantsLimited?partial('variants-limited'):{rows,truncated:false,total:rows.length,reason:null};
  const next=text(info.endCursor);if(cursors.has(next))return partial('cursor-repeated');cursors.add(next);after=next;
 }
 return partial('page-limit');
}
export const STOREFRONT_ANSWER_SCHEMA={type:'object',additionalProperties:false,required:['status','variantIds'],properties:{status:{type:'string',enum:['matched','not-found','needs-human']},variantIds:{type:'array',maxItems:5,items:{type:'string'}}}};
/** The model chooses IDs only. It cannot invent prose, prices, URLs, discounts or promises. */
export function storefrontAnswer(raw:unknown,catalogue:StorefrontCatalogue,domain:string){
 const fail=(condition:unknown)=>check(condition,'STOREFRONT_OUTPUT_REJECTED','The assistant could not verify this answer against the catalogue. Open the shop or ask its owner.');
 fail(!!raw&&typeof raw==='object'&&!Array.isArray(raw));const answer=raw as Record<string,unknown>;
 fail(Object.keys(answer).sort().join(',')==='status,variantIds'&&typeof answer.status==='string'&&['matched','not-found','needs-human'].includes(String(answer.status))&&Array.isArray(answer.variantIds));const ids=answer.variantIds as unknown[];
 fail(ids.length<=5&&ids.every(i=>typeof i==='string')&&new Set(ids).size===ids.length&&(answer.status==='matched'?ids.length>0:ids.length===0));
 const sourceDigest=digest(catalogue),store=shopifyDomain(domain),products=ids.map(value=>{
  const row=catalogue.rows.find(p=>p.variantId===value);fail(row?.available);const product=row!;
  const display=formatMinor(product.priceMinor,product.currency),receipt={id:'store-price-'+digest({sourceDigest,variantId:product.variantId}),sourceId:product.variantId,sourceDigest,currency:product.currency,minor:product.priceMinor,display,rule:'Exact public Shopify catalogue price converted to integer minor units. Checkout confirms the current total, taxes and delivery.'};
  return {variantId:product.variantId,title:product.title,variantTitle:product.variantTitle,price:{minor:product.priceMinor,currency:product.currency,display,receipt},cart:{url:'https://'+store+'/cart/'+product.variantId.split('/').at(-1)+':1',disclosure:'Not charged here' as const}};
 });
 return {disclosure:'You are chatting with an AI assistant' as const,status:catalogue.truncated&&answer.status==='not-found'?'needs-human':answer.status as 'matched'|'not-found'|'needs-human',products,sourceDigest,truncated:catalogue.truncated,shopUrl:'https://'+store,orderPlaced:false as const};
}
