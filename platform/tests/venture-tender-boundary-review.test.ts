// Independent public tender boundary review, including issuer cells and asynchronous state changes.
import test from 'node:test';
import type {Json} from '../runtime/portable.ts';
import assert from 'node:assert/strict';
import {setup,owner,seedBlueprint,seedOrder} from './venture-views-env.ts';
import {ventureAction,digest,listRecords} from '../runtime/venture/records.ts';
import {TENDER_DESK_DESK} from '../runtime/venture/playbooks/tender-desk/desk.ts';
import {writeXlsx} from '../runtime/venture/playbooks/kit/ooxml/xlsx.ts';
import {consentForOrder} from './fixtures/venture/scripted-agent.ts';
import {withdrawClientAiConsent} from '../runtime/venture/clients/ai-consent.ts';
async function fixture(){const env=await setup(),{order}=await seedOrder(env,await seedBlueprint(env));const docs=await ventureAction(env.deps,owner,'prepare','review.tender',tx=>{tx.replace({...tx.find('venture-order',order.id)!,intake:{rights:null,format:'long',aiVoice:false,aiPresenter:false,paidPromotion:false,cutFile:null,fields:{rfpText:'Describe support.'}}});const text='We provide support.';return tx.put({...tx.base('venture-upload'),name:'evidence.txt',format:'csv',bytes:text.length,digest:digest(text),contentBase64:Buffer.from(text).toString('base64'),scope:{kind:'order',orderId:order.id},clientData:true});});const base={playbook:'tender-desk',kind:'bid',id:order.id} as const;const get=()=>TENDER_DESK_DESK.bid.get!(env.deps,owner,base) as Promise<any>;const act=(action:string,payload:Record<string,Json>,hash?:string)=>TENDER_DESK_DESK.bid.act!(env.deps,owner,{...base,action,payload,...(hash?{digest:hash}:{})}) as Promise<any>;return {env,order,docs,act,get,selection:{rfpFileId:null,documentFileIds:[docs.id],issuerFileId:null,mapping:null}};}
test('an issuer cell retains every line, including pricing qualifiers, as one question',async()=>{
 const f=await fixture(),question='Describe support.\nState the hourly rate.';
 const issuer=await ventureAction(f.env.deps,owner,'prepare','review.issuer',tx=>{tx.replace({...tx.find('venture-order',f.order.id)!,intake:{...tx.find('venture-order',f.order.id)!.intake!,fields:{rfpText:''}}});const bytes=writeXlsx({sheets:[{name:'RFP',rows:[['Question','Answer'],[question,null]]}]});return tx.put({...tx.base('venture-upload'),name:'rfp.xlsx',format:'xlsx',bytes:bytes.length,digest:digest(Buffer.from(bytes).toString('base64')),contentBase64:Buffer.from(bytes).toString('base64'),scope:{kind:'order',orderId:f.order.id},clientData:true});});
 await f.act('import',{...f.selection,issuerFileId:issuer.id,mapping:{sheet:'RFP',questionColumn:'A',answerColumn:'B',firstRow:2,lastRow:2}});
 const view=await f.get();assert.equal(view.item.rows.length,1);assert.equal(view.item.rows[0].question.question,question);assert.equal(view.item.rows[0].question.ownerOnly,true);
 await assert.rejects(f.act('ai-preview',{questionId:view.item.rows[0].question.id},view.digest),{code:'PRICING_OWNER_ONLY'});
});
test('two confirmations of one AI preview dispatch only once, and changed source during completion cannot save',async()=>{
 const f=await fixture();await f.act('import',f.selection);let view=await f.get();const questionId=view.item.rows[0].question.id;let calls=0,release!:(value:unknown)=>void;const finished=new Promise(resolve=>release=resolve);
 await consentForOrder(f.env.deps,owner,f.order.id);
 f.env.deps.models.preview=(async()=>({callId:'review-call',payloadText:'review request',digest:'review-digest',presetId:'anthropic-sonnet-5-5',model:'fixture',endpoint:'https://example.test/model',estimatedMaxCostMicros:'1000',estimatedMaxCostDisplay:'USD 0.0010',expiresAt:'2026-10-16T00:00:00Z'})) as any;
 f.env.deps.models.runPreview=(async(_ctx:any,_id:any,_hash:any,validate:any)=>{calls++;await finished;return {value:validate({answer:'We provide support.'})};}) as any;
 await f.act('ai-preview',{questionId},view.digest);view=await f.get();const args={questionId,callId:'review-call',approvedDigest:'review-digest'};
 const first=f.act('ai-confirm',args,view.digest);for(let i=0;i<100&&calls===0;i++)await new Promise(r=>setTimeout(r,5));assert.equal(calls,1);
 await assert.rejects(f.act('ai-confirm',args,view.digest),{code:'APPROVAL_CHANGED'});
 await ventureAction(f.env.deps,owner,'prepare','review.changed-source',tx=>{tx.replace({...tx.find('venture-upload',f.docs.id)!,contentBase64:Buffer.from('Different source.').toString('base64')});});
 release(null);await assert.rejects(first,{code:'DERIVED_STALE'});assert.equal(calls,1);assert.equal(listRecords(f.env.store.read(),'venture-tender-question')[0]!.question.answer,'');
});
test('a privacy change while a model preview is being made expires its unlinked client payload',async()=>{
 const f=await fixture();await f.act('import',f.selection);const view=await f.get(),questionId=view.item.rows[0].question.id;let callId='';
 await consentForOrder(f.env.deps,owner,f.order.id);
 f.env.deps.models.preview=(async()=>{await ventureAction(f.env.deps,owner,'prepare','review.preview-race',tx=>{callId=tx.put({...tx.base('venture-model-call'),status:'preview',payloadText:'Opaque source data',costMicros:'0'} as any).id;const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,intake:{...order.intake!,fields:{...order.intake!.fields,private:true}}});});return {callId,payloadText:'Opaque source data',digest:'request-digest',expiresAt:'2026-10-16T00:00:00Z'};}) as any;
 await assert.rejects(f.act('ai-preview',{questionId},view.digest),{code:'DERIVED_STALE'});
 const call=listRecords(f.env.store.read(),'venture-model-call').find(row=>row.id===callId)!;assert.equal(call.payloadText,'');assert.equal(call.status,'expired');assert.equal(listRecords(f.env.store.read(),'venture-tender-question')[0]!.aiRequest,null);
});


test('tender dispatch guard stops source replacement inside model preparation',async()=>{
 const f=await fixture();await f.act('import',f.selection);let view=await f.get();const questionId=view.item.rows[0].question.id;
 await consentForOrder(f.env.deps,owner,f.order.id);
 f.env.deps.models.preview=(async()=>({callId:'guard-call',payloadText:'source',digest:'guard-digest',expiresAt:'2026-10-16T00:00:00Z'})) as any;
 await f.act('ai-preview',{questionId},view.digest);view=await f.get();let sent=0;
 f.env.deps.models.runPreview=(async(_ctx:unknown,_id:unknown,_digest:unknown,_validate:unknown,options?:{beforeDispatch?:()=>void})=>{
  await ventureAction(f.env.deps,owner,'approve','test.dispatch-race',tx=>tx.replace({...tx.find('venture-upload',f.docs.id)!,contentBase64:Buffer.from('Changed evidence.').toString('base64')}));
  options?.beforeDispatch?.();sent++;throw Error('Dispatch must be blocked');
 }) as any;
 await assert.rejects(f.act('ai-confirm',{questionId,callId:'guard-call',approvedDigest:'guard-digest'},view.digest));assert.equal(sent,0);
});

for(const moment of ['missing','preview','dispatch','response','regrant'] as const)test(`tender client AI grant is bound at ${moment}`,async()=>{
 const f=await fixture();await f.act('import',f.selection);const questionId=(await f.get()).item.rows[0].question.id;let previews=0,sent=0,callId='';
 const withdraw=()=>withdrawClientAiConsent(f.env.deps,owner,{clientId:f.order.clientId});
 if(moment!=='missing')await consentForOrder(f.env.deps,owner,f.order.id);
 f.env.deps.models.preview=(async()=>{previews++;await ventureAction(f.env.deps,owner,'prepare','test.tender-preview',tx=>{callId=tx.put({...tx.base('venture-model-call'),status:'preview',payloadText:'Private tender source',costMicros:'0'} as any).id;});if(moment==='preview')await withdraw();return {callId,payloadText:'Private tender source',digest:'grant-request'};}) as any;
 f.env.deps.models.runPreview=(async(_ctx:unknown,_id:unknown,_hash:unknown,validate:(raw:unknown)=>unknown,options:{beforeDispatch:()=>void})=>{if(moment==='dispatch')await withdraw();options.beforeDispatch();sent++;if(moment==='response')await withdraw();return {value:validate({answer:'We provide support.'})};}) as any;
 const ask=()=>f.get().then(view=>f.act('ai-preview',{questionId},view.digest));
 if(moment==='missing'||moment==='preview')await assert.rejects(ask(),{code:'CLIENT_AI_CONSENT_REQUIRED'});
 else {await ask();if(moment==='regrant'){await withdraw();await consentForOrder(f.env.deps,owner,f.order.id);}await assert.rejects(f.act('ai-confirm',{questionId,callId,approvedDigest:'grant-request'},(await f.get()).digest),{code:moment==='regrant'?'CLIENT_AI_CONSENT_CHANGED':'CLIENT_AI_CONSENT_REQUIRED'});}
 assert.equal(previews,moment==='missing'?0:1);assert.equal(sent,moment==='response'?1:0);assert.equal((await f.get()).item.rows[0].question.answer,'');
 if(moment==='preview'){const call=listRecords(f.env.store.read(),'venture-model-call').find(row=>row.id===callId)!;assert.equal(call.payloadText,'');assert.equal(call.status,'expired');}
});
