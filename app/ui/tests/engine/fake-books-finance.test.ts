// Owner demo follows the same exact cycle, receipt and voucher contracts.
import {expect,it} from 'vitest';
import {booksClient} from '../helpers/books-client';
import {fakeBooksFinance} from '../../src/engine/fake-books-finance';
import type {W4DeskHost} from '../../src/engine/fake-w4';
it('fake finance refuses new work and export when consent is revoked or order cancelled',()=>{
 const order={id:'order',clientId:'client',status:'received',intake:{fields:{'data-consent':true}}},csv='kind,id,name,source,debitRupees,creditRupees\ncategory,bank,Bank,Statement,,\ncategory,equity,Equity,Statement,,\nopening,bank,,Statement,100,0\nopening,equity,,Statement,0,100';
 const host={current:()=> 'business',now:()=> '2026-10-28T12:00:00Z',emit:()=>{},ask:()=>[order],orderFiles:()=>[{id:'file',name:'setup.csv',format:'csv',contentBase64:btoa(csv)}]} as unknown as W4DeskHost;
 const desk=fakeBooksFinance(host).kind,base={playbook:'bookkeeping-cfo' as const,kind:'finance'},act=(action:string,payload:unknown,id='new',digest?:string)=>desk.act!({...base,id,action,payload,...(digest?{digest}:{})}) as any;
 const cycle=act('create-cycle',{orderId:order.id,system:'tally',companyId:'Client books',from:'2026-04-01',to:'2027-03-31'}),payload={cycleId:cycle.id,orderId:order.id,uploadId:'file'},draft=act('draft-setup',payload),view=desk.get!({...base,id:draft.id}) as any;
 for(const reason of ['consent','cancelled']){order.status=reason==='cancelled'?'cancelled':'received';order.intake.fields['data-consent']=reason!=='consent';expect(()=>act('draft-setup',payload)).toThrowError(expect.objectContaining({code:'BOOKS_CONSENT_REQUIRED'}));expect((desk.get!({...base,id:draft.id}) as any).item.stale).toBe(true);expect(()=>act('export-setup',{},draft.id,view.digest)).toThrowError(expect.objectContaining({code:'BOOKS_SOURCE_CHANGED'}));}
});
it('public fake finance approves exact receipt entries and resolves its code receipt',async()=>{
 const {client,order}=await booksClient();
 const base={playbook:'bookkeeping-cfo' as const,kind:'finance'};
 const cycle=await client.request('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'tally',companyId:'Client books',from:'2026-04-01',to:'2027-03-31'}});
 const file=await client.request('venture.files.add',{orderId:order.id,name:'receipt.csv',contentBase64:btoa('vendor,amount\nLandlord,100')});
 const drafted=await client.request('venture.desk.act',{...base,id:'new',action:'draft-voucher',payload:{cycleId:cycle.id,orderId:order.id,receiptUploadId:file.id,date:'2026-10-28',description:'Rent receipt',lines:[{accountId:'rent',debitRupees:'100',creditRupees:'0'},{accountId:'bank',debitRupees:'0',creditRupees:'100'}]}});
 const view=await client.request('venture.desk.get',{...base,id:drafted.id});const row=view.item as any;
 const receipt=await client.request('venture.work.get',{id:row.entry.receiptId});expect(receipt.figures[0]!.display).toBe('INR 100.00');
 expect(receipt.figures.map(figure=>({key:figure.key,minor:figure.minor,currency:figure.currency,unit:figure.unit}))).toEqual([{key:'debit',minor:'10000',currency:'INR',unit:'money'},{key:'credit',minor:'10000',currency:'INR',unit:'money'}]);
 const source=await client.request('venture.files.add',{orderId:order.id,name:'seller-month.csv',contentBase64:btoa('kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Order export,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlement export,100,99,\nfee-slab,one,,Fee card,1,,\ntcs,,,Credit statement,0.50,0.40,CA section to review')});
 const month=await client.request('venture.desk.act',{...base,id:'new',action:'monthly-seller',payload:{cycleId:cycle.id,orderId:order.id,uploadId:source.id,month:'2026-10'}});expect((month.result as any).entry.report.creditDifferenceMinor).toBe('10');
 const monthlyReceipt=await client.request('venture.work.get',{id:(month.result as any).entry.receiptId});expect(monthlyReceipt.figures.find(value=>value.key==='credit-tcs')!.display).toBe('INR 0.10');
 expect(monthlyReceipt.figures.find(value=>value.key==='credit-tcs')).toMatchObject({minor:'10',currency:'INR',unit:'money'});
 const setupFile=await client.request('venture.files.add',{orderId:order.id,name:'setup.csv',contentBase64:btoa('kind,id,name,source,debitRupees,creditRupees\ncustomer,c1,Example client,Client list,,\ncategory,bank,Bank,Statement,,\ncategory,equity,Equity,Statement,,\nopening,bank,,Statement,100,0\nopening,equity,,Statement,0,100')});
 const setup=await client.request('venture.desk.act',{...base,id:'new',action:'draft-setup',payload:{cycleId:cycle.id,orderId:order.id,uploadId:setupFile.id}}),setupView=await client.request('venture.desk.get',{...base,id:setup.id});
 const pack=await client.request('venture.desk.act',{...base,id:setup.id,action:'export-setup',digest:setupView.digest,payload:{}});expect((pack.result as any).posted).toBe(false);expect(JSON.parse((pack.result as any).content).customers[0].name).toBe('Example client');
 await expect(client.request('venture.desk.act',{...base,id:drafted.id,action:'approve-voucher',digest:'old',payload:{}})).rejects.toMatchObject({code:'APPROVAL_STALE'});
 const approved=await client.request('venture.desk.act',{...base,id:drafted.id,action:'approve-voucher',digest:view.digest,payload:{}});expect((approved.result as any).entry.voucher.posted).toBe(false);
 await expect(client.request('venture.desk.list',{...base,filter:{cycleId:'unrelated'}})).rejects.toMatchObject({code:'BOOKS_WORK_NOT_FOUND'});
});
