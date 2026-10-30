// Support owner flow and Hindi, original Chausar tests; no outside code.
import {describe,it,expect} from 'vitest';
import {act,fireEvent,render,screen,within} from '@testing-library/react';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import {SupportDeskDesk} from '../../src/places/work/desks/SupportDeskDesk';
import {assertInkRules} from '../helpers/ink-rules';
const settle=()=>act(async()=>{for(let i=0;i<4;i++)await new Promise(r=>setTimeout(r,0));});
function start(language:'en'|'hi'='en'){const client=createFakeClient(new FakeEngine({now:()=> '2026-10-27T10:00:00.000Z'}));render(<EngineProvider client={client}><TextProvider language={language}><SupportDeskDesk/></TextProvider></EngineProvider>);return client;}
const type=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
describe('Support owner desk',()=>{
 it('proposes and confirms a ticket before a sourced reply, then offers only an unsent handoff',async()=>{
  const client=start();const orders=await client.request('venture.order.list',{});const order=orders.find(o=>o.status!=='cancelled')!;await client.request('venture.files.add',{orderId:order.id,name:'tracking.csv',contentBase64:btoa('Order,State\nA,In transit')});await screen.findByRole('heading',{name:'Support queue'});
  fireEvent.click(screen.getByRole('button',{name:'Add a ticket'}));
  type('Shop service order',order.id);
  type('Customer email','buyer@example.com');type('Subject','Parcel late');
  fireEvent.click(screen.getByRole('button',{name:'Review ticket'}));await settle();
  const ticket=await screen.findByRole('button',{name:'Parcel late'});fireEvent.click(ticket);await settle();
  fireEvent.click(screen.getByRole('button',{name:'Confirm ticket'}));await settle();
  fireEvent.click(screen.getByText('Reply address'));type('Shop reply mailbox','help@shop.example');fireEvent.click(screen.getByRole('button',{name:'Create reply address'}));await settle();expect(screen.getByText(/^help\+s\.[a-f0-9]{32}@shop\.example$/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Add a reply'}));
  type('Draft before translation','Please check the carrier tracking.');type('Customer-language reply','Please check the carrier tracking.');type('Shop sources','tracking.csv');
  fireEvent.click(screen.getByRole('button',{name:'Keep draft'}));await settle();
  fireEvent.click(screen.getByRole('button',{name:'Approve reply'}));await settle();
  fireEvent.click(screen.getByRole('button',{name:'Open sending options'}));await settle();
  expect(screen.getByRole('link',{name:'Open mail app'}).getAttribute('href')).toMatch(/^mailto:/);
  expect(screen.getByText('Nothing was sent. Send from the shop mailbox, then record it here.')).toBeTruthy();
  assertInkRules(document.body);
 });
 it('words the empty state and controls in Hindi',async()=>{
  start('hi');await screen.findByRole('heading',{name:'सहायता कतार'});
  expect(screen.getByRole('button',{name:'टिकट जोड़ें'})).toBeTruthy();
  expect(await screen.findByText('क्लाइंट मेल से एक टिकट जोड़ें। हर जवाब आप मंज़ूर करके ख़ुद भेजते हैं।')).toBeTruthy();
  assertInkRules(document.body);
 });
});


it('shows a repair instruction for each unknown mail check',async()=>{
 start();await screen.findByRole('heading',{name:'Support queue'});fireEvent.click(screen.getByText('Mail domain readiness'));type('Shop mail domain','shop.example');type('DKIM selector from your mail provider','mail');fireEvent.click(screen.getByRole('button',{name:'Re-check'}));await settle();
 expect(screen.getByText('Ask your mail provider for the domain mail-exchanger records.')).toBeTruthy();expect(screen.getByText('Add the SPF record supplied by your mail provider.')).toBeTruthy();expect(screen.getByText('Add the DKIM public key supplied for this selector.')).toBeTruthy();expect(screen.getByText('Ask your mail provider to help publish a DMARC policy.')).toBeTruthy();
});
it('asks the owner to choose a customer order from the shop source',async()=>{
 const client=start();const order=(await client.request('venture.order.list',{})).find(o=>o.status!=='cancelled')!;await client.request('venture.files.add',{orderId:order.id,name:'customers.csv',contentBase64:btoa('customerId,email,phone,orderNumber\nbuyer-a,buyer@example.com,9876543210,SHOP-A')});await screen.findByRole('heading',{name:'Support queue'});fireEvent.click(screen.getByRole('button',{name:'Add a ticket'}));type('Shop service order',order.id);type('Customer email','buyer@example.com');type('Subject','Customer match');fireEvent.click(screen.getByRole('button',{name:'Review ticket'}));await settle();
 type('Customer order match',screen.getByRole('option',{name:'buyer-a: SHOP-A (customers.csv)'}).getAttribute('value')!);fireEvent.click(screen.getByRole('button',{name:'Confirm ticket'}));await settle();expect(screen.getByRole('button',{name:'Add a reply'})).toBeTruthy();
});
