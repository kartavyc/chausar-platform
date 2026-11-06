// Demo refuses absent provider evidence after the same owner/source validation.
import {expect,it} from 'vitest';
import {booksClient} from '../helpers/books-client';
it('fake setup validates exact owner mappings and never fabricates remote masters',async()=>{
 const {client,order}=await booksClient(),finance={playbook:'bookkeeping-cfo' as const,kind:'finance'},cycle=await client.request('venture.desk.act',{...finance,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId:'12345',from:'2026-04-01',to:'2027-03-31'}});
 const file=await client.request('venture.files.add',{orderId:order.id,name:'setup.csv',contentBase64:btoa('kind,id,name,source,debitRupees,creditRupees\ncategory,cash,Cash,Chart,,\ncategory,capital,Capital,Chart,,\nopening,cash,,Trial balance,100,0\nopening,capital,,Trial balance,0,100')}),row=await client.request('venture.desk.act',{...finance,id:'new',action:'draft-setup',payload:{cycleId:cycle.id,orderId:order.id,uploadId:file.id}});
 await client.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'posting',id:cycle.id,action:'configure-zoho-account',payload:{dataCenter:'in',accessToken:'owner demo input'}});
 const base={playbook:'bookkeeping-cfo' as const,kind:'setup',id:row.id,action:'stage-masters'},mappings=[{kind:'account',sourceId:'cash',name:'Cash',code:'CASH',accountType:'cash',currencyId:'66'},{kind:'account',sourceId:'capital',name:'Capital',code:'CAPITAL',accountType:'equity',currencyId:'66'}];
 await expect(client.request('venture.desk.act',{...base,payload:{mappings:[]}})).rejects.toMatchObject({code:'BOOKS_MAPPING_REQUIRED'});await expect(client.request('venture.desk.act',{...base,payload:{mappings}})).rejects.toMatchObject({code:'BOOKS_READ_FAILED'});
 const view=await client.request('venture.desk.get',{playbook:'bookkeeping-cfo',kind:'setup',id:row.id});expect((view.item as any).entry.posting).toBeUndefined();
 await expect(client.request('venture.desk.act',{...base,action:'apply-masters',payload:{},digest:'invented'})).rejects.toMatchObject({code:'APPROVAL_STALE'});
});
