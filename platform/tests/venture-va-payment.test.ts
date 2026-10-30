import test from 'node:test';import assert from 'node:assert/strict';
import {paymentFieldAllowed,purchaseHandoff} from '../runtime/venture/playbooks/virtual-assistant/payment.ts';
test('payment fields are refused and purchases carry an exact owner-reviewed item and total',()=>{
 for(const kind of ['card','upi','bank'])assert.throws(()=>paymentFieldAllowed({kind,value:'not retained'}),{code:'PAYMENT_FIELD_REFUSED',message:'Chausar never types payment details. Pay it yourself.'});
 const handoff=purchaseHandoff({item:'One blue notebook',quantity:'2',unitMinor:'12500',currency:'INR'});
 assert.equal(handoff.totalMinor,'25000');assert.equal(handoff.purchased,false);assert.deepEqual(handoff.receipt,{operation:'multiply',inputs:['2','12500'],result:'25000',unit:'minor'});
 assert.throws(()=>purchaseHandoff({item:'Notebook',quantity:'2.5',unitMinor:'12500',currency:'INR'}));
});
