import {expect,it} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {BooksFinance} from '../../src/places/work/desks/BooksFinance';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import {booksClient} from '../helpers/books-client';
import {assertInkRules} from '../helpers/ink-rules';
it('distinguishes companies and accounting systems for the same client period',async()=>{
 const {client,order}=await booksClient();
 for(const [system,companyId] of [['tally','Client books'],['zoho','12345']])await client.request('venture.desk.act',{playbook:'bookkeeping-cfo',kind:'finance',id:'new',action:'create-cycle',payload:{orderId:order.id,system,companyId,from:'2026-04-01',to:'2027-03-31'}});
 render(<TextProvider language="en"><EngineProvider client={client}><BooksFinance/></EngineProvider></TextProvider>);
 fireEvent.click(screen.getByText('Books and receipts'));await screen.findByRole('option',{name:order.request});fireEvent.change(screen.getByLabelText('Client order'),{target:{value:order.id}});
 expect(await screen.findByRole('option',{name:'Client books · Tally · 2026-04-01 to 2027-03-31'})).toBeTruthy();
 expect(screen.getByRole('option',{name:'12345 · Zoho Books · 2026-04-01 to 2027-03-31'})).toBeTruthy();
});
it('owner drafts a receipt voucher with rupee text and reviews each entry before approval',async()=>{
 const {client,order}=await booksClient();
 const file=await client.request('venture.files.add',{orderId:order.id,name:'receipt.csv',contentBase64:btoa('vendor,amount\nLandlord,100')});
 const monthly=await client.request('venture.files.add',{orderId:order.id,name:'seller-month.csv',contentBase64:btoa('kind,orderId,on,source,expectedRupees,paidRupees,detail\norder,one,2026-10-27,Order export,,,\nsettlement,one,2026-10-28T10:00:00Z,Settlement export,100,99,\nfee-slab,one,,Fee card,1,,\ntcs,,,Credit statement,0.50,0.40,CA section to review')});
 render(<TextProvider language="en"><EngineProvider client={client}><BooksFinance/></EngineProvider></TextProvider>);
 fireEvent.click(screen.getByText('Books and receipts'));
 for(const [name,header] of [['Download setup template','kind,id,name,source,debitRupees,creditRupees'],['Download posting template','shopId,orderId,source,occurredAt'],['Download monthly template','kind,orderId,on,source,expectedRupees,paidRupees,detail']]){const link=screen.getByRole('link',{name});expect(decodeURIComponent(link.getAttribute('href')!)).toContain(header);expect(link.hasAttribute('download')).toBe(true);}
 fireEvent.change(await screen.findByLabelText('Client order'),{target:{value:order.id}});
 fireEvent.change(screen.getByLabelText('Company in the accounting system'),{target:{value:'Client books'}});
 fireEvent.change(screen.getByLabelText('Cycle starts'),{target:{value:'2026-04-01'}});
 fireEvent.change(screen.getByLabelText('Cycle ends'),{target:{value:'2027-03-31'}});
 fireEvent.submit(screen.getByRole('form',{name:'Create a finance cycle'}));
 await waitFor(()=>expect(screen.getByRole('option',{name:'Client books · Tally · 2026-04-01 to 2027-03-31'})).toBeTruthy());
 fireEvent.change(screen.getByLabelText('Receipt file'),{target:{value:file.id}});
 fireEvent.change(screen.getByLabelText('Receipt date'),{target:{value:'2026-10-28'}});
 fireEvent.change(screen.getByLabelText('What this entry records'),{target:{value:'Rent receipt'}});
 fireEvent.change(screen.getByLabelText('Debit account'),{target:{value:'rent'}});
 fireEvent.change(screen.getByLabelText('Credit account'),{target:{value:'bank'}});
 fireEvent.change(screen.getByLabelText('Amount in rupees'),{target:{value:'100'}});
 fireEvent.submit(screen.getByRole('form',{name:'Draft a receipt voucher'}));
 expect(await screen.findByRole('button',{name:'Approve these entries'})).toBeTruthy();expect(screen.getAllByText('INR 100.00').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('button',{name:'Approve these entries'}));
 expect(await screen.findByText('Approved for the bookkeeper. Nothing posted.')).toBeTruthy();assertInkRules();
 fireEvent.change(screen.getByLabelText('Monthly seller file'),{target:{value:monthly.id}});fireEvent.change(screen.getByLabelText('Accounting month'),{target:{value:'2026-10'}});
 fireEvent.submit(screen.getByRole('form',{name:'Monthly seller books'}));
 expect(await screen.findByText('INR 0.10')).toBeTruthy();expect(screen.getByText('A CA must confirm tax sections. Nothing was posted or filed.')).toBeTruthy();assertInkRules();
 const setupFile=await client.request('venture.files.add',{orderId:order.id,name:'setup.csv',contentBase64:btoa('kind,id,name,source,debitRupees,creditRupees\ncustomer,c1,Example client,Client list,,\ncategory,bank,Bank,Statement,,\ncategory,equity,Equity,Statement,,\nopening,bank,,Statement,100,0\nopening,equity,,Statement,0,100')});
 // Selecting the same order again refreshes the uploaded-file list and leaves the existing cycle available.
 fireEvent.change(screen.getByLabelText('Client order'),{target:{value:''}});fireEvent.change(screen.getByLabelText('Client order'),{target:{value:order.id}});fireEvent.change(screen.getByLabelText('Finance cycle'),{target:{value:screen.getByRole('option',{name:'Client books · Tally · 2026-04-01 to 2027-03-31'}).getAttribute('value')}});
 await screen.findAllByRole('option',{name:'setup.csv'});fireEvent.change(screen.getByLabelText('Receipt file'),{target:{value:setupFile.id}});fireEvent.click(screen.getByRole('button',{name:'Review prepared setup file'}));
 expect(await screen.findByText('Example client')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Approve this setup export'}));expect(await screen.findByRole('link',{name:'Download setup review package'})).toBeTruthy();assertInkRules();
});
