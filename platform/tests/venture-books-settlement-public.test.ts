import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness} from './fixtures/venture/kit-business.ts';
import {config,resolve,provider} from './fixtures/venture/zoho-settlement.ts';
import {externalPostingId} from '../runtime/venture/playbooks/bookkeeping-cfo/posting-core.ts';
import {SETTLEMENT_PAYMENT_COLUMNS} from '../runtime/venture/playbooks/bookkeeping-cfo/settlement-payments.ts';
import {emptyShelf} from './venture-network-env.ts';
test('public owner settlement desk uses actual provider prepare, exact approval and received-payment readback',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'}),p=provider();env.deps.secrets=emptyShelf();p.invoice.reference_number=externalPostingId({shopId:'shop',orderId:'one'});env.deps.net={resolve,send:p.send};
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Keep these client books.',intake:{fields:{'data-consent':true,period:'October 2026'}}}),base={playbook:'bookkeeping-cfo',kind:'finance'};
 const cycle=await env.call('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:config.organizationId,from:'2026-04-01',to:'2027-03-31'}});
 await env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'posting',id:cycle.id,action:'configure-zoho',payload:{dataCenter:config.dataCenter,accessToken:config.accessToken,customerId:'77',placeOfSupply:'MH',gstTreatment:'consumer',gstNo:null,taxSpecification:'inter',lineMode:'aggregate-non-inventory',lines:[{itemId:'99',taxId:'88',taxKind:'tax'}]}});
 const add=(name:string,text:string)=>env.call('venture.files.add',{orderId:order.id,name,contentBase64:Buffer.from(text).toString('base64')});
 const source=await add('month.csv','kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Orders,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlements,100,99,\nfee-slab,one,,Fee source,1,,'),month=await env.call('venture.desk.act',{...base,id:'new',action:'monthly-seller',payload:{cycleId:cycle.id,orderId:order.id,uploadId:source.id,month:'2026-10'}});
 const file=await add('payments.csv',SETTLEMENT_PAYMENT_COLUMNS.join(',')+'\nshop,payout,one,2026-10-28T10:00:00Z,Asia/Kolkata,banktransfer,100,99,Settlement row');
 const desk={playbook:'bookkeeping-cfo',kind:'settlement'},staged=await env.call('venture.desk.act',{...desk,id:month.id,action:'stage',payload:{uploadId:file.id}});assert.equal(p.calls.some(call=>call.method==='POST'),false);assert.equal(staged.result.entry.posting.state,'staged');
 const view=await env.call('venture.desk.get',{...desk,id:month.id});await assert.rejects(env.call('venture.desk.act',{...desk,id:month.id,action:'apply',payload:{},digest:'old'}),{code:'APPROVAL_STALE'});
 const done=await env.call('venture.desk.act',{...desk,id:month.id,action:'apply',payload:{},digest:view.digest});assert.equal(done.result.entry.posting.state,'recorded');assert.equal(p.calls.filter(call=>call.method==='POST').length,1);assert.equal(p.payment.amount,99);assert.equal(p.payment.bank_charges,0);assert.deepEqual(p.payment.contact_persons,[]);
});
