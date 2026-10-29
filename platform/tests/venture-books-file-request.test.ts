// Independent BK6 integration: the existing client upload link feeds exact owner-approved receipt vouchers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {shareRequestHandler,fileRequestEntry} from '../runtime/venture/build/file-requests.ts';
import {listRecords,ventureAction} from '../runtime/venture/records.ts';

test('client request-link receipt becomes a scoped voucher and changed bytes revoke approval',async()=>{
 const e=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});
 const order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers[0]!.id,request:'Client receipts',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 const hosted={...e.deps,host:'hosted-web' as const,publicUrl:'https://app.example.test'},link=await shareRequestHandler(hosted,owner,{orderId:order.id,note:'Upload this month receipt.'});
 const token=new URL(link.url!).pathname.split('/')[2]!;const claim=await fileRequestEntry(hosted,owner,token,{step:'claim'}) as {lock:string};
 await fileRequestEntry(hosted,owner,token,{step:'store',lock:claim.lock,name:'rent.csv',contentBase64:Buffer.from('id,on,description,debitAccount,creditAccount,amount\nr1,2026-10-28,Rent,rent,bank,100').toString('base64')});
 const upload=listRecords(e.deps.store.read(),'venture-upload').find(row=>row.fileRequestId===link.id)!;assert.equal(upload.origin,'client-link');assert.deepEqual(upload.scope,{kind:'order',orderId:order.id});
 const base={playbook:'bookkeeping-cfo',kind:'finance'},cycle=await e.call('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'tally',companyId:'Client books',from:'2026-04-01',to:'2027-03-31'}});
 const made=await e.call('venture.desk.act',{...base,id:'new',action:'draft-voucher',payload:{cycleId:cycle.id,orderId:order.id,receiptUploadId:upload.id,date:'2026-10-28',description:'Rent',lines:[{accountId:'rent',debitRupees:'100',creditRupees:'0'},{accountId:'bank',debitRupees:'0',creditRupees:'100'}]}});
 const view=await e.call('venture.desk.get',{...base,id:made.id}),approved=await e.call('venture.desk.act',{...base,id:made.id,action:'approve-voucher',payload:{},digest:view.digest});assert.equal(approved.result.entry.voucher.state,'approved');assert.equal(approved.result.entry.voucher.posted,false);assert.equal(approved.result.entry.voucher.systemOfRecord,'client');
 await ventureAction(e.deps,owner,'prepare','review.receipt-changed',tx=>tx.replace({...tx.find('venture-upload',upload.id)!,contentBase64:Buffer.from('Changed receipt').toString('base64')}));
 const changed=await e.call('venture.desk.get',{...base,id:made.id});assert.equal(changed.item.stale,true);assert.equal(changed.item.entry.voucher.state,'draft');await assert.rejects(e.call('venture.desk.act',{...base,id:made.id,action:'approve-voucher',payload:{},digest:changed.digest}),{code:'BOOKS_RECEIPT_CHANGED'});
});
