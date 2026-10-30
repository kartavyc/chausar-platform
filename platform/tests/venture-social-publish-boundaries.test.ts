// Original Chausar final social boundaries: current brand rules and the judge's exact source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { business,owner } from './venture-judge-helpers.ts';
import { seedPostDraft,seedPostPlaybook,seedClientAnswer } from './venture-post-drafts.ts';
import { brandKitSetHandler } from '../runtime/venture/playbooks/kit/brand-kit.ts';
import { draftPostGate } from '../runtime/venture/build/posting.ts';
import { deliveryJudgeHandler } from '../runtime/venture/delivery/judge-run.ts';

test('current brand kit is checked on accepted posts even when their old checks passed',async()=>{
 const env=await business('social media agency');
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0].id,request:'A weekly post.'});
 const playbook=await seedPostPlaybook(env.deps,'social-agency');
 const run=await seedPostDraft(env.deps,['X: Our cheap yoga classes.'],{orderId:order.id,playbookId:playbook.id,playbookChecks:[{playbook:'social-agency',check:'words',outcome:'pass',detail:'Old rules passed.'}]});
 await seedClientAnswer(env.deps,run,'approved');
 assert.equal(draftPostGate(env.store.read(),{draftId:run.id,connectorId:'x'}).allowed,true);
 await brandKitSetHandler(env.deps,owner,{clientId:env.client.id,kit:{bannedWords:['cheap']}});
 const gate=draftPostGate(env.store.read(),{draftId:run.id,connectorId:'x'});
 assert.equal(gate.allowed,false);assert.ok(gate.reasons.some(reason=>reason.code==='POST_DRAFT_UNCHECKED'&&reason.line.includes('cheap')));
});
test('repurpose judge receives the bound source as evidence, independent of optional tool calls',async()=>{
 const env=await business('social media agency');
 const offer=env.offers.find(offer=>offer.playbookOffer==='repurpose-pack')!;
 const source='text\nWe teach yoga.\nWe use mats.\nWe practise breathing.\nWe learned to slow down.';
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:offer.id,request:'Repurpose the uploaded source.',intake:{fields:{channels:['linkedin','x','facebook']}},intakeFiles:{sourceFile:{name:'source.csv',contentBase64:Buffer.from(source).toString('base64')}}});
 const playbook=await seedPostPlaybook(env.deps,'social-agency');
 const run=await seedPostDraft(env.deps,['X: We teach yoga.'],{orderId:order.id,playbookId:playbook.id,status:'ready-for-review',verdict:null,playbookChecks:[{playbook:'social-agency',check:'source-faithful',outcome:'pass',detail:'The source matches.'}]});
 await deliveryJudgeHandler(env.deps,owner,{runId:run.id});
 const task=env.models.previewed.at(-1)!;
 assert.ok(JSON.stringify(task.input).includes('We learned to slow down.'));
 assert.ok(JSON.stringify(task.input).includes('Only this bound source'));
});
