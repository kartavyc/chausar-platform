import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {CAREER_PRIVACY_RULE} from '../runtime/venture/playbooks/job-search-desk/definition-data.ts';
import {sharePage,shareDecide} from '../runtime/venture/build/share-links.ts';
import {net,personNamed} from './venture-network-env.ts';
import {listRecords} from '../runtime/venture/records.ts';
const fact={id:'research',statement:'Interviewed customers',qualifiers:['as an intern'],forbiddenUses:['team management']};
async function setup(){const e=await kitBusiness({now:new Date('2026-10-29T10:00:00Z')},{idea:'A career coach and job search help business'});await ventureAction(e.deps,owner,'approve','test.rehearsal',tx=>tx.touch({launchStage:'rehearsal'}));const offer=e.offers.find(o=>o.playbookOffer==='profile-and-tailoring')!;const order=await e.call('venture.order.create',{clientId:e.client.id,offerId:offer.id,request:'A source-backed research profile.',intake:{fields:{targetRoles:['Researcher'],locations:['Pune'],facts:'Interviewed customers as an intern.',languages:['English']}}});const made=await e.call('venture.desk.act',{playbook:'job-search-desk',kind:'fact',id:order.id,action:'propose',payload:{value:fact}});const get=await e.call('venture.desk.get',{playbook:'job-search-desk',kind:'fact',id:made.id});await e.call('venture.desk.act',{playbook:'job-search-desk',kind:'fact',id:made.id,action:'approve',payload:{},digest:get.digest});return{e,order,factId:made.id};}
test('career pack render binds exact real file bytes, owner approval, and every re-render clears it',async()=>{
 const {e,order}=await setup(),base={playbook:'job-search-desk',kind:'thread'};const made=await e.call('venture.desk.act',{...base,id:order.id,action:'create-pack',payload:{input:{kind:'resume',claims:[{factId:'research',use:'research'}],sources:[]}}});
 let view=await e.call('venture.desk.get',{...base,id:made.id});assert.equal(view.item.pack.ownerApproval,null);await assert.rejects(e.call('venture.desk.act',{...base,id:made.id,action:'approve-pack',payload:{},digest:view.digest}),{code:'CAREER_RENDER_REQUIRED'});
 await e.call('venture.desk.act',{...base,id:made.id,action:'render',payload:{},digest:view.digest});view=await e.call('venture.desk.get',{...base,id:made.id});assert.equal(view.item.pack.files[0].name,'resume.docx');assert.equal(Buffer.from(view.item.pack.files[0].contentBase64,'base64').subarray(0,2).toString(),'PK');assert.match(view.item.pack.files[0].sha256,/^[a-f0-9]{64}$/);
 await e.call('venture.desk.act',{...base,id:made.id,action:'approve-pack',payload:{},digest:view.digest});view=await e.call('venture.desk.get',{...base,id:made.id});assert.ok(view.item.pack.ownerApproval);
 await e.call('venture.desk.act',{...base,id:made.id,action:'render',payload:{},digest:view.digest});view=await e.call('venture.desk.get',{...base,id:made.id});assert.equal(view.item.pack.ownerApproval,null);
});
test('career pack approval refuses a changed fact and a fabricated client approval',async()=>{
 const {e,order,factId}=await setup(),base={playbook:'job-search-desk',kind:'thread'};const made=await e.call('venture.desk.act',{...base,id:order.id,action:'create-pack',payload:{input:{kind:'resume',claims:[{factId:'research',use:'research'}],sources:[]}}});let view=await e.call('venture.desk.get',{...base,id:made.id});await e.call('venture.desk.act',{...base,id:made.id,action:'render',payload:{},digest:view.digest});view=await e.call('venture.desk.get',{...base,id:made.id});
 const f=await e.call('venture.desk.get',{playbook:'job-search-desk',kind:'fact',id:factId});await e.call('venture.desk.act',{playbook:'job-search-desk',kind:'fact',id:factId,action:'revise',payload:{value:{...fact,forbiddenUses:['team management','research']}},digest:f.digest});
 await assert.rejects(e.call('venture.desk.act',{...base,id:made.id,action:'approve-pack',payload:{},digest:view.digest}),{code:'CAREER_SOURCE_CHANGED'});
 await assert.rejects(e.call('venture.desk.act',{...base,id:made.id,action:'approve-client',payload:{confirmed:true},digest:view.digest}));
});
test('career application rows are explicit client reports with age, next touch and a human path',async()=>{
 const {e,order}=await setup(),base={playbook:'job-search-desk',kind:'thread'};
 const listing=await e.call('venture.desk.act',{playbook:'job-search-desk',kind:'listing',id:order.id,action:'paste',payload:{url:'https://jobs.example/research',text:'A customer research role in Pune.'}});
 const payload={listingId:listing.id,state:'applied',lastTouch:'2026-10-28',nextTouch:'2026-11-02',clientReported:true};
 await assert.rejects(e.call('venture.desk.act',{...base,id:order.id,action:'record-application',payload:{...payload,clientReported:false}}),{code:'INVALID_VENTURE_REQUEST'});
 const made=await e.call('venture.desk.act',{...base,id:order.id,action:'record-application',payload});
 const view=await e.call('venture.desk.get',{...base,id:made.id});assert.equal(view.item.state,'applied');assert.equal(view.item.nextTouch,'2026-11-02');assert.equal(view.item.ageDays,0);assert.match(view.item.humanPath,/client.*sends.*applies/i);assert.equal(view.item.pack,null);
 await assert.rejects(e.call('venture.desk.act',{...base,id:made.id,action:'update-thread',payload:{state:'interview',lastTouch:'2026-02-30',nextTouch:null,clientReported:true},digest:view.digest}),{code:'INVALID_VENTURE_REQUEST'});
});
test('career client review uses a hosted token for exact rendered files and closes after re-render',async t=>{
 const {e,order}=await setup();e.deps.host='hosted-web';e.deps.publicUrl='https://career.example';const base={playbook:'job-search-desk',kind:'thread'},made=await e.call('venture.desk.act',{...base,id:order.id,action:'create-pack',payload:{input:{kind:'resume',claims:[{factId:'research',use:'research'}],sources:[]}}});const act=async(action:string,payload:unknown={})=>e.call('venture.desk.act',{...base,id:made.id,action,payload,digest:(await e.call('venture.desk.get',{...base,id:made.id})).digest});
 await act('render');await act('approve-pack');await assert.rejects(act('share'),{code:'RULE_UNCONFIRMED'});
 const previous=CAREER_PRIVACY_RULE.confirmedBy;CAREER_PRIVACY_RULE.confirmedBy={name:'Synthetic test reviewer',on:'2026-10-29'};t.after(()=>{CAREER_PRIVACY_RULE.confirmedBy=previous;});
 const link=(await act('share')).result,token=new URL(link.url).pathname.split('/').at(-1)!;assert.ok(await sharePage(e.deps,owner,token));await assert.rejects(act('export',{name:'resume.docx'}),{code:'CAREER_CLIENT_APPROVAL_REQUIRED'});
 await shareDecide(e.deps,owner,token,{digest:link.digest??(await sharePage(e.deps,owner,token))!.digest,decision:'approved'});await act('approve-client',{shareId:link.id});const exported=(await act('export',{name:'resume.docx'})).result;assert.equal(exported.saved,false);assert.equal(exported.sent,false);assert.equal(Buffer.from(exported.contentBase64,'base64').subarray(0,2).toString(),'PK');
 await act('render');assert.equal(await sharePage(e.deps,owner,token),null);await assert.rejects(act('export',{name:'resume.docx'}));
});
test('Forget removes opaque career ledger, rendered bytes and order intake through the linked client',async()=>{
 const {e,order}=await setup(),base={playbook:'job-search-desk',kind:'thread'};const made=await e.call('venture.desk.act',{...base,id:order.id,action:'create-pack',payload:{input:{kind:'resume',claims:[{factId:'research',use:'research'}],sources:[]}}});const before=await e.call('venture.desk.get',{...base,id:made.id});await e.call('venture.desk.act',{...base,id:made.id,action:'render',payload:{},digest:before.digest});
 await net(e,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nAsha Rao,asha@example.com'});const person=personNamed(e as any,'Asha Rao');await ventureAction(e.deps,owner,'approve','test.link-career-client',tx=>{tx.replace({...tx.find('venture-person',person.id)!,clientId:order.clientId});});await net(e,'venture.network.forget',{id:person.id});
 assert.equal(listRecords(e.store.read(),'venture-career-fact').length,0);assert.equal(listRecords(e.store.read(),'venture-career-thread').length,0);assert.doesNotMatch(JSON.stringify(listRecords(e.store.read(),'venture-order')),/Interviewed customers|Researcher/);await assert.rejects(e.call('venture.desk.get',{...base,id:made.id}),{code:'CAREER_NOT_FOUND'});
});
