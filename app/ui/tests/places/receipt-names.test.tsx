import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { receiptMark } from '../helpers/ink-rules';

/*
 * 4Z3: a receipt mark is named for the amount it proves where the amount is at hand ("Receipt for ₹26,200.00"), so a
 * screen reader hears more than "Receipt": the invoices table, a paid call, the invoice sheet and the payment sheet.
 */

const NOW = '2026-10-21T11:00:00.000Z';
function start(hash: string) {
  window.location.hash = hash;
  render(<ClockProvider now={() => new Date(NOW)}><App client={createFakeClient(new FakeEngine({ now: () => NOW }))} language="en" /></ClockProvider>);
}

describe('receipt marks say the amount they prove (4Z3)', () => {
  it('the invoices table names each row\'s mark for its total', async () => {
    start('#/money/invoices');
    const mark = await screen.findByRole('button', { name: receiptMark('R-0416') });
    expect(mark.getAttribute('aria-label')).toMatch(/^Receipt for ₹[\d,]+\.\d{2}$/);
  });

  it('a paid call names its mark for the figure it settled at', async () => {
    start('#/money/spend');
    const mark = await screen.findByRole('button', { name: receiptMark('R-0412') });
    expect(mark.getAttribute('aria-label')).toBe('Receipt for ₹42.10');
  });

  it('the invoice sheet names the price mark for the invoice total', async () => {
    start('#/money/invoices?sheet=invoice:inv-0039');
    const sheet = await screen.findByRole('complementary');
    const mark = await within(sheet).findByRole('button', { name: /^Receipt for ₹/ });
    expect(mark.hasAttribute('data-receipt')).toBe(true);
  });

  it('the payment sheet names the price mark for what is still owed', async () => {
    start('#/money/invoices?sheet=payment:inv-0039');
    const sheet = await screen.findByRole('complementary', { name: 'Record a payment' });
    expect(await within(sheet).findByRole('button', { name: 'Receipt for ₹26,200.00' })).toBeTruthy();
  });
});
