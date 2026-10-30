import test from 'node:test';
import assert from 'node:assert/strict';
import {settlementPayments,SETTLEMENT_PAYMENT_COLUMNS,settlementPaymentSource} from '../runtime/venture/playbooks/bookkeeping-cfo/settlement-payments.ts';
import {financeCycle} from '../runtime/venture/playbooks/bookkeeping-cfo/cycles.ts';
import {sellerBooksSource} from '../runtime/venture/playbooks/bookkeeping-cfo/seller-books-source.ts';
const cycle=financeCycle({businessId:'business',clientId:'client',system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'});
const report=sellerBooksSource('kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Orders,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlement export,100,99,\nfee-slab,one,,Fee source,1,,',cycle,'2026-10');
const row={shopId:'shop',settlementId:'payout',orderId:'one',paidAt:'2026-10-28T20:00:00Z',timeZone:'Asia/Kolkata',paymentMode:'banktransfer' as const,accountId:'100',paidMinor:'9900',source:'Settlement export row 1'};
test('settlement payment binds code-reconciled monthly paid amounts and stable source identities',()=>{
 const batch=settlementPayments(cycle,report,[row]);assert.equal(batch.rows[0]!.postingDate,'2026-10-29');assert.equal(batch.rows[0]!.amountMinor,'9900');assert.equal(batch.totalMinor,'9900');assert.match(batch.rows[0]!.externalId,/^chausar-settlement-[a-f0-9]{32}$/);assert.match(batch.rows[0]!.invoiceReference,/^chausar-[a-f0-9]{32}$/);assert.equal(batch.rows[0]!.unappliedDifferenceMinor,'100');
 assert.equal(settlementPayments(cycle,report,[{...row,source:'Same payout re-exported'}]).rows[0]!.externalId,batch.rows[0]!.externalId);
 assert.notEqual(settlementPayments(cycle,report,[{...row,settlementId:'second-payout'}]).rows[0]!.externalId,batch.rows[0]!.externalId);
});
test('payment preparation refuses invented amount, duplicate or omitted order, bad dates and mixed cycles',()=>{
 for(const rows of [[{...row,paidMinor:'10000'}],[row,row],[],[{...row,orderId:'other'}],[{...row,paidAt:'2026-11-01T00:00:00Z'}],[{...row,paidAt:'2026-02-30T00:00:00Z'}]])assert.throws(()=>settlementPayments(cycle,report,rows),error=>!!error&&typeof error==='object'&&'code'in error);
 assert.throws(()=>settlementPayments({...cycle,companyId:'other'},report,[row]));
 assert.throws(()=>settlementPayments(cycle,{...report,cycleId:'other'},[row]));
});
test('settlement payment source requires exact headers and rupee strings, no arithmetic in UI',()=>{
 const csv=SETTLEMENT_PAYMENT_COLUMNS.join(',')+'\nshop,payout,one,2026-10-28T20:00:00Z,Asia/Kolkata,banktransfer,100,99.01,Settlement export';
 const rows=settlementPaymentSource(csv);assert.equal(rows[0]!.paidMinor,'9901');assert.throws(()=>settlementPaymentSource(csv.replace('99.01','9.901')));assert.throws(()=>settlementPaymentSource(csv.replace('banktransfer','automatically')));
});
