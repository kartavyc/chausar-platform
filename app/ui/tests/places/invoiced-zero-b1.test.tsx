import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { TextProvider } from '../../src/text';
import type { GoalView } from '../../src/engine/types';
import { GoalCard } from '../../src/places/today/GoalCard';

/**
 * One-shot B1 (hands-on bug 14, words only): with nothing invoiced this month the engine sends an empty sum with no
 * receipt (by design), and the "Invoiced this month" card on Money and Today's goal card stood blank. Each now says so
 * in one line. The figure itself still shows only with its receipt; the card's layout is B4's.
 */
const NOW = () => '2026-10-21T11:00:00.000Z';
const NONE = 'Nothing invoiced yet this month.';

describe('Invoiced this month at zero (B1)', () => {
  it('Money says nothing was invoiced yet when the engine sends no figure', async () => {
    window.location.hash = '#/money';
    const client = createFakeClient(new FakeEngine({ now: NOW }));
    const request = client.request.bind(client);
    client.request = (async (method: string, params?: unknown) => {
      const answer = await request(method as never, params as never);
      return method === 'venture.goals.get' ? { ...(answer as GoalView), invoiced: { display: '', receiptId: null } } : answer;
    }) as typeof client.request;
    render(<App client={client} language="en" />);
    const invoiced = await screen.findByRole('region', { name: 'Invoiced this month' });
    expect(await within(invoiced).findByText(NONE)).toBeTruthy();
  });

  it("Today's goal card says the same with no invoiced figure", () => {
    render(<TextProvider language="en"><GoalCard data={{ state: 'none', month: 'October', invoiced: null, invoicedNone: true, received: null }} /></TextProvider>);
    expect(screen.getByText(NONE)).toBeTruthy();
  });

  it('a figure that only lacks its receipt is left out, with no line in its place', () => {
    render(<TextProvider language="en"><GoalCard data={{ state: 'none', month: 'October', invoiced: null, received: null }} /></TextProvider>);
    expect(screen.queryByText(NONE)).toBeNull();
  });

  it('a figure with its receipt shows instead of the line', () => {
    render(<TextProvider language="en"><GoalCard data={{ state: 'none', month: 'October', invoiced: { value: '₹2,000', receiptId: 'R-1' }, received: null }} /></TextProvider>);
    expect(screen.queryByText(NONE)).toBeNull();
  });
});
