// Actual owner desk transitions with a synthetic private desktop port. No external site is contacted.
import test,{beforeEach,afterEach} from 'node:test';
import {FORMS_ACCESS_RULE} from '../runtime/venture/playbooks/data-entry-desk/rules.ts';
const originalConfirmation=FORMS_ACCESS_RULE.confirmedBy;
beforeEach(()=>{FORMS_ACCESS_RULE.confirmedBy={name:'Synthetic test reviewer only',on:'2026-10-29'};});
afterEach(()=>{FORMS_ACCESS_RULE.confirmedBy=originalConfirmation;});
import assert from 'node:assert/strict';
import {formsFixture} from './venture-forms-env.ts';
import {DATA_ENTRY_DESK_DESK} from '../runtime/venture/playbooks/data-entry-desk/desk.ts';
import {clearForgottenFormSignIns} from '../runtime/venture/playbooks/data-entry-desk/privacy.ts';
import {net,personNamed} from './venture-network-env.ts';
import {owner} from './venture-views-env.ts';
import {filesAddHandler} from '../runtime/venture/delivery/harness/files.ts';
import {ventureAction,listRecords} from '../runtime/venture/records.ts';
const hash='a'.repeat(64),fp='b'.repeat(64);
async function flow(){
 const f=await formsFixture();f.env.deps.host='desktop';let sends=0,fills=0;let finalGuard:()=>void|Promise<void>=()=>{};
 const fields=[{id:'customer',fingerprint:fp,pageHash:hash,name:'customer',kind:'text',disabled:false,inForm:true},{id:'submit',fingerprint:fp,pageHash:hash,name:'save',kind:'submit',disabled:false,inForm:true}];
 f.env.deps.formsBrowser={open:async(_input,guard)=>{guard();return {opened:true};},navigate:async()=>({opened:true}),capture:async()=>({pageHash:hash,url:'https://records.example.com/form',title:'Client form',complete:true,pages:[{index:0,pageHash:hash,text:'Customer Save'}],targets:fields,screenshot:null,responseEvidence:null}),fill:async()=>{fills++;return {filled:true};},prepare:async()=>({handle:'opaque-submit',digest:'c'.repeat(64),url:'https://records.example.com/save',method:'POST',review:[{name:'customer',value:'Asha'},{name:'csrf',value:null}],sensitive:true,credential:false,expiresAt:new Date(f.env.deps.clock().getTime()+60000).toISOString()}),submit:async(_run,_input,before)=>{await finalGuard();before();sends++;return {status:'response-received',responseEvidence:{requestId:2,url:'https://records.example.com/save',statusCode:200}};},readSaved:async()=>({digest:'d'.repeat(64),responseEvidence:{requestId:2,url:'https://records.example.com/save',statusCode:200},targets:[{id:'saved-name',fingerprint:fp,name:'customer',kind:'text',value:'Asha'},{id:'saved-id',fingerprint:fp,name:'record-id',kind:'text',value:'REC-1'}]}),close:async()=>{},eraseSignIns:async()=>{}};
 const permission=await filesAddHandler(f.env.deps,owner,{orderId:f.order.id,name:'written-permission.txt',contentBase64:Buffer.from('Client authorizes data entry at records.example.com using a revocable staff account.').toString('base64')});
 const made=await f.act('prepare',{orderId:f.order.id,fileId:f.file.id,identityColumn:'Record',rowIndex:0});
 const act=async(action:string,payload:any={})=>{const current=await f.get(made.id);return f.act(action,payload,made.id,current.digest);};
 return {...f,id:made.id,permission,go:act,counts:()=>({sends,fills}),atSend:(fn:()=>void|Promise<void>)=>{finalGuard=fn;}};
}
async function staged(f:Awaited<ReturnType<typeof flow>>){await f.go('open',{url:'https://records.example.com/form',permissionFileId:f.permission.id,allowed:true,revocableStaffLogin:true,savedSignInId:null});await f.go('capture');await f.go('fill',{pageHash:hash,mapping:[{column:'Customer',targetId:'customer'}]});await f.go('capture');return f.go('review-submit',{pageHash:hash,targetId:'submit',fingerprint:fp});}
test('R2 opens only an owner-approved permitted source, holds submit, then compares actual saved response selections',async()=>{
 const f=await flow();await staged(f);assert.deepEqual(f.counts(),{sends:0,fills:1});await f.go('submit');assert.equal(f.counts().sends,1);
 await f.go('read-back');const result=await f.go('compare',{readbackDigest:'d'.repeat(64),recordTargetId:'saved-id',mapping:[{column:'Customer',targetId:'saved-name'}]});assert.equal((result.result as any).comparison.status,'matches');assert.equal((result.result as any).comparison.recordId,'REC-1');
 await assert.rejects(f.go('submit'),{code:'FORM_ACTION_HELD'});assert.equal(f.counts().sends,1);
});
test('R2 final physical send rechecks revoked source consent and leaves a known not-sent outcome',async()=>{
 const f=await flow();await staged(f);await ventureAction(f.env.deps,owner,'approve','forms.revoke',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,intake:{...order.intake!,fields:{'data-consent':false}}});});await assert.rejects(f.go('submit'),{code:'FORM_CONSENT_REQUIRED'});assert.equal(f.counts().sends,0);assert.equal(listRecords(f.env.store.read(),'venture-journal-entry').filter(row=>row.operation==='forms-submit').length,0);
});

test('R2 revoked consent at the physical callback saves not-sent without releasing a request',async()=>{
 const f=await flow();await staged(f);f.atSend(async()=>{await ventureAction(f.env.deps,owner,'approve','forms.physical-revoke',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,intake:{...order.intake!,fields:{'data-consent':false}}});});});
 const result=await f.go('submit');assert.equal((result.result as any).state,'not-sent');assert.equal(f.counts().sends,0);assert.equal(listRecords(f.env.store.read(),'venture-journal-entry').find(row=>row.operation==='forms-submit')?.state,'rejected');
});
test('R2 uncertain submitted records are fenced across new entries and a restarted browser session',async()=>{
 const f=await flow();await staged(f);f.env.deps.formsBrowser!.submit=async(_run,_payload,before)=>{before();throw new Error('connection lost after send');};const result=await f.go('submit');assert.equal((result.result as any).state,'outcome-unknown');await assert.rejects(f.go('open',{url:'https://records.example.com/form',permissionFileId:f.permission.id,allowed:true,revocableStaffLogin:true,savedSignInId:null}),{code:'FORM_ACTION_HELD'});
 await ventureAction(f.env.deps,owner,'approve','forms.duplicate-entry-fixture',tx=>{const row=tx.find('venture-entry-record',f.id)!;const {browserRunId:_run,...rest}=row;tx.put({...rest,...tx.base('venture-entry-record'),state:'source',submitReview:null});});const duplicate=listRecords(f.env.store.read(),'venture-entry-record').find(row=>row.id!==f.id)!;const current=await f.get(duplicate.id);await assert.rejects(f.act('open',{url:'https://records.example.com/form',permissionFileId:f.permission.id,allowed:true,revocableStaffLogin:true,savedSignInId:null},duplicate.id,current.digest),{code:'FORM_ALREADY_SUBMITTED'});assert.equal(listRecords(f.env.store.read(),'venture-journal-entry').filter(row=>row.operation==='forms-submit').length,1);
});

test('R2 client browser stays planned while the permission workflow lacks professional confirmation',async()=>{
 const f=await flow();FORMS_ACCESS_RULE.confirmedBy=null;await assert.rejects(f.go('open',{url:'https://records.example.com/form',permissionFileId:f.permission.id,allowed:true,revocableStaffLogin:true,savedSignInId:null}),{code:'RULE_UNCONFIRMED'});assert.deepEqual(f.counts(),{fills:0,sends:0});
});

test('R2 linked-client Forget deletes opaque source, permission, derived entry and saved sign-in',async()=>{
 const f=await flow();await staged(f);const cleared:string[][]=[];f.env.deps.formsBrowser!.eraseSignIns=async ids=>{cleared.push(ids);};
 const signIn='12345678-1234-1234-1234-123456789012';await ventureAction(f.env.deps,owner,'approve','forms.saved-login-fixture',tx=>{const row=tx.find('venture-entry-record',f.id)!;tx.replace({...row,site:{...row.site!,savedSignInId:signIn}});});
 await net(f.env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nOpaque Contact,opaque@example.com'});const person=personNamed(f.env,'Opaque Contact');await ventureAction(f.env.deps,owner,'approve','forms.link',tx=>tx.replace({...tx.find('venture-person',person.id)!,clientId:f.order.clientId}));await net(f.env,'venture.network.forget',{id:person.id});
 assert.equal(listRecords(f.env.store.read(),'venture-entry-record').length,0);assert.equal(listRecords(f.env.store.read(),'venture-upload').filter(file=>file.scope.kind==='order'&&file.scope.orderId===f.order.id).length,0);assert.equal(listRecords(f.env.store.read(),'venture-order').find(row=>row.id===f.order.id)?.status,'cancelled');assert.deepEqual(cleared,[[signIn]]);await assert.rejects(f.get(f.id),{code:'FORM_RECORD_NOT_FOUND'});
});

test('R2 unacknowledged saved-sign-in erasure stays durable and resumes without a live client entry',async()=>{
 const f=await flow();await staged(f);const signIn='12345678-1234-1234-1234-123456789012';await ventureAction(f.env.deps,owner,'approve','forms.saved-login-fixture',tx=>{const row=tx.find('venture-entry-record',f.id)!;tx.replace({...row,site:{...row.site!,savedSignInId:signIn}});});f.env.deps.formsBrowser!.eraseSignIns=async()=>{throw new Error('main temporarily unavailable');};
 await net(f.env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nOpaque Contact,opaque@example.com'});const person=personNamed(f.env,'Opaque Contact');await ventureAction(f.env.deps,owner,'approve','forms.link',tx=>tx.replace({...tx.find('venture-person',person.id)!,clientId:f.order.clientId}));const forgotten=await net<any>(f.env,'venture.network.forget',{id:person.id});assert.match(forgotten.line,/cleanup is still pending/);assert.equal(listRecords(f.env.store.read(),'venture-entry-record').length,0);assert.deepEqual(listRecords(f.env.store.read(),'venture-record')[0]!.formsSignInErasure,[signIn]);
 const cleared:string[][]=[],restarted={...f.env.deps,formsBrowser:{...f.env.deps.formsBrowser!,eraseSignIns:async(ids:string[])=>{cleared.push(ids);}}};assert.equal(await clearForgottenFormSignIns(restarted,owner),true);assert.deepEqual(cleared,[[signIn]]);assert.deepEqual(listRecords(f.env.store.read(),'venture-record')[0]!.formsSignInErasure,[]);
});
test('R2 Forget during the final submit wait sends nothing and cannot recreate a deleted entry',async()=>{
 const f=await flow();await staged(f);await net(f.env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nOpaque Contact,opaque@example.com'});const person=personNamed(f.env,'Opaque Contact');await ventureAction(f.env.deps,owner,'approve','forms.link',tx=>tx.replace({...tx.find('venture-person',person.id)!,clientId:f.order.clientId}));f.atSend(async()=>{await net(f.env,'venture.network.forget',{id:person.id});});await assert.rejects(f.go('submit'));assert.equal(f.counts().sends,0);assert.equal(listRecords(f.env.store.read(),'venture-entry-record').length,0);assert.equal(listRecords(f.env.store.read(),'venture-upload').filter(file=>file.scope.kind==='order'&&file.scope.orderId===f.order.id).length,0);
});

test('R2 Forget follows a person inside an uploaded source before any mapping stores their text',async()=>{
 const f=await flow();await net(f.env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nAsha,asha@example.com'});const person=personNamed(f.env,'Asha');await net(f.env,'venture.network.forget',{id:person.id});assert.equal(listRecords(f.env.store.read(),'venture-entry-record').length,0);assert.equal(listRecords(f.env.store.read(),'venture-upload').filter(file=>file.scope.kind==='order'&&file.scope.orderId===f.order.id).length,0);
});

test('R2 owner credential submit is separately held and never counts as a completed source entry',async()=>{
 const f=await flow();await f.go('open',{url:'https://records.example.com/form',permissionFileId:f.permission.id,allowed:true,revocableStaffLogin:true,savedSignInId:null});await f.go('capture');const prepare=f.env.deps.formsBrowser!.prepare;f.env.deps.formsBrowser!.prepare=async(run,input)=>({...await prepare(run,input) as object,credential:true});
 await f.go('review-sign-in',{pageHash:hash,targetId:'submit',fingerprint:fp});assert.equal(f.counts().sends,0);const login=await f.go('submit');assert.equal((login.result as any).state,'sign-in-response');assert.equal(listRecords(f.env.store.read(),'venture-journal-entry').find(row=>row.operation==='forms-sign-in')?.state,'applied');await assert.rejects(f.go('read-back'),{code:'FORM_READBACK_UNAVAILABLE'});
 let navigations=0;f.env.deps.formsBrowser!.navigate=async(_run,payload)=>{assert.deepEqual(payload,{url:'https://records.example.com/form'});navigations++;return {opened:true};};const continued=await f.go('continue',{url:'https://records.example.com/form'});assert.equal((continued.result as any).state,'open');assert.equal(navigations,1);assert.equal((continued.result as any).comparison,null);
});

test('R2 saved sign-ins are owner-created and bound to the exact client and origin',async()=>{
 const f=await flow(),body={url:'https://records.example.com/form',permissionFileId:f.permission.id,allowed:true,revocableStaffLogin:true,savedSignInId:'12345678-1234-1234-1234-123456789012'};await assert.rejects(f.go('open',body),{code:'FORM_SIGNIN_REQUIRED'});
 const remembered=await f.go('open',{...body,savedSignInId:'new'}),id=(remembered.result as any).site.savedSignInId;assert.match(id,/^[a-f0-9-]{36}$/);await f.go('close');await assert.rejects(f.go('open',{...body,url:'https://other.example.com/form',savedSignInId:id}),{code:'FORM_SIGNIN_REQUIRED'});const reopened=await f.go('open',{...body,savedSignInId:id});assert.equal((reopened.result as any).site.savedSignInId,id);
});

test('R2 a delivered order cannot authorize another external submit',async()=>{
 const f=await flow();await staged(f);await ventureAction(f.env.deps,owner,'approve','forms.complete-order',tx=>tx.replace({...tx.find('venture-order',f.order.id)!,status:'delivered'}));await assert.rejects(f.go('submit'),{code:'FORM_ORDER_CLOSED'});assert.equal(f.counts().sends,0);
});
test('R2 reassigned order views and close replies never expose the former client mapping or saved result',async()=>{
 for(const completed of [false,true]){const f=await flow();await staged(f);if(completed){await f.go('submit');await f.go('read-back');await f.go('compare',{readbackDigest:'d'.repeat(64),recordTargetId:'saved-id',mapping:[{column:'Customer',targetId:'saved-name'}]});}
 await ventureAction(f.env.deps,owner,'approve','forms.reassign',tx=>{const old=tx.find('venture-client',f.order.clientId)!;const other=tx.put({...old,...tx.base('venture-client'),name:'Another client'});tx.replace({...tx.find('venture-order',f.order.id)!,clientId:other.id});});
 const detail=await f.get(f.id),listed=await DATA_ENTRY_DESK_DESK.entries!.list!(f.env.deps,owner,{playbook:'data-entry-desk',kind:'entries'}),closed=await f.act('close',{},f.id,detail.digest);
 for(const value of [detail.item,listed.rows[0],closed.result]){assert.equal((value as any).stale,true);assert.doesNotMatch(JSON.stringify(value),/Asha|REC-1|csrf|written-permission/);for(const key of ['clientId','sourceRecordId','mapping','submitReview','comparison','site','signIns'])assert.equal(Object.hasOwn(value as object,key),false,key+' must not remain on a reassigned view');}
 }
});

test('R2 approved non-credential screenshot stays with the exact record and Forget erases its media copy',async()=>{
 const f=await flow(),capture=f.env.deps.formsBrowser!.capture;f.env.deps.formsBrowser!.capture=async(run)=>({...await capture(run) as object,screenshot:{mime:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNCsAAAAASUVORK5CYII='}});
 const reviewed=await staged(f),screen=(reviewed.result as any).filmstrip;assert.equal(screen.length,1);assert.equal(screen[0].pageHash,hash);assert.equal(screen[0].phase,'approved-form');assert.equal(screen[0].screenshot.mime,'image/png');const before=await f.get(f.id);const fileId=(before.item as any).screenshot.fileId;assert.ok(listRecords(f.env.store.read(),'venture-upload').some(file=>file.id===fileId&&file.scope.kind==='media'));
 await f.go('close');assert.equal(((await f.get(f.id)).item as any).filmstrip.length,1);
 await ventureAction(f.env.deps,owner,'approve','forms.reassign-film',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,clientId:'other-client'});});assert.equal(((await f.get(f.id)).item as any).filmstrip,undefined);await net(f.env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nAsha,asha@example.com'});await net(f.env,'venture.network.forget',{id:personNamed(f.env,'Asha').id});assert.equal(listRecords(f.env.store.read(),'venture-upload').some(file=>file.id===fileId),false);
});

test('R2 agent mapping is only a source-bound proposal, and saved readback cannot be supplied by a model',async()=>{
 const {DATA_ENTRY_DESK_TOOLS}=await import('../runtime/venture/delivery/harness/tools-data-entry-desk.ts');const f=await flow();await f.go('open',{url:'https://records.example.com/form',permissionFileId:f.permission.id,allowed:true,revocableStaffLogin:true,savedSignInId:null});await f.go('capture');
 const run=await ventureAction(f.env.deps,owner,'approve','forms.tool-fixture',tx=>tx.put({...tx.base('venture-delivery-run'),orderId:f.order.id,status:'waiting-for-you'} as any)),env={deps:f.env.deps,ctx:owner,ventureId:run.ventureId,runRef:{kind:'delivery',runId:run.id}} as any;
 const proposal=await DATA_ENTRY_DESK_TOOLS['forms.map'].run(env,{entryId:f.id,mapping:JSON.stringify([{column:'Customer',targetId:'customer'}])});assert.equal((proposal.result as any).needsOwnerApproval,true);assert.equal((proposal.result as any).values[0].value,'Asha');assert.deepEqual(f.counts(),{fills:0,sends:0});assert.equal(((await f.get(f.id)).item as any).mappingProposal.pageHash,hash);
 await assert.rejects(DATA_ENTRY_DESK_TOOLS['forms.map'].run(env,{entryId:f.id,mapping:JSON.stringify([{column:'Customer',targetId:'customer',value:'Invented'}])}),{code:'FORM_MAPPING_INVALID'});
 await assert.rejects(DATA_ENTRY_DESK_TOOLS['forms.readBack'].run(env,{entryId:f.id,fields:'fabricated'}),{code:'INVALID_VENTURE_REQUEST'});const result=await DATA_ENTRY_DESK_TOOLS['forms.readBack'].run(env,{entryId:f.id});assert.equal((result.result as any).comparison,null);assert.equal((result.result as any).state,'captured');
 await ventureAction(f.env.deps,owner,'approve','forms.tool-source-revoke',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,intake:{...order.intake!,fields:{'data-consent':false}}});});await assert.rejects(DATA_ENTRY_DESK_TOOLS['forms.readBack'].run(env,{entryId:f.id}),{code:'FORM_CONSENT_REQUIRED'});
});

test('R2 Forget erases superseded agent payloads linked through run history while preserving cost accounting',async()=>{const f=await flow();await ventureAction(f.env.deps,owner,'approve','forms.old-call-fixture',tx=>{tx.put({...tx.base('venture-model-call'),id:'old-form-call',status:'preview',payloadText:'Private field ZQ97 not present in contacts',payloadTruncated:false,costMicros:'17'}as any);tx.put({...tx.base('venture-delivery-run'),orderId:f.order.id,status:'waiting-for-you',callId:null,harness:{turns:[{modelCallId:'old-form-call'}]}}as any);});await net(f.env,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nOpaque Contact,opaque@example.com'});const person=personNamed(f.env,'Opaque Contact');await ventureAction(f.env.deps,owner,'approve','forms.link-old-call',tx=>tx.replace({...tx.find('venture-person',person.id)!,clientId:f.order.clientId}));await net(f.env,'venture.network.forget',{id:person.id});const call=listRecords(f.env.store.read(),'venture-model-call').find(call=>call.id==='old-form-call')!;assert.equal(call.payloadText,'');assert.equal(call.status,'expired');assert.equal(call.costMicros,'17');});
