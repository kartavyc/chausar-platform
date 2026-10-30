// Independent synthetic target exercises the owner setup loop without a provider account.
import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {digest,listRecords,ventureAction} from '../runtime/venture/records.ts';
import {stageSetupMasters,applySetupMasters,stageSetupOpening,applySetupOpening,reconcileSetupPosting,type SetupTarget} from '../runtime/venture/build/accounting-setup.ts';
async function fixture(){
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'}),order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Set up these books.',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 const base={playbook:'bookkeeping-cfo',kind:'finance'},cycle=await env.call('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 const upload=await env.call('venture.files.add',{orderId:order.id,name:'setup.csv',contentBase64:Buffer.from('kind,id,name,source,debitRupees,creditRupees\ncustomer,c,Shop,Client list,,\ncategory,cash,Cash,Chart,,\ncategory,capital,Capital,Chart,,\nopening,cash,,Trial balance,100,0\nopening,capital,,Trial balance,0,100').toString('base64')});
 const row=await env.call('venture.desk.act',{...base,id:'new',action:'draft-setup',payload:{cycleId:cycle.id,orderId:order.id,uploadId:upload.id}});
 const maps:any[]=[{kind:'contact',sourceId:'c',name:'Shop',number:'C-1',contactType:'customer',customerSubtype:'business',gstTreatment:'business_none',gstNo:null,placeOfContact:'MH',currencyId:'66',openingBalanceMinor:'0'},{kind:'account',sourceId:'cash',name:'Cash',code:'CASH',accountType:'cash',currencyId:'66'},{kind:'account',sourceId:'capital',name:'Capital',code:'CAPITAL',accountType:'equity',currencyId:'66'}];
 const records=new Map<string,any>(),sent:string[]=[];let opened:any=null;
 const external=(input:any)=>input.kind==='contact'?input.number:input.code;
 const target:SetupTarget={identity:'zoho:setup-fixture',companyId:'12345',readMaster:async input=>records.get(external(input))??null,prepareMaster:async input=>{const value:any={kind:'zoho-setup-master',connectionIdentity:'zoho:setup-fixture',input,externalIdentity:external(input),method:'POST',path:input.kind==='contact'?'contacts':'chartofaccounts',query:{},body:JSON.stringify(input),materialDigest:digest(input),evidenceDigest:digest('current'),digest:''};value.digest=digest(value);return value;},sendMaster:async(prepared,beforeSend)=>{beforeSend();sent.push(prepared.externalIdentity);records.set(prepared.externalIdentity,{id:String(100+records.size),kind:prepared.input.kind,externalIdentity:prepared.externalIdentity,materialDigest:prepared.materialDigest});},readOpening:async()=>opened,prepareOpening:async input=>{const value:any={kind:'zoho-setup-opening',connectionIdentity:'zoho:setup-fixture',input,externalIdentity:'organization-opening-balance',method:'POST',path:'settings/openingbalances',query:{},body:JSON.stringify(input),materialDigest:digest(input),evidenceDigest:digest('current'),digest:''};value.digest=digest(value);return value;},sendOpening:async(prepared,beforeSend)=>{beforeSend();sent.push('opening');opened={id:'900',materialDigest:prepared.materialDigest,migrationDate:prepared.input.migrationDate,locationId:null,lines:prepared.input.lines.map(line=>({...line,currencyId:'66'}))};}};
 return {env,order,cycle,upload,row,maps,target,sent,records};
}
test('setup separately approves exact absent masters then opening from their read-back IDs',async()=>{
 const f=await fixture(),staged=await stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps});assert.deepEqual(f.sent,[]);
 await assert.rejects(applySetupMasters(f.env.deps,owner,f.target,{id:f.row.id,digest:'wrong'}),{code:'APPROVAL_STALE'});
 const done=await applySetupMasters(f.env.deps,owner,f.target,{id:f.row.id,digest:staged.entry.posting!.reviewDigest});assert.equal(done.entry.posting!.state,'masters-done');assert.deepEqual(f.sent,['C-1','CASH','CAPITAL']);
 const opening=await stageSetupOpening(f.env.deps,owner,f.target,{id:f.row.id,digest:done.entry.posting!.reviewDigest,migrationDate:'2026-04-01'});assert.deepEqual(opening.entry.posting!.opening!.input.lines.map(line=>line.accountId),['101','102']);assert.equal(f.sent.length,3);
 const final=await applySetupOpening(f.env.deps,owner,f.target,{id:f.row.id,digest:opening.entry.posting!.reviewDigest});assert.equal(final.entry.posting!.state,'complete');assert.equal(f.sent.length,4);await assert.rejects(applySetupOpening(f.env.deps,owner,f.target,{id:f.row.id,digest:final.entry.posting!.reviewDigest}));
});
test('setup binds source identity, complete owner mapping and current consent at final send',async()=>{
 const f=await fixture();await assert.rejects(stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps.slice(1)}),{code:'BOOKS_MAPPING_REQUIRED'});await assert.rejects(stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps.map((value,i)=>i===0?{...value,name:'Other shop'}:value)}),{code:'BOOKS_MAPPING_REQUIRED'});
 const staged=await stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps}),send=f.target.sendMaster;f.target.sendMaster=async(prepared,beforeSend)=>{await ventureAction(f.env.deps,owner,'approve','test.revoke',tx=>{const order=tx.find('venture-order',f.order.id)!;tx.replace({...order,status:'cancelled'});});await send(prepared,beforeSend);};
 const result=await applySetupMasters(f.env.deps,owner,f.target,{id:f.row.id,digest:staged.entry.posting!.reviewDigest});assert.equal(result.entry.posting!.state,'stopped');assert.deepEqual(f.sent,[]);
});
test('setup missing readback becomes unknown and cannot restage or create opening',async()=>{
 const f=await fixture(),staged=await stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps});f.target.readMaster=async()=>null;const result=await applySetupMasters(f.env.deps,owner,f.target,{id:f.row.id,digest:staged.entry.posting!.reviewDigest});assert.equal(result.entry.posting!.state,'outcome_unknown');assert.equal(f.sent.length,1);await assert.rejects(stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps}));await assert.rejects(stageSetupOpening(f.env.deps,owner,f.target,{id:f.row.id,digest:result.entry.posting!.reviewDigest,migrationDate:'2026-04-01'}));assert.ok(listRecords(f.env.deps.store.read(),'venture-journal-entry').some(value=>value.state==='outcome_unknown'));
});

test('opening readback must include the exact date and actual source amounts, not only a claimed digest',async()=>{
 const f=await fixture(),staged=await stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps}),masters=await applySetupMasters(f.env.deps,owner,f.target,{id:f.row.id,digest:staged.entry.posting!.reviewDigest}),opening=await stageSetupOpening(f.env.deps,owner,f.target,{id:f.row.id,digest:masters.entry.posting!.reviewDigest,migrationDate:'2026-04-01'});
 f.target.readOpening=async()=>({id:'900',materialDigest:opening.entry.posting!.opening!.materialDigest,migrationDate:'2026-04-02',locationId:null,lines:[]});
 const result=await applySetupOpening(f.env.deps,owner,f.target,{id:f.row.id,digest:opening.entry.posting!.reviewDigest});assert.equal(result.entry.posting!.state,'outcome_unknown');
});

test('interrupted master preparation cannot send after recovery ends its claim',async()=>{
 const f=await fixture(),staged=await stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps}),prepare=f.target.prepareMaster;let started:()=>void=()=>{},release:()=>void=()=>{};const ready=new Promise<void>(r=>{started=r;}),gate=new Promise<void>(r=>{release=r;});f.target.prepareMaster=async input=>{const result=await prepare(input);started();await gate;return result;};
 const running=applySetupMasters(f.env.deps,owner,f.target,{id:f.row.id,digest:staged.entry.posting!.reviewDigest});const observed=running.catch(error=>error);await ready;const recovered=await reconcileSetupPosting(f.env.deps,owner,f.row.id);assert.equal(recovered.entry.posting!.state,'stopped');release();await observed;assert.deepEqual(f.sent,[]);assert.equal(listRecords(f.env.deps.store.read(),'venture-journal-entry').length,0);
});
test('matching existing masters are adopted without creating them again',async()=>{
 const f=await fixture();for(const [index,input] of f.maps.entries())f.records.set(input.kind==='contact'?input.number:input.code,{id:String(300+index),kind:input.kind,externalIdentity:input.kind==='contact'?input.number:input.code,materialDigest:digest(input)});
 const staged=await stageSetupMasters(f.env.deps,owner,f.target,{id:f.row.id,mappings:f.maps});assert.ok(staged.entry.posting!.masters.every(row=>row.state==='existing'&&row.prepared===null));const done=await applySetupMasters(f.env.deps,owner,f.target,{id:f.row.id,digest:staged.entry.posting!.reviewDigest});assert.equal(done.entry.posting!.state,'masters-done');assert.deepEqual(f.sent,[]);
});
