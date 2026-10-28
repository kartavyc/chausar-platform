// Website checks and bounded cycles. lintapple and beyondseo (MIT), public contracts only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteCheck, approveWebsiteCheck, scheduleWebsiteRecheck } from '../runtime/venture/playbooks/seo-visibility/site-check.ts';
import { monitorPlan, runMonitorCycle } from '../runtime/venture/playbooks/seo-visibility/monitor-cycles.ts';
const code=(wanted:string)=>(error:any)=>error.code===wanted;
const report={url:'https://clinic.example/',runs:[390,1280].flatMap(width=>['light','dark'].map(colorScheme=>({viewport:{width,height:900},colorScheme}))),findings:[{rule:'font-size',selector:'h1',message:'Too small',actual:'10px',expected:'12px',fix:'Increase the heading size.',viewport:{width:390,height:900},colorScheme:'light'}]};
test('website findings retain the report receipt, approval and recurring floor', async()=> {
  const checked=await websiteCheck('https://clinic.example/',{async run(){return report;}});
  assert.match(checked.receipt,/^[a-f0-9]{64}$/);
  assert.equal(checked.findings[0].measured,'10px');
  assert.throws(()=>approveWebsiteCheck(checked,'wrong'),code('SITE_CHECK_STALE'));
  const approved=approveWebsiteCheck(checked,checked.receipt);
  assert.equal(approved.approved,true);
  assert.throws(()=>scheduleWebsiteRecheck(approved,false),code('APPROVAL_REQUIRED'));
  assert.equal(scheduleWebsiteRecheck(approved,true).previousReceipt,checked.receipt);
});
test('monitor cycles have bounded counts and timing and refuse reused evidence',async()=> {
  assert.throws(()=>monitorPlan({cycles:10001,intervalSeconds:60}),code('MONITOR_INVALID'));
  assert.throws(()=>monitorPlan({cycles:2,intervalSeconds:59}),code('MONITOR_INVALID'));
  const plan=monitorPlan({cycles:2,intervalSeconds:60});
  const used=new Set<string>(); let reads=0;
  const port={async claim(folder:string){if(used.has(folder))return false;used.add(folder);return true;},async collect(folder:string){reads++;return {folder};}};
  const first=await runMonitorCycle(plan,{index:0,nowMs:0,lastAtMs:null,root:'evidence'},port);
  assert.equal(first.nextAtMs,60000);
  await assert.rejects(runMonitorCycle(plan,{index:1,nowMs:59000,lastAtMs:0,root:'evidence'},port),code('MONITOR_TOO_SOON'));
  await assert.rejects(runMonitorCycle(plan,{index:0,nowMs:60000,lastAtMs:0,root:'evidence'},port),code('EVIDENCE_FOLDER_USED'));
  assert.equal(reads,1);
});

test('monitor plans allow long intervals as well as minute-scale checks',()=>{
  assert.deepEqual(monitorPlan({cycles:10000,intervalSeconds:172800}),{cycles:10000,intervalSeconds:172800});
});

test('installed-checker browser requests use the guard and refuse writes or private subresources',async()=>{
 const {websiteBrowserRead}=await import('../runtime/venture/playbooks/seo-visibility/site-check.ts');let sends=0;
 const net={resolve:async()=>[{address:'93.184.216.34',family:4 as const}],send:async()=>{sends++;return{status:200,headers:{},body:Buffer.from('User-agent: *\nAllow: /')};}};
 await assert.rejects(websiteBrowserRead('https://clinic.example/form','POST',net),code('SITE_CHECK_WRITE_REFUSED'));
 await assert.rejects(websiteBrowserRead('http://127.0.0.1/secret','GET',net),code('NET_ADDRESS_REFUSED'));
 assert.equal(sends,0);
 const result=await websiteBrowserRead('https://clinic.example/style.css','GET',net);assert.equal(result.status,200);assert.ok(sends>=2);
});
