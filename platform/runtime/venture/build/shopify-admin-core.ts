// Bounded Shopify GraphQL 2026-10 contracts. Official schema facts only; independently written.
import {check} from '../../portable.ts';
import {decimalMinor,currencyMinorDigits} from '../../currency.ts';
import {stageSellerChange,type SellerCaps,type SellerChange} from '../playbooks/online-seller/staging.ts';
export const SHOPIFY_API_VERSION='2026-10';
export type ShopifyQuery=(query:string,variables:Record<string,unknown>)=>Promise<unknown>;
export type ShopifyProduct={variantId:string;productId:string;inventoryItemId:string;locationId:string;sku:string|null;title:string;priceMinor:string;currency:string;stock:string};
export type ShopifyCatalogueRow=Pick<ShopifyProduct,'variantId'|'productId'|'sku'|'title'|'priceMinor'|'currency'>;
const object=(raw:unknown):Record<string,unknown>=>{check(!!raw&&typeof raw==='object'&&!Array.isArray(raw),'SHOPIFY_RESPONSE_INVALID','Shopify returned an incomplete response.');return raw as Record<string,unknown>;};
const text=(raw:unknown,max=2000)=>{check(typeof raw==='string'&&raw.length>0&&raw.length<=max,'SHOPIFY_RESPONSE_INVALID','Shopify returned an incomplete field.');return raw;};
const gid=(raw:unknown,kind:string)=>{const value=text(raw,200);check(new RegExp('^gid://shopify/'+kind+'/[1-9][0-9]*$').test(value),'SHOPIFY_RESPONSE_INVALID','Shopify returned an invalid resource identifier.');return value;};
/** A Shopify-only hostname. No caller-controlled URL, path, user-info or alternative network target. */
export function shopifyDomain(raw:unknown):string{check(typeof raw==='string'&&/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(raw),'SHOPIFY_STORE_REQUIRED','Use the exact lowercase myshopify.com store name, without a path.');return raw;}
export function shopifyAccount(account:{domain:string;clientId:string;clientSecret:string}){const domain=shopifyDomain(account.domain);check(typeof account.clientId==='string'&&account.clientId.length>=3&&account.clientId.length<=500&&!/\s/.test(account.clientId)&&typeof account.clientSecret==='string'&&account.clientSecret.length>=8&&account.clientSecret.length<=500&&!/\s/.test(account.clientSecret),'SHOPIFY_SETUP_REQUIRED','Add the credentials of the app installed in your own Shopify organization.');return {...account,domain};}
/** GraphQL errors are failures even when the HTTP status was successful. */
export function shopifyData(raw:unknown){const root=object(raw);check(root.errors===undefined||Array.isArray(root.errors)&&root.errors.length===0,'SHOPIFY_API_REFUSED','Shopify refused this read. Check the app scopes and account.');return object(root.data);}
function readSku(raw:unknown):string|null{check(raw===null||typeof raw==='string'&&raw.length<=2000,'SHOPIFY_RESPONSE_INVALID','Shopify returned an invalid SKU.');return typeof raw==='string'&&raw.trim()?raw:null;}
function catalogueRow(raw:unknown,currency:string):ShopifyCatalogueRow{const row=object(raw),product=object(row.product),price=decimalMinor(text(row.price,80),currency);check(BigInt(price)>=0n,'SHOPIFY_RESPONSE_INVALID','Shopify returned a negative product price.');return {variantId:gid(row.id,'ProductVariant'),productId:gid(product.id,'Product'),sku:readSku(row.sku),title:text(product.title),priceMinor:price,currency};}
export const SHOPIFY_CATALOGUE_QUERY='query ChausarCatalogue($after: String) { shop { currencyCode } productVariants(first: 250, after: $after) { nodes { id sku price product { id title } } pageInfo { hasNextPage endCursor } } }';
/** Bounded cursor scan. The total is deliberately absent on every partial or failed scan. */
export async function readShopifyCatalogue(request:ShopifyQuery,maxPages=20){
 check(Number.isInteger(maxPages)&&maxPages>=1&&maxPages<=100,'SELLER_INPUT_INVALID','Read between one and one hundred pages.');
 const rows:ShopifyCatalogueRow[]=[],ids=new Set<string>(),cursors=new Set<string>();let after:string|null=null,currency:string|null=null;
 for(let page=0;page<maxPages;page++){
  let raw:unknown;try{raw=await request(SHOPIFY_CATALOGUE_QUERY,{after});}catch{return {rows,truncated:true,total:null,reason:'read-failed' as const};}
  const data=shopifyData(raw),money=text(object(data.shop).currencyCode,3);currencyMinorDigits(money);check(currency===null||currency===money,'SHOPIFY_RESPONSE_INVALID','The shop currency changed during the read.');currency=money;
  const connection=object(data.productVariants),info=object(connection.pageInfo);check(Array.isArray(connection.nodes)&&connection.nodes.length<=250&&typeof info.hasNextPage==='boolean','SHOPIFY_RESPONSE_INVALID','Shopify returned an incomplete page.');
  const next=info.endCursor;check(!info.hasNextPage||typeof next==='string'&&next.length>0&&next.length<=2000,'SHOPIFY_RESPONSE_INVALID','Shopify did not provide a cursor for the remaining rows.');
  for(const rawRow of connection.nodes){const row=catalogueRow(rawRow,money);if(ids.has(row.variantId))return {rows,truncated:true,total:null,reason:'rows-changed' as const};ids.add(row.variantId);rows.push(row);}
  if(!info.hasNextPage)return {rows,truncated:false,total:rows.length,reason:null};
  if(cursors.has(next as string))return {rows,truncated:true,total:null,reason:'cursor-repeated' as const};cursors.add(next as string);after=next as string;
 }
 return {rows,truncated:true,total:null,reason:'page-limit' as const};
}
export const SHOPIFY_VARIANT_QUERY='query ChausarVariant($id: ID!, $location: ID!) { shop { currencyCode } productVariant(id: $id) { id sku price product { id title } inventoryItem { id inventoryLevel(locationId: $location) { id location { id } quantities(names: ["available"]) { name quantity } } } } }';
/** A read of one variant and one exact location, never a store-wide stock total. */
export function shopifyVariant(raw:unknown,currency:string,locationId:string):ShopifyProduct{
 const base=catalogueRow(raw,currency),row=object(raw),inventory=object(row.inventoryItem),level=object(inventory.inventoryLevel);const inventoryItemId=gid(inventory.id,'InventoryItem'),levelId=text(level.id,250),matched=/^gid:\/\/shopify\/InventoryLevel\/[1-9][0-9]*\?inventory_item_id=([1-9][0-9]*)$/.exec(levelId);check(matched&&'gid://shopify/InventoryItem/'+matched[1]===inventoryItemId,'SHOPIFY_RESPONSE_INVALID','The inventory level belongs to a different item.');gid(locationId,'Location');check(object(level.location).id===locationId,'SHOPIFY_RESPONSE_INVALID','The inventory level belongs to a different location.');
 check(Array.isArray(level.quantities)&&level.quantities.length===1,'SHOPIFY_RESPONSE_INVALID','Read the available quantity at the selected location.');const available=object(level.quantities[0]);check(available.name==='available'&&Number.isSafeInteger(available.quantity)&&Number(available.quantity)>=-2147483648&&Number(available.quantity)<=2147483647,'SHOPIFY_RESPONSE_INVALID','Shopify returned an invalid available quantity.');
 return {...base,inventoryItemId:gid(inventory.id,'InventoryItem'),locationId,stock:String(available.quantity)};
}
const moneyDecimal=(minor:string,currency:string)=>{const digits=currencyMinorDigits(currency),n=BigInt(minor),scale=10n**BigInt(digits);return String(n/scale)+(digits?'.'+String(n%scale).padStart(digits,'0'):'');};
/** Reuses F2 caps, identity and break-even rules. Only three explicit fields become GraphQL mutations. */
export function shopifyChange(context:{product:ShopifyProduct;breakEvenMinor:string|null;caps:SellerCaps;today:string;operationId:string;ownerSku?:string},change:SellerChange){
 const p=context.product;check(['price','stock','title'].includes(change.field),'SELLER_FIELD_UNWRITABLE','This Shopify route only changes a price, title or stock movement.');
 check(p.sku!==null||typeof context.ownerSku==='string'&&context.ownerSku.trim().length>0&&context.ownerSku.length<=120,'SHOPIFY_SKU_MAPPING_REQUIRED','This product has no SKU. Name the owner SKU in the exact preview.');check(BigInt(p.stock)>=0n,'SHOPIFY_OVERSOLD_MANUAL','This location is oversold. Inspect and correct it in Shopify before staging a change here.');
 const proposal=stageSellerChange({sku:p.sku??context.ownerSku!,channel:'shopify',priceMinor:p.priceMinor,breakEvenMinor:context.breakEvenMinor,stock:p.stock,title:p.title,currency:p.currency},change,context.caps,context.today);
 check(proposal.descriptionComplete,'SELLER_PREVIEW_INCOMPLETE','Add the missing evidence before approving this change.');
 let query:string,variables:Record<string,unknown>,expected:string;
 if(change.field==='price'){
  query='mutation ChausarPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $allowPartialUpdates: Boolean!) { productVariantsBulkUpdate(productId: $productId, variants: $variants, allowPartialUpdates: $allowPartialUpdates) { productVariants { id price } userErrors { field message code } } }';
  variables={productId:p.productId,variants:[{id:p.variantId,price:moneyDecimal(change.value,p.currency)}],allowPartialUpdates:false};expected=change.value;
 }else if(change.field==='title'){
  query='mutation ChausarTitle($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id title } userErrors { field message } } }';variables={product:{id:p.productId,title:change.value}};expected=change.value;
 }else{
  const before=BigInt(p.stock),after=BigInt(change.value),delta=after-before;check(after<=2147483647n&&delta>=-2147483648n&&delta<=2147483647n,'SELLER_INPUT_INVALID','The inventory movement is outside Shopify limits.');check(/^[A-Za-z0-9_.:-]{1,200}$/.test(context.operationId),'SELLER_INPUT_INVALID','Use the saved operation identifier.');
  query='mutation ChausarStock($input: InventoryAdjustQuantitiesInput!, $key: String!) { inventoryAdjustQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { createdAt reason changes { name delta } } userErrors { field message code } } }';
  variables={key:context.operationId,input:{name:'available',reason:'correction',referenceDocumentUri:'gid://chausar/SellerMovement/'+context.operationId,changes:[{inventoryItemId:p.inventoryItemId,locationId:p.locationId,delta:Number(delta),changeFromQuantity:Number(before)}]}};expected=change.value;
 }
 return {proposal,query,variables,expected,field:change.field as 'price'|'title'|'stock'};
}
