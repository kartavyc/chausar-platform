import {FakeEngine,createFakeClient} from '../../src/engine/fake';
export async function booksClient(){
 const engine=new FakeEngine({fresh:true,now:()=> '2026-10-28T12:00:00Z'}),client=createFakeClient(engine);
 await client.request('workspace.create',{name:'Books studio',pack:'services'});
 await client.request('venture.create',{idea:'bookkeeping and CFO service',countryCode:'IN'});
 for(const [questionId,answer] of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'monthly'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await client.request('venture.interview.answer',{questionId,answer});
 const plan=await client.request('venture.blueprint.draft',{useTemplate:true}),offer=plan.blueprint.offers[0]!;
 await client.request('venture.blueprint.update',{patch:{offers:[{id:offer.id,unitPrice:'100'}]}});
 const person=await client.request('venture.client.add',{name:'Client',countryCode:'IN'});
 const order=await client.request('venture.order.create',{clientId:person.id,offerId:offer.id,request:'Keep these client books.',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 return {engine,client,order};
}
