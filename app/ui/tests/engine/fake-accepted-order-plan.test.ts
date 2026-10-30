// Integration: orders use the owner's accepted contract and their own code-computed receipt.
import {it,expect} from 'vitest';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
async function fixture(){
 const client=createFakeClient(new FakeEngine({fresh:true,now:()=> '2026-10-29T10:00:00Z'}));
 await client.request('workspace.create',{name:'Accepted price test',pack:'services'});
 await client.request('venture.create',{idea:'Bespoke colour consulting',countryCode:'IN'});
 for(const [questionId,answer]of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'project'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await client.request('venture.interview.answer',{questionId,answer});
 const first=await client.request('venture.blueprint.draft',{useTemplate:true}),offer=first.blueprint.offers[0]!;
 const priced=await client.request('venture.blueprint.update',{patch:{offers:first.blueprint.offers.map(o=>({id:o.id,unitPrice:'1000'}))}});
 const person=await client.request('venture.client.add',{name:'Fictional client',countryCode:'IN'});
 const approve=async()=>{const row=(await client.request('venture.queue.list',{})).rows.find(r=>r.viewRef?.kind==='plan'&&r.viewRef.id===priced.blueprint.id)!;await client.request('venture.queue.decide',{id:row.id,digest:row.digest,action:'approve',viewed:true});};
 return{client,offer,approve,request:{clientId:person.id,offerId:offer.id,request:'Review the supplied palette'}};
}
it('new orders wait for the first owner-approved plan',async()=>{
 const f=await fixture();await expect(f.client.request('venture.order.create',f.request)).rejects.toMatchObject({code:'BLUEPRINT_NOT_ACCEPTED'});
});
it('a newer unpriced draft cannot hide the accepted offer or its computed order price',async()=>{
 const f=await fixture();await f.approve();await f.client.request('venture.blueprint.draft',{useTemplate:true});
 const order=await f.client.request('venture.order.create',f.request),receipt=await f.client.request('venture.receipt.get',{id:order.priceReceiptId});
 expect(order.offerId).toBe(f.offer.id);expect(receipt.totalMinor).toBe('100000');expect(receipt.explanation).toContain('100000');
});
it('a quote made after acceptance cannot substitute its quantity or receipt for the order',async()=>{
 const f=await fixture();await f.approve();const quote=await f.client.request('venture.price.quote',{offerId:f.offer.id,quantity:'1'});
 const order=await f.client.request('venture.order.create',{...f.request,quantity:'3'}),receipt=await f.client.request('venture.receipt.get',{id:order.priceReceiptId});
 expect(receipt.totalMinor).toBe('300000');expect(receipt.id).not.toBe(quote.id);
 expect((await f.client.request('venture.receipt.get',{id:quote.id})).totalMinor).toBe('100000');
});

it('refuses an order currency outside the accepted country books',async()=>{
 const f=await fixture();await f.approve();const view=await f.client.request('venture.blueprint.get',{});view!.blueprint.backOffice.currency='USD';
 const {FakeWorkDesk}=await import('../../src/engine/fake-work');
 const desk=new FakeWorkDesk({current:()=> 'biz',now:()=> '2026-10-29T10:00:00Z',clients:()=>[{id:f.request.clientId,name:'Client',countryCode:'US'}] as never,country:()=>({code:'IN',currency:'INR'}),plan:()=>view,runs:()=>[],agentName:()=> 'Writer',emit:()=>{}},{fresh:true});
 expect(()=>desk.request('venture.order.create',f.request)).toThrowError(expect.objectContaining({code:'CURRENCY_CONFLICT'}));
});
