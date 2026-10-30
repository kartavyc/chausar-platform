// CA10. Original Chausar implementation; template/error ideas from py-idp (AGPL, no code copied).
// Every page ties by BigInt arithmetic. These are owner-review drafts; no external books are changed.
import {check} from '../../../portable.ts';
import {paise,signedPaise,isoDate} from './money.ts';
import {ReceiptBuilder} from './receipt.ts';
import type {DocumentEntryInput,DocumentEntryWorking} from './doc-entry-types.ts';
export type {DocumentEntryInput,DocumentEntryWorking} from './doc-entry-types.ts';
const words=(value:unknown,label:string,max=200):string=>{check(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\r\n\0]/.test(value),'TAX_INPUT_INVALID',`Give a bounded ${label} from the source document.`);return value;};
/** Prepare bank, purchase or sales vouchers only after every required code tie passes. */
export function documentEntries(input:DocumentEntryInput){
 check(input&&typeof input==='object','TAX_INPUT_INVALID','Choose a document template.');words(input.source,'source reference');
 const builder=new ReceiptBuilder('doc-entry'),working:DocumentEntryWorking={kind:input.kind,account:null,vouchers:[],pages:[]};
 if(input.kind==='bank-statement'){
  working.account=words(input.account,'account identifier',80);check(Array.isArray(input.pages)&&input.pages.length>0&&input.pages.length<=1000,'TAX_INPUT_INVALID','Give the statement pages in order.');
  const ids=new Set<string>();let previous:bigint|null=null;
  for(const [index,page]of input.pages.entries()){
   check(page.page===index+1&&Array.isArray(page.lines)&&page.lines.length<=10000,'TAX_INPUT_INVALID','Give consecutive statement pages starting at one.');
   const opening=signedPaise(page.openingMinor,'Opening balance'),closing=signedPaise(page.closingMinor,'Closing balance');
   check(previous===null||opening===previous,'STATEMENT_DOES_NOT_TIE',`Statement page ${page.page} opening differs from the preceding closing balance.`);
   let credits=0n,debits=0n;
   for(const line of page.lines){words(line.id,'line id',80);check(!ids.has(line.id),'TAX_INPUT_INVALID','Each statement line needs a unique source id.');ids.add(line.id);const date=isoDate(line.date,'Entry date'),description=words(line.description,'description');const credit=paise(line.creditMinor,'Credit'),debit=paise(line.debitMinor,'Debit');
    check((credit>0n)!==(debit>0n),'TAX_INPUT_INVALID','A bank movement has one positive credit or debit, not both.');credits+=credit;debits+=debit;
    const value=credit||debit;builder.step(`entry-${working.vouchers.length+1}`,'Document movement',value);
    working.vouchers.push({id:line.id,source:`${input.source}:page-${page.page}:${line.id}`,date,description,direction:credit>0n?'in':'out',amountMinor:String(value),state:'draft',ownerApprovalRequired:true});
   }
   check(opening+credits-debits===closing,'STATEMENT_DOES_NOT_TIE',`Statement page ${page.page} does not tie: opening plus credits minus debits must equal closing.`);
   working.pages.push({page:page.page,openingMinor:String(opening),creditsMinor:String(credits),debitsMinor:String(debits),closingMinor:String(closing),ties:true});previous=closing;
  }
 }else{
  check(input.kind==='purchase-bill'||input.kind==='sales-invoice','TAX_INPUT_INVALID','Choose a bank statement, purchase bill or sales invoice.');
  const number=words(input.number,'invoice number',80),party=words(input.party,'party'),date=isoDate(input.date,'Document date');const net=paise(input.netMinor,'Net amount'),tax=paise(input.taxMinor,'Tax amount'),total=paise(input.totalMinor,'Total');
  check(net+tax===total,'DOCUMENT_TOTAL_DOES_NOT_TIE','Document net amount plus tax must equal its total.');
  builder.step('net','Source net amount',net);builder.step('tax','Source tax amount, not a tax calculation',tax);builder.step('total','Source total',total);
  working.vouchers.push({id:number,source:input.source,date,description:party,direction:input.kind==='purchase-bill'?'out':'in',amountMinor:String(total),state:'draft',ownerApprovalRequired:true});
 }
 return builder.build(input,working,'Source totals tie by code. Review each voucher before approving it for the books. Masked identifiers remain exactly as supplied.');
}
