// Chausar kit order intake, 5M. Original tests at the New order sheet boundary.
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { BlueprintViewLite, MethodName, OfferIntakeLite } from '../../src/engine/types';

const kit: NonNullable<OfferIntakeLite['kit']> = [
  { id: 'city', label: 'City', help: 'Where the clients are.', kind: 'text', required: true },
  { id: 'channel', label: 'Contact channel', help: 'Choose one.', kind: 'choice', required: true, options: ['Email', 'LinkedIn'] },
  { id: 'consent', label: 'Client agreed', help: 'Record their permission.', kind: 'consent', required: true },
  { id: 'warm', label: 'Already knows you', help: 'Yes or no.', kind: 'yes-no', required: true },
  { id: 'days', label: 'Send days', help: 'One entry per line.', kind: 'list', required: true },
  { id: 'starts', label: 'Start date', help: 'A calendar day.', kind: 'date', required: false },
  { id: 'budget', label: 'Client budget', help: 'Their budget.', kind: 'money', required: false },
];

async function open(fields = kit, draftCurrency = 'INR') {
  const engine = new FakeEngine();
  await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_shorts', unitPrice: '8000' }] } });
  const base = await engine.request('venture.blueprint.get', {}) as BlueprintViewLite;
  const view: BlueprintViewLite = { ...base, blueprint: {...base.blueprint,backOffice:{...base.blueprint.backOffice,currency:draftCurrency}}, intake: { offer_shorts: { rights: [], fields: [], kit: fields } } };
  const client = createFakeClient(engine);
  const request = client.request.bind(client);
  const orders: unknown[] = [];
  client.request = ((method: MethodName, params: unknown) => {
    if (method === 'venture.blueprint.get') return Promise.resolve(view);
    if (method === 'venture.voiceConsent.list') return Promise.resolve({ consents: [{ id: 'voiceconsent_asha', speaker: 'Asha Rao', state: 'current' }], line: '' });
    if (method === 'venture.order.create') {
      orders.push(params);
      return Promise.resolve({ id: 'o-kit', at: '2026-10-27T09:00:00.000Z', clientId: 'c-boat', offerId: 'offer_shorts', quantity: '1', request: 'Local pipeline', status: 'open', priceReceiptId: 'R-1', deliveredOn: null });
    }
    return request(method, params as never);
  }) as typeof client.request;
  window.location.hash = '#/work';
  render(<App client={client} language="en" />);
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'New order' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  const sheet = await screen.findByRole('complementary', { name: 'New order' });
  const who = await within(sheet).findByLabelText('Client');
  await within(who).findByRole('option', { name: 'Boat Audio' });
  fireEvent.change(who, { target: { value: 'c-boat' } });
  const service = within(sheet).getByLabelText('Service');
  await within(service).findByRole('option', { name: 'Shorts from your long video' });
  fireEvent.change(service, { target: { value: 'offer_shorts' } });
  fireEvent.change(within(sheet).getByLabelText('What they asked for'), { target: { value: 'Local pipeline' } });
  const submit = () => within(sheet).getByRole('button', { name: 'Add order' }) as HTMLButtonElement;
  return { sheet, orders, submit, service };
}

function complete(sheet: HTMLElement) {
  fireEvent.change(within(sheet).getByLabelText('City'), { target: { value: '  Mumbai  ' } });
  fireEvent.change(within(sheet).getByLabelText('Contact channel'), { target: { value: 'Email' } });
  fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Client agreed' }));
  fireEvent.change(within(sheet).getByLabelText('Already knows you'), { target: { value: 'no' } });
  fireEvent.change(within(sheet).getByLabelText('Send days'), { target: { value: 'Monday\nFriday\nMonday' } });
}

describe('kit fields in New order', () => {
  it('asks only the selected offer fields, blocks missing required answers, and preserves an explicit no', async () => {
    const { sheet, orders, submit } = await open();
    expect(submit().disabled).toBe(true);
    complete(sheet);
    expect(submit().disabled).toBe(false);
    await act(async () => { fireEvent.click(submit()); });
    expect(orders).toEqual([{ clientId: 'c-boat', offerId: 'offer_shorts', request: 'Local pipeline', intake: {
      fields: { city: 'Mumbai', channel: 'Email', consent: true, warm: false, days: ['Monday', 'Friday'] },
    } }]);
  });

  it('passes rupee text to the engine without computing paise and excludes absent optional fields', async () => {
    const { sheet, orders, submit } = await open();
    complete(sheet);
    fireEvent.change(within(sheet).getByLabelText('Client budget'), { target: { value: '125.50' } });
    await act(async () => { fireEvent.click(submit()); });
    expect(orders[0]).toMatchObject({ intake: { moneyAmounts: { budget: '125.50' } } });
    expect((orders[0] as { intake: { fields: object } }).intake.fields).not.toHaveProperty('budget');
  });
});

it('lets an owner choose current consent by speaker name, without typing an internal reference', async () => {
 const { sheet, orders, submit } = await open([{ id: 'people', label: 'People in the work', help: 'Their current consent.', kind: 'people', required: true }]);
 expect(submit().disabled).toBe(true);
 fireEvent.click(within(sheet).getByRole('button', { name: 'Add a person' }));
 const consent = await within(sheet).findByRole('combobox', { name: 'Recorded consent' });
 await within(consent).findByRole('option', { name: 'Asha Rao' });
 fireEvent.change(consent, { target: { value: 'voiceconsent_asha' } });
 expect(submit().disabled).toBe(false);
 await act(async () => { fireEvent.click(submit()); });
 expect(orders[0]).toMatchObject({ intake: { fields: { people: [{ name: 'Asha Rao', consentId: 'voiceconsent_asha' }] } } });
});
it('accepts a client file while creating the first order and sends it for atomic intake', async () => {
 const { sheet, orders, submit } = await open([{ id: 'ledger', label: 'Client ledger', help: 'The client file.', kind: 'file', required: true }]);
 const input = within(sheet).getByLabelText('Client ledger') as HTMLInputElement;
 expect(input.type).toBe('file');
 fireEvent.change(input, { target: { files: [new File(['item,amount\nsale,125.50'], 'ledger.csv', { type: 'text/csv' })] } });
 expect(submit().disabled).toBe(false);
 await act(async () => { fireEvent.click(submit()); });
 expect(orders[0]).toMatchObject({ intakeFiles: { ledger: { name: 'ledger.csv', contentBase64: btoa('item,amount\nsale,125.50') } }, intake: { fields: {} } });
});

import { KitIntakeFields } from '../../src/places/work/KitIntakeFields';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { NewOrderSheet } from '../../src/places/work/NewOrderSheet';

it('shows a country-read failure instead of leaving an unexplained locked order form', async () => {
  const client = createFakeClient(new FakeEngine());
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params: unknown) => method === 'venture.get'
    ? Promise.reject(new Error('Business country could not be loaded.'))
    : request(method, params as never)) as typeof client.request;
  render(<EngineProvider client={client}><TextProvider language="en"><NewOrderSheet id="new" onClose={() => {}} returnFocus={() => {}} /></TextProvider></EngineProvider>);
  expect(await screen.findByText(/Business country could not be loaded/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Add order' })).toBeNull();
});

it('money intake labels the accepted order currency without changing typed amounts',()=>{
 render(<EngineProvider client={createFakeClient(new FakeEngine())}><TextProvider language="en"><KitIntakeFields ask={{rights:[],fields:[],kit:[{id:'budget',label:'Budget',help:'Client budget',kind:'money',required:false}]}} answers={{budget:'250'}} onChange={()=>{}} currency="JPY" /></TextProvider></EngineProvider>);
 expect(screen.getByText(/Enter JPY/)).toBeTruthy();expect((screen.getByLabelText('Budget') as HTMLInputElement).value).toBe('250');expect(screen.queryByText(/Enter rupees/)).toBeNull();
});

it('a pending country draft cannot change the currency label on a new order',async()=>{
 const {sheet}=await open(kit,'JPY');
 expect(within(sheet).getByText(/Enter INR/)).toBeTruthy();
 expect(within(sheet).queryByText(/Enter JPY/)).toBeNull();
});
