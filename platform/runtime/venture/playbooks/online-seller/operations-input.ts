// Source settings are recorded by the owner, never invented by an agent tool call.
import {sellerDate,sellerRefuse} from './operations-core.ts';
import {sellerThresholdRows,type SellerOperationMode} from './operations-analysis.ts';
export function sellerSourceOptions(mode:SellerOperationMode,fields:Record<string,unknown>,rowsOf:(id:string)=>Record<string,string>[]):unknown{
 if(mode==='alerts')return fields.thresholds?{thresholds:sellerThresholdRows(rowsOf(String(fields.thresholds)))}:{};
 if(mode==='stock'||mode==='payouts')return {};
 if(mode==='research'){const date=sellerDate(fields.researchDate);return {month:Number(date.slice(5,7)),profile:fields.researchProfile,trademarks:fields.trademarks??[]};}
 if(mode==='multi-store')return {stores:fields.stores};
 if(mode==='catalogue'){
  if(typeof fields.catalogueMapping!=='string')sellerRefuse('SELLER_CATALOGUE_HOLD','Add the owner dated marketplace column map.');
  return {map:{channel:String(fields.marketplace).toLowerCase(),checkedOn:fields.mappingCheckedOn,source:fields.mappingSource,columns:rowsOf(String(fields.catalogueMapping))}};
 }
 sellerRefuse('SELLER_INPUT_INVALID','Use the owner desk for a price-history comparison.');
}
