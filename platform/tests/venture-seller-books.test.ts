// Seller books reuse the reviewed settlement engine, original Chausar regression.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sellerBooks} from '../runtime/venture/playbooks/bookkeeping-cfo/seller-books.ts';
import {computeSettlements} from '../runtime/venture/playbooks/online-seller/model.ts';
import {financeCycle} from '../runtime/venture/playbooks/bookkeeping-cfo/cycles.ts';
const cycle=financeCycle({businessId:'b',clientId:'c',companyId:'books',system:'zoho',from:'2026-04-01',to:'2027-03-31'});
const settlements=[{orderId:'one',expectedMinor:'10000',paidMinor:'9900',source:'settlement.csv:2',observedAt:'2026-10-28T10:00:00Z',adjustments:[{kind:'fee-slab' as const,minor:'100',source:'fee-card:3'}],holdReasons:[]}];
const input=()=>({cycle,month:'2026-10',orders:[{orderId:'one',on:'2026-10-27',source:'orders.csv:2'}],settlements,credits:[{kind:'gst' as const,expectedMinor:'1800',creditedMinor:'1800',section:'owner CA rule',source:'gst-ledger:2'},{kind:'tcs' as const,expectedMinor:'50',creditedMinor:'40',section:'owner CA rule',source:'tax-ledger:2'},{kind:'tds' as const,expectedMinor:'10',creditedMinor:'0',section:'owner CA rule',source:'tax-ledger:3'}]});
test('seller books reuse settlement differences and keep tax credits separate from payout claims',()=>{
 const result=sellerBooks(input());assert.deepEqual(result.settlement,computeSettlements(settlements));
 assert.deepEqual(result.credits.map(row=>row.differenceMinor),['0','10','10']);assert.equal(result.creditDifferenceMinor,'20');
 assert.equal(result.requiresCaConfirmation,true);assert.equal(result.posted,false);assert.equal(result.credits[1]!.state,'reconcile');assert.match(result.receiptId,/^seller_books_/);
});
test('monthly books refuse cross-cycle, cross-month and unmatched order sources before totals',()=>{
 assert.throws(()=>sellerBooks({...input(),month:'2025-10'}),{code:'BOOKS_CYCLE_INVALID'});
 assert.throws(()=>sellerBooks({...input(),orders:[{...input().orders[0]!,on:'2026-09-30'}]}),{code:'BOOKS_CYCLE_INVALID'});
 assert.throws(()=>sellerBooks({...input(),settlements:[{...settlements[0]!,orderId:'other'}]}),{code:'BOOKS_SETTLEMENT_MISMATCH'});
 assert.throws(()=>sellerBooks({...input(),credits:[input().credits[0]!,input().credits[0]!]}),{code:'BOOKS_SETUP_INVALID'});
});
