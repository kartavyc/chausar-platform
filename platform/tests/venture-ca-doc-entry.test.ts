// CA10 uses typed source figures; extraction may suggest fields but cannot override balance arithmetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {documentEntries} from '../runtime/venture/playbooks/ca-firm/doc-entry.ts';
import {callTool,type ToolEnv} from '../runtime/venture/delivery/harness/tools.ts';
import {digest} from '../runtime/venture/records.ts';
const statement={kind:'bank-statement' as const,source:'f1',account:'XXXX1234',pages:[{page:1,openingMinor:'10000',closingMinor:'12500',lines:[{id:'l1',date:'2026-10-01',description:'Client payment',creditMinor:'5000',debitMinor:'0'},{id:'l2',date:'2026-10-02',description:'Supplies',creditMinor:'0',debitMinor:'2500'}]}]};
test('bank template ties every page in paise, preserves masked numbers and produces approval-only voucher drafts',()=>{
 const result=documentEntries(statement);assert.equal(result.working.vouchers.length,2);
 assert.equal(result.working.account,'XXXX1234');assert.ok(result.working.vouchers.every(v=>v.state==='draft'&&v.ownerApprovalRequired));
 assert.deepEqual(result.working.pages,[{page:1,openingMinor:'10000',creditsMinor:'5000',debitsMinor:'2500',closingMinor:'12500',ties:true}]);
 assert.equal(result.working.vouchers[1].amountMinor,'2500');assert.equal(result.working.vouchers[1].direction,'out');
});
test('statement refuses the exact broken page, negative debit, double-sided line and discontinuous page opening',()=>{
 assert.throws(()=>documentEntries({...statement,pages:[{...statement.pages[0],closingMinor:'12501'}]}),error=>(error as any).code==='STATEMENT_DOES_NOT_TIE'&&/page 1/i.test((error as Error).message));
 assert.throws(()=>documentEntries({...statement,pages:[{...statement.pages[0],lines:[{...statement.pages[0].lines[0],debitMinor:'-1'}]}]}),{code:'TAX_INPUT_INVALID'});
 assert.throws(()=>documentEntries({...statement,pages:[{...statement.pages[0],lines:[{...statement.pages[0].lines[0],debitMinor:'1'}]}]}),{code:'TAX_INPUT_INVALID'});
 assert.throws(()=>documentEntries({...statement,pages:[...statement.pages,{page:2,openingMinor:'999',closingMinor:'999',lines:[]}]}),{code:'STATEMENT_DOES_NOT_TIE'});
});
test('purchase and sales templates require source totals to tie and retain their correct voucher direction',()=>{
 for(const kind of ['purchase-bill','sales-invoice'] as const){const input={kind,source:'f2',number:'INV-2',date:'2026-10-03',party:'Example shop',netMinor:'10000',taxMinor:'1800',totalMinor:'11800'};const result=documentEntries(input);assert.equal(result.working.vouchers[0].direction,kind==='purchase-bill'?'out':'in');assert.equal(result.figures.find(f=>f.key==='total')?.minor,'11800');assert.throws(()=>documentEntries({...input,totalMinor:'11801'}),{code:'DOCUMENT_TOTAL_DOES_NOT_TIE'});}
});
test('bank balances may be overdrawn while debit and credit movements stay positive',()=>{
 const result=documentEntries({...statement,pages:[{page:1,openingMinor:'-10000',closingMinor:'-5000',lines:[statement.pages[0].lines[0]]}]});
 assert.equal(result.working.pages[0].closingMinor,'-5000');
});
test('docs.entry reads source cells, ties pages and refuses model-supplied amounts',async()=>{
 const csv='Page,Account,Opening,Closing,Date,Description,Credit,Debit\n1,XXXX1234,-100.00,-75.00,01/10/2026,Client payment,50.00,\n1,XXXX1234,-100.00,-75.00,02/10/2026,Supplies,,25.00';
 const env={deps:{services:{}},ventureId:'venture',memberId:'owner',epoch:1,currency:'INR',dateOrder:'day-month-year',runRef:{kind:'rehearsal',scenarioId:'statement-ties',episode:0},files:[{id:'upload_1',name:'statement.csv',format:'csv',bytes:csv.length,digest:digest(csv),contentBase64:Buffer.from(csv).toString('base64'),clientData:false}],tables:[],receipts:[],dictionary:[],allowed:[],now:()=> '2026-10-28T10:00:00Z'} as unknown as ToolEnv;
 const input={kind:'bank-statement',table:'f1',columns:{page:'Page',account:'Account',opening:'Opening',closing:'Closing',date:'Date',description:'Description',credit:'Credit',debit:'Debit'}};
 const run=(value:unknown)=>callTool(env,['docs.entry'],1,0,{tool:'docs.entry',input:JSON.stringify(value)});
 const result=await run(input);assert.equal(result.record.outcome,'succeeded',JSON.stringify(result.record.envelope));assert.equal(result.receipts?.[0].ca?.engine,'doc-entry');
 const working=result.receipts![0].ca!.working as unknown as ReturnType<typeof documentEntries>['working'];assert.equal(working.vouchers.length,2);assert.equal(working.account,'XXXX1234');
 assert.equal((await run({...input,closingMinor:'0'})).record.outcome,'failed');
});
