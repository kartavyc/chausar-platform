// Chausar staged seller handoffs. Shopify commerce examples Apache-2.0 and multi-store MIT ideas only.
import {exact,sellerText,sellerInteger,sellerDate,sellerRefuse,sellerCurrency} from './operations-core.ts';
export type SellerProduct={sku:string;channel:string;priceMinor:string;breakEvenMinor:string|null;stock:string;title:string;currency:string};
export type SellerCaps={priceChangeBps:string;promotionBps:string};
export type SellerChange={field:string;value:string;clearance?:boolean;scope?:string;depthBps?:string;endsOn?:string};
export type SellerStaged={product:SellerProduct;change:SellerChange;dryRun:true;descriptionComplete:boolean;missing:string[];clearance:boolean;confirmName:string|null;money:boolean;caps:SellerCaps;capability:'handoff'};
const FIELDS=['price','stock','title','promotion','archive'];
export function sellerProduct(raw:unknown):SellerProduct {exact(raw,['sku','channel','priceMinor','breakEvenMinor','stock','title','currency']);const p=raw as SellerProduct;sellerText(p.sku,'SKU',120);if(!['shopify','amazon','flipkart','meesho'].includes(p.channel))sellerRefuse('SELLER_INPUT_INVALID','Choose a supported seller channel.');sellerInteger(p.priceMinor,'Price');if(p.breakEvenMinor!==null)sellerInteger(p.breakEvenMinor,'Break even');sellerInteger(p.stock,'Stock');sellerText(p.title,'Title',2000);sellerCurrency(p.currency);return structuredClone(p);}
function readCaps(raw:unknown):SellerCaps{exact(raw,['priceChangeBps','promotionBps']);const caps=raw as SellerCaps;for(const value of Object.values(caps))if(sellerInteger(value,'Cap')>10000n)sellerRefuse('SELLER_INPUT_INVALID','Caps cannot exceed one hundred percent.');return structuredClone(caps);}
/** Produces an immutable dry preview, never an API write. Missing evidence remains visible. */
export function stageSellerChange(raw:unknown,request:unknown,rawCaps:unknown,today:string):SellerStaged{
 const product=sellerProduct(raw),caps=readCaps(rawCaps);sellerDate(today);exact(request,['field','value','clearance','scope','depthBps','endsOn'],['field','value']);const change=structuredClone(request) as SellerChange;
 if(!FIELDS.includes(change.field))sellerRefuse('SELLER_FIELD_UNWRITABLE','This channel handoff cannot change that field.');sellerText(change.value,'New value',2000);
 if(change.clearance!==undefined&&typeof change.clearance!=='boolean')sellerRefuse('SELLER_INPUT_INVALID','Clearance needs the owner choice.');
 const missing:string[]=[];
 if(change.field==='price'){
  const next=sellerInteger(change.value,'Price'),before=sellerInteger(product.priceMinor,'Current price');if(next===0n||before===0n)sellerRefuse('SELLER_INPUT_INVALID','Prices must be positive.');
  if(product.breakEvenMinor===null)missing.push('Break-even contribution');else if(next<BigInt(product.breakEvenMinor)&&!change.clearance)sellerRefuse('SELLER_BELOW_BREAK_EVEN','The price is below break even. Only the owner can mark clearance.');
  if((next>before?next-before:before-next)*10000n>before*BigInt(caps.priceChangeBps))sellerRefuse('SELLER_CAP_EXCEEDED','This price change exceeds the current owner cap.');
 }
 if(change.field==='stock')sellerInteger(change.value,'Stock');
 if(change.field==='promotion'){
  sellerText(change.scope,'Promotion scope',200);const depth=sellerInteger(change.depthBps,'Promotion depth');if(depth===0n||depth>BigInt(caps.promotionBps))sellerRefuse('SELLER_CAP_EXCEEDED','This promotion exceeds the current owner cap.');const effective=BigInt(product.priceMinor)*(10000n-depth)/10000n;if(product.breakEvenMinor===null)missing.push('Break-even contribution');else if(effective<BigInt(product.breakEvenMinor)&&!change.clearance)sellerRefuse('SELLER_BELOW_BREAK_EVEN','The promotion price is below break even. Only the owner can mark clearance.');if(sellerDate(change.endsOn)<=today)sellerRefuse('SELLER_INPUT_INVALID','A promotion needs a future end date.');
 }
 if(change.field==='archive'&&change.value!=='yes')sellerRefuse('SELLER_INPUT_INVALID','Archive must name the exact action.');
 return {product,change,dryRun:true,descriptionComplete:!missing.length,missing,clearance:change.clearance===true,confirmName:change.field==='archive'?'Archive '+product.sku:null,money:['price','promotion'].includes(change.field),caps,capability:'handoff'};
}
/** Owner-route approval and session provenance are checked by the API before this current-state recheck. */
export function checkSellerApply(stage:SellerStaged,current:unknown,caps:unknown,today:string):SellerStaged{
 if(!stage.descriptionComplete)sellerRefuse('SELLER_PREVIEW_INCOMPLETE','Narrow the preview and supply the missing evidence before preparing a handoff.');const product=sellerProduct(current);
 if(product.sku!==stage.product.sku||product.channel!==stage.product.channel||product.currency!==stage.product.currency)sellerRefuse('SELLER_PROVENANCE_REQUIRED','Read this exact product in the current session.');
 if(stage.change.field==='stock'&&product.stock!==stage.product.stock)sellerRefuse('SELLER_STOCK_CHANGED','The stock moved since it was read.');
 if(stage.change.field!=='stock'&&JSON.stringify(product)!==JSON.stringify(stage.product))sellerRefuse('SELLER_SOURCE_CHANGED','The product changed since it was read.');
 return stageSellerChange(product,stage.change,caps,today);
}

/** Spreadsheet-safe manual file preserving every approved promotion bound. No marketplace write. */
export function sellerChangeHandoff(stage:SellerStaged){
 const {product:p,change:c}=stage;const before=c.field==='stock'?p.stock:c.field==='price'?p.priceMinor:c.field==='title'?p.title:'';
 const cell=(value:string)=>'"'+(/^[\s]*[=+@\-\t\r]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';
 return {name:'seller-change.csv',text:['sku,channel,currency,field,before,after,scope,depthBps,endsOn,clearance', [p.sku,p.channel,p.currency,c.field,before,c.value,c.scope??'',c.depthBps??'',c.endsOn??'',stage.clearance?'yes':'no'].map(cell).join(',')].join('\n')};
}
