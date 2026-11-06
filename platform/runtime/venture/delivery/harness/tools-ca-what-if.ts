import {wholeCount} from '../../playbooks/kit/count.ts';
// CA4 original adapter. It varies a verified calculator working, never accepts model-authored money.
import {check} from '../../../contracts.ts';
import {whatIf,type WhatIfInput} from '../../playbooks/ca-firm/what-if.ts';
import {rederiveCaReceipt} from '../../playbooks/ca-firm/stored-receipt.ts';
import {newLog,noteSource,requireRupees,sumPicks} from '../../playbooks/ca-firm/tool-inputs.ts';
import {text,type Spec} from './tools.ts';
export const WHAT_IF:Spec={name:'tax.whatIf',effect:'compute',tier:'code',endsTurn:false,summary:'Compare regimes, inspect the rebate boundary or find extra income within a tax ceiling, using a verified income-tax receipt.',input:{mode:{type:'enum',required:true,values:['compare-regimes','cliff','inverse'],about:'Which scenario to compute.'},base:text('Income-tax work receipt such as w1.',12),target:{type:'list',required:false,max:10,about:'For inverse only: the client tax ceiling from source cells.',item:{type:'object',required:true,about:'Client source amount.',fields:{table:text('Source table.',20),row:text('Source row.',20),column:text('Source column.',80)}}}},async run(env,input){
 const {caAnswer,noRetry}=await import('./tools-ca.ts');
 return noRetry(async()=>{
  requireRupees(env);const match=/^w([1-9]\d*)$/.exec(input.base),base=match?env.receipts[wholeCount(match[1])-1]:null;
  check(base?.ca?.engine==='income-tax'&&base.ventureId===env.ventureId&&JSON.stringify(base.runRef)===JSON.stringify(env.runRef),'TOOL_FAILED','Choose an income-tax receipt from this run.');
  check(rederiveCaReceipt(base).rederived==='same','TOOL_FAILED','The base working changed. Work the income tax again first.');
  const log=newLog();noteSource(log,{id:base.id,name:input.base,digest:base.digest});
  let request:WhatIfInput;
  if(input.mode==='inverse'){
   check(Array.isArray(input.target)&&input.target.length>0,'NEEDS_FACTS','Add the client tax ceiling to a source file before this scenario.');
   const targetMinor=await sumPicks(env,input.target,'Tax ceiling',log);
   check(targetMinor!==undefined,'NEEDS_FACTS','The client tax ceiling is needed.');
   request={mode:'inverse',base:base.ca.inputs as unknown as WhatIfInput['base'],targetMinor};
  }else{
   check(input.target===undefined,'TOOL_FAILED','A tax ceiling belongs only to the inverse scenario.');
   request={mode:input.mode,base:base.ca.inputs as unknown as WhatIfInput['base']};
  }
  const receipt=whatIf(request,env.rateUse??{mode:'client',confirmations:[]});
  return caAnswer(env,receipt,request,log,{scenario:{mode:receipt.working.mode,varied:receipt.working.varied,receipts:receipt.working.receipts.map(row=>({id:row.id,engine:row.engine}))}});
 });
}};
