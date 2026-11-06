// Actual approved facts and recorded human outcomes are the only report evidence.
import test from 'node:test';import assert from 'node:assert/strict';import {receptionistFacts,receptionistScript} from '../runtime/venture/playbooks/phone-receptionist/script.ts';import {phoneReport,phoneDelivery,phoneChecks} from '../runtime/venture/playbooks/phone-receptionist/report.ts';import type {CallLogBody} from '../runtime/venture/playbooks/phone-receptionist/records.ts';
function fixture():CallLogBody{const facts=receptionistFacts({business:'Sona repairs',hours:'Weekdays',services:['Fan repair'],faq:[],prices:[]});return {orderId:'order-test',clientId:'client-test',orderDigest:'a'.repeat(64),facts,language:'en',script:receptionistScript(facts,facts.digest,'en'),rates:null,budget:null,logs:[]};}
test('report refuses an unapproved or changed script and literal delivery cannot add unsupported claims',()=>{const row=fixture();assert.throws(()=>phoneReport({...row,script:null}),{code:'CALL_SETUP_REQUIRED'});assert.throws(()=>phoneReport({...row,script:{...row.script!,lines:['I booked the visit.']}}),{code:'APPROVAL_STALE'});const report=phoneReport(row),deliverable=phoneDelivery(report);assert.equal(phoneChecks({phoneReport:report,deliverable})[0]!.outcome,'pass');assert.equal(phoneChecks({phoneReport:report,deliverable:{...deliverable,sections:[{heading:'Call review',parts:[{kind:'text',text:'I booked and charged the caller.'}]}]}})[0]!.outcome,'fail');assert.match(report.text,/planned/i);assert.match(report.text,/AI assistant/);assert.equal(report.bookedByAgent,false);});

test('wave 6: downloaded receptionist text hides internal receipts but retains exact computed costs', async () => {
 const {callLogExport}=await import('../runtime/venture/playbooks/phone-receptionist/logs.ts');
 const {CALL_UNITS,priceCall}=await import('../runtime/venture/playbooks/phone-receptionist/call-cost.ts');
 const row=fixture(),callId='provider-call-example';
 const rates={currency:'INR' as const,checkedOn:'2026-10-30',source:'https://example.org/rates',rates:Object.entries(CALL_UNITS).map(([leg,unit])=>({leg:leg as keyof typeof CALL_UNITS,unit,perUnits:'1',minor:'25'}))};
 const cost=priceCall({callId,legs:rates.rates.map(({leg,unit})=>({leg,unit,quantity:'2'}))},rates);
 const log=callLogExport({callId,endedAt:'2026-10-30T10:00:00.000Z',transcript:'The caller asked about opening hours.',requests:[]});
 const receiptId='internal-call-work-receipt';
 row.logs=[{month:'2026-10',log,cost,receiptId,importDigest:'example-import',bookedByAgent:false,reviews:[]}];
 const report=phoneReport(row);
 assert.equal(report.text.includes(receiptId),false);
 assert.equal(report.text.includes(cost.receipt.id),false);
 assert.ok(report.text.includes('INR 2.50'));
 assert.equal(report.calls[0].receiptId,receiptId);
 assert.equal(phoneChecks({phoneReport:report,deliverable:phoneDelivery(report)})[0].outcome,'pass');
});
