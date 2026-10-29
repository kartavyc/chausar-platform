import test from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction,currentVenture} from '../runtime/venture/records.ts';
import {VIRTUAL_ASSISTANT_TOOLS} from '../runtime/venture/delivery/harness/tools-virtual-assistant.ts';
import type {DeliveryRunRecord} from '../runtime/venture/contracts.ts';
import type {ToolEnv} from '../runtime/venture/delivery/harness/tools.ts';
test('va.brief reads only this run current approved room and cannot mutate, send or use another order',async()=>{
 const e=await kitBusiness(undefined,{idea:'A virtual assistant service'}),order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers[0]!.id,request:'Research venues',intake:{fields:{scope:'Research venues',deliverable:'A table',deadline:'2026-11-02',hoursBand:'Agreed monthly band'}}});
 const base={playbook:'virtual-assistant',kind:'room'},made=await e.call('venture.desk.act',{...base,id:order.id,action:'create',payload:{}}),get=()=>e.call('venture.desk.get',{...base,id:made.id}),act=async(action:string,payload:unknown)=>e.call('venture.desk.act',{...base,id:made.id,action,payload,digest:(await get()).digest});
 await act('request',{text:'Compare venues'});await act('draft',{requestId:(await get()).item.requests[0].id,fields:{scope:'Research venues',deliverable:'A table',deadline:'2026-11-02'}});
 const run=await ventureAction(e.deps,owner,'prepare','test.va-run',tx=>tx.put<DeliveryRunRecord>({...tx.base('venture-delivery-run'),orderId:order.id} as never));
 const env={deps:e.deps,ventureId:currentVenture(e.store.read())!.id,ctx:owner,runRef:{kind:'delivery',runId:run.id}} as unknown as ToolEnv;
 await assert.rejects(VIRTUAL_ASSISTANT_TOOLS['va.brief'].run(env,{}),{code:'APPROVAL_STALE'});
 await act('approve',{});const result=await VIRTUAL_ASSISTANT_TOOLS['va.brief'].run(env,{});assert.match(JSON.stringify(result),/Research venues/);assert.match(JSON.stringify(result),new RegExp(order.priceReceiptId));
 await assert.rejects(VIRTUAL_ASSISTANT_TOOLS['va.brief'].run(env,{orderId:'another'}),{code:'INVALID_VENTURE_REQUEST'});
 await act('draft',{requestId:(await get()).item.requests[0].id,fields:{scope:'Changed scope',deliverable:'A table',deadline:'2026-11-02'}});await assert.rejects(VIRTUAL_ASSISTANT_TOOLS['va.brief'].run(env,{}),{code:'APPROVAL_STALE'});
});
