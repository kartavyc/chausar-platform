import test,{type TestContext} from 'node:test';import assert from 'node:assert/strict';
import {kitBusiness,installKitFixture,owner} from './fixtures/venture/kit-business.ts';
import {kitFixture} from './fixtures/venture/kit-fixture.ts';
import {sharePage,shareComment} from '../runtime/venture/build/share-links.ts';
import {ventureAction} from '../runtime/venture/records.ts';
import {listRecords} from '../runtime/venture/records.ts';
import {net,personNamed} from './venture-network-env.ts';
async function setup(t:TestContext){const undo=installKitFixture({...kitFixture(),clientRoom:true});t.after(undo);const e=await kitBusiness();const order=await e.call('venture.order.create',{clientId:e.client.id,offerId:e.offers[0]!.id,request:'Research local venues.',intake:{fields:{'brand-name':'Venue Studio','consent-data':true}}});const base={playbook:'kit-fixture',kind:'room'},created=await e.call('venture.desk.act',{...base,id:order.id,action:'create',payload:{}});const get=()=>e.call('venture.desk.get',{...base,id:created.id});const act=async(action:string,payload:unknown)=>e.call('venture.desk.act',{...base,id:created.id,action,payload,digest:(await get()).digest});return{e,order,base,id:created.id,get,act};}
test('one definition flag enables real owner-recorded requests with owner-list pricing and exact revision approval',async t=>{
 const f=await setup(t);await f.act('request',{text:'Compare three meeting venues.'});const row=(await f.get()).item;
 const fields={scope:'Research three venues.',deliverable:'A sourced table.',deadline:'2026-11-02'};
 await assert.rejects(f.act('draft',{requestId:row.requests[0].id,fields,price:'1'}),{code:'INVALID_VENTURE_REQUEST'});
 await f.act('draft',{requestId:row.requests[0].id,fields});let current=await f.get();assert.equal(current.item.brief.price.receiptId,f.order.priceReceiptId);assert.equal(current.item.client.brief,null);
 await f.act('approve',{});current=await f.get();assert.equal(current.item.client.brief.scope,fields.scope);assert.equal(current.item.client.line,'Your client sees this when you send it');
 const before=current.digest;await f.act('draft',{requestId:row.requests[0].id,fields:{...fields,scope:'Research five venues.'}});assert.equal((await f.get()).item.client.brief.scope,fields.scope);
 await assert.rejects(f.e.call('venture.desk.act',{...f.base,id:f.id,action:'approve',payload:{},digest:before}),{code:'APPROVAL_STALE'});
 await f.act('approve',{});assert.equal((await f.get()).item.client.brief.scope,'Research five venues.');
});
test('a real served token accepts client requests while pending owner text stays private and cancelled orders lose access',async t=>{
 const f=await setup(t);f.e.deps.host='hosted-web';f.e.deps.publicUrl='https://studio.example';const link=await f.act('share',{}),token=new URL(link.result.url).pathname.split('/').at(-1)!;
 let page=await sharePage(f.e.deps,owner,token);assert.equal(page?.canRequest,true);assert.equal(page?.canAnswer,false);
 await shareComment(f.e.deps,owner,token,{item:'room-request',text:'Please research one quiet cafe.'});const row=(await f.get()).item;assert.equal(row.requests[0].via,'client-page');
 await f.act('draft',{requestId:row.requests[0].id,fields:{scope:'PRIVATE PENDING SCOPE',deliverable:'One cafe with evidence.',deadline:'2026-11-03'}});
 assert.doesNotMatch((await sharePage(f.e.deps,owner,token))!.text,/PRIVATE PENDING/);
 await f.act('approve',{});page=await sharePage(f.e.deps,owner,token);assert.match(page!.text,/PRIVATE PENDING SCOPE/);
 await ventureAction(f.e.deps,owner,'approve','test.cancel',tx=>tx.replace({...tx.find('venture-order',f.order.id)!,status:'cancelled'}));
 assert.equal(await sharePage(f.e.deps,owner,token),null);assert.equal(await shareComment(f.e.deps,owner,token,{item:'room-request',text:'late'}),null);
});
test('Forget removes opaque room requests, approved versions and served links by client identity',async t=>{
 const f=await setup(t);await f.act('request',{text:'opaque confidential research'});const row=(await f.get()).item;
 await f.act('draft',{requestId:row.requests[0].id,fields:{scope:'opaque scope',deliverable:'opaque deliverable',deadline:'2026-11-02'}});await f.act('approve',{});
 f.e.deps.host='hosted-web';f.e.deps.publicUrl='https://studio.example';const link=(await f.act('share',{})).result,token=new URL(link.url).pathname.split('/').at(-1)!;f.e.deps.host='desktop';
 await net(f.e,'venture.network.import',{kind:'contacts-csv',name:'contacts.csv',text:'Name,E-mail 1 - Value\nAsha Rao,asha@example.com'});const person=personNamed(f.e as never,'Asha Rao');await ventureAction(f.e.deps,owner,'approve','test.link-room',tx=>{tx.replace({...tx.find('venture-person',person.id)!,clientId:f.order.clientId});});await net(f.e,'venture.network.forget',{id:person.id});
 assert.equal(listRecords(f.e.store.read(),'venture-room-brief').length,0);assert.equal(await sharePage(f.e.deps,owner,token),null);assert.equal(listRecords(f.e.store.read(),'venture-share-link').some(r=>r.id===link.id),false);
});
