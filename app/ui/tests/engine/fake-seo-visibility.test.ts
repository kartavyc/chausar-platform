// SEO fake parity tests. Chausar's public panel desk contract; no external source copied.
import { describe, it, expect } from 'vitest';
import { fakeSeoVisibilityDesk } from '../../src/engine/fake-seo-visibility';
import type { W4DeskHost } from '../../src/engine/fake-w4';
const spec=()=>({questions:Array.from({length:15},(_,i)=>({id:`q${i}`,text:`Question ${i}`})),engines:['chatgpt'],timepoints:[{id:'before',from:'2026-10-27T00:00:00.000Z',to:'2026-10-28T00:00:00.000Z'}],repeats:2,minimumFilled:4});
function setup(){const host:W4DeskHost={current:()=> 'seo',now:()=> '2026-10-27T12:00:00.000Z',hosted:()=>false,emit:()=>{},rows:()=>[],setRows:()=>{},digest:value=>JSON.stringify(value),ask:()=>[]};const desk=fakeSeoVisibilityDesk(host).kinds.panel;if(!desk)throw new Error('The SEO panel desk is not built.');return desk;}
const request={playbook:'seo-visibility',kind:'panel'};
describe('SEO fake follows the persisted panel contract',()=>{
  it('creates and freezes the exact design, preserving missing slots',()=>{
    const desk=setup();expect(desk).toBeDefined();
    const made:any=desk.act!({...request,id:'new',action:'create',payload:{spec:spec(),orderId:null}});
    const view:any=desk.get!({...request,id:made.id});
    const approved:any=desk.act!({...request,id:made.id,action:'approve',payload:{},digest:view.digest});
    expect(approved.result.panel.state).toBe('approved');expect(approved.result.metrics.mentions).toEqual({numerator:0,denominator:30,missing:30});
    const next:any=desk.get!({...request,id:made.id});
    expect(()=>desk.act!({...request,id:made.id,action:'edit',payload:{spec:spec()},digest:next.digest})).toThrowError(expect.objectContaining({code:'PANEL_FROZEN'}));
  });
  it('refuses extra outer fields, malformed specs and missing screenshot records',()=>{
    const desk=setup();expect(desk).toBeDefined();
    expect(()=>desk.act!({...request,id:'new',action:'create',payload:{spec:spec(),orderId:null},extra:true})).toThrowError(expect.objectContaining({code:'INVALID_VENTURE_REQUEST'}));
    expect(()=>desk.act!({...request,id:'new',action:'create',payload:{spec:{...spec(),repeats:'2'},orderId:null}})).toThrowError(expect.objectContaining({code:'PANEL_INVALID'}));
    const made:any=desk.act!({...request,id:'new',action:'create',payload:{spec:spec(),orderId:null}});const view:any=desk.get!({...request,id:made.id});desk.act!({...request,id:made.id,action:'approve',payload:{},digest:view.digest});const approved:any=desk.get!({...request,id:made.id});
    expect(()=>desk.act!({...request,id:made.id,action:'observe',payload:{questionId:'q0',engine:'chatgpt',timepointId:'before',repeat:1,capturedAt:'2026-10-27T12:00:00.000Z',method:'owner-capture',screenshotFileId:'upload_missing',answer:'Saved answer',mentioned:true,fixture:false},digest:approved.digest})).toThrowError(expect.objectContaining({code:'PANEL_SCREENSHOT_REQUIRED'}));
  });
});

describe('SEO fake website-check approvals',()=>{
 it('persists the exact report hash and refuses scheduling before approval',()=>{
  const host:W4DeskHost={current:()=> 'seo',now:()=> '2026-10-27T12:00:00.000Z',hosted:()=>false,emit:()=>{},rows:()=>[],setRows:()=>{},digest:value=>JSON.stringify(value),ask:method=>method==='venture.routines.set'?{routine:{id:'routine_recheck'}}:[]};
  const desk=fakeSeoVisibilityDesk(host).kinds.website;if(!desk)throw new Error('The SEO website desk is not built.');expect(desk).toBeDefined();
  const report={url:'https://clinic.example/',runs:[390,1280].flatMap(width=>['light','dark'].map(colorScheme=>({viewport:{width,height:900},colorScheme}))),findings:[]};
  const base={playbook:'seo-visibility',kind:'website'};
  const made:any=desk.act!({...base,id:'new',action:'import',payload:{url:report.url,report}});let view:any=desk.get!({...base,id:made.id});
  expect(()=>desk.act!({...base,id:made.id,action:'schedule',payload:{},digest:view.digest})).toThrowError(expect.objectContaining({code:'APPROVAL_REQUIRED'}));
  desk.act!({...base,id:made.id,action:'approve',payload:{},digest:view.digest});view=desk.get!({...base,id:made.id});
  const scheduled:any=desk.act!({...base,id:made.id,action:'schedule',payload:{},digest:view.digest});expect(scheduled.result.recheck.state).toBe('active');expect(scheduled.result.recheck.latestReceipt).toBe(view.item.report.receipt);
 });
});


it('bounded monitors stay draft until exact approval and preserve plan bounds in the fake',()=>{
 const host:W4DeskHost={current:()=> 'seo',now:()=> '2026-10-27T12:00:00.000Z',hosted:()=>false,emit:()=>{},rows:()=>[],setRows:()=>{},digest:value=>JSON.stringify(value),ask:()=>[]};
 const desk=fakeSeoVisibilityDesk(host).kinds.monitor;expect(desk).toBeDefined();
 const base={playbook:'seo-visibility',kind:'monitor'};
 const payload={url:'https://clinic.example/',root:'C:\\Evidence\\Clinic',cycles:2,intervalSeconds:60};
 expect(()=>desk!.act!({...base,id:'new',action:'create',payload:{...payload,intervalSeconds:59}})).toThrowError(expect.objectContaining({code:'MONITOR_INVALID'}));
 const made:any=desk!.act!({...base,id:'new',action:'create',payload});expect(made.result.state).toBe('draft');expect(made.result.completed).toBe(0);
 const normalized:any=desk!.act!({...base,id:'new',action:'create',payload:{...payload,root:'C:/Evidence/../Clinic/'}});expect(normalized.result.root).toBe('C:\\Clinic');
 const view:any=desk!.get!({...base,id:made.id});
 expect(()=>desk!.act!({...base,id:made.id,action:'approve',payload:{},digest:'stale'})).toThrowError(expect.objectContaining({code:'MONITOR_STALE'}));
 const approved:any=desk!.act!({...base,id:made.id,action:'approve',payload:{},digest:view.digest});expect(approved.result.state).toBe('active');expect(approved.result.cycles).toBe(2);expect(approved.result.evidence).toEqual([]);
 const current:any=desk!.get!({...base,id:made.id});const stopped:any=desk!.act!({...base,id:made.id,action:'stop',payload:{},digest:current.digest});expect(stopped.result.state).toBe('stopped');
});
