import test from 'node:test';
import assert from 'node:assert/strict';
import {kitBusiness,owner} from './fixtures/venture/kit-business.ts';
import {ventureAction,listRecords} from '../runtime/venture/records.ts';
import {BOOKKEEPING_CFO_TOOLS} from '../runtime/venture/delivery/harness/tools-bookkeeping-cfo.ts';
import type {ToolEnv} from '../runtime/venture/delivery/harness/tools.ts';
test('all finance source tools refuse revoked consent and cancelled orders before computing receipts',async()=>{
 const env=await kitBusiness({now:new Date('2026-10-28T12:00:00Z')},{idea:'bookkeeping and CFO service'});
 const order=await env.call('venture.order.create',{clientId:env.client.id,offerId:env.offers[0]!.id,request:'Keep these client books.',intake:{fields:{'data-consent':true,period:'October 2026'}}});
 const cycle=await env.call('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'create-cycle',payload:{orderId:order.id,system:'tally',companyId:'Client books',from:'2026-04-01',to:'2027-03-31'}});
 const run=await env.call('venture.delivery.run',{orderId:order.id});
 const cases=[['vouchers.draft','id,on,description,debitAccount,creditAccount,amount\nrent,2026-10-28,Rent,rent,bank,100'],['books.setup','kind,id,name,source,debitRupees,creditRupees\ncategory,bank,Bank,Statement,,\ncategory,equity,Equity,Statement,,\nopening,bank,,Statement,100,0\nopening,equity,,Statement,0,100'],['seller.books','kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Orders,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlements,100,100,']] as const;
 for(const [name,csv] of cases){
  await ventureAction(env.deps,owner,'approve','test.restore-consent',tx=>{const current=tx.find('venture-order',order.id)!;tx.replace({...current,status:order.status,intake:{...current.intake!,fields:{...current.intake?.fields,'data-consent':true}}});});
  const file=await env.call('venture.files.add',{orderId:order.id,name:name+'.csv',contentBase64:Buffer.from(csv).toString('base64')});
  const source=listRecords(env.deps.store.read(),'venture-upload').find(row=>row.id===file.id)!;
  const tool:ToolEnv={deps:env.deps,ventureId:order.ventureId,memberId:'owner',epoch:1,currency:'INR',dateOrder:'day-month-year',runRef:{kind:'delivery',runId:run.id},files:[source],tables:[],receipts:[],dictionary:[],sandbox:undefined,now:()=> '2026-10-28T12:00:00Z',allowed:[]};
  const input={table:'f1',cycleId:cycle.id,month:'2026-10'};
  assert.ok((await BOOKKEEPING_CFO_TOOLS[name].run(tool,input)).receipts?.length);
  for(const revoked of ['consent','cancelled'] as const){
   await ventureAction(env.deps,owner,'approve','test.revoke-consent',tx=>{const current=tx.find('venture-order',order.id)!;tx.replace({...current,status:revoked==='cancelled'?'cancelled':order.status,intake:{...current.intake!,fields:{...current.intake?.fields,'data-consent':revoked!=='consent'}}});});
   await assert.rejects(BOOKKEEPING_CFO_TOOLS[name].run(tool,input),{code:'BOOKS_CONSENT_REQUIRED'});
  }
 }
});
