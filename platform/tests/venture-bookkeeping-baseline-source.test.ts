// Independent baseline review: canned reference prose is not evidence that finance source checks ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BOOKKEEPING_CFO_DEFINITION} from '../runtime/venture/playbooks/bookkeeping-cfo/definition.ts';
import {loadKitBaseline} from '../runtime/venture/playbooks/kit/baseline.ts';

test('finance baseline cannot pass its reference prose after source evidence is removed',()=>{
 const definition=BOOKKEEPING_CFO_DEFINITION;
 for(const item of loadKitBaseline(definition).cases){
  const without={...item,meta:{...item.meta}};delete without.meta.source;
  assert.equal(definition.baseline.score(without,item.draft,without.meta).pass,false,item.id+' needs source evidence');
 }
});
test('finance baseline cannot pass its reference prose with a corrupted source shape',()=>{
 const definition=BOOKKEEPING_CFO_DEFINITION;
 for(const item of loadKitBaseline(definition).cases){
  const corrupt={...item,meta:{...item.meta,source:JSON.stringify({unexpected:'corrupted source shape'})}};
  assert.equal(definition.baseline.score(corrupt,item.draft,corrupt.meta).pass,false,item.id+' must execute and validate its source');
 }
});
test('each finance baseline responds to a material change in its own source',()=>{
 const definition=BOOKKEEPING_CFO_DEFINITION,mutate:Record<string,(source:any)=>void>={
  'promise-broken-twice':s=>{s.payments=[{invoiceId:'a',amountMinor:'1000',receivedOn:'2026-10-09',cleared:true},{invoiceId:'b',amountMinor:'2000',receivedOn:'2026-10-19',cleared:true}];},
  'hire-memo-scenarios':s=>{s.base.revenueMinor='90000';},
  'positive-cash-no-runway':s=>{s.netCashMinor='-20000';},
  'subscription-rise':s=>{s.rows[2].amountMinor='10000';},
  'no-investment-advice':s=>{s.candidate='Review the recorded monthly spending.';},
 };
 for(const item of loadKitBaseline(definition).cases){
  assert.equal(definition.baseline.score(item,item.draft,item.meta??{}).pass,true,item.id+' positive source');
  const source=JSON.parse(item.meta!.source!);assert.ok(mutate[item.id],item.id+' mutation defined');mutate[item.id]!(source);
  const changed={...item,meta:{...item.meta,source:JSON.stringify(source)}};
  assert.equal(definition.baseline.score(changed,item.draft,changed.meta).pass,false,item.id+' changed source');
 }
});
