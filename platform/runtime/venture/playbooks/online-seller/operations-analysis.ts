// Chausar export-only seller analyses. Shared with rehearsal; original MIT/Apache research implementation.
import {exact,sellerRefuse} from './operations-core.ts';
import {sellerAlerts,sellerBriefing,type SellerThresholds} from './alerts.ts';
import {sellerStock,sellerPayouts,sellerWasPrice} from './stock.ts';
import {reviewSellerShortlist} from './research.ts';
import {sellerCatalogueRows} from './catalogue-sheets.ts';
import {sellerMultiStore} from './multi-store.ts';
export const SELLER_OPERATION_MODES=['alerts','stock','research','catalogue','multi-store','payouts','price-history'] as const;
export type SellerOperationMode=typeof SELLER_OPERATION_MODES[number];
export const SELLER_DEFAULT_THRESHOLDS:SellerThresholds={defaults:{lowStock:'5',slowSold30:'2',slowStock:'12',returnBps:'2000',returnMinOrders:'4'},categories:{},skus:{}};
export const SELLER_OPERATION_HEADERS:Record<SellerOperationMode,string>={alerts:'sku,category,stock,sold30,returns,orders,unitCostMinor,currency,source',stock:'id,sku,counter,delta,authority,source,at',research:'id,title,keyword,priceMinor,feeMinor,reviews,ratingBps,recentReviewSpike,seasonMonths,source',catalogue:'sku,title,priceMinor,stock', 'multi-store':'kind,sku,store,currency,priceMinor,stock,source,id,placedOn,fulfilled',payouts:'kind,minor,status,currency','price-history':'at,minor,currency'};
const bool=(value:string)=>{if(!['yes','no'].includes(value))sellerRefuse('SELLER_INPUT_INVALID','Use yes or no in this export.');return value==='yes';};
export function sellerThresholdRows(rows:Record<string,string>[]):SellerThresholds{const config=structuredClone(SELLER_DEFAULT_THRESHOLDS);for(const row of rows){exact(row,['scope','id','key','value']);if(!['defaults','categories','skus'].includes(row.scope!))sellerRefuse('SELLER_INPUT_INVALID','A threshold scope is defaults, categories or skus.');if(row.scope==='defaults')config.defaults[row.key!]=row.value!;else {if(!row.id)sellerRefuse('SELLER_INPUT_INVALID','An override needs its category or SKU.');const group=config[row.scope as 'categories'|'skus'];group[row.id]={...group[row.id],[row.key!]:row.value!};}}return config;}
/** Tool callers supply only files; owner forms may supply these non-money report settings. */
export function analyseSellerOperation(mode:SellerOperationMode,rows:Record<string,string>[],options:unknown,today:string):unknown{
 if(!SELLER_OPERATION_MODES.includes(mode))sellerRefuse('SELLER_INPUT_INVALID','Choose a seller operation.');
 if(mode==='alerts'){exact(options,['thresholds'],[]);const thresholds=options.thresholds??SELLER_DEFAULT_THRESHOLDS;const metrics=rows.map(row=>({...row,...Object.fromEntries(['stock','sold30','returns','orders','unitCostMinor'].map(key=>[key,row[key]||null]))}));return {alerts:sellerAlerts(metrics,thresholds),briefing:sellerBriefing(metrics,thresholds),thresholds};}
 if(mode==='stock'){exact(options,[]);return sellerStock(rows);}
 if(mode==='payouts'){exact(options,[]);return sellerPayouts(rows);}
 if(mode==='price-history'){exact(options,['was','currency']);return sellerWasPrice(rows,String(options.was),String(options.currency),today);}
 if(mode==='research'){exact(options,['month','trademarks','profile']);return reviewSellerShortlist(rows.map(row=>({...row,recentReviewSpike:bool(row.recentReviewSpike!),seasonMonths:row.seasonMonths?row.seasonMonths.split('|').map(Number):[]})),options as {month:number;trademarks:string[];profile:string});}
 if(mode==='catalogue'){exact(options,['map']);return sellerCatalogueRows(rows,options.map,today);}
 exact(options,['stores']);const products:Record<string,string>[]=[],orders:Record<string,unknown>[]=[];for(const row of rows){exact(row,['kind','sku','store','currency','priceMinor','stock','source','id','placedOn','fulfilled']);if(row.kind==='product')products.push(Object.fromEntries(['sku','store','currency','priceMinor','stock','source'].map(key=>[key,row[key]!])));else if(row.kind==='order')orders.push({id:row.id,sku:row.sku,store:row.store,placedOn:row.placedOn,fulfilled:bool(row.fulfilled!)});else sellerRefuse('SELLER_INPUT_INVALID','Name each row product or order.');}return sellerMultiStore(products,options.stores as string[],orders,today);
}
