// Tender monetary claims retain exact source currency and minor-unit evidence, never floating calculations.
import test from 'node:test';import assert from 'node:assert/strict';
import {tenderMoneyReceipts} from '../runtime/venture/playbooks/tender-desk/money.ts';
import {groundTenderCommercial} from '../runtime/venture/playbooks/tender-desk/ground.ts';
test('explicit tender amounts have exact code receipts from the same source currency',()=>{
 const docs=[{id:'quote',text:'The fee is INR 1,20,000.25.'}],result=tenderMoneyReceipts('The fee is ₹120000.25.',docs);
 assert.equal(result.unmatched.length,0);assert.equal(result.receipts[0].minor,'12000025');assert.equal(result.receipts[0].currency,'INR');assert.equal(result.receipts[0].sourceId,'quote');assert.ok(result.receipts[0].id);assert.equal(result.receipts[0].sourceDigest.length,64);
 assert.equal(tenderMoneyReceipts('The fee is USD 120000.25.',docs).unmatched.length,1);
 assert.equal(tenderMoneyReceipts('The fee is INR 9000.',docs).unmatched.length,1);
 assert.equal(tenderMoneyReceipts('The fee is INR 0.001.',[{id:'quote',text:'INR 0.001'}]).unmatched.length,1);
 assert.equal(tenderMoneyReceipts('The fee is INR 1.2 lakh.',[{id:'quote',text:'INR 120000'}]).receipts[0].minor,'12000000');
});
test('commercial grounding refuses equal digits in a different currency',()=>{
 assert.equal(groundTenderCommercial('The fee is USD 9000.',[{id:'quote',text:'The fee is INR 9000.'}]).passed,false);
});
