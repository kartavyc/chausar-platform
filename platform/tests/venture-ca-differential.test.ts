// Synthetic fixtures exercise comparison mechanics. They are not department-calculator captures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runDifferential} from '../runtime/venture/playbooks/ca-firm/differential.ts';
import {computeIncomeTax,type IncomeTaxInput} from '../runtime/venture/playbooks/ca-firm/income-tax.ts';
import {receiptFigure} from '../runtime/venture/playbooks/ca-firm/receipt.ts';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
const inputs:IncomeTaxInput={assessmentYear:'2027-28',regime:'new',residency:'resident',ageBand:'below-60',otherSlabIncomeMinor:'150000000'};
const value=receiptFigure(computeIncomeTax(inputs),'tax-liability-rounded').minor;
const fixture={name:'synthetic-comparison',inputs,outputs:{'tax-liability-rounded':value},capturedBy:'Synthetic test, not a CA capture'};
test('differential comparison requires all requested keys and refuses a new difference',()=>{
 assert.equal(runDifferential([fixture],[]).passed,true);
 assert.throws(()=>runDifferential([{...fixture,outputs:{'tax-liability-rounded':String(BigInt(value)+100n)}}],[]),{code:'CA_DIFFERENTIAL_CHANGED'});
 assert.throws(()=>runDifferential([{...fixture,outputs:{}}],[]),{code:'TAX_INPUT_INVALID'});
 assert.throws(()=>runDifferential([{...fixture,outputs:{madeUp:'0','tax-liability-rounded':value}}],[]),{code:'TAX_INPUT_INVALID'});
});
test('accepted differences bind exact values and require a quoted rule and official source',()=>{
 const changed={...fixture,outputs:{'tax-liability-rounded':String(BigInt(value)+100n)}};
 const known={name:fixture.name,key:'tax-liability-rounded',oursMinor:value,departmentMinor:changed.outputs['tax-liability-rounded'],quote:'Synthetic rounding example only.',source:'https://incometax.gov.in/'};
 assert.equal(runDifferential([changed],[known]).cases[0].differences[0].accepted,true);
 assert.throws(()=>runDifferential([changed],[{...known,quote:''}]),{code:'TAX_INPUT_INVALID'});
 assert.throws(()=>runDifferential([changed],[{...known,departmentMinor:'0'}]),{code:'CA_DIFFERENTIAL_CHANGED'});
});
test('public differential capture requires the CA of record and persists who captured the exact values',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T10:00:00Z')},{idea:'CA firm for small shops in Pune'});
 await assert.rejects(env.call('venture.ca.differential.add',{...fixture,capturedBy:'Asha Rao'}),{code:'CA_OF_RECORD_REQUIRED'});
 await env.call('venture.ca.setOfRecord',{name:'Asha Rao',membershipNo:'123456'});
 await assert.rejects(env.call('venture.ca.differential.add',{...fixture,capturedBy:'Other CA'}),{code:'CA_NOT_OF_RECORD'});
 const saved=await env.call('venture.ca.differential.add',{...fixture,capturedBy:'Asha Rao'});
 assert.equal(saved.capturedBy,'Asha Rao');assert.equal(saved.membershipNumber,'123456');assert.deepEqual(saved.outputs,fixture.outputs);
});
