// Shared seller figure projection. Original Chausar code; rehearsal uses the same integer values.
import { formatMoney } from '../../../owner-format.ts';
export type SellerOperationFigure={key:string;label:string;minor:string;display:string;currency:string;unit:'money'|'count'};
export function sellerOperationFigures(data:unknown):SellerOperationFigure[]{
 const figures:SellerOperationFigure[]=[];
 function visit(value:unknown,path:string,currency:string){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach((item,index)=>visit(item,path+'.'+(index+1),currency));return;}const row=value as Record<string,unknown>;const own=typeof row.currency==='string'?row.currency:currency;for(const [key,item] of Object.entries(row)){const id=(path+'.'+key).replace(/^\./,'');if((typeof item==='string'||typeof item==='number')&&/^-?\d+$/.test(String(item))&&(/Minor$/.test(key)||key==='minor'||['count','stock','onHand','allocated','reserved','incoming','available','purchasable','ageDays'].includes(key))){const money=/Minor$/.test(key)||key==='minor';figures.push({key:id,label:id,minor:String(item),display:money?formatMoney(String(item),own):String(item),currency:own,unit:money?'money':'count'});}else visit(item,id,own);}}
 visit(data,'','INR');return figures;}
