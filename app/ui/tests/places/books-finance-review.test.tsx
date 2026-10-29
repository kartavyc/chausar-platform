// Independent K2 review: delayed calculations must not cross a selected client context.
import {expect,it} from 'vitest';
import {render,screen,fireEvent,act} from '@testing-library/react';
import {BooksFinance} from '../../src/places/work/desks/BooksFinance';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import type {EngineClient} from '../../src/engine/types';
import {booksClient} from '../helpers/books-client';
it('distinguishes same-year accounting cycles by company and system',async()=>{
 const {client,order}=await booksClient(),base={playbook:'bookkeeping-cfo' as const,kind:'finance'};
 for(const [system,companyId] of [['tally','Shop local'],['zoho','12345']])await client.request('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system,companyId,from:'2026-04-01',to:'2027-03-31'}});
 render(<TextProvider language="en"><EngineProvider client={client}><BooksFinance/></EngineProvider></TextProvider>);fireEvent.click(screen.getByText('Books and receipts'));
 await screen.findByRole('option',{name:order.request});fireEvent.change(screen.getByLabelText('Client order'),{target:{value:order.id}});
 expect(await screen.findByRole('option',{name:/Shop local.*Tally.*2026-04-01/})).toBeTruthy();expect(await screen.findByRole('option',{name:/12345.*Zoho.*2026-04-01/})).toBeTruthy();
});
it.each(['client','cycle'])('does not reopen an old monthly result after changing the %s selection',async(change)=>{
 const {client,order}=await booksClient(),base={playbook:'bookkeeping-cfo' as const,kind:'finance'};
 const cycle=await client.request('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'tally',companyId:'Client books',from:'2026-04-01',to:'2027-03-31'}});
 const file=await client.request('venture.files.add',{orderId:order.id,name:'month.csv',contentBase64:btoa('kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Order export,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlement export,100,99,\ntcs,,,Credit statement,0.50,0.40,CA section to review')});
 let release:()=>void=()=>{},started:()=>void=()=>{};const began=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const delayed={...client,request:async(method:string,p:any)=>{if(method==='venture.desk.act'&&p.action==='monthly-seller'){started();await gate;}return client.request(method as any,p);}} as EngineClient;
 render(<TextProvider language="en"><EngineProvider client={delayed}><BooksFinance/></EngineProvider></TextProvider>);
 fireEvent.click(screen.getByText('Books and receipts'));
 await screen.findByRole('option',{name:order.request});fireEvent.change(screen.getByLabelText('Client order'),{target:{value:order.id}});
 await screen.findByRole('option',{name:/2026-04-01.*2027-03-31/});fireEvent.change(screen.getByLabelText('Finance cycle'),{target:{value:cycle.id}});
 await screen.findAllByRole('option',{name:'month.csv'});fireEvent.change(screen.getByLabelText('Monthly seller file'),{target:{value:file.id}});fireEvent.change(screen.getByLabelText('Accounting month'),{target:{value:'2026-10'}});fireEvent.submit(screen.getByRole('form',{name:'Monthly seller books'}));await began;
 fireEvent.change(screen.getByLabelText(change==='client'?'Client order':'Finance cycle'),{target:{value:''}});
 await act(async()=>{release();await new Promise(resolve=>setTimeout(resolve,80));});
 expect(screen.queryByText('INR 0.10')).toBeNull();
});
it('does not reopen a delayed setup draft after leaving its client cycle',async()=>{
 const {client,order}=await booksClient(),base={playbook:'bookkeeping-cfo' as const,kind:'finance'};
 const cycle=await client.request('venture.desk.act',{...base,id:'new',action:'create-cycle',payload:{orderId:order.id,system:'tally',companyId:'Client books',from:'2026-04-01',to:'2027-03-31'}});
 const file=await client.request('venture.files.add',{orderId:order.id,name:'setup.csv',contentBase64:btoa('kind,id,name,source,debitRupees,creditRupees\ncustomer,c1,Old client details,Client source,,\ncategory,bank,Bank,Statement,,\ncategory,equity,Equity,Statement,,\nopening,bank,,Statement,100,0\nopening,equity,,Statement,0,100')});
 let release:()=>void=()=>{},started:()=>void=()=>{};const began=new Promise<void>(resolve=>{started=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const delayed={...client,request:async(method:string,p:any)=>{if(method==='venture.desk.act'&&p.action==='draft-setup'){started();await gate;}return client.request(method as any,p);}} as EngineClient;
 render(<TextProvider language="en"><EngineProvider client={delayed}><BooksFinance/></EngineProvider></TextProvider>);
 fireEvent.click(screen.getByText('Books and receipts'));
 await screen.findByRole('option',{name:order.request});fireEvent.change(screen.getByLabelText('Client order'),{target:{value:order.id}});
 await screen.findByRole('option',{name:/2026-04-01.*2027-03-31/});fireEvent.change(screen.getByLabelText('Finance cycle'),{target:{value:cycle.id}});
 await screen.findAllByRole('option',{name:'setup.csv'});fireEvent.change(screen.getByLabelText('Receipt file'),{target:{value:file.id}});fireEvent.click(screen.getByRole('button',{name:'Review prepared setup file'}));await began;
 fireEvent.change(screen.getByLabelText('Finance cycle'),{target:{value:''}});
 await act(async()=>{release();await new Promise(resolve=>setTimeout(resolve,80));});
 expect(screen.queryByText('Old client details')).toBeNull();expect(screen.queryByRole('button',{name:'Approve this setup export'})).toBeNull();
});
