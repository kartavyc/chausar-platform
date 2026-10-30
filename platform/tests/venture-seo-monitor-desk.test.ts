// SEO bounded-monitor integration regression. beyondseo (MIT), original Chausar tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, owner, code } from './venture-views-env.ts';
import { SEO_VISIBILITY_DESK } from '../runtime/venture/playbooks/seo-visibility/desk.ts';
import { runSeoMonitorsDue } from '../runtime/venture/playbooks/seo-visibility/monitor-desk.ts';
const base = {playbook:'seo-visibility' as const,kind:'monitor'};
test('bounded monitoring requires exact owner approval then tick writes distinct evidence and stops at its bound',async()=>{
 const env=await setup(),root=await mkdtemp(join(tmpdir(),'chausar-seo-monitor-'));
 let calls=0;env.deps.net={resolve:async()=>[{address:'93.184.216.34',family:4}],send:async target=>{calls++;return {status:target.url.pathname==='/sitemap.xml'?404:200,headers:{'content-type':'text/html'},body:Buffer.from(target.url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<html><title>Clinic</title><h1>Care</h1><p>Clinic details</p></html>')};}};
 try{
 const handler=SEO_VISIBILITY_DESK.monitor;assert.ok(handler?.act&&handler.get);
 const created:any=await handler.act(env.deps,owner,{...base,id:'new',action:'create',payload:{url:'https://clinic.example/',root,cycles:2,intervalSeconds:60}});
 await runSeoMonitorsDue(env.deps,owner);assert.equal(calls,0);assert.deepEqual(await readdir(root),[]);
 let view:any=await handler.get(env.deps,owner,{...base,id:created.id});
 await assert.rejects(handler.act(env.deps,{...owner,channel:'agent' as never},{...base,id:created.id,action:'approve',payload:{},digest:view.digest}),code('APP_APPROVAL_REQUIRED'));
 await assert.rejects(handler.act(env.deps,owner,{...base,id:created.id,action:'approve',payload:{},digest:'old'}),code('MONITOR_STALE'));
 await handler.act(env.deps,owner,{...base,id:created.id,action:'approve',payload:{},digest:view.digest});
 await (await import('../runtime/venture/build/journal-sweep.ts')).sweepWholeJournal(env.deps,owner);view=await handler.get(env.deps,owner,{...base,id:created.id});
 assert.equal(view.item.completed,1);assert.equal(view.item.state,'active');const firstCalls=calls;
 const first=view.item.evidence[0];assert.equal(first.index,1);assert.ok(first.receipt);assert.equal(JSON.parse(await readFile(join(first.folder,'evidence.json'),'utf8')).receipt,first.receipt);
 await runSeoMonitorsDue(env.deps,owner);assert.equal(calls,firstCalls);
 env.advance(60000);await runSeoMonitorsDue(env.deps,owner);view=await handler.get(env.deps,owner,{...base,id:created.id});
 assert.equal(view.item.completed,2);assert.equal(view.item.state,'complete');assert.notEqual(view.item.evidence[0].folder,view.item.evidence[1].folder);
 const lastCalls=calls;env.advance(60000);await runSeoMonitorsDue(env.deps,owner);assert.equal(calls,lastCalls);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('used evidence is held and never overwritten or retried, and hosted cannot schedule local monitoring',async()=>{
 const env=await setup(),root=await mkdtemp(join(tmpdir(),'chausar-seo-monitor-'));
 try{
 const handler=SEO_VISIBILITY_DESK.monitor!;
 await assert.rejects(handler.act!({...env.deps,host:'hosted-web'},owner,{...base,id:'new',action:'create',payload:{url:'https://clinic.example/',root,cycles:1,intervalSeconds:60}}),code('MONITOR_DESKTOP_ONLY'));
 const made:any=await handler.act!(env.deps,owner,{...base,id:'new',action:'create',payload:{url:'https://clinic.example/',root,cycles:1,intervalSeconds:60}});
 const view:any=await handler.get!(env.deps,owner,{...base,id:made.id});
 await handler.act!(env.deps,owner,{...base,id:made.id,action:'approve',payload:{},digest:view.digest});
 await mkdir(join(root,'cycle-00001'));await writeFile(join(root,'cycle-00001','owner.txt'),'keep');
 await runSeoMonitorsDue(env.deps,owner);const held:any=await handler.get!(env.deps,owner,{...base,id:made.id});
 assert.equal(held.item.state,'held');assert.equal(held.item.error,'EVIDENCE_FOLDER_USED');assert.equal(await readFile(join(root,'cycle-00001','owner.txt'),'utf8'),'keep');
 await runSeoMonitorsDue(env.deps,owner);assert.equal((await handler.get!(env.deps,owner,{...base,id:made.id}) as any).digest,held.digest);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('owner stopping an in-flight cycle prevents later requests and evidence writes',async()=>{
 const env=await setup(),root=await mkdtemp(join(tmpdir(),'chausar-seo-stop-'));
 let unblock!:()=>void;const blocked=new Promise<void>(resolve=>{unblock=resolve;});let reached!:()=>void;const started=new Promise<void>(resolve=>{reached=resolve;});let calls=0;
 env.deps.net={resolve:async()=>[{address:'93.184.216.34',family:4}],send:async()=>{calls++;reached();await blocked;return {status:200,headers:{},body:Buffer.from('User-agent: *\nAllow: /')};}};
 try{
 const h=SEO_VISIBILITY_DESK.monitor!;const made:any=await h.act!(env.deps,owner,{...base,id:'new',action:'create',payload:{url:'https://clinic.example/',root,cycles:2,intervalSeconds:60}});
 let view:any=await h.get!(env.deps,owner,{...base,id:made.id});await h.act!(env.deps,owner,{...base,id:made.id,action:'approve',payload:{},digest:view.digest});
 const running=runSeoMonitorsDue(env.deps,owner);await started;
 await runSeoMonitorsDue(env.deps,owner);assert.equal(calls,1,'another tick must not duplicate the claimed cycle');
 view=await h.get!(env.deps,owner,{...base,id:made.id});await h.act!(env.deps,owner,{...base,id:made.id,action:'stop',payload:{},digest:view.digest});unblock();await running;
 const after:any=await h.get!(env.deps,owner,{...base,id:made.id});assert.equal(after.item.state,'stopped');assert.equal(after.item.completed,0);assert.equal(calls,1);assert.deepEqual(await readdir(join(root,'cycle-00001')),['.chausar-evidence']);
 }finally{unblock();await rm(root,{recursive:true,force:true});}
});

test('a persisted interrupted claim is held on restart, never silently recollected',async()=>{
 const {ventureAction}=await import('../runtime/venture/records.ts');
 const env=await setup(),root=await mkdtemp(join(tmpdir(),'chausar-seo-restart-'));let fetched=false;env.deps.net={resolve:async()=>{fetched=true;throw Error('must not collect');}};
 try{
 const h=SEO_VISIBILITY_DESK.monitor!;const made:any=await h.act!(env.deps,owner,{...base,id:'new',action:'create',payload:{url:'https://clinic.example/',root,cycles:2,intervalSeconds:60}});
 const view:any=await h.get!(env.deps,owner,{...base,id:made.id});await h.act!(env.deps,owner,{...base,id:made.id,action:'approve',payload:{},digest:view.digest});
 await ventureAction(env.deps,owner,'prepare','seed.interrupted-monitor',tx=>{const record=tx.find('venture-seo-finding',made.id)!;tx.replace({...record,monitor:{...record.monitor!,state:'collecting'}});});
 await runSeoMonitorsDue(env.deps,owner);const held:any=await h.get!(env.deps,owner,{...base,id:made.id});assert.equal(held.item.state,'held');assert.equal(held.item.error,'MONITOR_INTERRUPTED');assert.equal(fetched,false);assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
