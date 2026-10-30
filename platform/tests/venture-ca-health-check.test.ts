// CA6 checks full source coverage and code-rated findings, not model severity claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {booksHealthCheck,type HealthLine} from '../runtime/venture/playbooks/ca-firm/health-check.ts';
import {REHEARSAL} from '../runtime/venture/playbooks/ca-firm/rates.ts';
const line=(id:string,patch:Partial<HealthLine>={}):HealthLine=>({id,source:'ledger',transactionId:id,date:'2026-10-01',payee:'Supplier A',direction:'out',amountMinor:'600000',cash:false,purchase:true,gstCharged:true,gstin:null,tds:null,...patch});
test('health check reads every ledger and bank line twice, merges duplicate findings and rates from facts',()=>{
 const lines=[line('a'),line('b',{source:'bank',date:'2026-10-03'}),line('c',{cash:true,payee:'Vendor C',amountMinor:'1100000'})];
 const report=booksHealthCheck({quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'500000',lines,priorPayments:[]},REHEARSAL);
 assert.deepEqual(report.working.coverage,{read:3,total:3,passes:2,complete:true});assert.ok(report.working.worklist.every(row=>row.passes===2));
 const dup=report.working.findings.filter(f=>f.kind==='duplicate-payment');assert.equal(dup.length,1);assert.deepEqual(dup[0].evidence,['a','b']);assert.equal(dup[0].validator,'needs-follow-up');
 assert.ok(report.working.findings.some(f=>f.kind==='missing-gstin'&&f.severity==='medium'));
 assert.ok(report.working.findings.some(f=>f.kind==='cash-payment'&&f.severity==='high'));
 assert.ok(report.working.findings.every(f=>f.state==='needs-ca-review'&&f.evidence.length>0));
});
test('cash uses daily aggregation and matched ledger/bank transaction ids count only once',()=>{
 const a=line('a',{cash:true,amountMinor:'600000',transactionId:'payment-1'}),b=line('b',{cash:true,amountMinor:'500000',transactionId:'payment-2'});
 const report=booksHealthCheck({quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'0',lines:[a,b,{...a,id:'bank-a',source:'bank'}],priorPayments:[]},REHEARSAL);
 assert.equal(report.working.findings.filter(f=>f.kind==='cash-payment').length,1);
 assert.equal(report.figures.find(f=>f.key==='cash-payment-1')?.minor,'1100000');
 assert.equal(report.working.coverage.read,3);
});
test('TDS shortfall reuses the dated section table and includes prior source payments for annual thresholds',()=>{
 const payment=line('consulting',{amountMinor:'10000000',gstCharged:false,tds:{section:'194J-professional',payeeKind:'individual',pan:null,deductedMinor:'0'}});
 const report=booksHealthCheck({quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'0',lines:[payment],priorPayments:[],tdsHistoryComplete:true},REHEARSAL);
 assert.ok(report.working.findings.some(f=>f.kind==='tds-shortfall'&&f.evidence.includes('consulting')));assert.ok(report.tables.some(t=>t.id.includes('tds')));
 assert.throws(()=>booksHealthCheck({quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'0',lines:[payment],priorPayments:[]},{mode:'client',confirmations:[]}),{code:'RATE_UNCONFIRMED'});
});
test('TDS evidence includes the prior threshold payment and malformed nullable facts refuse',()=>{
 const payment=line('current',{amountMinor:'1000000',gstCharged:false,tds:{section:'194J-professional',payeeKind:'individual',pan:null,deductedMinor:'0'}});
 const input={quarter:'2026-Q4',financialYear:'2026-27' as const,purchaseThresholdMinor:'0',lines:[payment],priorPayments:[{id:'prior',payee:payment.payee,date:'2026-08-01',amountMinor:'4900000',section:'194J-professional' as const,payeeKind:'individual' as const,pan:null}],tdsHistoryComplete:true};
 const report=booksHealthCheck(input,REHEARSAL);assert.deepEqual(report.working.findings.find(f=>f.kind==='tds-shortfall')?.evidence,['current','prior']);
 for(const patch of [{gstin:4},{tds:undefined},{eventId:42}])assert.throws(()=>booksHealthCheck({...input,lines:[{...payment,...patch} as any]},REHEARSAL),{code:'TAX_INPUT_INVALID'});
});
test('overlapping cash day/event evidence does not duplicate the same amount receipt',()=>{
 const rows=[line('cash',{cash:true,direction:'in',amountMinor:'20000000',eventId:'sale'})];
 const report=booksHealthCheck({quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'0',lines:rows,priorPayments:[]},REHEARSAL);
 assert.equal(report.working.findings.filter(f=>f.kind==='cash-receipt').length,1);assert.equal(report.figures.filter(f=>f.key.startsWith('cash-receipt')).length,1);
});
test('source-cell evidence ids remain usable in TDS findings',()=>{const input={quarter:'2026-Q4',financialYear:'2026-27' as const,purchaseThresholdMinor:'0',tdsHistoryComplete:true,priorPayments:[],lines:[{id:'f1:r1',source:'ledger' as const,transactionId:'payment',date:'2026-10-01',payee:'Consultant',direction:'out' as const,amountMinor:'10000000',cash:false,purchase:false,gstCharged:false,gstin:null,tds:{section:'194J-professional' as const,payeeKind:'individual' as const,pan:'ABCPD1234E',deductedMinor:'0'}}]};const report=booksHealthCheck(input,REHEARSAL);assert.ok(report.working.findings.some(f=>f.kind==='tds-shortfall'&&f.evidence.includes('f1:r1')));});

test('large purchase without GSTIN stays a CA applicability question even when GST charged is false',()=>{const report=booksHealthCheck({quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'500000',lines:[line('not-charged',{gstCharged:false})],priorPayments:[]},REHEARSAL);assert.ok(report.working.findings.some(f=>f.kind==='missing-gstin'));});
