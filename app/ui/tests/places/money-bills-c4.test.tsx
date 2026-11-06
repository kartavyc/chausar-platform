import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

/*
 * One-shot C4 task 22: a bill due today says so with its word, what it is for leads its second line, the same bill raises
 * one notice on Today, and the add form's due date starts at the vendor's last terms.
 */
const NOW = '2026-11-03T06:00:00.000Z';

async function start(hash: string) {
  window.location.hash = hash;
  const engine = new FakeEngine({ now: () => NOW });
  const client = createFakeClient(engine);
  await client.request('venture.bills.add', {
    vendor: 'Sharma Traders', billDate: '2026-10-24', dueDate: '2026-11-03', recurring: null,
    lines: [{ description: 'Frames for October', amount: '4000', taxName: '', taxRate: '0' }],
  });
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return { engine };
}

describe('Bills: due today (C4 task 22)', () => {
  it('says Due today, and what the bill is for', async () => {
    await start('#/money/bills');
    const mark = await screen.findByText('Due today');
    expect(mark.hasAttribute('data-due-today')).toBe(true);
    const row = mark.closest('li') ?? mark.closest('tr')!;
    expect(row.textContent).toContain('Frames for October');
  });

  it('the add form starts its due date at the vendor\'s last terms', async () => {
    await start('#/money/bills');
    await screen.findByText('Due today');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /add a bill/i })); });
    const vendor = await screen.findByLabelText('Who it is from');
    fireEvent.change(vendor, { target: { value: 'Sharma Traders' } });
    const billDate = screen.getByLabelText(/bill date/i) as HTMLInputElement;
    fireEvent.change(billDate, { target: { value: '2026-11-01' } });
    // Ten days between that vendor's last bill and its due date.
    await waitFor(() => expect((screen.getByLabelText(/due date/i) as HTMLInputElement).value).toBe('2026-11-11'));
  });

  it('raises one notice on Today, which leaves once the bill is paid', async () => {
    const { engine } = await start('#/today');
    const needsYou = await screen.findByRole('region', { name: 'Needs you' });
    const more = within(needsYou).queryByRole('button', { name: /^Show \d+ more$/ });
    if (more) await act(async () => { fireEvent.click(more); });
    expect(await within(needsYou).findAllByText('A bill to Sharma Traders is due today.')).toHaveLength(1);
    const list = await engine.request('venture.bills.list', {}) as { bills: { id: string; vendor: string }[] };
    const bill = list.bills.find((item) => item.vendor === 'Sharma Traders')!;
    await act(async () => { await engine.request('venture.bills.pay', { billId: bill.id, amount: '4000', paidOn: '2026-11-03', method: 'upi' }); });
    const after = await engine.request('venture.queue.list', {}) as { rows: { title: string }[] };
    expect(after.rows.map((row) => row.title)).not.toContain('A bill to Sharma Traders is due today.');
  });
});
