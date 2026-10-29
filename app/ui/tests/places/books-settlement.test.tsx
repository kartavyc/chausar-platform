// A deterministic screen fixture only; the shipped demo never fabricates provider evidence.
import {expect,it} from 'vitest';
import {render,screen,fireEvent,waitFor,act,within} from '@testing-library/react';
import {BooksSettlement} from '../../src/places/work/desks/BooksSettlement';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import {assertInkRules} from '../helpers/ink-rules';
import {BooksFinance} from '../../src/places/work/desks/BooksFinance';
import {booksClient} from '../helpers/books-client';
import type {WorkReceiptLite} from '../../src/engine/types';
function fixture(state:string|null=null,missingReceipt=false,options:{language?:'en'|'hi';two?:boolean;missingPayment?:boolean}={}){
 const client=createFakeClient(new FakeEngine()),calls:any[]=[],payments=[{externalId:'payment-one',orderId:'one',source:'Bank payout A',postingDate:'2026-10-28',paymentMode:'banktransfer',accountId:'100',amountMinor:'9900',invoiceReference:'source-invoice-one',unappliedDifferenceMinor:'100'},{externalId:'payment-two',orderId:'two',source:'Bank payout B',postingDate:'2026-10-29',paymentMode:'cash',accountId:'200',amountMinor:'4100',invoiceReference:'source-invoice-two',unappliedDifferenceMinor:'0'}].slice(0,options.two?2:1),posting={uploadId:'payment-file',state:state??'staged',reviewDigest:'exact-one',receiptId:'proof',prepared:payments.map((payment,i)=>({payment,customerId:i?'88':'77',invoiceId:i?'444':'333',method:'POST',path:'customerpayments',query:{},body:i?'{"amount":41.00,"contact_persons":[]}':'{"amount":99.00,"contact_persons":[]}'})),outcomes:[{externalId:'source-payment',state:state==='outcome_unknown'?'outcome_unknown':'pending',remoteId:null}]};let ready=state!==null;
 client.request=(async(method:string,p:any)=>{if(method==='venture.client.list')return [{id:'client-one',name:'Kavya shop'}];if(method==='venture.work.get'){if(missingReceipt)throw Error('no receipt');return {id:'proof',at:'2026-10-29T10:00:00Z',operation:'work.totals',currency:'INR',explanation:'Record confirmed money already received. No charge or bank transfer is made.',steps:[{op:'add',inputs:payments.map(payment=>payment.amountMinor),result:options.two?'14000':'9900',rule:'Sum confirmed paid amounts in paise, matched to the monthly source. No fee or tax credit is invented.'}],figures:[{key:'total',label:'Received settlement total',minor:options.two?'14000':'9900',currency:'INR',unit:'money',display:options.two?'INR 140.00':'INR 99.00'},...payments.filter((_,i)=>!options.missingPayment||i>0).map((payment,i)=>({key:payment.externalId,label:'Received payment: '+payment.orderId,minor:payment.amountMinor,display:payment.externalId==='payment-two'?'INR 41.00':'INR 99.00',currency:'INR',unit:'money' as const}))]} satisfies WorkReceiptLite;}if(method==='venture.desk.get')return {playbook:'bookkeeping-cfo',kind:'settlement',item:{id:'month',clientId:'client-one',orderId:'service-order',entry:{kind:'seller-month',report:{month:'2026-10'},...(ready?{posting:structuredClone(posting)}:{})}},digest:ready?posting.reviewDigest:'month'};if(method==='venture.desk.act'){calls.push(structuredClone(p));ready=true;if(p.action==='apply'){posting.state='recorded';posting.outcomes[0]={externalId:'source-payment',state:'recorded',remoteId:'333' as any};posting.reviewDigest='exact-two';}return {id:'month'};}throw Error(method);}) as typeof client.request;
 render(<TextProvider language={options.language??"en"}><EngineProvider client={client}><BooksSettlement id="month" system="zoho" files={[{id:'payment-file',name:'payments.csv'},{id:'different-file',name:'different.csv'}]}/></EngineProvider></TextProvider>);return {calls};
}
it('prepares from the selected source, exposes exact bytes and receipt, then approves that received-payment record',async()=>{
 const f=fixture();fireEvent.click(screen.getByText('Record received settlements'));const link=screen.getByRole('link',{name:'Download settlement template'});expect(decodeURIComponent(link.getAttribute('href')!)).toContain('settlementId');
 fireEvent.change(await screen.findByLabelText('Received payment source'),{target:{value:'payment-file'}});fireEvent.submit(screen.getByRole('form',{name:'Prepare received payments'}));
 expect(await screen.findAllByText('INR 99.00')).toHaveLength(2);expect(screen.getByText('{"amount":99.00,"contact_persons":[]}').hasAttribute('data-content')).toBe(true);
 expect(f.calls[0]).toEqual({playbook:'bookkeeping-cfo',kind:'settlement',id:'month',action:'stage',payload:{uploadId:'payment-file'}});
 fireEvent.click(screen.getByRole('button',{name:'Approve recording these payments'}));await screen.findByText('Payments recorded and read back');expect(f.calls[1]).toEqual({playbook:'bookkeeping-cfo',kind:'settlement',id:'month',action:'apply',payload:{},digest:'exact-one'});assertInkRules();
});
it('unknown payment outcomes offer no resend, and missing receipts lock approval',async()=>{
 const first=fixture('outcome_unknown');fireEvent.click(screen.getByText('Record received settlements'));await screen.findByText(/A payment may already exist/);expect(screen.queryByRole('button',{name:'Approve recording these payments'})).toBeNull();expect(screen.queryByRole('form',{name:'Prepare received payments'})).toBeNull();expect(first.calls).toEqual([]);assertInkRules();
});
it('does not permit a payment approval without its code receipt',async()=>{fixture('staged',true);fireEvent.click(screen.getByText('Record received settlements'));await waitFor(()=>expect(screen.getByRole('button',{name:'Approve recording these payments'}).getAttribute('aria-disabled')).toBe('true'));assertInkRules();});
it('locks the old dry run when the owner selects a different received-payment source',async()=>{
 const f=fixture('staged');fireEvent.click(screen.getByText('Record received settlements'));await screen.findAllByText('INR 99.00');fireEvent.change(screen.getByLabelText('Received payment source'),{target:{value:'different-file'}});
 const approve=screen.getByRole('button',{name:'Approve recording these payments'});expect(approve.getAttribute('aria-disabled')).toBe('true');fireEvent.click(approve);expect(f.calls).toEqual([]);
});
it.each([false,true])('removes the previous monthly settlement when the owner changes finance cycle (delayed old detail %s)',async(delayed)=>{
 const {client,order}=await booksClient(),base={playbook:'bookkeeping-cfo' as const,kind:'finance'};
 const create=(companyId:string)=>client.request('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'zoho',companyId,from:'2026-04-01',to:'2027-03-31'}}),first=await create('111'),second=await create('222');
 const file=await client.request('venture.files.add',{orderId:order.id,name:'month.csv',contentBase64:btoa('kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Orders,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlements,100,100,')});
 const month=await client.request('venture.desk.act',{...base,id:'new',action:'monthly-seller',payload:{cycleId:first.id,orderId:order.id,uploadId:file.id,month:'2026-10'}});
 let release:(()=>void)|undefined;const request=client.request.bind(client);client.request=(async(method:string,p:any)=>{const result=await request(method as any,p);if(delayed&&method==='venture.desk.get'&&p.kind==='finance'&&p.id===month.id)return new Promise(resolve=>{release=()=>resolve(result);});return result;}) as typeof client.request;
 render(<TextProvider language="en"><EngineProvider client={client}><BooksFinance/></EngineProvider></TextProvider>);
 fireEvent.click(screen.getByText('Books and receipts'));await screen.findByRole('option',{name:order.request});fireEvent.change(screen.getByLabelText('Client order'),{target:{value:order.id}});await screen.findByRole('option',{name:'111 · Zoho Books · 2026-04-01 to 2027-03-31'});fireEvent.change(screen.getByLabelText('Finance cycle'),{target:{value:first.id}});
 fireEvent.click(await screen.findByRole('button',{name:'Monthly seller books'}));if(delayed)await waitFor(()=>expect(release).toBeTruthy());else expect(await screen.findByText('Record received settlements')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Finance cycle'),{target:{value:second.id}});if(delayed)await act(async()=>release!());await waitFor(()=>expect(screen.queryByText('Record received settlements')).toBeNull());
});

it.each(['en','hi'] as const)('explains each exact payment allocation before approval in %s',async language=>{
 const f=fixture('staged',false,{language,two:true});
 fireEvent.click(screen.getByText(language==='en'?'Record received settlements':'मिली हुई भुगतान राशि दर्ज करें'));
 const label=language==='en'?'Payment allocation':'भुगतान का आवंटन';
 const cards=await screen.findAllByRole('group',{name:label});expect(cards).toHaveLength(2);
 expect(await screen.findByText('Kavya shop')).toBeTruthy();
 for(const [i,values] of [['one','77','333','100','2026-10-28','Bank payout A','INR 99.00'],['two','88','444','200','2026-10-29','Bank payout B','INR 41.00']].entries())for(const value of values)expect(within(cards[i]!).getByText(value)).toBeTruthy();
 expect(within(cards[0]!).getByText(language==='en'?'Bank transfer':'बैंक ट्रांसफ़र')).toBeTruthy();
 expect(within(cards[1]!).getByText(language==='en'?'Cash':'नकद')).toBeTruthy();
 expect(screen.queryByText('Received settlement total')).toBeNull();expect(screen.queryByText('Received payment: one')).toBeNull();
 for(const card of cards){expect(card.querySelector('[data-figure] [data-receipt]')??card.querySelector('[data-figure] button')).toBeTruthy();expect(card.querySelector('details')?.open).toBe(false);}
 fireEvent.click(screen.getByRole('button',{name:language==='en'?'Approve recording these payments':'ये भुगतान दर्ज करना मंज़ूर करें'}));
 await waitFor(()=>expect(f.calls).toEqual([{playbook:'bookkeeping-cfo',kind:'settlement',id:'month',action:'apply',payload:{},digest:'exact-one'}]));assertInkRules();
});
it('refuses approval when a prepared payment has no matching receipt figure',async()=>{
 const f=fixture('staged',false,{two:true,missingPayment:true});fireEvent.click(screen.getByText('Record received settlements'));
 await screen.findByText('INR 140.00');const button=await screen.findByRole('button',{name:'Approve recording these payments'});await waitFor(()=>expect(button.getAttribute('aria-disabled')).toBe('true'));fireEvent.click(button);expect(f.calls).toEqual([]);
});
