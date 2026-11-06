import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, InvoiceViewLite } from '../../src/engine/types';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * Wave 6 money on the invoice sheet (6D1 to 6D3): how clients pay (the UPI QR code the engine drew, the UPI ID, bank
 * details), the file and the share links that open the owner's own apps, billing part of an order from a draft, the
 * owner's billing settings in their own sheet, and a Razorpay payment link (fixture-tested) made only after a second ask.
 */

type Call = [string, unknown];
const NOW = '2026-10-23T10:00:00.000Z';

async function start(hash: string, before?: (engine: FakeEngine) => Promise<void>) {
  const engine = new FakeEngine({ now: () => NOW });
  await before?.(engine);
  window.location.hash = hash;
  const base = createFakeClient(engine);
  const calls: Call[] = [];
  const request = base.request.bind(base);
  const client: EngineClient = { ...base, request: (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as EngineClient['request'] };
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return { engine, calls };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const type = async (scope: HTMLElement, label: string, value: string) => { await act(async () => { fireEvent.change(within(scope).getByLabelText(label), { target: { value } }); }); };

describe('Money w6: how clients pay', () => {
  it('with no way to pay set up, the sheet says so and opens the billing settings', async () => {
    await start('#/money/invoices?sheet=invoice:inv-0039');
    const panel = await screen.findByRole('complementary', { name: 'INV-0039' });
    const pay = await within(panel).findByRole('region', { name: 'How clients pay' });
    expect(pay.textContent).toContain('Add your UPI ID or bank details so clients can pay you.');
    await click(within(pay).getByRole('button', { name: 'Set up' }));
    await waitFor(() => expect(window.location.hash).toMatch(/sheet=billing/));
  });

  it('the billing sheet refuses a UPI ID that is not one, in the engine\'s words, and saves a good one', async () => {
    const { calls } = await start('#/money/invoices?sheet=billing:settings');
    const panel = await screen.findByRole('complementary', { name: 'How clients pay' });
    await waitFor(() => expect((within(panel).getByLabelText('Days until an invoice is due') as HTMLInputElement).value).toBe('7'));
    await type(panel, 'UPI ID', 'lumen studio');
    await click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText(/Use a UPI ID like yourname@okbank\./)).toBeTruthy();
    await type(panel, 'UPI ID', 'lumen.studio@okaxis');
    await click(within(panel).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.billing.set', expect.objectContaining({ upiId: 'lumen.studio@okaxis' })]));
    expect(await within(panel).findByText('Saved.')).toBeTruthy();
    expect(panel.textContent).toContain('Not tried live yet');
    assertInkRules(panel);
  });

  it('an issued invoice shows the QR code, the UPI ID and the amount on its receipt, and the file and share buttons', async () => {
    const { calls } = await start('#/money/invoices?sheet=invoice:inv-0039', async (engine) => { await engine.request('venture.billing.set', { upiId: 'lumen.studio@okaxis' }); });
    const panel = await screen.findByRole('complementary', { name: 'INV-0039' });
    const pay = await within(panel).findByRole('region', { name: 'How clients pay' });
    const qr = within(pay).getByRole('img', { name: 'UPI QR code for INV-0039' });
    expect(qr.tagName.toLowerCase()).toBe('svg');
    expect(pay.textContent).toContain('lumen.studio@okaxis');
    expect(pay.querySelector('[data-figure-group]')?.textContent).toContain('₹26,200');
    await click(within(pay).getByRole('button', { name: 'Save file' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.pdf', { invoiceId: 'inv-0039' }]));
    expect(await within(pay).findByText('A PDF needs the desktop app.')).toBeTruthy();
    expect(within(pay).getByRole('button', { name: 'Share on WhatsApp' })).toBeTruthy();
    expect(within(pay).getByRole('button', { name: 'Email it' })).toBeTruthy();
    assertInkRules(panel);
    assertOnePrimary(panel);
  });

  it('a draft can bill part of its order instead, and the sheet then shows the part', async () => {
    let draft: InvoiceViewLite | null = null;
    const { calls } = await start('#/money/invoices', async (engine) => {
      draft = await engine.request('venture.invoice.prepare', { orderId: 'o-boat-14' }) as InvoiceViewLite;
      window.location.hash = `#/money/invoices?sheet=invoice:${draft.invoice.id}`;
    });
    window.location.hash = `#/money/invoices?sheet=invoice:${draft!.invoice.id}`;
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const panel = await screen.findByRole('complementary', { name: 'Draft invoice' });
    await click(within(panel).getByText('Bill part of the order'));
    await act(async () => { fireEvent.change(within(panel).getByLabelText('Kind'), { target: { value: 'advance' } }); });
    await type(panel, 'Share of the order, in percent', '40');
    await click(within(panel).getByRole('button', { name: 'Draft this part' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.prepare', { orderId: 'o-boat-14', part: { kind: 'advance', percent: '40' } }]));
    const parted = await screen.findByRole('complementary', { name: 'Draft invoice' });
    await waitFor(() => expect(parted.querySelector('[data-part="advance"]')?.textContent).toBe('Advance'));
  });

  it('a payment link says Not tried live yet and is made only after a second ask, with the digest shown', async () => {
    const keyId = ['rzp', 'test', 'Sample0Key9'].join('_');
    const { calls } = await start('#/money/invoices?sheet=invoice:inv-0039', async (engine) => { await engine.request('venture.billing.set', { razorpayKeys: { keyId, keySecret: 'samplesecretvalue1' } }); });
    const panel = await screen.findByRole('complementary', { name: 'INV-0039' });
    const pay = await within(panel).findByRole('region', { name: 'How clients pay' });
    expect(pay.textContent).toContain('Not tried live yet');
    await click(within(pay).getByRole('button', { name: 'Make a payment link' }));
    expect(calls.map(([method]) => method)).not.toContain('venture.invoice.payLink');
    await click(within(pay).getByRole('button', { name: 'Make link' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.payLink', expect.objectContaining({ invoiceId: 'inv-0039', action: 'create' })]));
    expect(await within(pay).findByText('https://rzp.io/i/sample1')).toBeTruthy();
  });
});
