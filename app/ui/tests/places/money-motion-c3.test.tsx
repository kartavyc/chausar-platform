import { act, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { PaymentSheet } from '../../src/places/money/PaymentSheet';
import { Place as Apps } from '../../src/places/apps';
import { Overview } from '../../src/places/money/Overview';
import { Bills } from '../../src/places/money/Bills';

it('Payment waits with a still sheet skeleton instead of visible Loading words', async () => {
  const base = createFakeClient(new FakeEngine({ latencyMs: 0 }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const client: EngineClient = { ...base, request: (async (method: string, params?: Record<string, unknown>) => {
    if (method === 'venture.invoice.get') await gate;
    return base.request(method as never, params as never);
  }) as EngineClient['request'] };
  const { container } = render(<EngineProvider client={client}><PaymentSheet id="inv-0039" onClose={() => {}} returnFocus={() => {}} /></EngineProvider>);
  expect(screen.queryByText('LoadingÃ¢â‚¬Â¦')).toBeNull();
  await waitFor(() => expect(container.querySelector('[data-skeleton="sheet"]')).not.toBeNull());
  await act(async () => { release(); });
  await screen.findByRole('textbox', { name: 'Amount received' });
  expect(container.querySelector('[data-skeleton]')).toBeNull();
});

it('new bills arrive after the engine answers; paid plain rows keep their place', async () => {
  const engine = new FakeEngine({ latencyMs: 0 });
  const base = createFakeClient(engine);
  const add = (vendor: string) => engine.request('venture.bills.add', { vendor, billDate: '2026-10-20', dueDate: '2026-10-30', recurring: null, lines: [{ description: 'A service', amount: '100', taxName: '', taxRateBps: '0' }] });
  await add('First supplier');
  const { container } = render(<EngineProvider client={base}><Bills /></EngineProvider>);
  await screen.findByText('First supplier');
  expect(container.querySelector('[data-arriving]')).toBeNull();
  await act(async () => { await add('Second supplier'); engine.emit({ type: 'queue.changed', businessId: 'lumen', at: new Date().toISOString() }); });
  const row = (await screen.findByText('Second supplier')).closest('li')!;
  expect(row.hasAttribute('data-arriving')).toBe(true);
  // Money's plain rows remain the same receipt-bearing row when their state becomes Paid.
  const id = row.getAttribute('data-row-id')!;
  await act(async () => { await engine.request('venture.bills.pay', { billId: id, amount: '100', paidOn: '2026-10-21', method: 'bank-transfer' }); engine.emit({ type: 'queue.changed', businessId: 'lumen', at: new Date().toISOString() }); });
  await waitFor(() => expect(row.textContent).toContain('Paid'));
  expect((await screen.findByText('Second supplier')).closest('li')).toBe(row);
  expect(row.hasAttribute('data-leaving')).toBe(false);
});


it.each(['Apps', 'Money'] as const)('%s first content fades only after a slow skeleton', async place => {
  window.location.hash = place === 'Apps' ? '#/apps' : '#/money';
  const base = createFakeClient(new FakeEngine({ latencyMs: 0 }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const methods = place === 'Apps' ? ['venture.apps.list'] : ['venture.money.overview', 'venture.books.summary'];
  const client: EngineClient = { ...base, request: (async (method: string, params?: Record<string, unknown>) => {
    if (methods.includes(method)) await gate;
    return base.request(method as never, params as never);
  }) as EngineClient['request'] };
  const { container } = render(<EngineProvider client={client}>{place === 'Apps' ? <Apps /> : <Overview views={{}} />}</EngineProvider>);
  await waitFor(() => expect(container.querySelector('[data-skeleton]')).not.toBeNull());
  expect(container.querySelector('[data-arrived]')).toBeNull();
  await act(async () => { release(); });
  await waitFor(() => expect(container.querySelector('[data-skeleton]')).toBeNull());
  expect(container.querySelector('[data-arrived]')).not.toBeNull();
});
