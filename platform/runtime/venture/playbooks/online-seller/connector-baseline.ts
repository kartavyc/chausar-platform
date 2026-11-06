// Source-executed F3 cases. Offline checks prove boundaries, never provider account qualification.
import {digest} from '../../../portable.ts';import {stageShopifyWrite,claimShopifyWrite} from './shopify-state.ts';import {storefrontAnswer} from '../../build/storefront-assistant-core.ts';
import type {KitBaselineCase} from '../kit/define.ts';
export function sellerConnectorBaseline(item:KitBaselineCase,text:string,meta:Readonly<Record<string,string>>){
 if(!['shopify-source-change','storefront-catalogue-only'].includes(item.id))return null;let pass=false;
 try{const input=JSON.parse(meta.input??'null');if(item.id==='shopify-source-change'){const context={read:input.read,caps:input.caps,breakEvenMinor:input.breakEvenMinor,now:input.now},stage=stageShopifyWrite(context,input.change,'baseline-change');try{claimShopifyWrite(stage,digest(stage),{...context,read:{...input.read,product:{...input.read.product,priceMinor:input.currentPriceMinor}}});}catch(error){pass=(error as {code?:string}).code==='SELLER_SOURCE_CHANGED'&&/changed.*read.*approve again/i.test(text);}}else{try{storefrontAnswer(input.answer,input.catalogue,input.domain);}catch(error){pass=(error as {code?:string}).code==='STOREFRONT_OUTPUT_REJECTED'&&/catalogue.*no invented products/i.test(text);}}}catch{pass=false;}
 return {pass,why:pass?'Actual source rules held; no live provider qualification is claimed.':'The source boundary did not hold for this evidence.'};
}
