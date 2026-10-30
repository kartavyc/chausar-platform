import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import type {BlueprintViewLite,EngineClient} from '../../src/engine/types';

/** Exercise the actual owner flow before a fixture creates its first order. */
export async function priceAndAcceptPlan(source:FakeEngine|EngineClient,plan:BlueprintViewLite,unitPrice:string){
 const client=source instanceof FakeEngine?createFakeClient(source):source;
 const priced=await client.request('venture.blueprint.update',{patch:{offers:plan.blueprint.offers.map(offer=>({id:offer.id,unitPrice}))}});
 const approval=(await client.request('venture.queue.list',{})).rows.find(row=>row.viewRef?.kind==='plan'&&row.viewRef.id===priced.blueprint.id);
 if(!approval)throw new Error('Fixture needs the current priced plan approval.');
 const decision=await client.request('venture.queue.decide',{id:approval.id,digest:approval.digest,action:'approve',viewed:true});
 if(decision.outcome!=='done')throw new Error('Fixture plan approval was refused: '+JSON.stringify(decision));
 return priced;
}
