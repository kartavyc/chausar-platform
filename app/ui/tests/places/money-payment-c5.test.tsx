import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// C5 task 12: the payment sheet starts from the engine's payment default (the newest payment's method), and "Full
// amount" fills the box with the balance exactly as the engine's figure reads; the screen never works it out.
describe('Record a payment: India-friendly defaults', () => {
  it('starts on the method of the newest payment, and Full amount copies the balance figure', async () => {
    const engine = new FakeEngine({ now: () => '2026-10-21T11:00:00.000Z' });
    await engine.request('venture.payment.record', { invoiceId: 'inv-0039', amount: '1,000', receivedOn: '2026-10-21', method: 'cash' });
    window.location.hash = '#/money/invoices?sheet=payment:inv-0039';
    render(<App client={createFakeClient(engine)} language="en" />);
    const sheet = await screen.findByRole('complementary', { name: 'Record a payment' });
    await waitFor(() => expect(sheet.querySelector('[data-figure-group]')).not.toBeNull());
    const owed = sheet.querySelector('[data-figure-group]')!.textContent!.replace('Still owed', '');
    expect((within(sheet).getByLabelText('How it was paid') as HTMLSelectElement).value).toBe('cash');
    expect((within(sheet).getByLabelText('Amount received') as HTMLInputElement).value).toBe('');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Full amount' })); });
    expect((within(sheet).getByLabelText('Amount received') as HTMLInputElement).value).toBe(owed);
    expect(owed).toBe('₹25,200');
  });
});
