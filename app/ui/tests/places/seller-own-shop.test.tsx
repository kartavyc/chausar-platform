// Seller fake parity at the public engine API, original Chausar test.
import {it,expect} from 'vitest';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import {priceAndAcceptPlan} from '../helpers/accepted-plan';
import {TextProvider} from '../../src/text';
import {EngineProvider} from '../../src/engine/context';
import {render,screen,fireEvent} from '@testing-library/react';
import {OnlineSellerDesk} from '../../src/places/work/desks/OnlineSellerDesk';
import type {BlueprintViewLite} from '../../src/engine/types';
async function shop(){
 const engine=new FakeEngine({fresh:true});
 await engine.request('workspace.create',{name:'Own shop',pack:'services'});
 await engine.request('venture.create',{idea:'An online seller in Pune',countryCode:'IN'});
 await engine.request('venture.interview.answer',{questionId:'q_1',answer:{skipped:true}});
 await engine.request('venture.interview.answer',{questionId:'q_pricing_model',answer:{choiceId:'monthly'}});
 await engine.request('venture.interview.answer',{questionId:'q_price',answer:{skipped:true}});
 await engine.request('venture.interview.answer',{questionId:'q_tax',answer:{yes:false}});
 const view=await engine.request('venture.blueprint.draft',{useTemplate:true}) as BlueprintViewLite;
 const offer=view.blueprint.offers.find(o=>o.playbookOffer==='own-shop-back-office')!;
 await priceAndAcceptPlan(engine,view,'1000');
 return {engine,offer};
}
it('own-shop fake orders use one self client and refuse customer invoice and shares',async()=>{
 const {engine,offer}=await shop();
 const first=await engine.request('venture.order.create',{offerId:offer.id,request:'Check my shop.'}) as any;
 const second=await engine.request('venture.order.create',{offerId:offer.id,request:'Check my next export.'}) as any;
 expect(first.internal).toBe(true);expect(second.clientId).toBe(first.clientId);
 await expect(engine.request('venture.invoice.prepare',{orderId:first.id})).rejects.toMatchObject({code:'INTERNAL_ORDER'});
 await expect(engine.request('venture.share.create',{kind:'order-status',orderId:first.id})).rejects.toMatchObject({code:'INTERNAL_ORDER'});
});
it('the seller desk can start own-shop work without asking for a customer',async()=>{
 const {engine}=await shop();
 render(<TextProvider language="en"><EngineProvider client={createFakeClient(engine)}><OnlineSellerDesk/></EngineProvider></TextProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Start own-shop work'}));
 expect(await screen.findByRole('option',{name:'Check my own shop exports.'})).toBeTruthy();
});
