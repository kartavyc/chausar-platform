// Original Chausar live social slot and hook checks. Tests use trusted records, never agent-supplied history.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {runFlagshipChecks,type FlagshipCheckInput} from '../runtime/venture/playbooks/draft-checks.ts';
const draft=(plan:string[]=[])=>({title:'Useful posts',sections:[{heading:'Drafts',parts:[{kind:'text' as const,text:'LinkedIn: Practise slowly.',ref:''},{kind:'text' as const,text:'Facebook: Breathe calmly.',ref:''}]},{heading:'Post plan',parts:plan.map(text=>({kind:'text' as const,text,ref:''}))}],questionsForClient:[]});
const input=(plan:string[]=[],fields:Record<string,unknown>={})=>({flagship:'social-agency',offerKey:'community-replies',stageId:'drafts',servedBy:'model',deliverable:draft(plan),request:'Helpful replies.',intake:{rights:null,format:'long',aiVoice:false,aiPresenter:false,paidPromotion:false,cutFile:null,fields:{communityRules:'Be helpful.',communityPromotion:false,communityLinks:false,...fields}},files:[],receipts:[],known:[],mode:'client',today:'2026-10-27',dateOrder:'day-month-year'} as FlagshipCheckInput);
const plans=['Post 1 | Value | Goal: Teach breathing | Reader action: Try it | Hook: Question','Post 2 | Value | Goal: Teach patience | Reader action: Practise | Hook: Story'];
test('live social checks require exact metadata for every actual post even when no slots tool was called',async()=>{
 const checks=await runFlagshipChecks(input());
 assert.equal(checks.find(c=>c.check==='selling-share')?.outcome,'fail');
 assert.equal((await runFlagshipChecks(input(plans))).find(c=>c.check==='selling-share')?.outcome,'pass');
 for(const bad of [[plans[0]],[plans[0],plans[0]],[...plans,plans[0].replace('Post 1','Post 3')]])assert.equal((await runFlagshipChecks(input(bad))).find(c=>c.check==='selling-share')?.outcome,'fail');
});
test('selling share reads the owner cap and one goal/action per actual post; hook reuse within a pack fails',async()=>{
 const selling=plans.map(s=>s.replace('| Value |','| Sell |'));
 assert.equal((await runFlagshipChecks(input(selling))).find(c=>c.check==='selling-share')?.outcome,'fail');
 assert.equal((await runFlagshipChecks(input(selling,{sellingCap:'100'}))).find(c=>c.check==='selling-share')?.outcome,'pass');
 assert.equal((await runFlagshipChecks(input([plans[0].replace('Teach breathing','Teach breathing; Sell classes'),plans[1]]))).find(c=>c.check==='one-goal')?.outcome,'fail');
 assert.equal((await runFlagshipChecks(input([plans[0],plans[1].replace('Hook: Story','Hook: Question')]))).find(c=>c.check==='hook-variety')?.outcome,'fail');
});

import {ventureAction,listRecords,requireVenture,digest} from '../runtime/venture/records.ts';
import {renderDeliverable} from '../runtime/venture/delivery/deliverable.ts';
async function socialEnv(){return kitBusiness({now:new Date('2026-10-27T10:00:00Z')},{idea:'A content calendar service for shops'});}
async function ready(env:Awaited<ReturnType<typeof socialEnv>>,hook='Question',clientId=env.client.id,due?:string){
 const offer=env.offers.find(o=>o.playbookOffer==='community-replies')!;
 const order=await env.call('venture.order.create',{clientId,offerId:offer.id,request:'Helpful community posts.',intake:{fields:{communityRules:'Be helpful.',communityPromotion:false,communityLinks:false,...(due?{revisionDue:due}:{})}}});
 const waiting=await env.call('venture.delivery.run',{orderId:order.id});
 const delivered=draft([plans[0].replace('Hook: Question','Hook: '+hook),plans[1]]);
 await ventureAction(env.deps,owner,'prepare','test.social.ready',tx=>{
  const record=tx.find('venture-delivery-run',waiting.id)!;const own=tx.find('venture-order',order.id)!;
  tx.replace({...own,chainStage:2});
  tx.replace({...record,chainStage:2,status:'ready-for-review',servedBy:'owner',practice:false,deliverable:delivered,renderedText:renderDeliverable(delivered,[],tx.venture!.country),checks:[],playbookChecks:[],preview:null,callId:null});
 });return {order,run:waiting};
}
test('Accept stamps exact code-owned history, blocks cached concurrent reuse, and isolates clients',async()=>{
 const env=await socialEnv();const first=await ready(env);
 await env.call('venture.delivery.review',{runId:first.run.id,verdict:'accepted'});
 const own=listRecords(env.store.read(),'venture-order').find(o=>o.id===first.order.id)!;
 assert.equal(own.socialPostHistory?.length,2);
 assert.equal(own.socialPostHistory?.[0].textDigest,digest({channel:'linkedin',text:'Practise slowly.'}));
 const second=await ready(env);
 await assert.rejects(env.call('venture.delivery.review',{runId:second.run.id,verdict:'accepted'}),{code:'SOCIAL_POST_PLAN_INVALID'});
 const other=await env.call('venture.client.add',{name:'Another shop',countryCode:'IN'});
 const separate=await ready(env,'Question',other.id);
 await env.call('venture.delivery.review',{runId:separate.run.id,verdict:'accepted'});
 assert.equal(listRecords(env.store.read(),'venture-order').find(o=>o.id===separate.order.id)!.socialPostHistory?.length,2);
});
test('same post revision may keep its hook, but a changed post plan and missing metadata refuse at approval',async()=>{
 const env=await socialEnv();const first=await ready(env);await env.call('venture.delivery.review',{runId:first.run.id,verdict:'accepted'});
 await ventureAction(env.deps,owner,'prepare','test.social.reopen',tx=>{const run=tx.find('venture-delivery-run',first.run.id)!;tx.replace({...run,status:'ready-for-review'});});
 await env.call('venture.delivery.review',{runId:first.run.id,verdict:'accepted'});
 await ventureAction(env.deps,owner,'prepare','test.social.reopen',tx=>{const run=tx.find('venture-delivery-run',first.run.id)!;tx.replace({...run,status:'ready-for-review'});});
 await assert.rejects(env.call('venture.delivery.review',{runId:first.run.id,verdict:'edited',editedText:'LinkedIn: A changed post without its plan.'}),{code:'SOCIAL_POST_PLAN_INVALID'});
});
test('monthly revision due dates appear in the real Today queue and disappear when delivered',async()=>{
 const env=await socialEnv();const current=await ready(env,'Question',env.client.id,'2026-10-27');
 const future=await ready(env,'Contrast',env.client.id,'2026-10-28');
 const queue=await env.call('venture.queue.list',{});
 const rows=queue.rows.filter((row:any)=>row.id.includes('social-revision:'));
 assert.equal(rows.length,1);assert.ok(rows[0].notice.link.includes(current.order.id));assert.equal(rows[0].actions[0].id,'open');assert.ok(!rows.some((r:any)=>r.notice.link.includes(future.order.id)));
 await env.call('venture.order.deliver',{orderId:current.order.id,deliveredOn:'2026-10-27'});
 assert.equal((await env.call('venture.queue.list',{})).rows.filter((r:any)=>r.id.includes('social-revision:')).length,0);
});

import {postPlanLines,readPostPlan} from '../runtime/venture/playbooks/social/post-plan.ts';
test('rendered metadata is scoped to its section and malformed rows are not hidden',()=>{
 const text='# Drafts\n\n## Post 1 | Story\nLinkedIn: Practise slowly.\n\n## POST PLAN\n'+plans.join('\n')+'\n\n## Notes\nPost 3 | not metadata';
 assert.deepEqual(postPlanLines(text),plans);
 assert.throws(()=>readPostPlan(postPlanLines(text.replace(plans[1],'malformed row')),['post-1','post-2']),{code:'SOCIAL_POST_PLAN_INVALID'});
});

test('calendar slot plans count actual Drafts posts, not channel-labelled alt text',async()=>{
 const value=input(plans);value.intake!.calendar={month:'2026-10',channels:['linkedin','facebook'],postsPerChannel:1,weekdays:[1,2,3,4,5]};
 value.deliverable.sections.push({heading:'Alt text',parts:[{kind:'text',text:'Instagram: A person practising.'}]});
 assert.equal((await runFlagshipChecks(value)).find(c=>c.check==='selling-share')?.outcome,'pass');
});

import {HOOK_FORMULAS} from '../runtime/venture/playbooks/social/post-plan.ts';
test('calendar hook windows allow spaced repeats in a pack over sixteen posts but refuse repeats within seven days',async()=>{
 const metadata=Array.from({length:18},(_,i)=>'Post '+(i+1)+' | Value | Goal: Teach | Reader action: Try | Hook: '+HOOK_FORMULAS[i%16]);
 const value=input(metadata);value.intake!.calendar={month:'2026-11',channels:['linkedin','facebook'],postsPerChannel:9,weekdays:[1,2,3,4,5,6,7]};
 value.deliverable.sections[0].parts=Array.from({length:18},(_,i)=>({kind:'text' as const,text:(i<9?'LinkedIn':'Facebook')+': Practise patiently.'}));
 assert.equal((await runFlagshipChecks(value)).find(c=>c.check==='hook-variety')?.outcome,'pass');
 (value.deliverable.sections[1].parts[1] as {kind:'text';text:string}).text=metadata[1].replace('Contrast','Question');
 assert.equal((await runFlagshipChecks(value)).find(c=>c.check==='hook-variety')?.outcome,'fail');
});

test('two simultaneous approvals cannot both stamp the same client hook; seven days later it is available',async()=>{
 const env=await socialEnv();const first=await ready(env);const second=await ready(env);
 const results=await Promise.allSettled([first,second].map(item=>env.call('venture.delivery.review',{runId:item.run.id,verdict:'accepted'})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.code==='SOCIAL_POST_PLAN_INVALID').length,1);
 env.clock.now=new Date('2026-11-03T10:00:00Z');
 const next=await ready(env);await env.call('venture.delivery.review',{runId:next.run.id,verdict:'accepted'});
 assert.equal(listRecords(env.store.read(),'venture-order').filter(order=>order.id!==next.order.id).flatMap(order=>order.socialPostHistory??[]).length,0);
});

import {postsOfText} from '../runtime/venture/playbooks/social/run-approvals.ts';
import {canvasPosts} from '../runtime/venture/playbooks/social/canvas.ts';
import {socialDraftPosts} from '../runtime/venture/playbooks/social/draft-posts.ts';
import {draftPostLines} from '../runtime/venture/build/posting.ts';
test('alt text before Drafts cannot shift actual post ids across checks, approval, canvas and posting',async()=>{
 const env=await socialEnv();const first=await ready(env);const value=draft(plans);
 value.sections.unshift({heading:'Alt text',parts:[{kind:'text',text:'LinkedIn: A calm scene.',ref:''}]});
 const text=renderDeliverable(value,[],requireVenture(env.store.read()).country);
 assert.deepEqual(postsOfText(first.run.id,text).map(post=>post.n),[1,2]);
 assert.deepEqual(socialDraftPosts(value).map(post=>post.id),['post-1','post-2']);
 assert.deepEqual(draftPostLines(text,'linkedin'),['Practise slowly.']);
 const canvas=canvasPosts(first.run.id,text);assert.equal(canvas.length,2);assert.equal(canvas[0].plan?.goals[0],'Teach breathing');
 await ventureAction(env.deps,owner,'prepare','test.social.reordered',tx=>{const run=tx.find('venture-delivery-run',first.run.id)!;tx.replace({...run,deliverable:value,renderedText:text});});
 await env.call('venture.delivery.review',{runId:first.run.id,verdict:'accepted'});
 const view=await env.call('venture.desk.get',{playbook:'social-agency',kind:'canvas',id:first.order.id});
 const actual=view.item.cards.flatMap((card:any)=>card.posts);assert.equal(actual.length,2);assert.ok(actual.some((post:any)=>post.id===first.run.id+'.post-1'&&post.plan.goals[0]==='Teach breathing'));
});

import {actualSocialPosts} from '../runtime/venture/playbooks/social/post-label.ts';
test('nested editorial headings keep posts inside Drafts while explicit companion subsections stay excluded',async()=>{
 const text='## Drafts\n### A practical tip\nLinkedIn: Practise slowly.\n### Alt text\nX: Companion only.\n## Alt text\nFacebook: Companion only.';
 assert.deepEqual(actualSocialPosts(text).map(post=>({id:post.id,text:post.text})),[{id:'post-1',text:'Practise slowly.'}]);
 const value=input([plans[0]]);value.deliverable.sections[0].parts=[{kind:'text',text:'### A practical tip\nLinkedIn: Practise slowly.\n### Alt text\nX: Companion only.'}];
 assert.equal((await runFlagshipChecks(value)).find(c=>c.check==='selling-share')?.outcome,'pass');
});
