// Collections read a client's uploaded debtor ledger, never service-owner receivables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, owner, seedBlueprint, seedOrder, code } from './venture-views-env.ts';
import { ventureAction, digest, listRecords } from '../runtime/venture/records.ts';
import { BOOKKEEPING_CFO_DESK } from '../runtime/venture/playbooks/bookkeeping-cfo/desk.ts';
const header='kind,id,invoice,debtor,on,dueOn,amount,state';
const invoice='invoice,debtor-invoice,INV-A,Buyer,2026-10-01,2026-10-10,100,open';
async function source(env:Awaited<ReturnType<typeof setup>>,orderId:string,text:string){return ventureAction(env.deps,owner,'prepare','test.client-source',tx=>tx.put({...tx.base('venture-upload'),name:'collections.csv',format:'csv',bytes:Buffer.byteLength(text),contentBase64:Buffer.from(text).toString('base64'),digest:digest(text),scope:{kind:'order',orderId},clientData:true}));}
async function fixture(){const env=await setup();const {client,order}=await seedOrder(env,await seedBlueprint(env));await source(env,order.id,header+'\n'+invoice);return {env,client,order};}
test('client debtor invoices drive the desk and only later client source payments fulfil their promise',async()=>{
 const {env,client,order}=await fixture();const ledger=BOOKKEEPING_CFO_DESK.ledger!;
 const invoices=await ledger.list!(env.deps,owner,{playbook:'bookkeeping-cfo',kind:'ledger'});
 assert.equal(invoices.rows.length,1);assert.equal((invoices.rows[0] as any).invoiceId,'debtor-invoice');
 const promise=await BOOKKEEPING_CFO_DESK.promise!.act!(env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise',id:'new',action:'record',payload:{clientId:client.id,serviceOrderId:order.id,sourceName:'collections.csv',invoiceIds:['debtor-invoice'],amountRupees:'100',promisedOn:'2026-10-20',method:'UPI',statedBy:'Buyer contact'}});
 const kept=()=>BOOKKEEPING_CFO_DESK.promise!.get!(env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise',id:promise.id});
 assert.equal(((await kept()).item as any).status,'pending');
 await ventureAction(env.deps,owner,'approve','test.owner-payment',tx=>tx.put({...tx.base('venture-payment'),invoiceId:'debtor-invoice',currency:'INR',amountMinor:'10000',receivedOn:'2026-10-15',method:'upi',state:'cleared'} as any));
 assert.equal(((await kept()).item as any).status,'pending','owner books cannot fulfil client debt');
 await source(env,order.id,header+'\n'+invoice+'\npayment,receipt-1,debtor-invoice,Buyer,2026-10-15,,40,cleared');
 assert.equal(((await kept()).item as any).status,'pending');
 await source(env,order.id,header+'\n'+invoice+'\npayment,receipt-1,debtor-invoice,Buyer,2026-10-15,,40,cleared\npayment,receipt-2,debtor-invoice,Buyer,2026-10-15,,60,cleared');
 assert.equal(((await kept()).item as any).status,'kept');
 const row=(await kept()).item as any;
 const note=await BOOKKEEPING_CFO_DESK.promise!.act!(env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise',id:promise.id,action:'reminder',digest:row.digest,payload:{text:'Please review this reminder.'}});
 assert.equal((note.result as any).toClientId,client.id);assert.equal((note.result as any).sender,'client');
});
test('collection promises refuse service-owner invoice ids and another client service order',async()=>{
 const {env,client,order}=await fixture();const other=await seedOrder(env,await seedBlueprint(env));
 for(const payload of [{clientId:client.id,serviceOrderId:order.id,sourceName:'collections.csv',invoiceIds:['service-owner-invoice']},{clientId:other.client.id,serviceOrderId:order.id,sourceName:'collections.csv',invoiceIds:['debtor-invoice']}]){
  await assert.rejects(BOOKKEEPING_CFO_DESK.promise!.act!(env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise',id:'new',action:'record',payload:{...payload,amountRupees:'100',promisedOn:'2026-10-20',method:'UPI',statedBy:'Buyer'}}));
 }
 assert.equal(listRecords(env.store.read(),'venture-promise-to-pay').length,0);
});

test('broken promises from different debtors do not escalate each other inside one shop', async () => {
 const { env, client, order } = await fixture();
 await source(env, order.id, header+'\ninvoice,a,A,Buyer A,2026-10-01,2026-10-14,100,open\ninvoice,b,B,Buyer B,2026-10-01,2026-10-14,100,open');
 for (const invoiceId of ['a','b']) await BOOKKEEPING_CFO_DESK.promise!.act!(env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise',id:'new',action:'record',payload:{clientId:client.id,serviceOrderId:order.id,sourceName:'collections.csv',invoiceIds:[invoiceId],amountRupees:'100',promisedOn:'2026-10-14',method:'UPI',statedBy:invoiceId}});
 const view=await BOOKKEEPING_CFO_DESK.promise!.list!(env.deps,owner,{playbook:'bookkeeping-cfo',kind:'promise'});
 assert.deepEqual(view.rows.map(row=>(row as any).stage),['reminder','reminder']);
});
