import {expect,it} from 'vitest';
import {FakeEngine} from '../../src/engine/fake';
it.each([[false,'IN'],[true,'IN'],[false,'US']] as const)('public fake Today derives monthly notices without exposing locked workspaces (%s, %s)',async(locked,countryCode)=>{
 let now=countryCode==='US'?'2026-10-27T03:30:00Z':'2026-10-26T18:00:00Z';const engine=new FakeEngine({fresh:true,now:()=>now});
 const first=await engine.request('workspace.create',{name:'Social studio',pack:'services',...(locked?{passphrase:'a-long-test-passphrase'}:{})}) as any;await engine.request('venture.create',{idea:'social media agency',countryCode});
 for(const [questionId,answer] of [['q_1',{skipped:true}],['q_pricing_model',{choiceId:'monthly'}],['q_price',{skipped:true}],['q_tax',{yes:false}]] as const)await engine.request('venture.interview.answer',{questionId,answer});
 const plan=await engine.request('venture.blueprint.draft',{useTemplate:true}) as any;const offer=plan.blueprint.offers.find((o:any)=>o.playbookOffer==='content-calendar');await engine.request('venture.blueprint.update',{patch:{offers:[{id:offer.id,unitPrice:'100'}]}});
 const client=await engine.request('venture.client.add',{name:'Studio',countryCode:'IN'}) as any;
 const order=await engine.request('venture.order.create',{clientId:client.id,offerId:offer.id,request:'Write useful studio guidance.',intake:{fields:{revisionDue:'2026-10-27'},calendar:{month:'2026-11',channels:['linkedin'],postsPerChannel:1,weekdays:[1]}}}) as any;
 const rows=async()=>((await engine.request('venture.queue.list',{scope:'current'})) as any).rows.filter((r:any)=>r.id.startsWith('social-revision:'));
 expect(await rows()).toHaveLength(0);await engine.request('workspace.lock',{});await engine.request('workspace.create',{name:'Other studio',pack:'services'});now=countryCode==='US'?'2026-10-27T04:30:00Z':'2026-10-26T19:00:00Z';const all=await engine.request('venture.queue.list',{scope:'all'}) as any;expect(all.rows.filter((r:any)=>r.id.startsWith('social-revision:'))).toHaveLength(locked?0:1);expect(await rows()).toHaveLength(0);await engine.request('workspace.open',{folder:first.folder,...(locked?{passphrase:'a-long-test-passphrase'}:{})});let due=await rows();expect(due).toHaveLength(1);expect(due[0].notice.link).toBe('#/work?socialOrder='+order.id);expect(due[0].actions.map((a:any)=>a.id)).toEqual(['open','later']);
 const opened=await engine.request('venture.queue.decide',{id:due[0].id,digest:due[0].digest,action:'open'});expect(opened).toMatchObject({outcome:'refused',reason:'NOT_A_DECISION',line:'Open Work to review the social revisions.'});expect(await rows()).toHaveLength(1);
 await engine.request('venture.order.deliver',{orderId:order.id,deliveredOn:'2026-10-27'});expect(await rows()).toHaveLength(0);
});
