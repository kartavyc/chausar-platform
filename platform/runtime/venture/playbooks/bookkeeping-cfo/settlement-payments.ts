// Actual paid amounts only. Differences stay open for the bookkeeper; this never writes off fees or tax credits.
import {check,digest} from '../../../portable.ts';
import {csvRows} from '../../../csv.ts';
import {decimalMinor} from '../../../currency.ts';
import {booksExact,booksText,booksMinor} from './books-input.ts';
import {validateCycle,type FinanceCycle} from './cycles.ts';
import {externalPostingId,postingDay} from './posting-core.ts';
import type {sellerBooks} from './seller-books.ts';
export const SETTLEMENT_PAYMENT_COLUMNS=['shopId','settlementId','orderId','paidAt','timeZone','paymentMode','accountId','paidRupees','source'] as const;
export type SettlementPaymentSource={shopId:string;settlementId:string;orderId:string;paidAt:string;timeZone:string;paymentMode:'banktransfer'|'bankremittance'|'cash'|'check'|'creditcard'|'others';accountId:string;paidMinor:string;source:string};
export type SettlementPayment={externalId:string;invoiceReference:string;orderId:string;source:string;postingDate:string;paymentMode:SettlementPaymentSource['paymentMode'];accountId:string;amountMinor:string;unappliedDifferenceMinor:string};
function validate(row:SettlementPaymentSource){
 booksExact(row,['shopId','settlementId','orderId','paidAt','timeZone','paymentMode','accountId','paidMinor','source']);
 for(const key of ['shopId','settlementId','orderId','source'] as const)booksText(row[key]);
 check(typeof row.paymentMode==='string'&&['banktransfer','bankremittance','cash','check','creditcard','others'].includes(row.paymentMode),'BOOKS_SETUP_INVALID','Use the actual payment method from the settlement source.');
 check(typeof row.accountId==='string'&&/^\d{1,100}$/.test(row.accountId),'BOOKS_SETUP_INVALID','Name the actual cash or bank account ID.');
 check(booksMinor(row.paidMinor)>0n,'BOOKS_SETUP_INVALID','Only a confirmed positive payout can be recorded as a payment.');
 return postingDay(row.paidAt,row.timeZone);
}
export function settlementPaymentSource(text:string):SettlementPaymentSource[]{
 check(typeof text==='string'&&text.length<=500000,'BOOKS_SETUP_INVALID','Use a bounded settlement payment CSV.');const rows=csvRows(text),header=rows.shift();
 check(header?.length===SETTLEMENT_PAYMENT_COLUMNS.length&&SETTLEMENT_PAYMENT_COLUMNS.every((name,i)=>header[i]===name)&&rows.length>0&&rows.length<=500,'BOOKS_SETUP_INVALID','Use the settlement payment template with one to five hundred rows.');
 return rows.map(cells=>{check(cells.length===SETTLEMENT_PAYMENT_COLUMNS.length,'BOOKS_SETUP_INVALID','Fill every settlement payment source column.');const [shopId,settlementId,orderId,paidAt,timeZone,paymentMode,accountId,paidRupees,source]=cells as [string,string,string,string,string,SettlementPaymentSource['paymentMode'],string,string,string];const row={shopId,settlementId,orderId,paidAt,timeZone,paymentMode,accountId,paidMinor:decimalMinor(paidRupees,'INR'),source};validate(row);return row;});
}
export function settlementPayments(cycle:FinanceCycle,report:ReturnType<typeof sellerBooks>,sources:readonly SettlementPaymentSource[]){
 validateCycle(cycle);check(report.cycleId===cycle.id&&/^\d{4}-(0[1-9]|1[0-2])$/.test(report.month),'BOOKS_CYCLE_INVALID','Use this cycle current monthly reconciliation.');
 check(Array.isArray(sources)&&sources.length>0&&sources.length<=500&&sources.length===report.payouts.length,'BOOKS_SETTLEMENT_MISMATCH','Match every monthly order to one confirmed payment source.');
 const seen=new Set<string>(),identities=new Set<string>();const rows:SettlementPayment[]=sources.map(source=>{
  const postingDate=validate(source),payout=report.payouts.find(row=>row.orderId===source.orderId),reconciled=report.settlement.rows.find(row=>row.orderId===source.orderId);
  check(!seen.has(source.orderId)&&payout&&reconciled&&reconciled.holdReasons.length===0&&payout.paidMinor===source.paidMinor,'BOOKS_SETTLEMENT_MISMATCH','Resolve held or unexplained payouts and match actual paid amounts before posting.');seen.add(source.orderId);
  check(postingDate.startsWith(report.month+'-')&&postingDate>=cycle.from&&postingDate<=cycle.to,'BOOKS_CYCLE_INVALID','Each paid date must be in this accounting month and cycle.');
  const externalId='chausar-settlement-'+digest({shopId:source.shopId,settlementId:source.settlementId,orderId:source.orderId}).slice(0,32);check(!identities.has(externalId),'BOOKS_SETTLEMENT_MISMATCH','Use each settlement source identity once.');identities.add(externalId);
  const difference=booksMinor(payout.expectedMinor)-booksMinor(payout.paidMinor);
  return {externalId,invoiceReference:externalPostingId(source),orderId:source.orderId,source:source.source,postingDate,paymentMode:source.paymentMode,accountId:source.accountId,amountMinor:source.paidMinor,unappliedDifferenceMinor:String(difference)};
 });
 return {rows,totalMinor:String(rows.reduce((sum,row)=>sum+BigInt(row.amountMinor),0n)),digest:digest({cycle,report,sources})};
}
