// SEO desk persistence and owner route. GEOHub (AGPL ideas only); independent implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEO_VISIBILITY_DESK } from '../runtime/venture/playbooks/seo-visibility/desk.ts';
import { setup, owner, code } from './venture-views-env.ts';
import { ventureAction } from '../runtime/venture/records.ts';
const spec=()=>({questions:Array.from({length:15},(_,i)=>({id:`q${i}`,text:`Buyer question ${i}`})),engines:['chatgpt'],timepoints:[{id:'before',from:'2026-10-27T00:00:00.000Z',to:'2026-10-28T00:00:00.000Z'}],repeats:2,minimumFilled:4});
test('the owner creates and freezes a persisted panel; stale changes and agent approval are refused',async()=>{
  const env=await setup();
  await ventureAction(env.deps,owner,'prepare','seed.seo',tx=>tx.touch({idea:'SEO agency for clinics'}));
  const handler=SEO_VISIBILITY_DESK.panel;
  assert.ok(handler?.act&&handler.get&&handler.list,'the persisted panel desk must exist');
  const created:any=await handler.act(env.deps,owner,{playbook:'seo-visibility',kind:'panel',id:'new',action:'create',payload:{spec:spec(),orderId:null}});
  const id=created.id;
  const view:any=await handler.get(env.deps,owner,{playbook:'seo-visibility',kind:'panel',id});
  await assert.rejects(handler.act(env.deps,{...owner,channel:'agent' as never},{playbook:'seo-visibility',kind:'panel',id,action:'approve',payload:{},digest:view.digest}),code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(handler.act(env.deps,owner,{playbook:'seo-visibility',kind:'panel',id,action:'approve',payload:{},digest:'stale'}),code('PANEL_STALE'));
  await handler.act(env.deps,owner,{playbook:'seo-visibility',kind:'panel',id,action:'approve',payload:{},digest:view.digest});
  const frozen:any=await handler.get(env.deps,owner,{playbook:'seo-visibility',kind:'panel',id});
  assert.equal(frozen.item.panel.state,'approved');
  assert.equal(frozen.item.metrics.mentions.denominator,30);
  await assert.rejects(handler.act(env.deps,owner,{playbook:'seo-visibility',kind:'panel',id,action:'edit',payload:{spec:spec()},digest:frozen.digest}),code('PANEL_FROZEN'));
  assert.equal((await handler.list(env.deps,owner,{playbook:'seo-visibility',kind:'panel'})).rows.length,1);
});



test('website report approval persists its exact hash and an owner-approved recheck schedules the real checker',async()=>{
  const env=await setup();const handler=SEO_VISIBILITY_DESK.website;assert.ok(handler?.act&&handler.get,'the website-check desk must exist');
  const report={url:'https://clinic.example/',runs:[390,1280].flatMap(width=>['light','dark'].map(colorScheme=>({viewport:{width,height:900},colorScheme}))),findings:[]};
  const made:any=await handler.act(env.deps,owner,{playbook:'seo-visibility',kind:'website',id:'new',action:'import',payload:{url:report.url,report}});
  let view:any=await handler.get(env.deps,owner,{playbook:'seo-visibility',kind:'website',id:made.id});
  await assert.rejects(handler.act(env.deps,owner,{playbook:'seo-visibility',kind:'website',id:made.id,action:'schedule',payload:{},digest:view.digest}),code('APPROVAL_REQUIRED'));
  await handler.act(env.deps,owner,{playbook:'seo-visibility',kind:'website',id:made.id,action:'approve',payload:{},digest:view.digest});
  view=await handler.get(env.deps,owner,{playbook:'seo-visibility',kind:'website',id:made.id});
  const scheduled:any=await handler.act(env.deps,owner,{playbook:'seo-visibility',kind:'website',id:made.id,action:'schedule',payload:{},digest:view.digest});
  assert.equal(scheduled.result.recheck.state,'active');
  assert.equal(scheduled.result.recheck.latestReceipt,view.item.report.receipt);
  assert.equal(Date.parse(scheduled.result.recheck.nextAt)-Date.parse(env.now()),30*86400000);
});
