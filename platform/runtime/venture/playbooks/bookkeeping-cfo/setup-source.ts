// A regular uploadable CSV, parsed by the same code in the real and demo desks.
import {check} from '../../../portable.ts';
import {csvRows} from '../../../csv.ts';
import {decimalMinor} from '../../../currency.ts';
import type {SetupInput} from './setup.ts';
export const SETUP_COLUMNS=['kind','id','name','source','debitRupees','creditRupees'] as const;
export function setupSource(text:string):Omit<SetupInput,'cycle'>{
 check(typeof text==='string'&&text.length<=500000,'BOOKS_SETUP_INVALID','Use a setup CSV below five hundred kilobytes.');const rows=csvRows(text),head=rows.shift();check(head?.length===SETUP_COLUMNS.length&&SETUP_COLUMNS.every((key,i)=>head[i]===key),'BOOKS_SETUP_INVALID','Use the client setup CSV template columns.');
 check(rows.length>0&&rows.length<=2500,'BOOKS_SETUP_INVALID','Use a bounded client setup file.');const result:Omit<SetupInput,'cycle'>={customers:[],vendors:[],categories:[],opening:[]};
 for(const cells of rows){check(cells.length===SETUP_COLUMNS.length,'BOOKS_SETUP_INVALID','Fill every setup template column.');const [kind,id,name,source,debit,credit]=cells as [string,string,string,string,string,string];
  if(kind==='opening'){check(name===''&&debit!==''&&credit!=='','BOOKS_SETUP_INVALID','Opening rows need both rupee columns and no separate name.');result.opening.push({accountId:id,source,debitMinor:decimalMinor(debit,'INR'),creditMinor:decimalMinor(credit,'INR')});}
  else{check(['customer','vendor','category'].includes(kind)&&debit===''&&credit==='','BOOKS_SETUP_INVALID','Choose a customer, vendor or category row without opening amounts.');result[kind==='customer'?'customers':kind==='vendor'?'vendors':'categories'].push({id,name,source});}
 }
 return result;
}
