// Original code receipts for explicit currency claims. W6 6E4 moved the extractor to kit/documents/money.ts, shared
// with the document desk; this file keeps the tender names and its receipt prefix.
import {hasMoney,sourceMoneyReceipts,type SourceMoneyReceipt} from '../kit/documents/money.ts';
import type {SourceText} from '../../delivery/judge/claim-check-core.ts';
export type TenderMoneyReceipt=SourceMoneyReceipt;
/** Receipts prove exact transcription from a client quote, not independent price or tax advice. */
export function hasTenderMoney(text:string):boolean{return hasMoney(text);}
export function tenderMoneyReceipts(answer:string,documents:readonly SourceText[]):{receipts:TenderMoneyReceipt[];unmatched:string[]}{return sourceMoneyReceipts(answer,documents,'tender_money_');}
