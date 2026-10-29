// A deterministic screen fixture only; the shipped demo never fabricates provider evidence.
import {expect,it} from 'vitest';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {BooksSettlement} from '../../src/places/work/desks/BooksSettlement';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import {assertInkRules} from '../helpers/ink-rules';
import {BooksFinance} from '../../src/places/work/desks/BooksFinance';
import {booksClient} from '../helpers/books-client';
function fixture(state:string|null=null,missingReceipt=false){
 const client=createFakeClient(new FakeEngine()),calls:any[]=[],posting={uploadId:'payment-file',state:state??'staged',reviewDigest:'exact-one',receiptId:'proof',prepared:[{payment:{orderId:'one'},method:'POST',path:'customerpayments',query:{},body:'{"amount":99.00,"contact_persons":[]}'}],outcomes:[{externalId:'source-payment',state:state==='outcome_unknown'?'outcome_unknown':'pending',remoteId:null}]};let ready=state!==null;
 client.request=(async(method:string,p:any)=>{if(method==='venture.work.get'){if(missingReceipt)throw Error('no receipt');return {id:'proof',figures:[{key:'total',label:'Received settlement total',display:'INR 99.00'}]};}if(method==='venture.desk.get')return {playbook:'bookkeeping-cfo',kind:'settlement',item:{id:'month',entry:{kind:'seller-month',report:{month:'2026-10'},...(ready?{posting:structuredClone(posting)}:{})}},digest:ready?posting.reviewDigest:'month'};if(method==='venture.desk.act'){calls.push(structuredClone(p));ready=true;if(p.action==='apply'){posting.state='recorded';posting.outcomes[0]={externalId:'source-payment',state:'recorded',remoteId:'333' as any};posting.reviewDigest='exact-two';}return {id:'month'};}throw Error(method);}) as typeof client.request;
 render(<TextProvider language="en"><EngineProvider client={client}><BooksSettlement id="month" system="zoho" files={[{id:'payment-file',name:'payments.csv'},{id:'different-file',name:'different.csv'}]}/></EngineProvider></TextProvider>);return {calls};
}
it('prepares from the selected source, exposes exact bytes and receipt, then approves that received-payment record',async()=>{
 const f=fixture();fireEvent.click(screen.getByText('Record received settlements'));const link=screen.getByRole('link',{name:'Download settlement template'});expect(decodeURIComponent(link.getAttribute('href')!)).toContain('settlementId');
 fireEvent.change(await screen.findByLabelText('Received payment source'),{target:{value:'payment-file'}});fireEvent.submit(screen.getByRole('form',{name:'Prepare received payments'}));
 expect(await screen.findByText('INR 99.00')).toBeTruthy();expect(screen.getByText('{"amount":99.00,"contact_persons":[]}').hasAttribute('data-content')).toBe(true);
 expect(f.calls[0]).toEqual({playbook:'bookkeeping-cfo',kind:'settlement',id:'month',action:'stage',payload:{uploadId:'payment-file'}});
 fireEvent.click(screen.getByRole('button',{name:'Approve recording these payments'}));await screen.findByText('Payments recorded and read back');expect(f.calls[1]).toEqual({playbook:'bookkeeping-cfo',kind:'settlement',id:'month',action:'apply',payload:{},digest:'exact-one'});assertInkRules();
});
it('unknown payment outcomes offer no resend, and missing receipts lock approval',async()=>{
 const first=fixture('outcome_unknown');fireEvent.click(screen.getByText('Record received settlements'));await screen.findByText(/A payment may already exist/);expect(screen.queryByRole('button',{name:'Approve recording these payments'})).toBeNull();expect(screen.queryByRole('form',{name:'Prepare received payments'})).toBeNull();expect(first.calls).toEqual([]);assertInkRules();
});
it('does not permit a payment approval without its code receipt',async()=>{fixture('staged',true);fireEvent.click(screen.getByText('Record received settlements'));await waitFor(()=>expect(screen.getByRole('button',{name:'Approve recording these payments'}).getAttribute('aria-disabled')).toBe('true'));assertInkRules();});
it('locks the old dry run when the owner selects a different received-payment source',async()=>{
 const f=fixture('staged');fireEvent.click(screen.getByText('Record received settlements'));await screen.findByText('INR 99.00');fireEvent.change(screen.getByLabelText('Received payment source'),{target:{value:'different-file'}});
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
