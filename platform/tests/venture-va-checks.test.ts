import test from 'node:test';import assert from 'node:assert/strict';
import {vaBriefCheck} from '../runtime/venture/playbooks/virtual-assistant/checks.ts';
import {roomBrief,approveRoomBrief} from '../runtime/venture/playbooks/kit/client-room-core.ts';
test('delivery requires the current approved bounded brief and refuses a claim of autonomous payment',()=>{
 const brief=roomBrief({orderId:'order',clientId:'client',request:'Research venues',via:'owner-recorded',fields:{scope:'Research venues',deliverable:'A sourced table',deadline:'2026-11-02'},price:{offerId:'offer',minor:'10000',currency:'INR',receiptId:'receipt',priceDigest:'a'.repeat(64),display:'₹100'}},null);
 const approved=approveRoomBrief(brief,brief.digest,'owner','2026-10-29T10:00:00Z'),text='Research venues\nA sourced table\n2026-11-02\n₹100\nreceipt';
 const input=(room:unknown,words:string)=>({roomBrief:room,deliverable:{title:'Brief',sections:[{heading:'Brief',parts:[{kind:'text',text:words,ref:''},{kind:'figure',receiptId:'receipt',figureKey:'total'}]}]}} as never);
 assert.equal(vaBriefCheck(input(brief,text))[0]?.outcome,'fail');assert.equal(vaBriefCheck(input(approved,text))[0]?.outcome,'pass');assert.equal(vaBriefCheck(input(approved,text+' I paid with the client card.'))[0]?.outcome,'fail');assert.equal(vaBriefCheck(input(approved,'Research venues'))[0]?.outcome,'fail');
});
