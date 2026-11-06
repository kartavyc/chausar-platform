// Original bounded finance source validators, browser-safe and shared with the owner demo.
import {check} from '../../../portable.ts';
export function booksExact(value:unknown,keys:readonly string[]):asserts value is Record<string,unknown>{
 check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),'BOOKS_SETUP_INVALID','Use the exact finance source fields.');
}
export function booksText(value:unknown,max=200):asserts value is string{check(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f]/.test(value),'BOOKS_SETUP_INVALID','Use bounded source text.');}
export function booksMinor(value:unknown):bigint{check(typeof value==='string'&&/^(?:0|[1-9]\d{0,15})$/.test(value)&&BigInt(value)<=1_000_000_000_000_000n,'BOOKS_SETUP_INVALID','Use exact non-negative paise.');return BigInt(value);}
export function booksDate(value:unknown):asserts value is string{check(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!value.startsWith('0000')&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'BOOKS_CYCLE_INVALID','Use a real finance calendar date.');}
export function balancedEntries(rows:readonly {debitMinor:string;creditMinor:string}[]){
 let debit=0n,credit=0n;for(const row of rows){const d=booksMinor(row.debitMinor),c=booksMinor(row.creditMinor);check((d===0n)!==(c===0n),'BOOKS_SETUP_INVALID','Each entry needs one positive debit or credit.');debit+=d;credit+=c;}
 check(debit===credit,'BOOKS_OPENING_UNBALANCED','Reconcile entry debits and credits before approval.');return {debitMinor:String(debit),creditMinor:String(credit)};
}
