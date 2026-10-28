// Real collections desk interactions and engine/fake refusals, after finance-skills (MIT ideas).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { BookkeepingCfoDesk } from '../../src/places/work/desks/BookkeepingCfoDesk';
import { assertInkRules } from '../helpers/ink-rules';

async function start(language: 'en' | 'hi' = 'en') {
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-27T12:00:00.000Z' }));
  const order = (await client.request('venture.order.list', {}))[0]!;
  await client.request('venture.files.add', { orderId: order.id, name: 'collections.csv', contentBase64: btoa('kind,id,invoice,debtor,on,dueOn,amount,state\ninvoice,buyer-a,INV-A,Buyer,2026-10-01,2026-10-10,100,open') });
  const spy = vi.spyOn(client, 'request');
  render(<TextProvider language={language}><EngineProvider client={client}><BookkeepingCfoDesk /></EngineProvider></TextProvider>);
  return { client, spy };
}

describe('Collections desk', () => {
  it('opens with a plain client-only boundary and a payment promise action', async () => {
    await start();
    expect(await screen.findByRole('heading', { name: 'Collections' })).toBeTruthy();
    expect(screen.getByText('Your client reviews and sends every reminder. Chausar never contacts debtors.')).toBeTruthy();
    expect(await screen.findByText('No payment promises yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Record a promise' }));
    expect(screen.getByLabelText('Promised amount in rupees')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('sends rupee text unchanged, records the promise and re-reads the engine list', async () => {
    const { spy } = await start();
    fireEvent.click(await screen.findByRole('button', { name: 'Record a promise' }));
    const invoice = await screen.findByLabelText('Invoice');
    const options = invoice.querySelectorAll('option');
    const selected = [...options].find(option => option.value !== '');
    expect(selected).toBeTruthy();
    fireEvent.change(invoice, { target: { value: selected!.value } });
    fireEvent.change(screen.getByLabelText('Promised amount in rupees'), { target: { value: '100.50' } });
    fireEvent.change(screen.getByLabelText('Promised date'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Who promised'), { target: { value: 'Client contact' } });
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'UPI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve and record promise' }));
    expect(await screen.findByText('Client contact')).toBeTruthy();
    const call = spy.mock.calls.find(([method, params]) => method === 'venture.desk.act' && (params as any).action === 'record');
    expect((call?.[1] as any).payload.amountRupees).toBe('100.50');
    expect((call?.[1] as any).payload.method).toBe('UPI');
    expect(screen.queryByText('10050')).toBeNull();
    assertInkRules(document.body);
  });

  it('shows the desk in Hindi, including the debtor boundary', async () => {
    await start('hi');
    expect(await screen.findByRole('heading', { name: 'वसूली' })).toBeTruthy();
    expect(screen.getByText('आपका क्लाइंट हर याद दिलाने वाला संदेश जांचकर भेजता है। चौसर देनदारों से संपर्क नहीं करता।')).toBeTruthy();
    assertInkRules(document.body);
  });
});
