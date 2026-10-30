// CA4. Original Chausar code; compare, cliff and inverse ideas from opentax-engine (AGPL, no code copied).
// Every scenario reuses the dated India calculator. Only the selected income changes in an inverse search.
import {ChausarError} from '../../../portable.ts';
import {computeIncomeTax,incomeTaxTable,type IncomeTaxInput} from './income-tax.ts';
import {paise} from './money.ts';
import {ReceiptBuilder,receiptFigure,type CaReceipt} from './receipt.ts';
import {useRateTable,type RateUse} from './rates.ts';

export type WhatIfInput={base:IncomeTaxInput}&({mode:'compare-regimes'|'cliff'}|{mode:'inverse';targetMinor:string});
export type WhatIfWorking={mode:WhatIfInput['mode'];receipts:CaReceipt[];varied:'regime'|'taxable-income'|'other-slab-income'};
const tax=(r:CaReceipt)=>BigInt(receiptFigure(r,'tax-liability-rounded').minor);
const limit=999999999999999n;

/** Compare regimes, inspect the table rebate boundary, or search extra slab income to a tax ceiling in paise. */
export function whatIf(input:WhatIfInput,use:RateUse):CaReceipt<WhatIfWorking>{
 const base=computeIncomeTax(input.base,use),table=incomeTaxTable(input.base.assessmentYear),builder=new ReceiptBuilder('what-if');
 builder.useTable(table,useRateTable(table,use));
 const receipts:CaReceipt[]=[];
 const keep=(r:CaReceipt)=>{receipts.push(r);for(const line of r.assumptions)builder.assume(`Assumed: ${line}`);return r;};
 let varied:WhatIfWorking['varied'];
 if(input.mode==='compare-regimes'){
  varied='regime';
  const old=keep(computeIncomeTax({...input.base,regime:'old'},use)),fresh=keep(computeIncomeTax({...input.base,regime:'new'},use));
  builder.step('old-tax','Tax under the old regime',tax(old));builder.step('new-tax','Tax under the new regime',tax(fresh));builder.step('difference','Old regime tax minus new regime tax',tax(old)-tax(fresh));
  builder.assume('Assumed: income and claimed deductions are held unchanged; each regime applies its own deduction rules. This comparison is not permission to switch regimes.');
 }else if(input.mode==='cliff'){
  if(input.base.residency!=='resident')throw new ChausarError('NOT_MODELLED','The resident rebate boundary does not apply to a non-resident.');
  varied='taxable-income';const boundary=BigInt(table.payload.regimes[input.base.regime].rebate.incomeLimitMinor),next=boundary+1000n;
  const scenario=(income:bigint)=>computeIncomeTax({assessmentYear:input.base.assessmentYear,regime:input.base.regime,residency:input.base.residency,ageBand:input.base.ageBand,otherSlabIncomeMinor:String(income)},use);
  const at=keep(scenario(boundary)),after=keep(scenario(next));
  builder.step('rebate-limit','Taxable income at the rebate limit',boundary);builder.step('next-taxable-income','Next ten-rupee taxable income step',next);
  builder.step('tax-at-limit','Tax at the rebate limit',tax(at));builder.step('tax-after-limit','Tax at the next taxable income step',tax(after));
  builder.step('marginal-relief','Rebate marginal relief at the next step',BigInt(receiptFigure(after,'rebate-87a').minor));
  builder.assume('Assumed: this boundary example uses only other slab income, with no deductions or prepaid tax. It shows taxable income, not the client gross salary.');
 }else if(input.mode==='inverse'){
  varied='other-slab-income';const target=paise(input.targetMinor,'Tax target');
  if(tax(base)>target)throw new ChausarError('NOT_MODELLED','The current tax already exceeds this target. Extra income cannot meet it.');
  const current=paise(input.base.otherSlabIncomeMinor??'0','Other slab income');
  const probe=(extra:bigint)=>computeIncomeTax({...input.base,otherSlabIncomeMinor:String(current+extra)},use);
  let low=0n,high=limit-current;
  if(tax(probe(high))<=target)throw new ChausarError('NOT_MODELLED','This target exceeds the encoded income search range. Ask the CA to work this case.');
  while(low+1n<high){const middle=(low+high)/2n;if(tax(probe(middle))<=target)low=middle;else high=middle;}
  const result=keep(probe(low));keep(probe(high));
  builder.step('target-tax','Tax ceiling',target);builder.step('extra-income','Maximum extra other slab income at this ceiling',low);builder.step('result-tax','Tax after that extra income',tax(result));
  builder.step('next-paisa-tax','Tax with one more paisa of income',tax(receipts[1]!));
  builder.assume('Assumed: only other slab income increases; all other client facts are held unchanged. The ceiling is inclusive and statutory rounding is applied.');
 }else throw new ChausarError('TAX_INPUT_INVALID','Choose a regime comparison, rebate boundary or tax ceiling.');
 for(const key of ['salaryMinor','professionalTaxMinor','otherSlabIncomeMinor','businessIncomeMinor','deductions','prepaid'] as const)if(input.base[key]===undefined)builder.assume(`Assumed: omitted ${key} is zero or empty, as in the base working.`);
 return builder.build(input,{mode:input.mode,receipts,varied},'Scenario figures are computed from the same dated tax tables. The CA checks applicability and assumptions.');
}
