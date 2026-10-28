// CA9 original comparison rules, opentax-engine AGPL ideas only. Browser and engine share exact validation.
import {ChausarError,check} from '../../../portable.ts';
import {computeIncomeTax,type IncomeTaxInput} from './income-tax.ts';
export type DifferentialCase={name:string;inputs:IncomeTaxInput;outputs:Record<string,string>;capturedBy:string};
export type KnownDifference={name:string;key:string;oursMinor:string;departmentMinor:string;quote:string;source:string};
export function checkedCase(value:DifferentialCase){
 check(value&&typeof value==='object'&&typeof value.name==='string'&&value.name.trim().length>0&&typeof value.capturedBy==='string'&&value.capturedBy.trim().length>0,'TAX_INPUT_INVALID','Name the captured case and who captured it.');
 const receipt=computeIncomeTax(value.inputs);
 check(value.outputs&&typeof value.outputs==='object'&&!Array.isArray(value.outputs)&&Object.hasOwn(value.outputs,'tax-liability-rounded'),'TAX_INPUT_INVALID','Capture the department total tax liability in paise.');
 for(const [key,amount]of Object.entries(value.outputs))check(receipt.figures.some(row=>row.key===key)&&typeof amount==='string'&&/^-?\d{1,15}$/.test(amount),'TAX_INPUT_INVALID','Capture only known calculator figure keys and whole paise.');
 return receipt;
}
/** New value differences fail; an accepted difference binds both exact values, a rule quote and official source. */
export function runDifferential(cases:readonly DifferentialCase[],known:readonly KnownDifference[]){
 check(cases.length>0&&new Set(cases.map(row=>row.name)).size===cases.length,'TAX_INPUT_INVALID','Give a nonempty list of uniquely named captures.');
 for(const row of known){let official=false;try{const url=new URL(row.source);official=url.protocol==='https:'&&(url.hostname==='incometax.gov.in'||url.hostname.endsWith('.incometax.gov.in')||url.hostname==='incometaxindia.gov.in'||url.hostname.endsWith('.incometaxindia.gov.in'));}catch{}
  check(row.quote.trim().length>0&&official,'TAX_INPUT_INVALID','An accepted difference needs the quoted rule and its official source.');
 }
 const results=cases.map(item=>{const receipt=checkedCase(item);const differences=Object.entries(item.outputs).flatMap(([key,departmentMinor])=>{const oursMinor=receipt.figures.find(row=>row.key===key)!.minor;if(oursMinor===departmentMinor)return [];const accepted=known.find(row=>row.name===item.name&&row.key===key&&row.oursMinor===oursMinor&&row.departmentMinor===departmentMinor);if(!accepted)throw new ChausarError('CA_DIFFERENTIAL_CHANGED',`New calculator difference in ${item.name}, ${key}. The CA must check the rule and captured output.`);return [{key,oursMinor,departmentMinor,accepted:true,quote:accepted.quote,source:accepted.source}];});return {name:item.name,receiptId:receipt.id,differences};});
 return {passed:true,cases:results};
}
