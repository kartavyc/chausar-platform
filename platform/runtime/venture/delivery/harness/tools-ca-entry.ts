import {wholeCount} from '../../playbooks/kit/count.ts';
// CA10 original source-cell adapter. No model-authored amounts or reconstructed identifiers.
import {check} from '../../../contracts.ts';
import {documentEntries,type DocumentEntryInput} from '../../playbooks/ca-firm/doc-entry.ts';
import {amountTable,columnOf,cellOf,moneyCell,newLog,noteSource,requireRupees} from '../../playbooks/ca-firm/tool-inputs.ts';
import {parseDateCell} from './cells.ts';
import {text,type Spec} from './tools.ts';
const columns=['page','account','opening','closing','date','description','credit','debit','number','party','net','tax','total'];
export const DOC_ENTRY:Spec={name:'docs.entry',effect:'compute',tier:'code',endsTurn:false,summary:'Prepare source-bound voucher drafts. Bank templates repeat page opening and closing on each movement; bills use one selected source row. Owner approval is still required.',input:{kind:{type:'enum',required:true,values:['bank-statement','purchase-bill','sales-invoice'],about:'Document template.'},table:text('Source file table.',20),row:text('For a bill or invoice, the source row.',20,false),columns:{type:'object',required:true,about:'Map template fields to exact source headers.',fields:Object.fromEntries(columns.map(key=>[key,text(`Source column for ${key}.`,80,false)]))}},async run(env,input){
 requireRupees(env);const table=amountTable(env,input.table),log=newLog();noteSource(log,table);
 const need=input.kind==='bank-statement'?['page','account','opening','closing','date','description','credit','debit']:['number','date','party','net','tax','total'];
 const mapped=Object.fromEntries(need.map(key=>[key,columnOf(table,input.table,input.columns[key],key)]));
 check(Object.keys(input.columns).every(key=>need.includes(key)),'TOOL_FAILED','Map only the fields used by this document template.');
 const cell=(row:typeof table.rows[number],key:string)=>cellOf(row,mapped[key]);
 const money=(row:typeof table.rows[number],key:string,blankZero=false)=>{const amount=moneyCell(env,input.table,row.id,mapped[key],cell(row,key));check(amount!==null||blankZero,'TOOL_FAILED',`Source ${key} is empty in ${row.id}.`);return String(amount??0n);};
 const date=(row:typeof table.rows[number])=>{const value=parseDateCell(cell(row,'date'),env.dateOrder);check(value,'TOOL_FAILED',`Read a valid source date in ${row.id}.`);return value;};
 let request:DocumentEntryInput;
 if(input.kind==='bank-statement'){
  check(input.row===undefined&&table.rows.length>0,'TOOL_FAILED','A bank statement reads all its rows.');const pages:Extract<DocumentEntryInput,{kind:'bank-statement'}>['pages']=[];const account=cell(table.rows[0],'account');
  for(const row of table.rows){check(cell(row,'account')===account,'TOOL_FAILED','One statement must use the same account identifier.');const raw=cell(row,'page');check(/^[1-9]\d{0,3}$/.test(raw),'TOOL_FAILED','Each source row needs its page number.');const number=wholeCount(raw),openingMinor=money(row,'opening'),closingMinor=money(row,'closing');let page=pages.at(-1);
   if(page?.page!==number){page={page:number,openingMinor,closingMinor,lines:[]};pages.push(page);}else check(page.openingMinor===openingMinor&&page.closingMinor===closingMinor,'STATEMENT_DOES_NOT_TIE',`Statement page ${number} repeats conflicting balances.`);
   page.lines.push({id:row.id,date:date(row),description:cell(row,'description'),creditMinor:money(row,'credit',true),debitMinor:money(row,'debit',true)});log.rowIds.push(row.id);
  }request={kind:'bank-statement',source:table.id,account,pages};
 }else{
  const row=table.rows.find(row=>row.id===input.row);check(row,'TOOL_FAILED','Choose the invoice or bill source row.');log.rowIds.push(row.id);
  request={kind:input.kind,source:`${table.id}:${row.id}`,number:cell(row,'number'),party:cell(row,'party'),date:date(row),netMinor:money(row,'net'),taxMinor:money(row,'tax'),totalMinor:money(row,'total')};
 }
 log.columns=mapped;const receipt=documentEntries(request);const {caAnswer}=await import('./tools-ca.ts');
 return caAnswer(env,receipt,request,log,{vouchers:receipt.working.vouchers,pages:receipt.working.pages,account:receipt.working.account});
}};
