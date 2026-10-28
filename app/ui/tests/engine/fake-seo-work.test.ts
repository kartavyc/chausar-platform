import {it,expect} from 'vitest';
import {fakeSeoVisibilityDesk} from '../../src/engine/fake-seo-visibility';
import type {W4DeskHost} from '../../src/engine/fake-w4';
it('fake search work binds order bytes, refuses stale approval and mirrors the real refresh plan',async()=>{
 let bytes=btoa('Query,Page,Clicks,Impressions,Position\nclinic,https://clinic.example/a,1,100,4');const orders=[{id:'order_one',clientId:'client_one',request:'Refresh our clinic.'}];
 const host={current:()=> 'business',now:()=> '2026-10-27T12:00:00.000Z',digest:(v:unknown)=>JSON.stringify(v),ask:(method:string)=>method==='venture.order.list'?orders:[],orderFiles:(id:string)=>id==='order_one'?[{id:'file_one',name:'search.csv',format:'csv',contentBase64:bytes,digest:bytes}]:[],emit:()=>{}} as unknown as W4DeskHost;
 const desk=fakeSeoVisibilityDesk(host).kinds.work!;const base={playbook:'seo-visibility',kind:'work'};
 const made=await desk.act!({...base,id:'new',action:'create',payload:{orderId:'order_one',operation:'refresh',uploadId:'file_one'}} as any) as any;
 expect(made.result.result.kind).toBe('plan-only');const view=await desk.get!({...base,id:made.id} as any) as any;
 await expect(desk.act!({...base,id:made.id,action:'approve',digest:'old',payload:{}} as any)).rejects.toMatchObject({code:'APPROVAL_STALE'});
 bytes=btoa('changed');await expect(desk.act!({...base,id:made.id,action:'approve',digest:view.digest,payload:{}} as any)).rejects.toMatchObject({code:'SEO_SOURCE_CHANGED'});
});
