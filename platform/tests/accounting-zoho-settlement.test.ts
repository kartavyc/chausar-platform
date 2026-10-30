import test from 'node:test';
import assert from 'node:assert/strict';
import {createZohoSettlementAdapter} from '../runtime/adapters/accounting/zoho-settlement.ts';
import {config,resolve,row,provider} from './fixtures/venture/zoho-settlement.ts';
test('settlement adapter prepares exact net payment and records no invented fee, tax or email',async()=>{
 const p=provider(),adapter=createZohoSettlementAdapter(config,{resolve,send:p.send}),prepared=await adapter.preparePayment(row,'77');assert.equal(p.calls.some(call=>call.method==='POST'),false);assert.match(prepared.body,/"amount":99\.00/);assert.deepEqual(JSON.parse(prepared.body).contact_persons,[]);assert.equal(JSON.parse(prepared.body).bank_charges,0);assert.equal(JSON.parse(prepared.body).invoices[0].tax_amount_withheld,0);assert.equal(JSON.stringify(prepared).includes(config.accessToken),false);
 let claims=0;await adapter.sendPayment(prepared,()=>claims++);assert.equal(claims,1);assert.equal(p.calls.filter(call=>call.method==='POST').length,1);const read=await adapter.readPayment(row.externalId);assert.equal(read?.id,'333');assert.equal(read?.materialDigest,prepared.materialDigest);
 await assert.rejects(adapter.preparePayment(row,'77'),{code:'BOOKS_ALREADY_SENT'});
});
test('settlement refuses changed balance, wrong customer, inactive or foreign account before sending',async()=>{
 for(const change of [(p:ReturnType<typeof provider>)=>{p.invoice.customer_id='78';},(p:ReturnType<typeof provider>)=>{p.invoice.balance=98;},(p:ReturnType<typeof provider>)=>{p.account.currency_code='USD';},(p:ReturnType<typeof provider>)=>{p.account.is_active=false;},(p:ReturnType<typeof provider>)=>{p.invoice.status='draft';}]){const p=provider();change(p);await assert.rejects(createZohoSettlementAdapter(config,{resolve,send:p.send}).preparePayment(row,'77'));assert.equal(p.calls.some(call=>call.method==='POST'),false);}
 const p=provider(),adapter=createZohoSettlementAdapter(config,{resolve,send:p.send}),prepared=await adapter.preparePayment(row,'77');p.invoice.balance=99;await assert.rejects(adapter.sendPayment(prepared,()=>assert.fail('not approved')),{code:'APPROVAL_STALE'});assert.equal(p.calls.some(call=>call.method==='POST'),false);
});
test('payment readback binds account, recipient, applied invoice and exact amounts',async()=>{
 const p=provider(),adapter=createZohoSettlementAdapter(config,{resolve,send:p.send}),prepared=await adapter.preparePayment(row,'77');await adapter.sendPayment(prepared,()=>{});
 for(const change of [(value:any)=>{value.customer_id='78';},(value:any)=>{value.account_id='101';},(value:any)=>{value.invoices[0].invoice_id='999';},(value:any)=>{value.invoices[0].amount_applied=98;}]){const before=structuredClone(p.payment);change(p.payment);assert.notEqual((await adapter.readPayment(row.externalId))?.materialDigest,prepared.materialDigest);p.payment=before;}
});
