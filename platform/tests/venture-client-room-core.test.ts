import test from 'node:test';
import assert from 'node:assert/strict';
import {roomBrief, approveRoomBrief, clientRoomView} from '../runtime/venture/playbooks/kit/client-room-core.ts';
const price={offerId:'offer_1',minor:'125000',currency:'INR',receiptId:'receipt_1',priceDigest:'a'.repeat(64),display:'₹1,250.00'};
const fields={scope:'Research three meeting venues.',deliverable:'A table with sources and opening hours.',deadline:'2026-11-02'};
test('client room exposes only the exact owner-approved brief and a revision needs a fresh yes',()=>{
 const first=roomBrief({orderId:'order_1',clientId:'client_1',request:'Find venues',via:'owner-recorded',fields,price},null);
 assert.equal(clientRoomView(first,false).brief,null);
 const approved=approveRoomBrief(first,first.digest,'member_1','2026-10-29T10:00:00Z');
 assert.equal(clientRoomView(approved,false).brief?.scope,fields.scope);
 assert.equal(clientRoomView(approved,false).line,'Your client sees this when you send it');
 const revised=roomBrief({...approved,fields:{...fields,scope:'Research five venues.'},price},approved);
 assert.notEqual(revised.digest,approved.digest);
 assert.equal(clientRoomView(revised,true).brief?.scope,fields.scope,'pending words never replace approved client words');
 assert.throws(()=>approveRoomBrief(revised,approved.digest,'member_1','2026-10-29T10:01:00Z'),{code:'APPROVAL_STALE'});
 assert.equal(clientRoomView(approveRoomBrief(revised,revised.digest,'member_1','2026-10-29T10:02:00Z'),true).brief?.scope,'Research five venues.');
});
test('room input is bounded, dates are real, and prices retain their exact code receipt',()=>{
 const input={orderId:'order_1',clientId:'client_1',request:'Find venues',via:'client-page' as const,fields,price};
 for(const broken of [{...fields,scope:''},{...fields,deadline:'2026-02-30'},{...fields,deliverable:'a'.repeat(4001)}])assert.throws(()=>roomBrief({...input,fields:broken},null));
 assert.throws(()=>roomBrief({...input,price:{...price,minor:125000} as never},null));
 assert.throws(()=>roomBrief({...input,price:{...price,receiptId:''}},null));
 const saved=roomBrief(input,null);assert.deepEqual(saved.price,price);assert.equal(saved.version,1);
 const changed=roomBrief({...input,price:{...price,minor:'130000',priceDigest:'b'.repeat(64)}},saved);assert.notEqual(changed.digest,saved.digest);
 assert.throws(()=>roomBrief({...input,clientId:'client_2'},saved),{code:'APPROVAL_STALE'});
});
