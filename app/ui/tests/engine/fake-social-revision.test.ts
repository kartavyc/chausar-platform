import {priceAndAcceptPlan} from '../helpers/accepted-plan';
import { it, expect } from 'vitest';
import { fakeSocialRevision } from '../../src/engine/fake-social-revision';
import type { W4DeskHost } from '../../src/engine/fake-w4';
it.each([['INR','25000','INR 250.00'],['JPY','25000','JPY 25,000'],['BHD','25000','BHD 25.000'],['INR','123456789','INR 1,234,567.89']])('fake per-post revisions quote %s with exact receipt and currency precision', (currency,amount,formatted) => {
    let run: any = { id: 'run_a', orderId: 'order_a', status: 'ready-for-review', renderedText: '## Alt text\nLinkedIn: Keep companion text.\n## Drafts\nLinkedIn: First post.\nLinkedIn: Second post.\n## Hashtags\nLinkedIn: #KeepThese', editedText: null };
    const order: any = { id: 'order_a', offerId: 'offer_a', intake: { fields: { postCount: '8', extraRoundPrice: amount } } };
    const host: W4DeskHost & {
        reviseDelivery: (id: string, change: (r: any) => any) => any;
    } = { current: () => 'one', now: () => '2026-10-27T10:00:00Z', emit: () => { }, hosted: () => false, rows: () => [], setRows: () => { }, digest: value => JSON.stringify(value), ask: method => method === 'venture.get' ? {venture:{country:{currency}}} : method === 'venture.delivery.list' ? [run] : method === 'venture.order.list' ? [order] : { blueprint: { offers: [{ id: 'offer_a', playbookOffer: 'linkedin-ghostwriting' }] } }, reviseDelivery: (_id, change) => { run = change(run); return run; } };
    const desk = fakeSocialRevision(host);
    const id = 'run_a.post-1';
    const get = () => desk.get!({ id }) as any;
    const act = (action: string, extra = {}) => desk.act!({ id, action, digest: get().digest, payload: { runId: run.id, postId: id, words: 'Make it warmer.', ...extra } }) as any;
    for (let n = 0; n < 2; n++) {
        act('revise');
        run.status = 'ready-for-review';
    }
    expect(get().item.roundsUsed).toBe(2);
    expect((desk.get!({ id: 'run_a.post-2' }) as any).item.roundsUsed).toBe(0);expect(()=>desk.get!({id:'run_a.post-3'})).toThrow();
    expect(() => act('revise')).toThrow(expect.objectContaining({ code: 'OFFER_EXTRA_ROUND' }));
    const quote = act('quote').result;
    expect(quote.display).toBe(formatted);
    expect(desk.receipt(quote.receiptId)?.figures[0]?.display).toBe(quote.display);
    expect(() => act('revise', { quoteDigest: 'stale' })).toThrow(expect.objectContaining({ code: 'OFFER_EXTRA_ROUND' }));
    act('revise', { quoteDigest: quote.digest });
    expect(get().item.roundsUsed).toBe(3);
    expect(run.status).toBe('waiting-for-you');
    run.status='accepted';desk.act!({id,action:'client-answer',digest:get().digest,payload:{runId:run.id,postId:id,decision:'approved',comment:'Asha Rao likes this.'}});
    desk.forgetPeople([{id:'person',clientId:null,names:['Asha Rao'],emails:[],phones:[]}],true);expect(get().item.clientDecision).toBe(null);expect(get().item.roundsUsed).toBe(3);
});

import {FakeEngine} from '../../src/engine/fake';
it.each([['IN','INR'],['US','USD']])('public fake revision quote opens its %s code receipt through venture.receipt.get',async(countryCode,currency)=>{
 const engine=new FakeEngine({fresh:true,now:()=> '2026-10-27T10:00:00Z'});
 await engine.request('workspace.create',{name:'Revision studio',pack:'services'});await engine.request('venture.create',{idea:'social media agency',countryCode});
 for(const [questionId,answer] of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'monthly'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await engine.request('venture.interview.answer',{questionId,answer});
 const plan=await engine.request('venture.blueprint.draft',{useTemplate:true}) as any;const offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer==='linkedin-ghostwriting');await priceAndAcceptPlan(engine,plan,'100');
 const client=await engine.request('venture.client.add',{name:'Studio',countryCode:'IN'}) as any;
 const order=await engine.request('venture.order.create',{clientId:client.id,offerId:offer.id,request:'Write useful studio guidance.',intake:{fields:{postCount:'8'},moneyRupees:{extraRoundPrice:'250'}}}) as any;
 let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;
 for(let stage=1;stage<=3;stage++){run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;if(stage<3){await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});run=(await engine.request('venture.delivery.list',{}) as any[])[0];}}
 const postId=run.id+'.post-1';const act=async(action:string)=>{const item=await engine.request('venture.desk.get',{playbook:'social-agency',kind:'revision',id:postId}) as any;return engine.request('venture.desk.act',{playbook:'social-agency',kind:'revision',id:postId,digest:item.digest,action,payload:{runId:run.id,postId,words:'Make it warmer.'}}) as Promise<any>;};
 for(let round=0;round<2;round++){await act('revise');run=(await engine.request('venture.delivery.list',{}) as any[]).find(r=>r.id===run.id);run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;}
 const quote=(await act('quote')).result;expect(quote.currency).toBe(currency);const receipt=await engine.request('venture.receipt.get',{id:quote.receiptId}) as any;expect(receipt.figures[0].display).toBe(quote.display);
 await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});const item=await engine.request('venture.desk.get',{playbook:'social-agency',kind:'revision',id:postId}) as any;
 await engine.request('venture.desk.act',{playbook:'social-agency',kind:'revision',id:postId,digest:item.digest,action:'client-answer',payload:{runId:run.id,postId,decision:'approved'}});
 await engine.request('venture.share.create',{deliveryId:run.id});await engine.request('venture.share.recordAnswer',{draftId:run.id,answer:'changes',comment:'Asha requests a warmer tone.'});
 const latest=await engine.request('venture.desk.get',{playbook:'social-agency',kind:'revision',id:postId}) as any;expect(latest.item.clientDecision).toBe('changes');
 await engine.request('venture.network.import',{kind:'vcard',name:'contact.vcf',text:'BEGIN:VCARD\nVERSION:3.0\nFN:Asha Rao\nEMAIL:asha@privacy.example\nEND:VCARD'});const people=await engine.request('venture.network.people',{query:'Asha Rao'}) as any;await engine.request('venture.network.forget',{id:people.people[0].id});
 const saved=(engine as any).posting.socialClientAnswer(run.id);expect(saved.answer.comment).toBe(null);expect(saved.answer.decision).toBe('changes');


});
