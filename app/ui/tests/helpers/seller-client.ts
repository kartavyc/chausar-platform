import {FakeEngine,createFakeClient} from '../../src/engine/fake';
export async function sellerClient(){
 const engine=new FakeEngine({fresh:true,now:()=> '2026-10-29T10:00:00Z'}),client=createFakeClient(engine);
 await client.request('workspace.create',{name:'Own shop',pack:'services'});
 await client.request('venture.create',{idea:'online seller',countryCode:'IN'});
 for(const [questionId,answer] of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'monthly'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await client.request('venture.interview.answer',{questionId,answer});
 const plan=await client.request('venture.blueprint.draft',{useTemplate:true}),offer=plan.blueprint.offers.find(o=>o.playbookOffer==='own-shop-back-office')!;
 const priced=await client.request('venture.blueprint.update',{patch:{offers:plan.blueprint.offers.map(row=>({id:row.id,unitPrice:'100'}))}});
 const approval=(await client.request('venture.queue.list',{})).rows.find(row=>row.viewRef?.kind==='plan'&&row.viewRef.id===priced.blueprint.id)!;
 await client.request('venture.queue.decide',{id:approval.id,digest:approval.digest,action:'approve',viewed:true});
 const order=await client.request('venture.order.create',{offerId:offer.id,request:'Owner shop operations.'});
 return {engine,client,order};
}
