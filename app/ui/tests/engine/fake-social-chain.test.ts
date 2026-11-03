import {priceAndAcceptPlan} from '../helpers/accepted-plan';
import {expect,it} from 'vitest';
import {FakeEngine} from '../../src/engine/fake';
import {FakeSocialChain} from '../../src/engine/fake-social-chain';
import type {WorkHost} from '../../src/engine/fake-work';
import type {OrderLite} from '../../src/engine/types';import {completedSocialFixture,socialReviewFixture} from '../helpers/completed-social';
it('fake social legal guard permits shadow rehearsal like the real engine',()=>{
 const order={id:'order',clientId:'client',offerId:'offer',request:'Rehearse a sponsored draft.',intake:{paidPromotion:true}} as OrderLite;
 const host={current:()=> 'workspace',now:()=> '2026-10-28T10:00:00Z',clients:()=>[{id:'client',countryCode:'IN'}],plan:()=>({playbook:{id:'social-agency'},blueprint:{offers:[{id:'offer',playbookOffer:'linkedin-ghostwriting'}]}}),ask:(method:string)=>method==='venture.get'?{venture:{country:{code:'IN'},launchStage:'shadow'}}:null} as unknown as WorkHost;
 const chain=new FakeSocialChain(host,{orders:()=>[order],deliveries:()=>[],files:()=>[],keep:()=>{},eraseFiles:()=>{},next:()=>{}});
 expect(()=>chain.preflight(order)).not.toThrow();
});
async function setup(key='content-calendar',postCount='8'){
 const engine=new FakeEngine({fresh:true,now:()=> '2026-10-27T10:00:00.000Z'});
 await engine.request('workspace.create',{name:'Social studio',pack:'services'});await engine.request('venture.create',{idea:'social media agency',countryCode:'IN'});
 for(const [questionId,answer] of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'monthly'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await engine.request('venture.interview.answer',{questionId,answer});
 const plan=await engine.request('venture.blueprint.draft',{useTemplate:true}) as any;const offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer===key);
 await priceAndAcceptPlan(engine,plan,'100');const client=await engine.request('venture.client.add',{name:'Studio',countryCode:'IN'}) as any;
 const make=async(clientId=client.id)=>await engine.request('venture.order.create',{clientId,offerId:offer.id,request:'Write useful studio guidance.',intake:key==='monthly-report'?{fields:{reportMonth:'2026-11'}}:key==='linkedin-ghostwriting'?{fields:{postCount},moneyAmounts:{extraRoundPrice:'100'}}:{calendar:{month:'2026-11',channels:['linkedin'],postsPerChannel:1,weekdays:[1]}}}) as any;
 return {engine,client,make};
}
it('report preflight retains code-computed exports and refuses missing or changed duplicate sources',async()=>{
 const {engine,make}=await setup('monthly-report');const order=await make();const chain=(engine as any).work.socialChain;
 expect(()=>chain.preflight(order)).toThrowError(expect.objectContaining({code:'SOCIAL_EXPORTS_REQUIRED'}));
 const csv='Post ID,Publish time,Views,Reach,Likes,Comments,Shares,Saves,Follows\np-one,11/02/2026,100,80,4,2,1,1,3';
 await engine.request('venture.files.add',{orderId:order.id,name:'instagram.csv',contentBase64:btoa(csv)});
 expect(chain.report(order).receipts.find((r:any)=>r.key==='views').value).toBe('100');
 await engine.request('venture.files.add',{orderId:order.id,name:'second.csv',contentBase64:btoa(csv)});
 expect(()=>chain.preflight(order)).toThrowError(expect.objectContaining({code:'TOOL_FAILED'}));
});
it.each(['8','12'])('final review checks the selected %s post count and structures without inventing a model run',async count=>{
 const {engine,make}=await setup('linkedin-ghostwriting',count),order=await make();const run=socialReviewFixture(engine,order);
 expect(run.renderedText!.match(/^LinkedIn:/gm)).toHaveLength(Number(count));
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:'LinkedIn: An incomplete replacement.'})).rejects.toMatchObject({code:'SOCIAL_POST_PLAN_INVALID'});
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'rejected',reason:'invented'})).rejects.toMatchObject({code:'INVALID_VENTURE_REQUEST'});
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'})).resolves.toMatchObject({status:'accepted'});
});
it('changed brand invalidates the exact final draft',async()=>{
 const {engine,make}=await setup(),order=await make(),run=socialReviewFixture(engine,order);
 await engine.request('venture.brandKit.set',{clientId:order.clientId,kit:{voice:['Formal words.']}});
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'})).rejects.toMatchObject({code:'SOCIAL_VOICE_CHANGED'});
});
it('exact final edits cannot reuse an approved client hook inside seven days',async()=>{
 const {engine,make}=await setup(),first=await make(),run=socialReviewFixture(engine,first);
 await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});
 const second=await make(),next=socialReviewFixture(engine,second,1);
 await expect(engine.request('venture.delivery.review',{runId:next.id,verdict:'edited',editedText:run.renderedText})).rejects.toMatchObject({code:'SOCIAL_POST_PLAN_INVALID'});
 await expect(engine.request('venture.delivery.review',{runId:next.id,verdict:'accepted'})).resolves.toMatchObject({status:'accepted'});
});
it('final review accepts the same nested headings as the engine',async()=>{
 const {engine,make}=await setup('linkedin-ghostwriting'),run=socialReviewFixture(engine,await make());
 const edited=run.renderedText!.replace('# Fixture drafts','# Fixture drafts\n\n## Drafts').replace(/^## Post (\d+)/gm,'### Post $1');
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:edited})).resolves.toMatchObject({status:'edited'});
});
it('paid social client work remains held before any model job',async()=>{
 const {engine,client}=await setup('linkedin-ghostwriting'),plan=await engine.request('venture.blueprint.get',{}) as any,offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer==='linkedin-ghostwriting');
 const order=await engine.request('venture.order.create',{clientId:client.id,offerId:offer.id,request:'Draft a sponsored client post.',intake:{paidPromotion:true,fields:{postCount:'8'},moneyAmounts:{extraRoundPrice:'100'}}}) as any;
 await expect(engine.request('venture.delivery.run',{orderId:order.id})).rejects.toMatchObject({code:'RULE_UNCONFIRMED'});
 expect(await engine.request('venture.delivery.list',{})).toEqual([]);
});
it('repurpose final review requires every selected channel and newsletter blurb',async()=>{
 const {engine,client}=await setup('repurpose-pack'),plan=await engine.request('venture.blueprint.get',{}) as any,offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer==='repurpose-pack');
 const order=await engine.request('venture.order.create',{clientId:client.id,offerId:offer.id,request:'Repurpose the client source.',intake:{fields:{channels:['linkedin','x','facebook']}},intakeFiles:{sourceFile:{name:'source.csv',contentBase64:btoa('text\nClaim: We teach breathing.\nStory: We learned from neighbours.\nMistake: We once rushed.\nQuote: Slow down and listen.')}}}) as any;
 const run=socialReviewFixture(engine,order);
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:run.renderedText!.split('## Newsletter blurb')[0]})).rejects.toMatchObject({code:'SOCIAL_POST_PLAN_INVALID'});
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'})).resolves.toMatchObject({status:'accepted'});
});
it.each(['content-calendar','monthly-report'])('Forget clears named %s drafts and source files',async key=>{
 const {engine,make}=await setup(key),order=await make(),chain=(engine as any).work.socialChain;
 if(key==='monthly-report')await engine.request('venture.files.add',{orderId:order.id,name:'export.csv',contentBase64:btoa('Post ID,Publish time,Views,Reach,Likes,Comments,Shares,Saves,Follows\nAsha Rao,11/02/2026,100,80,4,2,1,1,3')});
 chain.preflight(order);completedSocialFixture(engine,order,{text:'Asha Rao teaches with warmth.'});
 await engine.request('venture.network.import',{kind:'vcard',name:'contact.vcf',text:'BEGIN:VCARD\nVERSION:3.0\nFN:Asha Rao\nEMAIL:asha@privacy.example\nEND:VCARD'});
 const people=await engine.request('venture.network.people',{query:'Asha Rao'}) as any;await engine.request('venture.network.forget',{id:people.people[0].id});
 expect(JSON.stringify(await engine.request('venture.delivery.list',{}))).not.toContain('Asha Rao');
 if(key==='monthly-report'){expect(await engine.request('venture.files.list',{orderId:order.id})).toEqual([]);expect(()=>chain.preflight(order)).toThrowError(expect.objectContaining({code:'SOCIAL_EXPORTS_REQUIRED'}));}
});
it('Forget preserves an unrelated name containing the forgotten name as a substring',async()=>{
 const {engine,make}=await setup(),order=await make();(engine as any).work.socialChain.preflight(order);
 completedSocialFixture(engine,order,{text:'Natasha teaches with warmth.'});
 await engine.request('venture.network.import',{kind:'vcard',name:'contact.vcf',text:'BEGIN:VCARD\nVERSION:3.0\nFN:Asha Rao\nEMAIL:asha@privacy.example\nEND:VCARD'});
 const people=await engine.request('venture.network.people',{query:'Asha Rao'}) as any;await engine.request('venture.network.forget',{id:people.people[0].id});
 expect(JSON.stringify(await engine.request('venture.delivery.list',{}))).toContain('Natasha teaches');
});
