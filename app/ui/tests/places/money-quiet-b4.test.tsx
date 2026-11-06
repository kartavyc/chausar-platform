import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

const NOW = '2026-10-23T10:00:00.000Z';
function start(hash: string, engine = new FakeEngine({ now: () => NOW }), noInvoice = false) {
  window.location.hash = hash;
  const client = createFakeClient(engine), base = client.request.bind(client);
  if (noInvoice) client.request = (async (method: string, params?: unknown) => {
    if (method === 'venture.goals.get') { const goal = await base('venture.goals.get', {}); return { ...goal, state: 'unset', goal: null, invoiced: { ...goal.invoiced, amountMinor: '0', receiptId: null }, paidInFull: null }; }
    return base(method as never, params as never);
  }) as EngineClient['request'];
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return client;
}

async function emptyMonthClient() {
  const client = createFakeClient(new FakeEngine({ now: () => NOW })), base = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => {
    const answer = await base(method as never, params as never);
    if (method === 'venture.goals.get') {
      const goal = await base('venture.goals.get', {});
      return { ...goal, state: 'unset', goal: null, invoiced: { ...goal.invoiced, receiptId: null }, receivedSoFar: { ...goal.receivedSoFar, receiptId: null } };
    }
    if (method === 'venture.money.flow') return { ...answer as object, months: [{ month: '2026-10', in: null, out: null }] };
    if (method === 'venture.money.aging') return { ...answer as object, invoices: [] };
    if (method === 'venture.money.cash') return { ...answer as object, bank: null };
    if (method === 'venture.team.list') {
      const team = await base('venture.team.list', {});
      return { ...team, departments: team.departments?.map(department => ({ ...department, spendThisMonth: { ...department.spendThisMonth, sharePermille: 0 } })), shared: team.shared ? { ...team.shared, sharePermille: 0 } : undefined };
    }
    if (method === 'venture.money.overview') {
      const overview = await base('venture.money.overview', {});
      return { ...overview, lines: overview.lines.map(line => line.id === 'spent' ? { ...line, basis: undefined } : line) };
    }
    return answer;
  }) as EngineClient['request'];
  return client;
}

describe('Money: quiet figures and actions (B4 task 17)', () => {
  it('a fully empty month shows one quiet next step instead of empty money cards', async () => {
    window.location.hash = '#/money';
    const client = await emptyMonthClient();
    render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
    expect(await screen.findByText('No money in or out yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Prepare your first invoice' }).getAttribute('href')).toBe('#/money/invoices');
    expect(screen.queryByRole('region', { name: 'Received' })).toBeNull();
    expect(screen.queryByText('In and out by month')).toBeNull();
  });
  it('an empty invoiced sum has a plain explanation and an Invoices link', async () => {
    start('#/money', undefined, true);
    const empty = await screen.findByText('Nothing invoiced yet this month.');
    const tile = empty.closest('section')!;
    expect(within(tile).getByRole('link', { name: 'Invoices' }).getAttribute('href')).toBe('#/money/invoices');
    expect(within(tile).getByText('This month')).toBeTruthy();
  });
  it('keeps last month visible when equal nonzero receipts are compared', async () => {
    window.location.hash = '#/money';
    const client = createFakeClient(new FakeEngine({ now: () => NOW })), base = client.request.bind(client);
    client.request = (async (method: string, params?: unknown) => {
      const answer = await base(method as never, params as never);
      if (method !== 'venture.books.summary') return answer;
      const books = answer as import('../../src/engine/types').BooksSummaryLite;
      const overview = await base('venture.money.overview', {});
      const received = overview.lines.find(line => line.id === 'received')!;
      return { ...books, previous: { month: '2026-09', label: 'September 2026', period: { from: '2026-09-01', to: '2026-09-30' }, figures: [{ operation: 'received', label: 'Received', display: received.value, receiptId: received.receiptId, stale: false }] } };
    }) as EngineClient['request'];
    render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
    const received = await screen.findByRole('region', { name: 'Received' });
    expect(await within(received).findByText('September 2026')).toBeTruthy();
  });

  it('gives the three share actions their own Send it section', async () => {
    start('#/money/invoices?sheet=invoice:inv-0039');
    const sheet = await screen.findByRole('complementary', { name: 'INV-0039' });
    const send = await within(sheet).findByRole('region', { name: 'Send it' });
    for (const name of ['Save file', 'Share on WhatsApp', 'Email it']) expect(within(send).getByRole('button', { name })).toBeTruthy();
    expect(within(send).queryByRole('heading', { name: 'How clients pay' })).toBeNull();
    expect(send.querySelector('[data-result-line]')).toBeTruthy();
  });
  it('a draft shows Subtotal, Tax and Total without Paid or Balance and opens its preview', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const prepared = await engine.request('venture.invoice.prepare', { orderId: 'o-boat-14' }) as { invoice: { id: string } };
    start(`#/money/invoices?sheet=invoice:${prepared.invoice.id}`, engine);
    const sheet = await screen.findByRole('complementary');
    await within(sheet).findByText('Subtotal');
    const labels = [...sheet.querySelectorAll('dt')].map(node => node.textContent);
    expect(labels).toContain('Total');
    expect(labels).not.toContain('Paid');
    expect(labels).not.toContain('Balance');
    expect(within(sheet).getByText('Preview invoice').closest('details')?.open).toBe(true);
  });
  it('empty Bills has one filled Add a bill action and no repeated heading', async () => {
    start('#/money/bills');
    const add = await screen.findByRole('button', { name: 'Add a bill' });
    expect(add.dataset.variant).toBe('primary');
    expect(screen.queryByRole('heading', { name: 'Bills' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Who it is from' })).toBeNull();
    await act(async () => { fireEvent.click(add); });
    expect(await screen.findByRole('textbox', { name: 'Who it is from' })).toBeTruthy();
  });
});