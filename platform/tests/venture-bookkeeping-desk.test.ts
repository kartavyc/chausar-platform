// Owner collections actions read client debtor snapshots; source uploads are not service-owner books.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, owner, phone, seedBlueprint, seedOrder, code } from './venture-views-env.ts';
import { BOOKKEEPING_CFO_DESK } from '../runtime/venture/playbooks/bookkeeping-cfo/desk.ts';
import { listRecords, ventureAction, digest } from '../runtime/venture/records.ts';
const header='kind,id,invoice,debtor,on,dueOn,amount,state';
const invoices='invoice,debtor-a,INV-A,Buyer,2026-10-01,2026-10-10,100,open\ninvoice,debtor-b,INV-B,Other buyer,2026-10-01,2026-10-10,100,open';
async function prepared(){const env=await setup();const {client,order}=await seedOrder(env,await seedBlueprint(env));const upload=async(payments='')=>ventureAction(env.deps,owner,'prepare','test.ledger',tx=>{const text=header+'\n'+invoices+(payments?'\n'+payments:'');tx.put({...tx.base('venture-upload'),name:'collections.csv',format:'csv',bytes:Buffer.byteLength(text),digest:digest(text),contentBase64:Buffer.from(text).toString('base64'),scope:{kind:'order',orderId:order.id},clientData:true});});await upload();const payload={clientId:client.id,serviceOrderId:order.id,sourceName:'collections.csv',invoiceIds:['debtor-a'],amountRupees:'100.50',promisedOn:'2026-10-20',method:'bank-transfer',statedBy:'Client contact'};const action={playbook:'bookkeeping-cfo',kind:'promise',id:'new',action:'record',payload} as const;return {env,client,order,upload,action};}
const desk=BOOKKEEPING_CFO_DESK.promise!;
test('recording a promise uses rupee text and exact fields; phone and debtor address are refused',async()=>{
 const f=await prepared();await assert.rejects(desk.act!(f.env.deps,phone,f.action),code('APP_APPROVAL_REQUIRED'));await assert.rejects(desk.act!(f.env.deps,owner,{...f.action,payload:{...f.action.payload,debtorEmail:'debtor@example.test'}}),code('INVALID_VENTURE_REQUEST'));
 const result=await desk.act!(f.env.deps,owner,f.action);assert.equal(listRecords(f.env.store.read(),'venture-promise-to-pay')[0].amountMinor,'10050');assert.equal((result.result as any).status,'pending');
});
test('Forget removes the client promise and its contact words',async()=>{
 const f=await prepared();const {net}=await import('./venture-network-env.ts');const person=await ventureAction(f.env.deps,owner,'admin','seed.person',tx=>tx.put({...tx.base('venture-person'),name:'Client contact',handles:{emails:[],phones:[],linkedinUrl:null},role:null,roles:[],facts:[],hidden:false,clientId:f.client.id,history:[]}));
 await desk.act!(f.env.deps,owner,{...f.action,payload:{...f.action.payload,statedBy:'Private promise contact'}});await net(f.env,'venture.network.forget',{id:person.id});assert.equal(listRecords(f.env.store.read(),'venture-promise-to-pay').length,0);assert.ok(!JSON.stringify(f.env.store.read()).includes('Private promise contact'));
});
test('a pending client cheque can keep its promise only after a later source marks it cleared',async()=>{
 const f=await prepared();await f.upload('payment,receipt,debtor-a,Buyer,2026-10-15,,100.50,pending');await desk.act!(f.env.deps,owner,f.action);let view=await desk.list!(f.env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise'});assert.equal((view.rows[0] as any).status,'pending');
 await f.upload('payment,receipt,debtor-a,Buyer,2026-10-15,,100.50,cleared');view=await desk.list!(f.env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise'});assert.equal((view.rows[0] as any).status,'kept');
});
test('one debtor invoice receives only its own source payment allocation',async()=>{
 const f=await prepared();await desk.act!(f.env.deps,owner,{...f.action,payload:{...f.action.payload,amountRupees:'100'}});await f.upload('payment,part-a,debtor-a,Buyer,2026-10-15,,40,cleared\npayment,part-b,debtor-b,Other buyer,2026-10-15,,60,cleared');const view=await desk.list!(f.env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise'});assert.equal((view.rows[0] as any).status,'pending');
});
test('Forget removes promise contact words for a person not linked to the billed client',async()=>{
 const f=await prepared();const {net}=await import('./venture-network-env.ts');const person=await ventureAction(f.env.deps,owner,'admin','seed.person',tx=>tx.put({...tx.base('venture-person'),name:'Nisha Contact',handles:{emails:[],phones:[],linkedinUrl:null},role:null,roles:[],facts:[],hidden:false,clientId:null,history:[]}));await desk.act!(f.env.deps,owner,{...f.action,payload:{...f.action.payload,statedBy:'Nisha Contact'}});await net(f.env,'venture.network.forget',{id:person.id});assert.equal(listRecords(f.env.store.read(),'venture-promise-to-pay').length,0);
});
