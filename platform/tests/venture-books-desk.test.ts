// 5K2 actual owner desk paths, receipt binding and cycle scope.
import assert from 'node:assert/strict';
import test from 'node:test';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction,listRecords} from '../runtime/venture/records.ts';
import {networkForget} from '../runtime/venture/network/forget.ts';
import {withNetworkKey} from './venture-network-env.ts';
const desk={playbook:'bookkeeping-cfo',kind:'finance'};
test('owner finance desk creates isolated cycles and approves exact receipt vouchers without posting',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Keep these client books.',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 const cycle=await env.call('venture.desk.act',{...desk,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'tally',companyId:'Client books',from:'2026-04-01',to:'2027-03-31'}});
 const file=await env.call('venture.files.add',{orderId:order.id,name:'receipt.csv',contentBase64:Buffer.from('vendor,amount\nLandlord,100').toString('base64')});
 const input={cycleId:cycle.id,orderId:order.id,receiptUploadId:file.id,date:'2026-10-28',description:'Rent receipt',lines:[{accountId:'rent',debitRupees:'100',creditRupees:'0'},{accountId:'bank',debitRupees:'0',creditRupees:'100'}]};
 const draft=await env.call('venture.desk.act',{...desk,id:'new',action:'draft-voucher',payload:input});
 const view=await env.call('venture.desk.get',{...desk,id:draft.id});
 const receipt=await env.call('venture.work.get',{id:view.item.entry.receiptId});
 assert.equal(receipt.figures[0].minor,'10000');
 const setupFile=await env.call('venture.files.add',{orderId:order.id,name:'setup.csv',contentBase64:Buffer.from('kind,id,name,source,debitRupees,creditRupees\ncategory,bank,Bank,Opening statement,,\ncategory,equity,Equity,Opening statement,,\ncustomer,c1,Client,Client list,,\nvendor,v1,Supplier,Supplier list,,\nopening,bank,,Opening statement,100,0\nopening,equity,,Opening statement,0,100').toString('base64')});
 const setup=await env.call('venture.desk.act',{...desk,id:'new',action:'draft-setup',payload:{cycleId:cycle.id,orderId:order.id,uploadId:setupFile.id}});
 assert.equal(setup.result.entry.setup.customers[0].name,'Client');assert.equal(setup.result.entry.setup.opening[0].debitMinor,'10000');
 const setupView=await env.call('venture.desk.get',{...desk,id:setup.id});await assert.rejects(env.call('venture.desk.act',{...desk,id:setup.id,action:'export-setup',digest:'old',payload:{}}),{code:'APPROVAL_STALE'});
 const handoff=await env.call('venture.desk.act',{...desk,id:setup.id,action:'export-setup',digest:setupView.digest,payload:{}});assert.equal(handoff.result.posted,false);assert.equal(handoff.result.folder,setup.result.entry.setup.cycle.folder);const pack=JSON.parse(handoff.result.content);assert.equal(pack.customers[0].name,'Client');assert.equal(pack.opening[0].debit,'INR 100.00');assert.equal(pack.receiptId,setup.result.entry.receiptId);assert.equal(pack.systemOfRecord,'client');
 const monthlyFile=await env.call('venture.files.add',{orderId:order.id,name:'seller-month.csv',contentBase64:Buffer.from('kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Order export,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlement export,100,99,\nfee-slab,one,,Fee card,1,,\ntcs,,,Credit statement,0.50,0.40,CA section to review').toString('base64')});
 const monthly=await env.call('venture.desk.act',{...desk,id:'new',action:'monthly-seller',payload:{cycleId:cycle.id,orderId:order.id,uploadId:monthlyFile.id,month:'2026-10'}});
 assert.equal(monthly.result.entry.report.creditDifferenceMinor,'10');assert.equal(monthly.result.entry.report.requiresCaConfirmation,true);assert.equal(monthly.result.entry.report.posted,false);
 const monthlyProof=await env.call('venture.work.get',{id:monthly.result.entry.receiptId});assert.equal(monthlyProof.figures.find((row:any)=>row.key==='credit-tcs').minor,'10');
 await assert.rejects(env.call('venture.desk.act',{...desk,id:draft.id,action:'approve-voucher',digest:'old',payload:{}}),{code:'APPROVAL_STALE'});
 const approved=await env.call('venture.desk.act',{...desk,id:draft.id,action:'approve-voucher',digest:view.digest,payload:{}});
 assert.equal(approved.result.entry.voucher.state,'approved');assert.equal(approved.result.entry.voucher.posted,false);
 await ventureAction(env.deps,owner,'approve','test.change-receipt',tx=>{const upload=tx.find('venture-upload',file.id)!;tx.replace({...upload,contentBase64:Buffer.from('changed').toString('base64')});});
 const stale=await env.call('venture.desk.get',{...desk,id:draft.id});assert.equal(stale.item.stale,true);assert.equal(stale.item.entry.voucher.state,'draft');
 await assert.rejects(env.call('venture.desk.act',{...desk,id:draft.id,action:'approve-voucher',digest:stale.digest,payload:{}}),{code:'BOOKS_RECEIPT_CHANGED'});
 const listed=await env.call('venture.desk.list',{...desk,filter:{cycleId:cycle.id}});assert.equal(listed.rows.length,4);
 for(const change of ['consent','cancelled'] as const){
  await ventureAction(env.deps,owner,'approve','test.revoke-finance',tx=>{const current=tx.find('venture-order',order.id)!;tx.replace({...current,status:change==='cancelled'?'cancelled':order.status,intake:{...current.intake!,fields:{...current.intake?.fields,'data-consent':change!=='consent'}}});});
  await assert.rejects(env.call('venture.desk.act',{...desk,id:'new',action:'draft-setup',payload:{cycleId:cycle.id,orderId:order.id,uploadId:setupFile.id}}),{code:'BOOKS_CONSENT_REQUIRED'});
  await assert.rejects(env.call('venture.desk.act',{...desk,id:'new',action:'monthly-seller',payload:{cycleId:cycle.id,orderId:order.id,uploadId:monthlyFile.id,month:'2026-10'}}),{code:'BOOKS_CONSENT_REQUIRED'});
  await assert.rejects(env.call('venture.desk.act',{...desk,id:'new',action:'draft-voucher',payload:input}),{code:'BOOKS_CONSENT_REQUIRED'});
  assert.equal((await env.call('venture.desk.get',{...desk,id:setup.id})).item.stale,true);
  await assert.rejects(env.call('venture.desk.act',{...desk,id:setup.id,action:'export-setup',digest:setupView.digest,payload:{}}),{code:'BOOKS_SOURCE_CHANGED'});
 }
 const person=await ventureAction(env.deps,owner,'approve','test.person',tx=>tx.put({...tx.base('venture-person'),name:'Receipt contact',handles:{emails:[],phones:[],linkedinUrl:null},role:null,roles:[],facts:[],hidden:false,clientId:env.client.id,history:[]}));
 withNetworkKey(env.deps.secrets);await networkForget(env.deps,owner,{id:person.id});
 assert.equal(listRecords(env.deps.store.read(),'venture-books-posting').length,0);
 await assert.rejects(env.call('venture.work.get',{id:view.item.entry.receiptId}),{code:'WORK_RECEIPT_NOT_FOUND'});
 assert.ok(!JSON.stringify(env.deps.store.read()).includes('Rent receipt'));
});
