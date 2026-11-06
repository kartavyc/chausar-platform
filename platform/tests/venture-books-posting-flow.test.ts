import {preparedBooksFixture} from './fixtures/venture/books-prepared.ts';
// Actual store and journal boundaries for owner-approved accounting drafts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {stageBooksPosting,applyBooksPosting,issueBooksPosting,type BooksTarget} from '../runtime/venture/build/accounting-write.ts';
import {booksFinancialDigest,type BooksOrder,type ExistingBooksRecord} from '../runtime/venture/playbooks/bookkeeping-cfo/posting-core.ts';
import {listRecords,ventureAction} from '../runtime/venture/records.ts';
import {BOOKS_SOURCE_COLUMNS} from '../runtime/venture/playbooks/bookkeeping-cfo/posting-source.ts';
const order:BooksOrder={shopId:'shop',orderId:'one',source:'order-export',occurredAt:'2026-10-28T10:00:00Z',timeZone:'Asia/Kolkata',status:'paid',eligible:true,currency:'INR',goodsMinor:'10000',sellerDiscountMinor:'0',platformDiscountMinor:'0',subtotalMinor:'10000',taxMinor:'1800',shippingMinor:'0',totalMinor:'11800',lines:[{sku:'shirt',itemId:'123',amountMinor:'10000'}]};
async function fixture(){
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});
 const clientOrder=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Post client books.',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 const cycle=await env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'create-cycle',payload:{orderId:clientOrder.id,system:'zoho',companyId:'company',from:'2026-04-01',to:'2027-03-31'}});
 const csv=BOOKS_SOURCE_COLUMNS.join(',')+'\n'+['shop','one','order-export','2026-10-28T10:00:00Z','Asia/Kolkata','paid','true','INR','100','0','0','100','0','18','118','shirt','123','100'].join(',');
 const upload=await env.call('venture.files.add',{orderId:clientOrder.id,name:'orders.csv',contentBase64:Buffer.from(csv).toString('base64')});
 const existing:ExistingBooksRecord[]=[];let writes=0,issues=0;
 const target:BooksTarget={identity:'zoho:company:connection-one',system:'zoho',companyId:'company',readExisting:async ids=>existing.filter(row=>ids.includes(row.externalId)),prepareDraft:async row=>preparedBooksFixture(row,target.identity),createDraft:async(prepared,beforeSend)=>{const row=prepared.decision;beforeSend();writes++;existing.push({externalId:row.externalId,id:'invoices:1',status:'draft',totalMinor:row.totalMinor,recipientId:'77',materialDigest:prepared.materialDigest,financialDigest:booksFinancialDigest(row),postingDate:row.postingDate,document:row.action==='create-refund-draft'?'credit-note':'invoice',originalId:row.originalId});},issue:async(row,beforeSend)=>{beforeSend();issues++;existing.find(value=>value.id===row.id)!.status='issued';}};
 return {...env,clientOrder,cycle,upload,target,existing,counts:()=>({writes,issues})};
}
test('dry run binds source, company and all rows; draft and issue have separate durable approvals',async()=>{
 const env=await fixture();const staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});
 assert.equal(env.counts().writes,0);assert.equal(staged.entry.kind,'posting');assert.equal(staged.entry.batch.rows.length,1);
 assert.equal(staged.entry.prepared.length,1,'The owner dry run persists exact provider bytes before approval');
 const proof=listRecords(env.deps.store.read(),'venture-work-receipt').find(value=>value.id===staged.entry.receiptId)!;assert.equal(proof.figures.find(value=>value.key===staged.entry.batch.rows[0]!.externalId)?.display,'INR 118.00');
 await assert.rejects(applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:'old'}),{code:'APPROVAL_STALE'});
 const done=await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});
 assert.equal(done.entry.state,'drafted');assert.deepEqual(env.counts(),{writes:1,issues:0});
 const journal=listRecords(env.deps.store.read(),'venture-journal-entry').filter(row=>row.operation==='books-draft');assert.equal(journal.length,1);assert.equal(journal[0]!.state,'applied');assert.ok(journal[0]!.claimedAt);
 await assert.rejects(applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest}));assert.equal(env.counts().writes,1);
 const issued=await issueBooksPosting(env.deps,owner,env.target,{id:done.id,digest:done.entry.reviewDigest,externalId:done.entry.batch.rows[0]!.externalId});
 assert.equal(issued.entry.outcomes[0]!.state,'issued');assert.equal(env.counts().issues,1);
 assert.equal(listRecords(env.deps.store.read(),'venture-journal-entry').filter(row=>row.operation==='books-issue').length,1);
});
test('failed readback stays unknown and never retries; changed source and account cannot write',async()=>{
 const env=await fixture();const staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});
 let calls=0;env.target.createDraft=async(_row,beforeSend)=>{beforeSend();calls++;throw new Error('lost response');};
 const unknown=await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});assert.equal(unknown.entry.state,'outcome_unknown');
 await assert.rejects(applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest}));assert.equal(calls,1);
 const fresh=await fixture();const draft=await stageBooksPosting(fresh.deps,owner,fresh.target,{cycleId:fresh.cycle.id,orderId:fresh.clientOrder.id,uploadId:fresh.upload.id});
 await assert.rejects(applyBooksPosting(fresh.deps,owner,{...fresh.target,identity:'other'}, {id:draft.id,digest:draft.entry.reviewDigest}),{code:'APPROVAL_STALE'});
 await ventureAction(fresh.deps,owner,'approve','test.source-change',tx=>{const file=tx.find('venture-upload',fresh.upload.id)!;tx.replace({...file,contentBase64:Buffer.from('[]').toString('base64')});});
 await assert.rejects(applyBooksPosting(fresh.deps,owner,fresh.target,{id:draft.id,digest:draft.entry.reviewDigest}),{code:'BOOKS_SOURCE_CHANGED'});assert.equal(fresh.counts().writes,0);
});
test('a refusal before the send guard is durably distinct from an unknown sent action',async()=>{
 const env=await fixture(),staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});
 env.target.createDraft=async()=>{throw Error('local configuration refused before send');};
 const done=await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});assert.equal(done.entry.state,'stopped');assert.equal(done.entry.outcomes[0]!.state,'not-sent');assert.equal(env.counts().writes,0);
});
