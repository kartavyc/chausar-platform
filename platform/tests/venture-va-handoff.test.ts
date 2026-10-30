import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
test('the actual VA desk refuses payment fields and calculates an exact manual purchase without retaining credentials',async()=>{
 const e=await kitBusiness(undefined,{idea:'A virtual assistant service'}),order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers[0]!.id,request:'Research venues',intake:{fields:{scope:'Research venues',deliverable:'A table',deadline:'2026-11-02',hoursBand:'Agreed monthly band'}}});
 const before=JSON.stringify(e.store.read());
 for(const field of ['card','upi','bank'])await assert.rejects(e.call('venture.desk.act',{playbook:'virtual-assistant',kind:'payment',id:order.id,action:'fill',payload:{field,value:'private-payment-placeholder'}}),{code:'PAYMENT_FIELD_REFUSED',message:'Chausar never types payment details. Pay it yourself.'});
 assert.equal(JSON.stringify(e.store.read()),before);
 const answer=await e.call('venture.desk.act',{playbook:'virtual-assistant',kind:'purchase',id:order.id,action:'preview',payload:{item:'Two blue notebooks',quantity:'2',unitMinor:'15000',currency:'INR'}});
 assert.equal(answer.result.totalMinor,'30000');assert.equal(answer.result.purchased,false);assert.equal(answer.result.receipt.result,'30000');assert.match(answer.result.receiptId,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(e.store.read()),before);
 await assert.rejects(e.call('venture.desk.act',{playbook:'virtual-assistant',kind:'purchase',id:order.id,action:'buy',payload:{item:'Two blue notebooks',quantity:'2',unitMinor:'15000',currency:'INR'}}),{code:'PAYMENT_FIELD_REFUSED'});
 await assert.rejects(e.call('venture.desk.act',{playbook:'virtual-assistant',kind:'purchase',id:order.id,action:'preview',payload:{item:'Notebook',quantity:'1',unitMinor:'1',currency:'INR',card:'private-payment-placeholder'}}),{code:'INVALID_VENTURE_REQUEST'});
});
