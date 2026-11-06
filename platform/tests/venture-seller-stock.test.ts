// Original Chausar seller operations regressions, MIT/Apache commerce ideas.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sellerStock,sellerPayouts,sellerWasPrice} from '../runtime/venture/playbooks/online-seller/stock.ts';
const move=(id:string,counter:string,delta:string,authority='warehouse')=>({id,sku:'A',counter,delta,authority,source:'moves.csv',at:'2026-10-28T10:00:00Z'});
test('stock is a movement ledger with independent counters and one authority, never an absolute set',()=>{
 const rows=[move('1','onHand','10'),move('2','allocated','3'),move('3','reserved','2'),move('4','incoming','7')];
 assert.deepEqual(sellerStock(rows)[0],{sku:'A',authority:'warehouse',onHand:'10',allocated:'3',reserved:'2',incoming:'7',available:'7',purchasable:'5',oversold:false});
 assert.throws(()=>sellerStock([...rows,move('5','onHand','2','marketplace')]),{code:'SELLER_AUTHORITY_CONFLICT'});
 assert.throws(()=>sellerStock([...rows,move('1','onHand','2')]),{code:'SELLER_MOVEMENT_DUPLICATE'});
 assert.throws(()=>sellerStock([move('1','set','10')]),{code:'SELLER_INPUT_INVALID'});
});
test('refunds do not rewrite earnings, only completed payouts are received, and was price uses the actual thirty-day minimum',()=>{
 const rows=[{kind:'earning',minor:'10000',status:'completed',currency:'INR'},{kind:'refund',minor:'2000',status:'completed',currency:'INR'},{kind:'payout',minor:'5000',status:'pending',currency:'INR'},{kind:'payout',minor:'3000',status:'completed',currency:'INR'}];
 assert.deepEqual(sellerPayouts(rows),[{currency:'INR',earnedMinor:'10000',refundMinor:'2000',receivedMinor:'3000',claimedMinor:'5000'}]);
 const prices=[{at:'2026-10-05',minor:'8000',currency:'INR'},{at:'2026-10-27',minor:'10000',currency:'INR'}];assert.equal(sellerWasPrice(prices,'8000','INR','2026-10-28').lowestMinor,'8000');assert.throws(()=>sellerWasPrice(prices,'9000','INR','2026-10-28'),{code:'SELLER_WAS_PRICE_INVALID'});
});
