// Chausar computed seller attention, Shopify commerce Apache-2.0 ideas. Alerts are never stored.
import {exact,sellerRows,sellerText,sellerInteger,sellerCurrency,sellerRefuse} from './operations-core.ts';
export type SellerThresholds={defaults:Record<string,string>;categories:Record<string,Record<string,string>>;skus:Record<string,Record<string,string>>};
export type SellerMetric={sku:string;category:string;stock:string|null;sold30:string|null;returns:string|null;orders:string|null;unitCostMinor:string|null;currency:string;source:string};
export type SellerAlert={sku:string;kind:string;threshold:string;source:string;currency:string;moneyMinor:string|null;inputs:Record<string,string|null>;options:string[]};
export function sellerAlerts(raw:unknown,config:unknown):SellerAlert[]{
 exact(config,['defaults','categories','skus']);const c=config as unknown as SellerThresholds;const allowed=['lowStock','slowSold30','slowStock','returnBps','returnMinOrders'];
 for(const group of [c.defaults,...Object.values(c.categories),...Object.values(c.skus)]){exact(group,allowed,[]);for(const value of Object.values(group))sellerInteger(value,'Threshold');}
 return sellerRows(raw).flatMap(value=>{
  exact(value,['sku','category','stock','sold30','returns','orders','unitCostMinor','currency','source']);const row=value as SellerMetric;sellerText(row.sku,'SKU',120);sellerText(row.category,'Category',120);sellerText(row.source,'Metric source');sellerCurrency(row.currency);for(const key of ['stock','sold30','returns','orders','unitCostMinor'] as const)if(row[key]!==null)sellerInteger(row[key],key);
  const t={...c.defaults,...c.categories[row.category],...c.skus[row.sku]},out:SellerAlert[]=[];const money=row.unitCostMinor===null||row.stock===null?null:String(BigInt(row.unitCostMinor)*BigInt(row.stock));
  const add=(kind:string,threshold:string,inputs:Record<string,string|null>,options:string[]=[])=>out.push({sku:row.sku,kind,threshold,source:row.source,currency:row.currency,moneyMinor:money,inputs,options});
  if(row.stock!==null&&t.lowStock!==undefined&&BigInt(row.stock)<=BigInt(t.lowStock))add('low-stock',t.lowStock,{stock:row.stock});
  if(row.stock!==null&&row.sold30!==null&&t.slowSold30!==undefined&&t.slowStock!==undefined&&BigInt(row.sold30)<=BigInt(t.slowSold30)&&BigInt(row.stock)>=BigInt(t.slowStock))add('slow-mover',t.slowSold30+' sold / '+t.slowStock+' stock',{stock:row.stock,sold30:row.sold30},['leave','mark down','pull']);
  if(row.returns!==null&&row.orders!==null&&t.returnBps!==undefined&&t.returnMinOrders!==undefined&&BigInt(row.orders)>0n&&BigInt(row.orders)>=BigInt(t.returnMinOrders)&&BigInt(row.returns)*10000n>=BigInt(row.orders)*BigInt(t.returnBps))add('return-spike',t.returnBps,{returns:row.returns,orders:row.orders});return out;
 });
}
/** Unknown means cannot read, never zero. Different currencies are kept in separate ranking groups. */
export function sellerBriefing(raw:unknown,config:unknown){const rows=sellerRows(raw) as SellerMetric[];const alerts=sellerAlerts(rows,config);const ranked=alerts.sort((a,b)=>a.currency.localeCompare(b.currency)||(a.moneyMinor===null?1:b.moneyMinor===null?-1:BigInt(a.moneyMinor)>BigInt(b.moneyMinor)?-1:BigInt(a.moneyMinor)<BigInt(b.moneyMinor)?1:0)).map(row=>({...row,metric:row.moneyMinor===null?'cannot read':'read'}));const fallback=['Sales trend','Buyer messages','Damaged goods'];for(const label of fallback){if(ranked.length>=3)break;ranked.push({sku:'',kind:label,threshold:'not available',source:'No source supplied for '+label.toLowerCase(),currency:rows[0]?.currency??'INR',moneyMinor:null,inputs:{},options:[],metric:'cannot read'});}return ranked.slice(0,6);}
