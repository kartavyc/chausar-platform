// CA4 scenarios extend the existing India calculator, never model arithmetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {whatIf} from '../runtime/venture/playbooks/ca-firm/what-if.ts';
import {computeIncomeTax,type IncomeTaxInput} from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import {receiptFigure} from '../runtime/venture/playbooks/ca-firm/receipt.ts';
import {REHEARSAL} from '../runtime/venture/playbooks/ca-firm/rates.ts';
import {callTool,type ToolEnv} from '../runtime/venture/delivery/harness/tools.ts';
import {caWorkReceipt} from '../runtime/venture/delivery/harness/tools-ca.ts';
import {newLog} from '../runtime/venture/playbooks/ca-firm/tool-inputs.ts';
import {rederiveCaReceipt} from '../runtime/venture/playbooks/ca-firm/stored-receipt.ts';
const base:IncomeTaxInput={assessmentYear:'2027-28',regime:'new',residency:'resident',ageBand:'below-60',otherSlabIncomeMinor:'120000000'};
const amount=(receipt:ReturnType<typeof whatIf>,key:string)=>BigInt(receiptFigure(receipt,key).minor);

test('regime comparison retains both source receipts and a signed difference receipt',()=>{
 const result=whatIf({mode:'compare-regimes',base},REHEARSAL);
 const old=computeIncomeTax({...base,regime:'old'},REHEARSAL),fresh=computeIncomeTax(base,REHEARSAL);
 assert.equal(amount(result,'old-tax'),BigInt(receiptFigure(old,'tax-liability-rounded').minor));
 assert.equal(amount(result,'new-tax'),BigInt(receiptFigure(fresh,'tax-liability-rounded').minor));
 assert.equal(amount(result,'difference'),amount(result,'old-tax')-amount(result,'new-tax'));
 assert.deepEqual(result.working.receipts.map(r=>r.id),[old.id,fresh.id]);
 assert.ok(result.assumptions.every(line=>line.startsWith('Assumed:')));
 assert.ok(result.tables.length>0);assert.equal(result.id,whatIf({mode:'compare-regimes',base},REHEARSAL).id);
});
test('cliff is the table rebate limit with the next taxable rounding step and marginal relief shown',()=>{
 const result=whatIf({mode:'cliff',base},REHEARSAL);
 assert.equal(amount(result,'rebate-limit'),120000000n);
 assert.equal(amount(result,'next-taxable-income'),120001000n);
 assert.ok(amount(result,'marginal-relief')>0n);
 assert.equal(result.working.receipts.length,2);
 assert.ok(result.assumptions.some(line=>line.includes('other slab income')));
 assert.throws(()=>whatIf({mode:'cliff',base:{...base,residency:'non-resident'}},REHEARSAL),{code:'NOT_MODELLED'});
});
test('inverse finds the last paisa at or below the tax target and proves the next paisa exceeds it',()=>{
 const input={...base,otherSlabIncomeMinor:'100000000'},result=whatIf({mode:'inverse' as const,base:input,targetMinor:'0'},REHEARSAL);
 const extra=amount(result,'extra-income');assert.ok(extra>0n);
 const probe=(n:bigint)=>BigInt(receiptFigure(computeIncomeTax({...input,otherSlabIncomeMinor:String(100000000n+n)},REHEARSAL),'tax-liability-rounded').minor);
 assert.equal(probe(extra),0n);assert.ok(probe(extra+1n)>0n);
 assert.equal(amount(result,'result-tax'),probe(extra));
 assert.ok(result.assumptions.some(line=>line.includes('held unchanged')));
});
test('what-if preserves missing facts and unsupported-income refusals and never uses unconfirmed client rates',()=>{
 assert.throws(()=>whatIf({mode:'compare-regimes',base:{...base,residency:undefined} as unknown as IncomeTaxInput},REHEARSAL),{code:'NEEDS_FACTS'});
 assert.throws(()=>whatIf({mode:'compare-regimes',base:{...base,alsoHas:['capital-gains']}},REHEARSAL),{code:'NOT_MODELLED'});
 assert.throws(()=>whatIf({mode:'compare-regimes',base},{mode:'client',confirmations:[]}),{code:'RATE_UNCONFIRMED'});
 assert.throws(()=>whatIf({mode:'inverse',base:{...base,otherSlabIncomeMinor:'200000000'},targetMinor:'0'},REHEARSAL),{code:'NOT_MODELLED'});
});
test('tax.whatIf reads only a verified same-run base working and returns a rederivable receipt',async()=>{
 const env={deps:{services:{}},ventureId:'venture',memberId:'owner',epoch:1,currency:'INR',dateOrder:'day-month-year',runRef:{kind:'rehearsal',scenarioId:'regime-compare',episode:0},files:[],tables:[],receipts:[],dictionary:[],allowed:[],now:()=> '2026-10-28T10:00:00Z',rateUse:REHEARSAL} as unknown as ToolEnv;
 const source=caWorkReceipt(env,computeIncomeTax(base,REHEARSAL),base,newLog()).record;env.receipts.push(source);
 const run=(input:unknown)=>callTool(env,['tax.whatIf'],1,0,{tool:'tax.whatIf',input:JSON.stringify(input)});
 const good=await run({mode:'compare-regimes',base:'w1'});
 assert.equal(good.record.outcome,'succeeded',JSON.stringify(good.record.envelope));
 assert.equal(good.receipts?.length,1);assert.equal(rederiveCaReceipt(good.receipts![0]).rederived,'same');
 const missing=await run({mode:'compare-regimes',base:'w9'});assert.equal(missing.record.outcome,'failed');
 source.ca!.inputsDigest='changed';const changed=await run({mode:'compare-regimes',base:'w1'});assert.equal(changed.record.outcome,'failed');
});
