import {priceAndAcceptPlan} from '../helpers/accepted-plan';
import {expect,it} from 'vitest';
import {FakeEngine} from '../../src/engine/fake';
import {FakeSocialChain} from '../../src/engine/fake-social-chain';
import type {WorkHost} from '../../src/engine/fake-work';
import type {OrderLite} from '../../src/engine/types';

it('fake social legal guard permits shadow rehearsal like the real engine',()=>{
 const order={id:'order',clientId:'client',offerId:'offer',request:'Rehearse a sponsored draft.',intake:{paidPromotion:true}} as OrderLite;
 const host={current:()=> 'workspace',now:()=> '2026-10-28T10:00:00Z',clients:()=>[{id:'client',countryCode:'IN'}],plan:()=>({playbook:{id:'social-agency'},blueprint:{offers:[{id:'offer',playbookOffer:'linkedin-ghostwriting'}]}}),ask:(method:string)=>method==='venture.get'?{venture:{country:{code:'IN'},launchStage:'shadow'}}:null} as unknown as WorkHost;
 const chain=new FakeSocialChain(host,{orders:()=>[order],deliveries:()=>[],files:()=>[],keep:()=>{},eraseFiles:()=>{},next:()=>{}});
 expect(chain.start(order,'run')).toMatchObject({status:'waiting-for-you'});
});
async function setup(key='content-calendar',postCount='8'){
 const engine=new FakeEngine({fresh:true,now:()=> '2026-10-27T10:00:00.000Z'});
 await engine.request('workspace.create',{name:'Social studio',pack:'services'});await engine.request('venture.create',{idea:'social media agency',countryCode:'IN'});
 for(const [questionId,answer] of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'monthly'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await engine.request('venture.interview.answer',{questionId,answer});
 const plan=await engine.request('venture.blueprint.draft',{useTemplate:true}) as any;const offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer===key);
 await priceAndAcceptPlan(engine,plan,'100');const client=await engine.request('venture.client.add',{name:'Studio',countryCode:'IN'}) as any;
 const make=async(clientId=client.id)=>await engine.request('venture.order.create',{clientId,offerId:offer.id,request:'Write useful studio guidance.',intake:key==='monthly-report'?{fields:{reportMonth:'2026-11'}}:key==='linkedin-ghostwriting'?{fields:{postCount},moneyRupees:{extraRoundPrice:'100'}}:{calendar:{month:'2026-11',channels:['linkedin'],postsPerChannel:1,weekdays:[1]}}}) as any;
 return {engine,client,make};
}
it('public fake approvals advance the pinned writing stages and reuse only the same client approved voice',async()=>{
 const {engine,make}=await setup();const order=await make();let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;
 expect(run.status).toBe('waiting-for-you');expect(run.chainStage).toBe(1);
 await expect(engine.request('venture.delivery.approve',{runId:run.id,digest:'wrong'})).rejects.toMatchObject({code:'INVALID_VENTURE_REQUEST'});
 run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;expect(run.renderedText).toContain('Demo');
 await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});
 expect((await engine.request('venture.order.chain',{orderId:order.id}) as any).stage).toBe(2);
 const next=(await engine.request('venture.delivery.list',{}) as any[]).find(r=>r.orderId===order.id&&r.chainStage===2)!;expect(next.preview.input.approvedClientVoice.text).toBe(run.renderedText);
 const repeat=await make();expect((await engine.request('venture.order.chain',{orderId:repeat.id}) as any).stage).toBe(1);expect((await engine.request('venture.delivery.run',{orderId:repeat.id}) as any).chainStage).toBe(2);
 const other=await engine.request('venture.client.add',{name:'Other Studio',countryCode:'IN'}) as any;expect((await engine.request('venture.delivery.run',{orderId:(await make(other.id)).id}) as any).chainStage).toBe(1);
 await engine.request('venture.brandKit.set',{clientId:order.clientId,kit:{voice:['Formal words.']}});expect((await engine.request('venture.delivery.run',{orderId:(await make()).id}) as any).chainStage).toBe(1);
});
it('fake reports require source exports and carry code-computed figures before one writing approval',async()=>{
 const {engine,make}=await setup('monthly-report');const order=await make();await expect(engine.request('venture.delivery.run',{orderId:order.id})).rejects.toMatchObject({code:'SOCIAL_EXPORTS_REQUIRED'});
 const csv='Post ID,Publish time,Views,Reach,Likes,Comments,Shares,Saves,Follows\np-one,11/02/2026,100,80,4,2,1,1,3';await engine.request('venture.files.add',{orderId:order.id,name:'instagram.csv',contentBase64:btoa(csv)});
 let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;expect(run.preview.input.report.receipts.find((r:any)=>r.key==='views').value).toBe('100');
 const chain=await engine.request('venture.order.chain',{orderId:order.id}) as any;expect(chain.prerequisites.map((p:any)=>p.state)).toEqual(['done','done']);
 run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});
 expect((await engine.request('venture.order.chain',{orderId:order.id}) as any).state).toBe('done');expect((await engine.request('venture.delivery.list',{}) as any[]).filter(r=>r.orderId===order.id)).toHaveLength(1);
});

it('Today opens the exact demo preview and Accept starts the next writing stage',async()=>{
 const {engine,make}=await setup();const order=await make();const waiting=await engine.request('venture.delivery.run',{orderId:order.id}) as any;
 const rows=async()=>((await engine.request('venture.queue.list',{scope:'current'}) as any).rows as any[]).filter(r=>r.id.startsWith('social-stage:'));
 let row=(await rows())[0];const view=await engine.request('venture.queue.view',{kind:'draft',id:waiting.id,opened:true}) as any;expect(JSON.stringify(view)).toContain('voice');
 expect(await engine.request('venture.queue.decide',{id:row.id,digest:row.digest,action:'approve',viewed:true})).toMatchObject({outcome:'done'});
 row=(await rows())[0];expect(JSON.stringify(await engine.request('venture.queue.view',{kind:'draft',id:waiting.id,opened:true}))).toContain('Demo voice sheet');
 await engine.request('venture.queue.decide',{id:row.id,digest:row.digest,action:'approve',viewed:true});expect((await engine.request('venture.order.chain',{orderId:order.id}) as any).stage).toBe(2);
});

it('changed report source refuses the old preview before demo draft creation',async()=>{const {engine,make}=await setup('monthly-report');const order=await make();const csv='Post ID,Publish time,Views,Reach,Likes,Comments,Shares,Saves,Follows\np-one,11/02/2026,100,80,4,2,1,1,3';await engine.request('venture.files.add',{orderId:order.id,name:'instagram.csv',contentBase64:btoa(csv)});const run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;await engine.request('venture.files.add',{orderId:order.id,name:'new.csv',contentBase64:btoa(csv)});await expect(engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest})).rejects.toMatchObject({code:'APPROVAL_STALE'});});

it('fake ghostwriting drafts keep selected pack count, five structures and checked Post plan',async()=>{for(const count of ['8','12']){const {engine,make}=await setup('linkedin-ghostwriting',count);const order=await make();let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;for(let stage=1;stage<=3;stage++){run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;if(stage<3){await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});run=(await engine.request('venture.delivery.list',{}) as any[])[0];}}expect(run.renderedText.match(/^LinkedIn:/gm)).toHaveLength(Number(count));expect(run.renderedText).toContain('## Post plan');expect(run.canAccept).toBe(true);expect(run.playbookChecks.filter((c:any)=>c.check.startsWith('ghostwriting-')).map((c:any)=>c.check)).toEqual(['ghostwriting-count','ghostwriting-structure']);await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:'LinkedIn: An incomplete replacement.'})).rejects.toMatchObject({code:'SOCIAL_POST_PLAN_INVALID'});await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'rejected',reason:'invented'})).rejects.toMatchObject({code:'INVALID_VENTURE_REQUEST'});}});
it('fake template report cannot bypass exports, and changed brand invalidates old preview',async()=>{const report=await setup('monthly-report');await expect(report.engine.request('venture.delivery.run',{orderId:(await report.make()).id,useTemplate:true})).rejects.toMatchObject({code:'NOT_BUILT_YET'});const {engine,make}=await setup();const order=await make();let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});const old=(await engine.request('venture.delivery.list',{}) as any[])[0];await engine.request('venture.brandKit.set',{clientId:order.clientId,kit:{voice:['Formal words.']}});await expect(engine.request('venture.delivery.approve',{runId:old.id,digest:old.preview.digest})).rejects.toMatchObject({code:'SOCIAL_VOICE_CHANGED'});expect((await engine.request('venture.delivery.run',{orderId:order.id}) as any).chainStage).toBe(1);});

it('fake Forget clears copied voice and personal report sources before they can be reused',async()=>{for(const key of ['content-calendar','monthly-report']){const {engine,make}=await setup(key);const order=await make();if(key==='monthly-report')await engine.request('venture.files.add',{orderId:order.id,name:'export.csv',contentBase64:btoa('Post ID,Publish time,Views,Reach,Likes,Comments,Shares,Saves,Follows\nAsha Rao,11/02/2026,100,80,4,2,1,1,3')});let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;if(key==='content-calendar'){run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;await engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:'Asha Rao teaches with warmth.'});}await engine.request('venture.network.import',{kind:'vcard',name:'contact.vcf',text:'BEGIN:VCARD\nVERSION:3.0\nFN:Asha Rao\nEMAIL:asha@privacy.example\nEND:VCARD'});const people=await engine.request('venture.network.people',{query:'Asha Rao'}) as any;await engine.request('venture.network.forget',{id:people.people[0].id});expect(JSON.stringify(await engine.request('venture.delivery.list',{}))).not.toContain('Asha Rao');if(key==='monthly-report'){expect(await engine.request('venture.files.list',{orderId:order.id})).toEqual([]);await expect(engine.request('venture.delivery.run',{orderId:order.id})).rejects.toMatchObject({code:'SOCIAL_EXPORTS_REQUIRED'});}else expect((await engine.request('venture.delivery.run',{orderId:order.id}) as any).chainStage).toBe(1);}});

it('fake exact edits cannot reuse an approved client hook inside seven days',async()=>{const {engine,make}=await setup();const first=await make();let run=await engine.request('venture.delivery.run',{orderId:first.id}) as any;for(let stage=1;stage<=3;stage++){run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});if(stage<3)run=(await engine.request('venture.delivery.list',{}) as any[])[0];}const prior=run.renderedText;const second=await make();run=await engine.request('venture.delivery.run',{orderId:second.id}) as any;expect(run.chainStage).toBe(2);run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});run=(await engine.request('venture.delivery.list',{}) as any[])[0];run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;expect(run.canAccept).toBe(true);await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:prior})).rejects.toMatchObject({code:'SOCIAL_POST_PLAN_INVALID'});await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});});

it('fake Forget preserves an unrelated name containing the forgotten name as a substring',async()=>{const {engine,make}=await setup();const order=await make();let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;await engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:'Natasha teaches with warmth.'});await engine.request('venture.network.import',{kind:'vcard',name:'contact.vcf',text:'BEGIN:VCARD\nVERSION:3.0\nFN:Asha Rao\nEMAIL:asha@privacy.example\nEND:VCARD'});const people=await engine.request('venture.network.people',{query:'Asha Rao'}) as any;await engine.request('venture.network.forget',{id:people.people[0].id});expect(JSON.stringify(await engine.request('venture.delivery.list',{}))).toContain('Natasha teaches');expect((await engine.request('venture.order.chain',{orderId:order.id}) as any).stage).toBe(2);});
it('fake accepts the same nested structure headings as the engine',async()=>{
 const {engine,make}=await setup('linkedin-ghostwriting');const order=await make();let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;
 for(let stage=1;stage<=3;stage++){run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;if(stage<3){await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});run=(await engine.request('venture.delivery.list',{}) as any[])[0];}}
 const edited=run.renderedText.replace('# Demo drafts','# Demo drafts\n\n## Drafts').replace(/^## Post (\d+)/gm,'### Post $1');
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:edited})).resolves.toMatchObject({status:'edited'});
});
it('fake refuses paid client social work before a preview while ordinary drafts remain available',async()=>{
 const {engine,client}=await setup('linkedin-ghostwriting');const plan=await engine.request('venture.blueprint.get',{}) as any;const offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer==='linkedin-ghostwriting');
 const order=await engine.request('venture.order.create',{clientId:client.id,offerId:offer.id,request:'Draft a sponsored client post.',intake:{paidPromotion:true,fields:{postCount:'8'},moneyRupees:{extraRoundPrice:'100'}}}) as any;
 await expect(engine.request('venture.delivery.run',{orderId:order.id})).rejects.toMatchObject({code:'RULE_UNCONFIRMED'});
 expect(await engine.request('venture.delivery.list',{})).toEqual([]);
});
it('fake repurpose review requires all selected channels and its newsletter blurb',async()=>{
 const {engine,client}=await setup('repurpose-pack');const plan=await engine.request('venture.blueprint.get',{}) as any;const offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer==='repurpose-pack');
 const order=await engine.request('venture.order.create',{clientId:client.id,offerId:offer.id,request:'Repurpose the client source.',intake:{fields:{channels:['linkedin','x','facebook']}},intakeFiles:{sourceFile:{name:'source.csv',contentBase64:btoa('text\nClaim: We teach breathing.\nStory: We learned from neighbours.\nMistake: We once rushed.\nQuote: Slow down and listen.')}}}) as any;
 let run=await engine.request('venture.delivery.run',{orderId:order.id}) as any;run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;
 await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});run=(await engine.request('venture.delivery.list',{}) as any[])[0];run=await engine.request('venture.delivery.approve',{runId:run.id,digest:run.preview.digest}) as any;
 expect(run.canAccept).toBe(true);expect(run.renderedText).toContain('## Newsletter blurb');
 await expect(engine.request('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:run.renderedText.split('## Newsletter blurb')[0]})).rejects.toMatchObject({code:'SOCIAL_POST_PLAN_INVALID'});
 await engine.request('venture.delivery.review',{runId:run.id,verdict:'accepted'});
});
