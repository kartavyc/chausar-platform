// C2 owner forms accept rupees and source templates; arithmetic stays in code.
import test from 'node:test';import assert from 'node:assert/strict';
import {ownerWorking,ownerPack,CA_TEMPLATES} from '../runtime/venture/playbooks/ca-firm/owner-input.ts';
test('owner rupee forms use exact paise and never silently omit malformed template rows',()=>{
 const bill=ownerWorking('document',{template:'purchase-bill',csv:CA_TEMPLATES['purchase-bill']+'INV-1,2026-10-01,Paper shop,100.01,18.00,118.01\n',source:'Owner invoice'});assert.equal((bill as any).totalMinor,'11801');
 assert.throws(()=>ownerWorking('document',{template:'purchase-bill',csv:CA_TEMPLATES['purchase-bill']+'INV-1,2026-10-01,Paper shop,100.001,18,118\n',source:'Owner invoice'}),{code:'INVALID_AMOUNT'});
 const pack=ownerPack({clientId:'c',assessmentYear:'2027-28',pan:null,aadhaar:null,csv:CA_TEMPLATES['return-pack']+'salary,100.01,Owner payslip\n'});assert.equal(pack.figures[0]?.amountMinor,'10001');
});
test('bank template retains masked numbers and typed page balances; health keeps explicit unknown TDS',()=>{
 const bank:any=ownerWorking('document',{template:'bank-statement',source:'Owner bank export',account:'XXXX1234',csv:CA_TEMPLATES['bank-statement']+'1,-10,5,a,2026-10-01,Deposit,15,0\n'});assert.equal(bank.account,'XXXX1234');assert.equal(bank.pages[0].openingMinor,'-1000');
 const health:any=ownerWorking('health',{quarter:'2026-Q4',financialYear:'2026-27',thresholdRupees:'5000',source:'Owner ledger',csv:CA_TEMPLATES.health+'a,ledger,a,2026-10-01,Shop,out,6000,false,true,true,,,,,,\n',priorCsv:'',tdsHistoryComplete:false});assert.equal(health.lines[0].tds,null);assert.equal(health.lines[0].gstin,null);assert.equal(health.purchaseThresholdMinor,'500000');
 assert.throws(()=>ownerWorking('health',{quarter:'2026-Q4',financialYear:'2026-27',thresholdRupees:'1',source:'Owner ledger',csv:CA_TEMPLATES.health+'broken\n',priorCsv:'',tdsHistoryComplete:false}),{code:'CA_OWNER_INPUT_INVALID'});
});

test('owner envelopes reject unlisted fields rather than silently discarding them',()=>{
 assert.throws(()=>ownerPack({clientId:'c',assessmentYear:'2027-28',pan:null,aadhaar:null,csv:CA_TEMPLATES['return-pack']+'salary,1,Source\n',send:true}),{code:'CA_OWNER_INPUT_INVALID'});
 assert.throws(()=>ownerWorking('document',{template:'purchase-bill',source:'Owner bill',csv:CA_TEMPLATES['purchase-bill']+'A,2026-10-01,Shop,1,0,1\n',post:true}),{code:'CA_OWNER_INPUT_INVALID'});
});
