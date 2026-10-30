// CA4/6/10/12 original owner forms. Shared with the fake, without model parsing or document readers.
import {check} from '../../../portable.ts';
import {decimalMinor} from '../../../currency.ts';
import {csvRows} from '../../../csv.ts';
import type {WhatIfInput} from './what-if.ts';import type {DocumentEntryInput,BankEntryPage} from './doc-entry-types.ts';import type {HealthInput,HealthLine} from './health-check.ts';import type {TdsPayment} from './tds.ts';
import {packFacts,type PackFacts} from './pack-core.ts';
export const CA_TEMPLATES={
 'bank-statement':'page,openingRupees,closingRupees,id,date,description,creditRupees,debitRupees\n',
 'purchase-bill':'number,date,party,netRupees,taxRupees,totalRupees\n',
 'sales-invoice':'number,date,party,netRupees,taxRupees,totalRupees\n',
 health:'id,source,transactionId,date,payee,direction,amountRupees,cash,purchase,gstCharged,gstin,eventId,section,payeeKind,pan,deductedRupees\n',
 prior:'id,payee,date,amountRupees,section,payeeKind,pan\n',
 'return-pack':'key,amountRupees,source\n',
} as const;
const valid=(condition:unknown)=>check(condition,'CA_OWNER_INPUT_INVALID','Use the complete source template and fill every required field.');
function text(value:unknown){valid(typeof value==='string'&&value.length<=1000000);return value as string;}
function money(value:unknown){return decimalMinor(text(value),'INR');}
function rows(value:unknown,template:keyof typeof CA_TEMPLATES){let rows:string[][];try{rows=csvRows(text(value));}catch{valid(false);throw new Error('unreachable');}const headers=CA_TEMPLATES[template].trim().split(',');valid(rows.length>=2&&rows.length<=10001&&rows[0]?.join(',')===headers.join(','));return rows.slice(1).map(row=>{valid(row.length===headers.length);return Object.fromEntries(headers.map((key,i)=>[key,row[i]!])) as Record<string,string>;});}
function bool(value:unknown){valid(value==='true'||value==='false');return value==='true';}
/** Parse an owner-selected template. Every amount is converted here, outside the UI. */
export function ownerWorking(mode:string,p:Record<string,unknown>):WhatIfInput|DocumentEntryInput|HealthInput{
 valid(Object.keys(p).every(k=>['ownerForm',...(mode==='what-if'?['scenario','assessmentYear','regime','residency','ageBand','salaryRupees','otherRupees','targetRupees']:mode==='document'?['template','source','account','csv']:['quarter','financialYear','thresholdRupees','csv','priorCsv','tdsHistoryComplete','source'])].includes(k)));
 if(mode==='what-if')return {mode:text(p.scenario) as WhatIfInput['mode'],base:{assessmentYear:text(p.assessmentYear) as '2026-27'|'2027-28',regime:text(p.regime) as 'old'|'new',residency:text(p.residency) as 'resident'|'non-resident',ageBand:text(p.ageBand) as 'below-60'|'60-79'|'80-plus',salaryMinor:money(p.salaryRupees),otherSlabIncomeMinor:money(p.otherRupees)},...(p.scenario==='inverse'?{targetMinor:money(p.targetRupees)}:{})} as WhatIfInput;
 if(mode==='document'){
  valid(['bank-statement','purchase-bill','sales-invoice'].includes(String(p.template)));const kind=p.template as DocumentEntryInput['kind'],source=text(p.source);valid(source.trim().length>=3);const records=rows(p.csv,kind);
  if(kind==='bank-statement'){const pages=new Map<number,BankEntryPage>();for(const row of records){valid(/^\d+$/.test(row.page!)&&Number(row.page)>0);const page=Number(row.page),openingMinor=money(row.openingRupees),closingMinor=money(row.closingRupees);const previous=pages.get(page);valid(!previous||previous.openingMinor===openingMinor&&previous.closingMinor===closingMinor);const current=previous??{page,openingMinor,closingMinor,lines:[]};current.lines.push({id:row.id!,date:row.date!,description:row.description!,creditMinor:money(row.creditRupees),debitMinor:money(row.debitRupees)});pages.set(page,current);}return {kind,source,account:text(p.account),pages:[...pages.values()]};}
  valid(records.length===1);const row=records[0]!;return {kind,source,number:row.number!,date:row.date!,party:row.party!,netMinor:money(row.netRupees),taxMinor:money(row.taxRupees),totalMinor:money(row.totalRupees)};
 }
 valid(mode==='health');const lines:HealthLine[]=rows(p.csv,'health').map(row=>{valid((row.section===''&&row.payeeKind===''&&row.pan===''&&row.deductedRupees==='')||(row.section!==''&&row.payeeKind!==''&&row.deductedRupees!==''));return {id:row.id!,source:row.source as HealthLine['source'],transactionId:row.transactionId!,date:row.date!,payee:row.payee!,direction:row.direction as HealthLine['direction'],amountMinor:money(row.amountRupees),cash:bool(row.cash),purchase:bool(row.purchase),gstCharged:bool(row.gstCharged),gstin:row.gstin||null,eventId:row.eventId||null,tds:row.section?{section:row.section as TdsPayment['section'],payeeKind:row.payeeKind as TdsPayment['payeeKind'],pan:row.pan||null,deductedMinor:money(row.deductedRupees)}:null};});
 const priorPayments:TdsPayment[]=p.priorCsv?rows(p.priorCsv,'prior').map(row=>({id:row.id!,payee:row.payee!,date:row.date!,amountMinor:money(row.amountRupees),section:row.section as TdsPayment['section'],payeeKind:row.payeeKind as TdsPayment['payeeKind'],pan:row.pan||null})):[];
 return {quarter:text(p.quarter),financialYear:text(p.financialYear) as HealthInput['financialYear'],purchaseThresholdMinor:money(p.thresholdRupees),lines,priorPayments,tdsHistoryComplete:p.tdsHistoryComplete===true};
}
/** Return-pack source rows stay typed by the owner. No identity file is read. */
export function ownerPack(p:Record<string,unknown>):PackFacts{valid(Object.keys(p).every(k=>['clientId','assessmentYear','pan','aadhaar','csv'].includes(k)));return packFacts({clientId:p.clientId,assessmentYear:p.assessmentYear,pan:p.pan,aadhaar:p.aadhaar,figures:rows(p.csv,'return-pack').map(row=>({key:row.key,amountMinor:money(row.amountRupees),source:row.source}))});}
