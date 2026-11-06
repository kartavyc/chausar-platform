// Seller-bookkeeping MIT catalogue ideas, reusing Chausar 5F1's exact settlement calculation.
import {check,digest} from '../../../portable.ts';
import {computeSettlements,type SettlementInput} from '../online-seller/model.ts';
import {validateCycle,type FinanceCycle} from './cycles.ts';
import {booksExact,booksText,booksDate,booksMinor} from './books-input.ts';
export type SellerBooksInput={cycle:FinanceCycle;month:string;orders:{orderId:string;on:string;source:string}[];settlements:SettlementInput[];credits:{kind:'gst'|'tcs'|'tds';expectedMinor:string;creditedMinor:string;section:string;source:string}[]};
/** Report source amounts only; tax section correctness remains a named CA review, never inferred from a rate. */
export function sellerBooks(input:SellerBooksInput){
 booksExact(input,['cycle','month','orders','settlements','credits']);validateCycle(input.cycle);
 check(typeof input.month==='string'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(input.month),'BOOKS_CYCLE_INVALID','Choose a real accounting month.');
 const start=input.month+'-01';booksDate(start);const end=new Date(Date.parse(start+'T00:00:00Z'));end.setUTCMonth(end.getUTCMonth()+1,0);const last=end.toISOString().slice(0,10);
 check(start>=input.cycle.from&&last<=input.cycle.to,'BOOKS_CYCLE_INVALID','The complete month must belong to this finance cycle.');
 check(Array.isArray(input.orders)&&input.orders.length>0&&input.orders.length<=500,'BOOKS_SETUP_INVALID','Use one to five hundred order source rows.');
 const ids=new Set<string>();for(const row of input.orders){booksExact(row,['orderId','on','source']);booksText(row.orderId);booksText(row.source,1000);booksDate(row.on);check(row.on.startsWith(input.month+'-'),'BOOKS_CYCLE_INVALID','Keep every order in this accounting month.');check(!ids.has(row.orderId),'BOOKS_SETUP_INVALID','Each source order must be unique.');ids.add(row.orderId);}
 const settlement=computeSettlements(input.settlements);
 check(settlement.rows.length===ids.size&&settlement.rows.every(row=>ids.has(row.orderId)),'BOOKS_SETTLEMENT_MISMATCH','Match every monthly order to exactly one settlement row.');
 check(Array.isArray(input.credits)&&input.credits.length<=3,'BOOKS_SETUP_INVALID','Use one source row per applicable GST, TCS or TDS credit.');
 const kinds=new Set<string>();const credits=input.credits.map(row=>{booksExact(row,['kind','expectedMinor','creditedMinor','section','source']);check(['gst','tcs','tds'].includes(row.kind)&&!kinds.has(row.kind),'BOOKS_SETUP_INVALID','Each credit kind occurs once.');kinds.add(row.kind);booksText(row.source,1000);booksText(row.section,500);const difference=booksMinor(row.expectedMinor)-booksMinor(row.creditedMinor);return {...row,differenceMinor:String(difference),state:difference===0n?'matched' as const:'reconcile' as const};});
 return {cycleId:input.cycle.id,month:input.month,settlement,payouts:input.settlements.map(row=>({orderId:row.orderId,expectedMinor:row.expectedMinor,paidMinor:row.paidMinor})),credits,creditDifferenceMinor:String(credits.reduce((sum,row)=>sum+BigInt(row.differenceMinor),0n)),requiresCaConfirmation:true as const,posted:false as const,receiptId:'seller_books_'+digest(input).slice(0,24)};
}
