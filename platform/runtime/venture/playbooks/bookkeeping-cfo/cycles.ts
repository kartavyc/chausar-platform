// Finance-workspace MIT ideas: explicit cycle identity and isolated folders, original implementation.
import {check,digest} from '../../../portable.ts';
import {booksExact,booksText,booksDate} from './books-input.ts';
export type CycleInput={businessId:string;clientId:string;system:'zoho'|'tally';companyId:string;from:string;to:string};
export type FinanceCycle=CycleInput&{id:string;folder:string};
export function financeCycle(input:CycleInput):FinanceCycle{
 booksExact(input,['businessId','clientId','system','companyId','from','to']);
 for(const key of ['businessId','clientId','companyId'] as const)booksText(input[key]);
 check(input.system==='zoho'||input.system==='tally','BOOKS_SETUP_INVALID','Choose the client accounting system.');
 booksDate(input.from);booksDate(input.to);check(input.from<=input.to,'BOOKS_CYCLE_INVALID','The finance cycle must end on or after it starts.');
 const id='cycle_'+digest(input).slice(0,32);return {...input,id,folder:'finance/'+id};
}
export function validateCycle(cycle:FinanceCycle):void{
 booksExact(cycle,['businessId','clientId','system','companyId','from','to','id','folder']);
 const {id,folder,...source}=cycle,expected=financeCycle(source);
 check(id===expected.id&&folder===expected.folder,'BOOKS_CYCLE_INVALID','The finance cycle identity changed.');
}
/** Callers never default to all cycles; client and year are part of the required identity. */
export function rowsForCycle<T extends {cycleId:string}>(rows:readonly T[],cycle:FinanceCycle):T[]{validateCycle(cycle);return rows.filter(row=>row.cycleId===cycle.id).map(row=>structuredClone(row));}
