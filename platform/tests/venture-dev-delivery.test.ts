// Real kit delivery: a code report cannot be replaced by a generic draft or reused after source revision.
import test from 'node:test';
import assert from 'node:assert/strict';
import hi from '../runtime/venture/playbooks/dev-agency/hi.json' with {type:'json'};
import {DEV_DATA} from '../runtime/venture/playbooks/dev-agency/definition-data.ts';
import {definePlaybook} from '../runtime/venture/playbooks/kit/define.ts';
import {installTestPlaybooks} from '../runtime/venture/playbooks/kit/installed.ts';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction,listRecords} from '../runtime/venture/records.ts';
test('developer delivery requires reviewed current evidence, makes no model request, and refuses stale or rewritten acceptance',async()=>{
 const undo=installTestPlaybooks([{definition:definePlaybook(DEV_DATA,hi),hi}]);try{
 const e=await kitBusiness(undefined,{idea:'A code review service'}),offer=e.offers.find(o=>o.playbookOffer==='qa-service')!;
 const source=JSON.stringify({repository:'client/shop',revision:'a'.repeat(40),files:[{path:'app.ts',content:'export const enabled = true;'}]});
 const order=await e.call('venture.order.create',{clientId:e.client.id,offerId:offer.id,request:'Review the copied source',intake:{fields:{startedAt:'2026-10-20',private:false}},intakeFiles:{source:{name:'source.txt',contentBase64:Buffer.from(source).toString('base64')}}});
 await assert.rejects(e.call('venture.delivery.run',{orderId:order.id}),{code:'DEV_PROJECT_NOT_FOUND'});
 const file=listRecords(e.store.read(),'venture-upload').find(f=>(f.scope.kind==='order')&&f.scope.orderId===order.id)!;
 const base={playbook:'dev-agency',kind:'project'},made=await e.call('venture.desk.act',{...base,id:order.id,action:'prepare',payload:{fileId:file.id,startedAt:'2026-10-20T00:00:00.000Z'}});
 const act=async(action:string,payload:unknown)=>e.call('venture.desk.act',{...base,id:made.id,action,payload,digest:(await e.call('venture.desk.get',{...base,id:made.id})).digest});
 await assert.rejects(e.call('venture.delivery.run',{orderId:order.id}),{code:'DEV_REVIEW_REQUIRED'});
 await act('read',{path:'app.ts',first:1,last:1});await act('confirm-review',{confirmed:true});
 const before=e.models.previewed.length,run=await e.call('venture.delivery.run',{orderId:order.id});
 assert.equal(e.models.previewed.length,before);assert.equal(run.status,'ready-for-review');assert.equal(run.canAccept,true,JSON.stringify(run.checks));assert.equal(run.playbookChecks.find((r:any)=>r.check==='dev-source').outcome,'pass');assert.match(run.renderedText,/Verdict: Ship/);
 await assert.rejects(e.call('venture.delivery.review',{runId:run.id,verdict:'edited',editedText:'This client system is safe.'}),{code:'DERIVED_STALE'});
 await ventureAction(e.deps,owner,'approve','test.source-change',tx=>tx.replace({...tx.find('venture-upload',file.id)!,contentBase64:Buffer.from('changed').toString('base64')}));
 await assert.rejects(e.call('venture.delivery.review',{runId:run.id,verdict:'accepted'}),{code:'DERIVED_STALE'});
 }finally{undo();}
});
