// Chausar owner form parsing. Shared engine/rehearsal code; Shopify Apache/MIT staging ideas only.

import {exact,sellerRefuse} from './operations-core.ts';
import type {SellerCaps,SellerStaged} from './staging.ts';

/** Decimal owner input is converted here, never in a React component. */
export function sellerDecimal(value:unknown):string {
 if(typeof value!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))sellerRefuse('SELLER_INPUT_INVALID','Use a positive amount with at most two decimal places.');
 const [whole,fraction='']=(value as string).trim().split('.');return String(BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0')));
}
/** Forms use percentage words; tools keep their already computed basis-point records. */
export function sellerOwnerCaps(raw:unknown):SellerCaps {
 if(raw&&typeof raw==='object'&&Object.hasOwn(raw,'priceChangePercent')){
  exact(raw,['priceChangePercent','promotionPercent']);
  return {priceChangeBps:sellerDecimal(raw.priceChangePercent),promotionBps:sellerDecimal(raw.promotionPercent)};
 }
 exact(raw,['priceChangeBps','promotionBps']);return raw as SellerCaps;
}
/** A rupee entry is accepted only for an INR price. Mixed units are refused. */
export function sellerOwnerChange(raw:unknown,currency:string):unknown {
 if(raw&&typeof raw==='object'&&Object.hasOwn(raw,'rupees')){
  exact(raw,['field','rupees','clearance'],['field','rupees']);
  if(raw.field!=='price'||currency!=='INR')sellerRefuse('SELLER_INPUT_INVALID','Rupee prices need an INR product.');
  return {field:'price',value:sellerDecimal(raw.rupees),...(raw.clearance===undefined?{}:{clearance:raw.clearance})};
 }
 if(raw&&typeof raw==='object'&&Object.hasOwn(raw,'depthPercent')){
  exact(raw,['field','value','scope','depthPercent','endsOn','clearance'],['field','value','scope','depthPercent','endsOn']);
  return {field:raw.field,value:raw.value,scope:raw.scope,depthBps:sellerDecimal(raw.depthPercent),endsOn:raw.endsOn,...(raw.clearance===undefined?{}:{clearance:raw.clearance})};
 }
 return raw;
}
/** Money in the preview has a concrete stored receipt, including the proposed amount. */
export function sellerStageNumbers(stage:SellerStaged) {
 return {currency:stage.product.currency,beforeMinor:stage.product.priceMinor,...(stage.product.breakEvenMinor===null?{}:{breakEvenMinor:stage.product.breakEvenMinor}),...(stage.change.field==='price'?{afterMinor:stage.change.value}:stage.change.field==='promotion'?{afterMinor:String(BigInt(stage.product.priceMinor)*(10000n-BigInt(stage.change.depthBps!))/10000n)}:{})};
}
