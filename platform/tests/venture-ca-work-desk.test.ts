// C2 owner review gates bind a real calculator receipt and exact source evidence.
import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
const bill={kind:'purchase-bill',source:'Owner typed invoice INV-1',number:'INV-1',date:'2026-10-01',party:'Paper shop',netMinor:'10000',taxMinor:'1800',totalMinor:'11800'};
test('document desk stores receipted drafts and exact approval, without posting to external books',async()=>{
 const env=await kitBusiness(undefined,{idea:'CA firm in Pune'});const act=(id:string,action:string,payload:unknown,digest?:string)=>env.call('venture.desk.act',{playbook:'ca-firm',kind:'working',id,action,payload,digest});
 const prepared=(await act('new','prepare',{clientId:env.client.id,mode:'document',input:bill})).result;
 assert.equal(prepared.receipt.engine,'doc-entry');assert.equal(prepared.vouchers[0].state,'draft');assert.ok(prepared.receiptId);
 await assert.rejects(act(prepared.id,'approve-vouchers',{voucherIds:['INV-1']},'stale'),{code:'CA_WORK_CHANGED'});
 const approved=(await act(prepared.id,'approve-vouchers',{voucherIds:['INV-1']},prepared.digest)).result;assert.equal(approved.vouchers[0].state,'approved');assert.equal(approved.postedExternally,false);
 await assert.rejects(act(prepared.id,'approve-vouchers',{voucherIds:['not-there']},approved.digest),{code:'CA_VOUCHER_UNKNOWN'});
});
test('health findings need exact CA identity, current receipt and evidence for confirm or dismiss',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T10:00:00Z')},{idea:'CA firm in Pune'});await env.call('venture.ca.setOfRecord',{name:'Asha CA',membershipNo:'123456'});const ca=await env.call('venture.ca.get');await env.call('venture.ca.confirmRates',{tableIds:ca.pendingRates.map((r:any)=>`${r.tableId}@${r.version}`),membershipNo:'123456'});
 const lines=['a','b'].map((id,i)=>({id,source:'ledger',transactionId:id,date:`2026-10-0${i+1}`,payee:'Shop',direction:'out',amountMinor:'600000',cash:false,purchase:true,gstCharged:true,gstin:null,tds:null}));
 const act=(id:string,action:string,payload:unknown,digest?:string)=>env.call('venture.desk.act',{playbook:'ca-firm',kind:'working',id,action,payload,digest});
 const prepared=(await act('new','prepare',{clientId:env.client.id,mode:'health',input:{quarter:'2026-Q4',financialYear:'2026-27',purchaseThresholdMinor:'500000',lines,priorPayments:[]}})).result;
 const finding=prepared.receipt.working.findings[0];await assert.rejects(act(prepared.id,'decide-finding',{findingId:finding.id,decision:'confirmed',membershipNo:'000000',evidence:['a'],note:'Invoice checked'},prepared.digest),{code:'CA_NOT_OF_RECORD'});
 await assert.rejects(act(prepared.id,'decide-finding',{findingId:finding.id,decision:'dismissed',membershipNo:'123456',evidence:[],note:'Invoice checked'},prepared.digest),{code:'CA_FINDING_EVIDENCE_REQUIRED'});
 const saved=(await act(prepared.id,'decide-finding',{findingId:finding.id,decision:'dismissed',membershipNo:'123456',evidence:finding.evidence,note:'Invoice copy checked with supplier'},prepared.digest)).result;assert.equal(saved.decisions[0].decision,'dismissed');assert.equal(saved.decisions[0].caName,'Asha CA');
});
test('one-click examples are marked assumptions and never saved to a client',async()=>{const env=await kitBusiness(undefined,{idea:'CA firm in Pune'});const before=await env.call('venture.desk.list',{playbook:'ca-firm',kind:'working'});const example=(await env.call('venture.desk.act',{playbook:'ca-firm',kind:'working',id:'new',action:'example',payload:{mode:'what-if'}})).result;assert.equal(example.sample,true);assert.equal(example.receipt.engine,'what-if');assert.ok(example.receipt.assumptions.length);const after=await env.call('venture.desk.list',{playbook:'ca-firm',kind:'working'});assert.equal(after.rows.length,before.rows.length);});
