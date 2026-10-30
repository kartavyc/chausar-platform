import {it,expect} from 'vitest';
import {booksClient} from '../helpers/books-client';
import {SETTLEMENT_PAYMENT_COLUMNS} from '../../../../platform/runtime/venture/playbooks/bookkeeping-cfo/settlement-payments';
it('uses the real settlement desk refusal order for a non-monthly id without a connection',async()=>{
 const {client,order}=await booksClient();const cycle=await client.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'111',from:'2026-04-01',to:'2027-03-31'}});
 await expect(client.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'settlement',id:cycle.id,action:'stage',payload:{uploadId:'absent'}})).rejects.toMatchObject({code:'BOOKS_CONNECTION_REQUIRED',message:'Connect this client account for the open session.'});
});
it('demo settlement source validates normally but refuses provider access without fabricating posted records',async()=>{
 const {client,order}=await booksClient(),base={playbook:'bookkeeping-cfo' as const,kind:'finance'},cycle=await client.request('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 await client.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'posting',id:cycle.id,action:'configure-zoho',payload:{dataCenter:'in',accessToken:'demo only',customerId:'77',placeOfSupply:'MH',gstTreatment:'consumer',gstNo:null,taxSpecification:'inter',lineMode:'aggregate-non-inventory',lines:[{itemId:'99',taxId:'88',taxKind:'tax'}]}});
 const add=(name:string,text:string)=>client.request('venture.files.add',{orderId:order.id,name,contentBase64:btoa(text)}),file=await add('month.csv','kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Orders,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlements,100,100,');
 const month=await client.request('venture.desk.act',{...base,id:'new',action:'monthly-seller',payload:{cycleId:cycle.id,orderId:order.id,uploadId:file.id,month:'2026-10'}}),payment=await add('payments.csv',SETTLEMENT_PAYMENT_COLUMNS.join(',')+'\nshop,payout,one,2026-10-28T10:00:00Z,Asia/Kolkata,banktransfer,100,100,Settlement export'),desk={playbook:'bookkeeping-cfo' as const,kind:'settlement'};
 expect((await client.request('venture.desk.list',{...desk,filter:{cycleId:cycle.id}})).rows).toHaveLength(1);
 await expect(client.request('venture.desk.act',{...desk,id:month.id,action:'stage',payload:{uploadId:payment.id}})).rejects.toMatchObject({code:'BOOKS_READ_FAILED'});
 expect((await client.request('venture.desk.get',{...desk,id:month.id})).item).not.toHaveProperty('entry.posting');
 await client.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'posting',id:cycle.id,action:'configure-zoho-account',payload:{dataCenter:'in',accessToken:'demo only'}});
 await expect(client.request('venture.desk.act',{...desk,id:month.id,action:'stage',payload:{uploadId:payment.id}})).rejects.toMatchObject({code:'BOOKS_MAPPING_REQUIRED'});
});
