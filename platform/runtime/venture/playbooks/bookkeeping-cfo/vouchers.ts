// Finance-workspace (MIT) receipt workflow ideas, original exact-entry Chausar implementation.
import {check,digest} from '../../../portable.ts';
import {validateCycle,type FinanceCycle} from './cycles.ts';
import {booksExact,booksText,booksDate,balancedEntries} from './books-input.ts';
import {decimalMinor} from '../../../currency.ts';
export type VoucherInput={cycle:FinanceCycle;date:string;description:string;receipt:{uploadId:string;digest:string;clientId:string;orderId:string};lines:{accountId:string;debitMinor:string;creditMinor:string}[]};
export type VoucherDraft=VoucherInput&{state:'draft';totalMinor:string;systemOfRecord:'client';digest:string};
/** Owner forms send rupee text unchanged; only the engine converts it to integer paise. */
export function voucherLinesFromRupees(raw:unknown):VoucherInput['lines']{
 check(Array.isArray(raw)&&raw.length>=2&&raw.length<=200,'BOOKS_SETUP_INVALID','Use two to two hundred voucher entries.');
 return raw.map(value=>{booksExact(value,['accountId','debitRupees','creditRupees']);booksText(value.accountId);booksText(value.debitRupees,40);booksText(value.creditRupees,40);return {accountId:value.accountId,debitMinor:decimalMinor(value.debitRupees,'INR'),creditMinor:decimalMinor(value.creditRupees,'INR')};});
}
export function voucherDraft(input:VoucherInput):VoucherDraft{
 booksExact(input,['cycle','date','description','receipt','lines']);validateCycle(input.cycle);booksDate(input.date);
 check(input.date>=input.cycle.from&&input.date<=input.cycle.to,'BOOKS_CYCLE_INVALID','The receipt date must belong to this finance cycle.');booksText(input.description,1000);
 booksExact(input.receipt,['uploadId','digest','clientId','orderId']);booksText(input.receipt.uploadId);booksText(input.receipt.orderId);
 check(input.receipt.clientId===input.cycle.clientId&&typeof input.receipt.digest==='string'&&/^[a-f0-9]{64}$/.test(input.receipt.digest),'BOOKS_RECEIPT_REQUIRED','Use the actual receipt uploaded to this client order.');
 check(Array.isArray(input.lines)&&input.lines.length>=2&&input.lines.length<=200,'BOOKS_SETUP_INVALID','Use two to two hundred voucher entries.');
 for(const line of input.lines){booksExact(line,['accountId','debitMinor','creditMinor']);booksText(line.accountId);}
 const totals=balancedEntries(input.lines);
 return {...structuredClone(input),state:'draft',totalMinor:totals.debitMinor,systemOfRecord:'client',digest:digest(input)};
}
/** The desk supplies current upload bytes and the authenticated bookkeeper identity, never model authority. */
export function approveVoucher(draft:VoucherDraft,approval:{digest:string;receiptDigest:string;by:string;at:string}){
 booksExact(draft,['cycle','date','description','receipt','lines','state','totalMinor','systemOfRecord','digest']);
 booksExact(approval,['digest','receiptDigest','by','at']);booksText(approval.by);booksText(approval.at,50);
 check(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(approval.at)||/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(approval.at),'BOOKS_SETUP_INVALID','Use the current approval timestamp.');
 check(Number.isFinite(Date.parse(approval.at)),'BOOKS_SETUP_INVALID','Use the current approval timestamp.');
 const {state,totalMinor,systemOfRecord,digest:prior,...source}=draft,current=voucherDraft(source);
 check(state==='draft'&&systemOfRecord==='client'&&totalMinor===current.totalMinor&&prior===current.digest&&approval.digest===current.digest,'APPROVAL_STALE','The voucher changed. Read and approve its exact entries again.');
 check(approval.receiptDigest===draft.receipt.digest,'BOOKS_RECEIPT_CHANGED','The original receipt changed or was removed. Draft the voucher again.');
 return {...structuredClone(draft),state:'approved' as const,approval:{by:approval.by,at:approval.at,digest:approval.digest},posted:false as const};
}
