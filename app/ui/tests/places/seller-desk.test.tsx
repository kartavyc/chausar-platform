// Seller desk UI, Chausar original code; export-first safety from sealeap (MIT) ideas.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { createFakeClient, FakeEngine } from '../../src/engine/fake';
import { OnlineSellerDesk } from '../../src/places/work/desks/OnlineSellerDesk';

describe('Seller desk', () => {
  it('starts with one check action and explains source coverage, no automatic marketplace changes', async () => {
    render(<TextProvider language="en"><EngineProvider client={createFakeClient(new FakeEngine())}><OnlineSellerDesk /></EngineProvider></TextProvider>);
    const region = await screen.findByRole('region', { name: 'Seller desk' });
    expect(within(region).getByLabelText('Seller CSV export')).toBeTruthy();
    expect(within(region).getByText('You upload every marketplace change yourself.')).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Check the export' }).getAttribute('aria-disabled')).toBe('true');
    expect(region.textContent).not.toContain('Not built yet');
  });
});

it('checks an uploaded ads export, opens its real code receipt and keeps the result on remount', async () => {
  const client = createFakeClient(new FakeEngine());
  const renderDesk = () => render(<TextProvider language="en"><EngineProvider client={client}><OnlineSellerDesk /></EngineProvider></TextProvider>);
  const first = renderDesk();
  const region = await screen.findByRole('region', { name: 'Seller desk' });
  await screen.findByRole('option', { name: /Sponsor|episode|script/i });
  fireEvent.change(within(region).getByLabelText('Check'), { target: { value: 'ads' } });
  fireEvent.change(within(region).getByLabelText('Seller CSV export'), { target: { files: [new File(['spendMinor,salesMinor,reportedAcosBps,basis,source,observedAt\n8000,99900,803,,Owner ads export,2026-10-27T10:00:00Z'], 'ads.csv', { type: 'text/csv' })] } });
  fireEvent.click(within(region).getByRole('button', { name: 'Check the export' }));
  const report = await screen.findByRole('region', { name: 'Seller check' });
  expect(report.textContent).toContain('8.01%');
  expect(within(report).getByText(/Break-even needs/)).toBeTruthy();
  fireEvent.click(within(report).getByRole('button', { name: /receipt/i }));
  expect(await screen.findByRole('complementary', { name: 'Calculation receipt' })).toBeTruthy();
  first.unmount(); renderDesk();
  expect(await screen.findByRole('list', { name: 'Saved checks' })).toBeTruthy();
});

it('the fake seller engine checks a source export using its real shape', async () => {
  const client = createFakeClient(new FakeEngine());
  const orders = await client.request('venture.order.list', {});
  const order = orders.find(item => item.status === 'open')!;
  const result = await client.request('venture.desk.act', { playbook: 'online-seller', kind: 'sku', id: order.id, action: 'inspect', payload: { orderId: order.id, mode: 'ads', name: 'ads.csv', contentBase64: btoa('spendMinor,salesMinor,reportedAcosBps,basis,source,observedAt\n8000,99900,803,,Owner ads export,2026-10-27T10:00:00Z') } });
  expect(result.result).toMatchObject({ mode: 'ads', figures: [{ key: 'acosBps', display: '8.01%' }] });
});
it('shows the ads mismatch instead of only the recomputed ratio', async () => {
  const client=createFakeClient(new FakeEngine());
  const order=(await client.request('venture.order.list',{})).find(o=>o.status==='open')!;
  await client.request('venture.desk.act',{playbook:'online-seller',kind:'sku',id:order.id,action:'inspect',payload:{orderId:order.id,mode:'ads',name:'ads.csv',contentBase64:btoa('spendMinor,salesMinor,reportedAcosBps,basis,source,observedAt\n8000,99900,803,,Owner export,2026-10-27T10:00:00Z')}});
  render(<TextProvider language="en"><EngineProvider client={client}><OnlineSellerDesk /></EngineProvider></TextProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'Read check'}));
  expect(await screen.findByText('The ads report does not reconcile.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Check'), {target:{value:'ads'}});
  expect(screen.getByLabelText('Economics CSV (optional)')).toBeTruthy();
});
it('shows settlement hold reasons and source-backed named differences', async () => {
  const client=createFakeClient(new FakeEngine());
  const order=(await client.request('venture.order.list',{})).find(o=>o.status==='open')!;
  await client.request('venture.desk.act',{playbook:'online-seller',kind:'sku',id:order.id,action:'inspect',payload:{orderId:order.id,mode:'settlement',name:'settlement.csv',contentBase64:btoa('orderId,expectedMinor,paidMinor,source,observedAt,holdReasons\norder-one,10000,9000,Owner statement,2026-10-27T10:00:00Z,Wait for fee card')}});
  render(<TextProvider language="en"><EngineProvider client={client}><OnlineSellerDesk /></EngineProvider></TextProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'Read check'}));
  expect(await screen.findByText('Wait for fee card')).toBeTruthy();
  expect(screen.getAllByText('Unexplained settlement balance').length).toBeTruthy();
});
it('shows each settlement split and total with its order and receipt',async()=>{
 const client=createFakeClient(new FakeEngine());const order=(await client.request('venture.order.list',{})).find(o=>o.status==='open')!;
 await client.request('venture.desk.act',{playbook:'online-seller',kind:'sku',id:order.id,action:'inspect',payload:{orderId:order.id,mode:'settlement',name:'settlements.csv',contentBase64:btoa('orderId,expectedMinor,paidMinor,source,observedAt,feeSlabMinor,feeSlabMinorSource\norder-a,10000,9000,Statement,2026-10-27T10:00:00Z,250,Fee card\norder-b,5000,5000,Statement,2026-10-27T10:00:00Z,0,Fee card')}});
 render(<TextProvider language="en"><EngineProvider client={client}><OnlineSellerDesk/></EngineProvider></TextProvider>);
 fireEvent.click(await screen.findByRole('button',{name:'Read check'}));
 const report=await screen.findByRole('region',{name:'Seller check'});
 expect(within(report).getByText('order-a: Fee slab')).toBeTruthy();expect(within(report).getByText('INR 2.50')).toBeTruthy();
 expect(within(report).getByText('order-a: Unknown difference')).toBeTruthy();expect(within(report).getByText('INR 7.50')).toBeTruthy();
 expect(within(report).getByText('order-b: Fee slab')).toBeTruthy();
 expect(within(report).getByText('order-a: Payout difference')).toBeTruthy();
 expect(within(report).getAllByRole('button',{name:/receipt/i})).toHaveLength(5);
});
import {SELLER_INDIA_DATA} from '../../../../platform/runtime/venture/playbooks/online-seller/metadata';
it('shows keep move and remove decisions beside the exact title words',async()=>{
 const trusted=SELLER_INDIA_DATA as {checkedOn:string;confirmedBy:{name:string;on:string}|null};const prior=trusted.confirmedBy;
 try{
  trusted.confirmedBy={name:'Fixture lawyer',on:'2026-10-27'};
  const client=createFakeClient(new FakeEngine());const order=(await client.request('venture.order.list',{})).find(o=>o.status==='open')!;
  await client.request('venture.desk.act',{playbook:'online-seller',kind:'sku',id:order.id,action:'inspect',payload:{orderId:order.id,mode:'listing',name:'listing.csv',contentBase64:btoa('marketplace,title,bullets,description,packaged,sellingMinor,mrpMinor,countryOfOrigin,sellerDetails\namazon-in,Best cup cup,Steel,Steel cup,yes,10000,12000,India,Owner shop')}});
  render(<TextProvider language="en"><EngineProvider client={client}><OnlineSellerDesk/></EngineProvider></TextProvider>);
  fireEvent.click(await screen.findByRole('button',{name:'Read check'}));
  const triage=await screen.findByRole('list',{name:'Title phrases'});
  expect(within(triage).getByText('Best')).toBeTruthy();expect(within(triage).getAllByText('cup')).toHaveLength(2);
  expect(triage.textContent).toContain('Remove');expect(triage.textContent).toContain('Keep');expect(triage.textContent).toContain('Move to bullets');
 }finally{trusted.confirmedBy=prior;}
});
