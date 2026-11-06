// Receipt-backed voucher drafts, original Chausar code after finance-workspace (MIT ideas).
import assert from 'node:assert/strict';
import test from 'node:test';
import {financeCycle} from '../runtime/venture/playbooks/bookkeeping-cfo/cycles.ts';
import {voucherDraft,approveVoucher} from '../runtime/venture/playbooks/bookkeeping-cfo/vouchers.ts';
const cycle=financeCycle({businessId:'business-a',clientId:'client-a',system:'tally',companyId:'client-books',from:'2026-04-01',to:'2027-03-31'});
const input=()=>({cycle,date:'2026-10-28',description:'Tea shop rent',receipt:{uploadId:'upload-a',digest:'a'.repeat(64),clientId:'client-a',orderId:'order-a'},lines:[{accountId:'rent',debitMinor:'10000',creditMinor:'0'},{accountId:'bank',debitMinor:'0',creditMinor:'10000'}]});
test('receipt vouchers remain drafts until the exact source-backed entry is approved',()=>{
 const draft=voucherDraft(input());assert.equal(draft.state,'draft');assert.equal(draft.totalMinor,'10000');assert.equal(draft.systemOfRecord,'client');
 const approved=approveVoucher(draft,{digest:draft.digest,receiptDigest:'a'.repeat(64),by:'bookkeeper-a',at:'2026-10-28T10:00:00Z'});
 assert.equal(approved.state,'approved');assert.equal(approved.posted,false);assert.equal(approved.approval.by,'bookkeeper-a');
 assert.throws(()=>approveVoucher(draft,{digest:'b'.repeat(64),receiptDigest:'a'.repeat(64),by:'bookkeeper-a',at:'2026-10-28T10:00:00Z'}),{code:'APPROVAL_STALE'});
 assert.throws(()=>approveVoucher(draft,{digest:draft.digest,receiptDigest:'b'.repeat(64),by:'bookkeeper-a',at:'2026-10-28T10:00:00Z'}),{code:'BOOKS_RECEIPT_CHANGED'});
 draft.lines[0]!.accountId='changed';assert.throws(()=>approveVoucher(draft,{digest:draft.digest,receiptDigest:'a'.repeat(64),by:'bookkeeper-a',at:'2026-10-28T10:00:00Z'}),{code:'APPROVAL_STALE'});
});
test('vouchers cannot cross the finance cycle or silently treat unbalanced and absent amounts as zero',()=>{
 assert.throws(()=>voucherDraft({...input(),date:'2025-10-28'}),{code:'BOOKS_CYCLE_INVALID'});
 assert.throws(()=>voucherDraft({...input(),receipt:{...input().receipt,clientId:'other'}}),{code:'BOOKS_RECEIPT_REQUIRED'});
 assert.throws(()=>voucherDraft({...input(),lines:[input().lines[0]!,{...input().lines[1]!,creditMinor:'9999'}]}),{code:'BOOKS_OPENING_UNBALANCED'});
 assert.throws(()=>voucherDraft({...input(),lines:[{accountId:'rent',debitMinor:'',creditMinor:'0'}]}),{code:'BOOKS_SETUP_INVALID'});
});
