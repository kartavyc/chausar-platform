// A single source CSV keeps the monthly reconciliation inspectable and uses the seller engine unchanged.
import {check} from '../../../portable.ts';
import {csvRows} from '../../../csv.ts';
import {decimalMinor} from '../../../currency.ts';
import {sellerBooks,type SellerBooksInput} from './seller-books.ts';
import type {FinanceCycle} from './cycles.ts';
export const SELLER_BOOKS_COLUMNS=['kind','orderId','on','source','expectedRupees','paidRupees','detail'] as const;
export function sellerBooksSource(text:string,cycle:FinanceCycle,month:string){
 check(typeof text==='string'&&text.length<=500000,'BOOKS_SETUP_INVALID','Use a bounded seller-month CSV.');const rows=csvRows(text),header=rows.shift();check(header?.length===SELLER_BOOKS_COLUMNS.length&&SELLER_BOOKS_COLUMNS.every((name,i)=>header[i]===name),'BOOKS_SETUP_INVALID','Use the seller-month CSV template columns.');check(rows.length>0&&rows.length<=2500,'BOOKS_SETUP_INVALID','Use a bounded set of monthly source rows.');
 const input:SellerBooksInput={cycle,month,orders:[],settlements:[],credits:[]};const adjustments:{orderId:string;kind:'fee-slab'|'weight-change'|'return-deduction';minor:string;source:string}[]=[],holds:{orderId:string;detail:string}[]=[];
 for(const cells of rows){check(cells.length===SELLER_BOOKS_COLUMNS.length,'BOOKS_SETUP_INVALID','Fill every monthly source column.');const [kind,orderId,on,source,expected,paid,detail]=cells as [string,string,string,string,string,string,string];
  if(kind==='order'){check(!expected&&!paid&&!detail,'BOOKS_SETUP_INVALID','Order rows carry their date and source, without payout amounts.');input.orders.push({orderId,on,source});}
  else if(kind==='settlement'){check(!detail,'BOOKS_SETUP_INVALID','Put settlement explanations in named adjustment or hold rows.');input.settlements.push({orderId,source,observedAt:on,expectedMinor:decimalMinor(expected,'INR'),paidMinor:decimalMinor(paid,'INR'),adjustments:[],holdReasons:[]});}
  else if(['gst','tcs','tds'].includes(kind)){check(!orderId&&!on,'BOOKS_SETUP_INVALID','Monthly credits have their own source and section, separate from order payouts.');input.credits.push({kind:kind as 'gst'|'tcs'|'tds',source,section:detail,expectedMinor:decimalMinor(expected,'INR'),creditedMinor:decimalMinor(paid,'INR')});}
  else if(['fee-slab','weight-change','return-deduction'].includes(kind)){check(!on&&!paid&&!detail,'BOOKS_SETUP_INVALID','An adjustment needs its order, source and exact amount.');adjustments.push({orderId,kind:kind as 'fee-slab'|'weight-change'|'return-deduction',minor:decimalMinor(expected,'INR'),source});}
  else{check(kind==='hold'&&!on&&!expected&&!paid&&!!source.trim(),'BOOKS_SETUP_INVALID','Use a named monthly row kind.');holds.push({orderId,detail:source+': '+detail});}
 }
 for(const row of adjustments){const settlement=input.settlements.find(value=>value.orderId===row.orderId);check(settlement,'BOOKS_SETTLEMENT_MISMATCH','Each adjustment needs its own settlement row.');const {orderId:_,...adjustment}=row;settlement.adjustments.push(adjustment);}
 for(const row of holds){const settlement=input.settlements.find(value=>value.orderId===row.orderId);check(settlement,'BOOKS_SETTLEMENT_MISMATCH','Each hold needs its own settlement row.');settlement.holdReasons.push(row.detail);}
 return sellerBooks(input);
}
