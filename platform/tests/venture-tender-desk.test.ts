// Real public desk approval and source-erasure fences, no portal or network stand-ins.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,owner,phone,seedBlueprint,seedOrder,seedRun} from './venture-views-env.ts';
import {ventureAction,listRecords,digest} from '../runtime/venture/records.ts';
import {TENDER_DESK_DESK} from '../runtime/venture/playbooks/tender-desk/desk.ts';
import {net,personNamed} from './venture-network-env.ts';
import {TENDER_DESK_TOOLS} from '../runtime/venture/delivery/harness/tools-tender-desk.ts';
async function fixture(){const env=await setup(),{order}=await seedOrder(env,await seedBlueprint(env));
 const upload=await ventureAction(env.deps,owner,'prepare','tender.fixture',tx=>{tx.replace({...tx.find('venture-order',order.id)!,intake:{rights:null,format:'long',aiVoice:false,aiPresenter:false,paidPromotion:false,cutFile:null,fields:{rfpText:'Describe support.\nState the price.'}}});const text='We provide support.';return tx.put({...tx.base('venture-upload'),name:'company.txt',format:'csv',bytes:text.length,digest:digest(text),contentBase64:Buffer.from(text).toString('base64'),scope:{kind:'order',orderId:order.id},clientData:true});});
 const base={playbook:'tender-desk',kind:'bid',id:order.id} as const;
 const act=(action:string,payload:Record<string,any>,hash?:string,ctx=owner)=>TENDER_DESK_DESK.bid!.act!(env.deps,ctx,{...base,action,payload,...(hash?{digest:hash}:{})});
 const get=()=>TENDER_DESK_DESK.bid!.get!(env.deps,owner,base) as Promise<any>;
 const selection={rfpFileId:null,documentFileIds:[upload.id],issuerFileId:null,mapping:null};return {env,order,upload,base,act,get,selection};}
test('tender desk requires exact type approvals and refuses export after source bytes change',async()=>{
 const f=await fixture();await assert.rejects(f.act('import',f.selection,undefined,phone),{code:'APP_APPROVAL_REQUIRED'});
 await f.act('import',f.selection);let view=await f.get();assert.equal(view.item.rows.length,2);
 await assert.rejects(f.act('export',{},view.digest),{code:'TENDER_APPROVAL_REQUIRED'});
 for(const row of view.item.rows){view=await f.get();await f.act('answer',{questionId:row.question.id,answer:row.question.ownerOnly?'Owner quote pending.':'We provide support.'},view.digest);}
 for(const kind of ['narrative','commercial']){view=await f.get();await f.act('approve-type',{kind},view.digest);}
 view=await f.get();const result=await f.act('export',{},view.digest) as any;assert.ok(result.result.files.some((file:any)=>file.name.endsWith('.docx')));assert.ok(result.result.files.some((file:any)=>file.name.endsWith('.csv')));assert.equal(result.result.submitted,false);
 await ventureAction(f.env.deps,owner,'prepare','tender.change',tx=>{tx.replace({...tx.find('venture-upload',f.upload.id)!,contentBase64:Buffer.from('Changed support source.').toString('base64')});});
 await assert.rejects(f.act('export',{},view.digest),{code:'DERIVED_STALE'});
 assert.equal(listRecords(f.env.store.read(),'venture-tender-question').length,2);
});
test('owner commercial authorship never exempts certifications or figures from source checks',async()=>{
 const f=await fixture();await f.act('import',f.selection);let view=await f.get();const row=view.item.rows.find((r:any)=>r.question.ownerOnly);
 await f.act('answer',{questionId:row.question.id,answer:'We are ISO 27001 certified and charge INR 9000.'},view.digest);view=await f.get();
 await assert.rejects(f.act('approve-type',{kind:'commercial'},view.digest),{code:'TENDER_GROUNDING_REQUIRED'});
 assert.equal(view.item.checks.find((c:any)=>c.id===row.question.id)?.result.gap,true);
});
test('AI preview binds exact question and actual sources, sends only after approval and consumes that approval',async()=>{
 const f=await fixture();await f.act('import',f.selection);let view=await f.get();const questionId=view.item.rows.find((r:any)=>!r.question.ownerOnly).question.id;let calls=0;
 f.env.deps.models.preview=(async(_ctx:any,task:any)=>({callId:'tender-call',payloadText:JSON.stringify(task.input),digest:'exact-request',presetId:'anthropic-sonnet-5-5',model:'fixture',endpoint:'https://example.com/model',estimatedMaxCostMicros:'1000',estimatedMaxCostDisplay:'USD 0.0010',expiresAt:'2026-10-16T00:00:00Z'})) as any;
 f.env.deps.models.runPreview=(async(_ctx:any,_id:any,_digest:any,validate:any)=>{calls++;return {value:validate({answer:'We provide support.'})};}) as any;
 const preview=await f.act('ai-preview',{questionId},view.digest) as any;assert.equal(calls,0);assert.match(preview.result.preview.payloadText,/We provide support/);
 view=await f.get();await assert.rejects(f.act('ai-confirm',{questionId,callId:'tender-call',approvedDigest:'wrong'},view.digest),{code:'APPROVAL_CHANGED'});assert.equal(calls,0);
 await f.act('ai-confirm',{questionId,callId:'tender-call',approvedDigest:'exact-request'},view.digest);assert.equal(calls,1);
 view=await f.get();assert.equal(view.item.rows.find((r:any)=>r.question.id===questionId).question.authoredBy,'agent');
 await assert.rejects(f.act('ai-confirm',{questionId,callId:'tender-call',approvedDigest:'exact-request'},view.digest),{code:'APPROVAL_CHANGED'});
 await f.act('ai-preview',{questionId},view.digest);view=await f.get();
 await ventureAction(f.env.deps,owner,'prepare','tender.change',tx=>{tx.replace({...tx.find('venture-upload',f.upload.id)!,contentBase64:Buffer.from('Changed source.').toString('base64')});});
 await assert.rejects(f.act('ai-confirm',{questionId,callId:'tender-call',approvedDigest:'exact-request'},view.digest),{code:'DERIVED_STALE'});assert.equal(calls,1);
});
test('Forget follows client links and erases opaque tender source copies and model payloads while retaining spend',async()=>{
 const f=await fixture();await f.act('import',f.selection);await net(f.env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nAsha Rao,asha@example.com'});const person=personNamed(f.env as any,'Asha Rao');let callId='';
 await ventureAction(f.env.deps,owner,'prepare','tender.privacy-fixture',tx=>{tx.replace({...tx.find('venture-person',person.id)!,clientId:f.order.clientId});callId=tx.put({...tx.base('venture-model-call'),status:'preview',payloadText:'Opaque confidential tender facts.',costMicros:'500'} as any).id;const row=tx.list('venture-tender-question')[0]!;tx.replace({...row,aiCallIds:[callId]});});
 await f.act('reimport',f.selection,(await f.get()).digest);
 await net(f.env,'venture.network.forget',{id:person.id});assert.equal(listRecords(f.env.store.read(),'venture-tender-question').length,0);assert.equal(listRecords(f.env.store.read(),'venture-upload').some(r=>r.id===f.upload.id),false);
 const call=listRecords(f.env.store.read(),'venture-model-call').find(r=>r.id===callId)!;assert.equal(call.payloadText,'');assert.equal(call.status,'expired');assert.equal(call.costMicros,'500');
});
test('agent tools read only their run source bucket and cannot invent a ready or exported pack',async()=>{
 const f=await fixture();await f.act('import',f.selection);const run=await seedRun(f.env,f.order,{}),env={deps:f.env.deps,ventureId:f.env.venture.id,runRef:{kind:'delivery',runId:run.id}} as any;
 const questions=await TENDER_DESK_TOOLS['tender.questions'].run(env,{}) as any;assert.equal(questions.result.rows.length,2);assert.equal(questions.result.saved,false);
 const gaps=await TENDER_DESK_TOOLS['tender.ground'].run(env,{}) as any;assert.equal(gaps.result.ready,false);assert.equal(gaps.result.delivery,null);assert.equal(gaps.result.submitted,false);
 await assert.rejects(TENDER_DESK_TOOLS['tender.questions'].run({...env,ventureId:'other'},{}),{code:'TENDER_NOT_FOUND'});
 await ventureAction(f.env.deps,owner,'prepare','tender.tool-source-change',tx=>{tx.replace({...tx.find('venture-upload',f.upload.id)!,contentBase64:Buffer.from('Changed support source.').toString('base64')});});
 await assert.rejects(TENDER_DESK_TOOLS['tender.ground'].run(env,{}),{code:'DERIVED_STALE'});
});
