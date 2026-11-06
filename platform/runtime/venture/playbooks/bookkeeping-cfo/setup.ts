// Back-office setup drafts after cfo/finance-workspace (MIT ideas); the client books remain authoritative.
import {check,digest} from '../../../portable.ts';
import {validateCycle,type FinanceCycle} from './cycles.ts';
import {booksExact,booksText,balancedEntries} from './books-input.ts';
export type SetupEntity={id:string;name:string;source:string};
export type OpeningEntry={accountId:string;debitMinor:string;creditMinor:string;source:string};
export type SetupInput={cycle:FinanceCycle;customers:SetupEntity[];vendors:SetupEntity[];categories:SetupEntity[];opening:OpeningEntry[]};
function entities(rows:SetupEntity[]):void{
 check(Array.isArray(rows)&&rows.length<=500,'BOOKS_SETUP_INVALID','Use at most five hundred setup rows per collection.');
 const ids=new Set<string>();for(const row of rows){booksExact(row,['id','name','source']);booksText(row.id);booksText(row.name);booksText(row.source,1000);check(!ids.has(row.id),'BOOKS_SETUP_INVALID','Each setup identity must be unique.');ids.add(row.id);}
}
export function setupDraft(input:SetupInput){
 booksExact(input,['cycle','customers','vendors','categories','opening']);validateCycle(input.cycle);
 entities(input.customers);entities(input.vendors);entities(input.categories);
 check(Array.isArray(input.opening)&&input.opening.length<=1000,'BOOKS_SETUP_INVALID','Use at most one thousand opening balance rows.');
 const accounts=new Set(input.categories.map(row=>row.id));
 for(const row of input.opening){booksExact(row,['accountId','debitMinor','creditMinor','source']);booksText(row.source,1000);check(accounts.has(row.accountId),'BOOKS_ACCOUNT_REQUIRED','Map every opening entry to a supplied account.');}
 return {...structuredClone(input),state:'draft' as const,systemOfRecord:'client' as const,...balancedEntries(input.opening),receiptId:'books_setup_'+digest(input).slice(0,24)};
}
