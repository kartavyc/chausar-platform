// Exact source CSV for marketplace orders, with one row per item and repeated order-level fields.
import {check,digest} from '../../../portable.ts';
import {csvRows} from '../../../csv.ts';
import {decimalMinor} from '../../../currency.ts';
import type {BooksOrder} from './posting-core.ts';
export const BOOKS_SOURCE_COLUMNS=['shopId','orderId','source','occurredAt','timeZone','status','eligible','currency','goodsRupees','sellerDiscountRupees','platformDiscountRupees','subtotalRupees','shippingRupees','taxRupees','totalRupees','sku','itemId','amountRupees'] as const;
export function postingSource(text:string):BooksOrder[]{
 check(typeof text==='string'&&text.length<=1000000,'BOOKS_INPUT_INVALID','Use a bounded order CSV.');const rows=csvRows(text),header=rows.shift();check(header?.length===BOOKS_SOURCE_COLUMNS.length&&BOOKS_SOURCE_COLUMNS.every((name,i)=>header[i]===name),'BOOKS_INPUT_INVALID','Use the accounting order CSV columns in template order.');
 check(rows.length>0&&rows.length<=1000,'BOOKS_INPUT_INVALID','Use one to one thousand order item rows.');const grouped=new Map<string,BooksOrder>();
 for(const cells of rows){check(cells.length===BOOKS_SOURCE_COLUMNS.length,'BOOKS_INPUT_INVALID','Every order row needs all template columns.');const row=Object.fromEntries(BOOKS_SOURCE_COLUMNS.map((key,i)=>[key,cells[i]!]));check(['true','false'].includes(row.eligible!)&&row.currency==='INR','BOOKS_INPUT_INVALID','State eligibility as true or false and currency as INR.');
  const value={shopId:row.shopId!,orderId:row.orderId!,source:row.source!,occurredAt:row.occurredAt!,timeZone:row.timeZone!,status:row.status as BooksOrder['status'],eligible:row.eligible==='true',currency:'INR' as const,...Object.fromEntries(['goods','sellerDiscount','platformDiscount','subtotal','shipping','tax','total'].map(key=>[key+'Minor',decimalMinor(row[key+'Rupees']!,'INR')]))} as Omit<BooksOrder,'lines'>;
  const key=digest([value.shopId,value.orderId]),prior=grouped.get(key);if(prior){const {lines:_,...same}=prior;check(digest(same)===digest(value),'BOOKS_INPUT_INVALID','Repeated item rows must agree on every order-level field.');}
  const order=prior??{...value,lines:[]};order.lines.push({sku:row.sku!,itemId:row.itemId||null,amountMinor:decimalMinor(row.amountRupees!,'INR')});grouped.set(key,order);
 }
 return [...grouped.values()];
}
