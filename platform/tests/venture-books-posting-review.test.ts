import {preparedBooksFixture} from './fixtures/venture/books-prepared.ts';
// Independent K2 foundation review regressions. No provider or external service is contacted.
import assert from 'node:assert/strict';
import test from 'node:test';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {stageBooksPosting,applyBooksPosting,issueBooksPosting,reconcileBooksPosting,type BooksTarget} from '../runtime/venture/build/accounting-write.ts';
import {booksFinancialDigest,decidePosting,externalPostingId,prepareBooksBatch,type BooksOrder,type ExistingBooksRecord} from '../runtime/venture/playbooks/bookkeeping-cfo/posting-core.ts';
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
test('review: a newly staged batch cannot retry a prior unknown write for the same target and external order',async()=>{
 const env=await fixture();let sends=0;env.target.createDraft=async(_row,beforeSend)=>{beforeSend();sends++;throw Error('response lost after send');};
 const request={cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id};const first=await stageBooksPosting(env.deps,owner,env.target,request);await applyBooksPosting(env.deps,owner,env.target,{id:first.id,digest:first.entry.reviewDigest});
 try{const second=await stageBooksPosting(env.deps,owner,env.target,request);await applyBooksPosting(env.deps,owner,env.target,{id:second.id,digest:second.entry.reviewDigest});}catch{}
 assert.equal(sends,1,'An unknown write cannot be retried through a new dry run');
});
test('review: cancelling the service order revokes a pending accounting write',async()=>{
 const env=await fixture();const staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});await ventureAction(env.deps,owner,'approve','test.cancel',tx=>{const order=tx.find('venture-order',env.clientOrder.id)!;tx.replace({...order,status:'cancelled'});});
 try{await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});}catch{}
 assert.equal(env.counts().writes,0,'Cancelled work cannot send to accounting');
});
test('review: a readback with no remote record identity cannot be confirmed as applied',async()=>{
 const env=await fixture();const staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});env.target.createDraft=async(prepared,beforeSend)=>{const row=prepared.decision;beforeSend();env.existing.push({externalId:row.externalId,id:'',status:'draft',totalMinor:row.totalMinor,recipientId:'77',materialDigest:prepared.materialDigest,financialDigest:booksFinancialDigest(row),postingDate:row.postingDate,document:row.action==='create-refund-draft'?'credit-note':'invoice',originalId:row.originalId});};
 const result=await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});assert.equal(result.entry.state,'outcome_unknown','A missing remote id is not proof of a saved draft');
});

test('review: a restaged applied document is still fenced if the later remote lookup is empty',async()=>{
 const env=await fixture(),request={cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id};const first=await stageBooksPosting(env.deps,owner,env.target,request);const applied=await applyBooksPosting(env.deps,owner,env.target,{id:first.id,digest:first.entry.reviewDigest});assert.equal(applied.entry.state,'drafted');
 env.target.readExisting=async()=>[];try{const second=await stageBooksPosting(env.deps,owner,env.target,request);await applyBooksPosting(env.deps,owner,env.target,{id:second.id,digest:second.entry.reviewDigest});}catch{}
 assert.equal(env.counts().writes,1,'A new review digest cannot authorize a duplicate document');
});

test('review: posting-date and document-kind readback mismatches remain unknown',async()=>{
 for(const mismatch of [{postingDate:'2026-10-27'},{document:'credit-note' as const},{originalId:'another-original'}]){const env=await fixture(),staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});env.target.createDraft=async(prepared,beforeSend)=>{const row=prepared.decision;beforeSend();env.existing.push({externalId:row.externalId,id:'invoices:wrong',status:'draft',totalMinor:row.totalMinor,recipientId:'77',materialDigest:prepared.materialDigest,financialDigest:booksFinancialDigest(row),postingDate:row.postingDate,document:'invoice',originalId:null,...mismatch});};const result=await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});assert.equal(result.entry.state,'outcome_unknown',JSON.stringify(mismatch));}
});
test('review: refund readback must identify the exact issued original',async()=>{
 const env=await fixture();env.existing.push({externalId:externalPostingId(order),id:'invoices:original',status:'issued',totalMinor:order.totalMinor,recipientId:'77',materialDigest:null,financialDigest:booksFinancialDigest(decidePosting(order,[])),postingDate:'2026-10-28',document:'invoice',originalId:null});await ventureAction(env.deps,owner,'approve','test.cancel-source-order',tx=>{const file=tx.find('venture-upload',env.upload.id)!;const csv=Buffer.from(file.contentBase64,'base64').toString().replace(',paid,',',cancelled,');tx.replace({...file,contentBase64:Buffer.from(csv).toString('base64')});});
 const staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});assert.equal(staged.entry.batch.rows[0]!.action,'create-refund-draft');env.target.createDraft=async(prepared,beforeSend)=>{const row=prepared.decision;beforeSend();env.existing.push({externalId:row.externalId,id:'creditnotes:wrong',status:'draft',totalMinor:row.totalMinor,recipientId:'77',materialDigest:prepared.materialDigest,financialDigest:booksFinancialDigest(row),postingDate:row.postingDate,document:'credit-note',originalId:'invoices:other'});};const result=await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});assert.equal(result.entry.state,'outcome_unknown');
});
test('review: withdrawn source-data consent prevents an approved dry run from sending',async()=>{
 const env=await fixture(),staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});await ventureAction(env.deps,owner,'approve','test.revoke-consent',tx=>{const order=tx.find('venture-order',env.clientOrder.id)!;tx.replace({...order,intake:{...order.intake!,fields:{...order.intake!.fields,'data-consent':false}}});});try{await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});}catch{}assert.equal(env.counts().writes,0);
});

test('review: equivalent existing-record lookup ordering does not invalidate the approved batch',async()=>{
 const orders=[order,{...order,orderId:'two'}];const existing=orders.map((o,i)=>({externalId:externalPostingId(o),id:'invoices:'+i,status:'issued' as const,totalMinor:o.totalMinor,recipientId:'77',materialDigest:null,financialDigest:booksFinancialDigest(decidePosting(o,[])),postingDate:'2026-10-28',document:'invoice' as const,originalId:null}));const a=await prepareBooksBatch(orders,async()=>existing),b=await prepareBooksBatch(orders,async()=>[...existing].reverse());assert.equal(a.digest,b.digest);
});

test('review: a pre-journal history refusal does not leave a new batch permanently applying',async()=>{
 const env=await fixture();env.target.createDraft=async(_row,beforeSend)=>{beforeSend();throw Error('response lost');};const request={cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id};const first=await stageBooksPosting(env.deps,owner,env.target,request),second=await stageBooksPosting(env.deps,owner,env.target,request);await applyBooksPosting(env.deps,owner,env.target,{id:first.id,digest:first.entry.reviewDigest});await assert.rejects(applyBooksPosting(env.deps,owner,env.target,{id:second.id,digest:second.entry.reviewDigest}));const saved=listRecords(env.deps.store.read(),'venture-books-posting').find(r=>r.id===second.id)!;assert.notEqual(saved.entry.kind==='posting'&&saved.entry.state,'applying');
});
async function forgetLinked(env:Awaited<ReturnType<typeof fixture>>){const {CONTACTS,net}=await import('./venture-network-env.ts');await net(env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:CONTACTS});const person=listRecords(env.deps.store.read(),'venture-person').find(p=>p.name==='Asha Rao')!;await ventureAction(env.deps,owner,'approve','test.link-client',tx=>tx.replace({...tx.find('venture-person',person.id)!,clientId:env.client.id}));await net(env,'venture.network.forget',{id:person.id});}
test('review: Forget removes all opaque client finance stages, source copies and receipts',async()=>{
 const env=await fixture(),request={cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id};const stages=[await stageBooksPosting(env.deps,owner,env.target,request),await stageBooksPosting(env.deps,owner,env.target,request)];await applyBooksPosting(env.deps,owner,env.target,{id:stages[0]!.id,digest:stages[0]!.entry.reviewDigest});await forgetLinked(env);
 assert.equal(listRecords(env.deps.store.read(),'venture-books-posting').filter(r=>r.clientId===env.client.id).length,0);assert.equal(listRecords(env.deps.store.read(),'venture-upload').some(r=>r.id===env.upload.id),false);for(const stage of stages)assert.equal(listRecords(env.deps.store.read(),'venture-work-receipt').some(r=>r.id===stage.entry.receiptId),false);assert.equal(listRecords(env.deps.store.read(),'venture-journal-entry').filter(r=>r.operation==='books-draft').length,1,'Keep the non-personal write tombstone so Forget cannot cause a duplicate');
});
test('review: Forget during adapter preparation revokes send and cannot resurrect deleted stage',async()=>{
 const env=await fixture(),staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});let sends=0;env.target.createDraft=async(_row,beforeSend)=>{await forgetLinked(env);beforeSend();sends++;};try{await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});}catch{}assert.equal(sends,0);assert.equal(listRecords(env.deps.store.read(),'venture-books-posting').some(r=>r.id===staged.id),false);assert.equal(listRecords(env.deps.store.read(),'venture-upload').some(r=>r.id===env.upload.id),false);
});

test('review: restart with no claim is stopped, while an unsettled claim cannot be declared not sent',async()=>{
 const env=await fixture(),staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});await ventureAction(env.deps,owner,'approve','test.restart-no-claim',tx=>tx.replace({...staged,entry:{...staged.entry,state:'applying'}}));const noClaim=await reconcileBooksPosting(env.deps,owner,staged.id);assert.equal(noClaim.entry.state,'stopped');assert.equal(noClaim.entry.outcomes[0]!.state,'not-sent');assert.equal(env.counts().writes,0);
 const live=await fixture(),proposal=await stageBooksPosting(live.deps,owner,live.target,{cycleId:live.cycle.id,orderId:live.clientOrder.id,uploadId:live.upload.id});live.target.createDraft=async(_row,beforeSend)=>{beforeSend();throw Error('crash');};await applyBooksPosting(live.deps,owner,live.target,{id:proposal.id,digest:proposal.entry.reviewDigest});await ventureAction(live.deps,owner,'approve','test.restore-claim',tx=>{tx.replace({...proposal,entry:{...proposal.entry,state:'applying'}});const journal=tx.list('venture-journal-entry').find(j=>j.operation==='books-draft')!;tx.replace({...journal,state:'approved'});});await assert.rejects(reconcileBooksPosting(live.deps,owner,proposal.id),{code:'BOOKS_STILL_RUNNING'});
});
test('review: restart after settled draft journal but before local identity save stays outcome unknown',async()=>{
 const env=await fixture(),staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});await ventureAction(env.deps,owner,'approve','test.restart-applied',tx=>tx.replace({...staged,entry:{...staged.entry,state:'applying'}}));const restored=await reconcileBooksPosting(env.deps,owner,staged.id);assert.equal(restored.entry.state,'outcome_unknown');assert.equal(restored.entry.outcomes[0]!.state,'outcome_unknown');assert.equal(env.counts().writes,1);
});
test('review: restart after issue settles must not keep presenting the document as an unissued draft',async()=>{
 const env=await fixture(),staged=await stageBooksPosting(env.deps,owner,env.target,{cycleId:env.cycle.id,orderId:env.clientOrder.id,uploadId:env.upload.id});const drafted=await applyBooksPosting(env.deps,owner,env.target,{id:staged.id,digest:staged.entry.reviewDigest});let interrupted=drafted;const issue=env.target.issue;env.target.issue=async(value,beforeSend)=>issue(value,()=>{beforeSend();interrupted=listRecords(env.deps.store.read(),'venture-books-posting').find(row=>row.id===drafted.id)! as typeof drafted;});await issueBooksPosting(env.deps,owner,env.target,{id:drafted.id,digest:drafted.entry.reviewDigest,externalId:drafted.entry.batch.rows[0]!.externalId});await ventureAction(env.deps,owner,'approve','test.restart-issued',tx=>tx.replace(interrupted));const recovered=await reconcileBooksPosting(env.deps,owner,drafted.id);assert.notEqual(recovered.entry.outcomes[0]!.state,'drafted');assert.equal(env.counts().issues,1,'Reconciliation must never issue again');
});

test('review: a credit note at the sale identity cannot authorize another refund draft',()=>{
 const original:ExistingBooksRecord={externalId:externalPostingId(order),id:'creditnotes:unexpected',status:'issued',totalMinor:order.totalMinor,recipientId:'77',materialDigest:null,financialDigest:booksFinancialDigest(decidePosting(order,[])),postingDate:'2026-10-28',document:'credit-note',originalId:'invoices:other'};
 const result=decidePosting({...order,status:'cancelled'},[original]);assert.equal(result.action,'skip','A cancellation must reverse an actual issued invoice, never another credit note');
});
