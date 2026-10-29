// Original persistent wrapper around shared voucher/setup receipt arithmetic.
import type {VentureTx} from '../../records.ts';
import {digest} from '../../records.ts';
import type {WorkReceiptRecord} from '../../contracts.ts';
import {financeReceiptData} from './finance-receipt-core.ts';
export function financeReceipt(tx:VentureTx,workId:string,source:{id:string;name:string;digest:string},rows:readonly {accountId:string;debitMinor:string;creditMinor:string}[]){
 const receipt:WorkReceiptRecord={...tx.base('venture-work-receipt'),...financeReceiptData(workId,source,rows)};
 receipt.digest=digest({...receipt,digest:''});tx.put(receipt);return receipt.id;
}
