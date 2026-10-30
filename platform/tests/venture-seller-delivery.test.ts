// Actual seller delivery exercises the selected writing artifact, legal gate and Accept boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,approveWaiting,draft} from './fixtures/venture/kit-business.ts';
import {SELLER_RULES} from '../runtime/venture/playbooks/online-seller/rules.ts';
import {ONLINE_SELLER_DEFINITION} from '../runtime/venture/playbooks/online-seller/definition.ts';
import {shareCreate} from '../runtime/venture/build/share-links.ts';
import {owner} from './fixtures/venture/kit-business.ts';
import {listRecords} from '../runtime/venture/records.ts';
test('every F1 seller offer reaches Accept once, with no extra model preview for work steps',async t=>{
 const env=await kitBusiness({now:new Date('2026-10-27T12:00:00Z')},{idea:'An online seller in Pune'});
 assert.equal(env.offers.length,ONLINE_SELLER_DEFINITION.offers.length,'all shipped offers can be selected');
 const rules=SELLER_RULES.filter(r=>r.needs!==null).map(rule=>({rule,prior:rule.confirmedBy}));
 t.after(()=>{for(const {rule,prior} of rules) rule.confirmedBy=prior;});
 for(const {rule} of rules) rule.confirmedBy={name:'Fixture professional',on:'2026-10-27'};
 for(const offer of env.offers.filter(offer=>['own-shop-back-office','listing-health-audit','reimbursement-audit','unit-economics-monthly','ads-health-check'].includes(offer.playbookOffer??''))){
  const internal=offer.playbookOffer==='own-shop-back-office';
  const order=await env.call('venture.order.create',{...(internal?{}:{clientId:env.client.id}),offerId:offer.id,request:'Seller audit from exports with missing evidence held.',...(internal?{}:{intake:{fields:{marketplace:'Amazon India',permission:true,channels:['Amazon India'],...(offer.playbookOffer==='unit-economics-monthly'?{gstRegistered:true,claimsInputCredit:true}:{}),...(offer.playbookOffer==='ads-health-check'?{adsSalesBasis:'gst-inclusive'}:{})}},intakeFiles:{exports:{name:'seller.csv',contentBase64:Buffer.from('item,status\ncup,checked').toString('base64')}}})});
  let run=await env.call('venture.delivery.run',{orderId:order.id});let rounds=0;
  while(run.status==='waiting-for-you' && rounds++<12){const purpose=env.models.previewed.at(-1)?.purpose;run=await approveWaiting(env,run,purpose==='delivery'?draft('Seller evidence report',{'Data coverage':['Missing evidence stays held.'],Findings:['No marketplace changes were made.'],'Specific fixes':['Ask the owner for the dated fee card.'],'Open questions':['Confirm the fee card before any estimate.']}):{note:'No more files to read.',calls:[],finished:true} as never);}
  assert.equal(run.status,'ready-for-review',JSON.stringify({offer,run}));
  const before:number=env.models.previewed.length;await env.call('venture.delivery.review',{runId:run.id,verdict:'accepted'});
  assert.equal(listRecords(env.store.read(),'venture-delivery-run').filter(r=>r.orderId===order.id).length,1);assert.equal(env.models.previewed.length,before);
  if(internal){
   await assert.rejects(shareCreate(env.deps,owner,{deliveryId:run.id}),{code:'INTERNAL_ORDER'});
   const report=await env.call('venture.report.render',{runId:run.id,formats:['html']});
   await assert.rejects(env.call('venture.report.share',{reportId:report.id,from:'2026-10-01',to:'2026-10-27'}),{code:'INTERNAL_ORDER'});
  }
 }
});
