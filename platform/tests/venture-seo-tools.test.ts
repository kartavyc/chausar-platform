// SEO tool results must include code-made count receipts, with no model calculation. Original Chausar tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SEO_VISIBILITY_TOOLS } from '../runtime/venture/delivery/harness/tools-seo-visibility.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { setup } from './venture-views-env.ts';
const resolve=async()=>[{address:'93.184.216.34',family:4 as const}];
test('diagnosis exposes its counts as a stored work receipt, including missing checks',async()=>{
  const env=await setup();
  const toolEnv:ToolEnv={deps:{...env.deps,net:{resolve,send:async target=>({status:target.url.pathname==='/sitemap.xml'?404:200,headers:{'content-type':'text/html'},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<html><title>Site</title><body><h1>Site</h1></body></html>')})}},ventureId:env.venture.id,memberId:'owner',epoch:1,currency:'INR',dateOrder:'day-month-year',runRef:{kind:'delivery',runId:'run_seo'},files:[],tables:[],receipts:[],dictionary:[],sandbox:undefined,now:()=>env.now(),allowed:[]};
  const output=await SEO_VISIBILITY_TOOLS['seo.diagnose'].run(toolEnv,{url:'https://clinic.example/'});
  assert.equal(output.receipts?.length,1,'the agent needs a real receipt for the computed counts');
  assert.equal(output.receipts?.[0].figures.find(figure=>figure.key==='planned')?.minor,'8');
  assert.equal(output.receipts?.[0].figures.find(figure=>figure.key==='observed')?.minor,'8');
  assert.ok(output.proofs?.some(proof=>proof.receiptId===output.receipts?.[0].id));
});

test('hosted website checks refuse the installed path before any network request', async () => {
  let fetched = false;
  const env = await setup();
  const toolEnv = { deps: { ...env.deps, host: 'hosted-web', net: { resolve, send: async () => { fetched = true; throw new Error('must not fetch'); } } } } as unknown as ToolEnv;
  await assert.rejects(() => SEO_VISIBILITY_TOOLS['seo.siteCheck'].run(toolEnv, { url: 'https://clinic.example/' }), { code: 'SITE_CHECK_DESKTOP_ONLY' });
  assert.equal(fetched, false);
});

test('answer-panel receipts use only the panel linked to this delivery order and business',async()=>{
 const {seedBlueprint,seedOrder,seedRun,owner}=await import('./venture-views-env.ts');
 const {SEO_VISIBILITY_DESK}=await import('../runtime/venture/playbooks/seo-visibility/desk.ts');
 const env=await setup();const blueprint=await seedBlueprint(env);const first=await seedOrder(env,blueprint);const second=await seedOrder(env,blueprint);const run=await seedRun(env,first.order,{});
 const handler=SEO_VISIBILITY_DESK.panel!;const base={playbook:'seo-visibility' as const,kind:'panel'};
 const spec={questions:Array.from({length:15},(_,i)=>({id:`q${i}`,text:`Buyer question ${i}`})),engines:['chatgpt'],timepoints:[{id:'before',from:'2026-10-27T00:00:00.000Z',to:'2026-10-28T00:00:00.000Z'}],repeats:2,minimumFilled:4};
 async function panel(orderId:string|null){const made:any=await handler.act!(env.deps,owner,{...base,id:'new',action:'create',payload:{spec,orderId}});const view:any=await handler.get!(env.deps,owner,{...base,id:made.id});await handler.act!(env.deps,owner,{...base,id:made.id,action:'approve',payload:{},digest:view.digest});return made.id;}
 const own=await panel(first.order.id),other=await panel(second.order.id),unlinked=await panel(null);
 const toolEnv:ToolEnv={deps:env.deps,ventureId:env.venture.id,memberId:'owner',epoch:1,currency:'INR',dateOrder:'day-month-year',runRef:{kind:'delivery',runId:run.id},files:[],tables:[],receipts:[],dictionary:[],sandbox:undefined,now:()=>env.now(),allowed:[]};
 const output=await SEO_VISIBILITY_TOOLS['seo.panel'].run(toolEnv,{panelId:own});assert.equal(output.receipts?.length,1);
 for(const panelId of [other,unlinked])await assert.rejects(()=>SEO_VISIBILITY_TOOLS['seo.panel'].run(toolEnv,{panelId}),{code:'PANEL_ORDER_REQUIRED'});
 await assert.rejects(()=>SEO_VISIBILITY_TOOLS['seo.panel'].run({...toolEnv,ventureId:'other-business'},{panelId:own}),{code:'PANEL_NOT_FOUND'});
});
