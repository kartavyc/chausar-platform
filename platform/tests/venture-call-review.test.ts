// Independent R6 receipt integrity review.
import test from 'node:test';import assert from 'node:assert/strict';
import {digest} from '../runtime/portable.ts';
import {callCostReceipt} from '../runtime/venture/playbooks/phone-receptionist/receipt.ts';
import {priceCall,callRateTable,CALL_UNITS} from '../runtime/venture/playbooks/phone-receptionist/call-cost.ts';
test('call work receipt digest covers the receipt body using the shared work receipt contract',()=>{const rates=callRateTable({currency:'INR',checkedOn:'2026-10-29',source:'https://example.org/fictional-rates',rates:Object.entries(CALL_UNITS).map(([leg,unit])=>({leg,unit,perUnits:'1',minor:'1'}))},'2026-10-29');const cost=priceCall({callId:'fictional-call',legs:Object.entries(CALL_UNITS).map(([leg,unit])=>({leg,unit,quantity:'1'}))},rates);const receipt=callCostReceipt('order-one',{id:'source-one',digest:'a'.repeat(64)},cost);const {digest:actual,...body}=receipt;assert.equal(actual,digest(body));});
