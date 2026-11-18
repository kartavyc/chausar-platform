import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { kindOf } from '../../src/shell/BusinessMenu';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';

/**
 * Seen in the real app on Windows (15 Nov 2026): under "Pune Handmade Pottery" the sidebar said "Service business",
 * though the potter's field is Creative work. That line was the label of the catch-all service type a keyword guess
 * gives an idea it cannot place. The line now says the way to earn the idea picked, else the field the owner kept
 * (the engine's own label), else a service type that says something; the catch-all says nothing.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk wholesale orders from cafes and hotels in Pune.';
const t = (key: string) => ({ 'business.kind.other': 'Service business', 'business.kind.studio': 'Creative studio' }[key] ?? key);

async function potter(field: string | null) {
  const engine = new FakeEngine({ fresh: true });
  const client = createFakeClient(engine);
  await client.request('workspace.create', { name: 'Pune Handmade Pottery', pack: 'services', folder: null });
  await client.request('venture.create', { idea: POTTER, countryCode: 'IN', workingName: 'Pune Handmade Pottery' });
  if (field) await client.request('venture.owner.set', { familyId: field });
  return client;
}
const railButton = async () => within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Pune Handmade Pottery/ });

describe('the line under the business name', () => {
  it('the engine names the field the owner kept in venture.get, and none until one is kept', async () => {
    expect((await (await potter(null)).request('venture.get', {}))?.field).toBeUndefined();
    expect((await (await potter('creative')).request('venture.get', {}))?.field).toEqual({ id: 'creative', label: 'Creative work' });
  });

  it('says the way to earn first, then the kept field, then a service type that says something, and nothing for the catch-all', () => {
    const venture = (serviceType: string | null) => ({ serviceType });
    expect(kindOf(t, { venture: venture('other'), playbook: { id: 'own-way', label: 'Wedding films' }, field: { label: 'Creative work' } })).toBe('Wedding films');
    expect(kindOf(t, { venture: venture('other'), field: { label: 'Creative work' } })).toBe('Creative work');
    expect(kindOf(t, { venture: venture('studio') })).toBe('Creative studio');
    expect(kindOf(t, { venture: venture('other') })).toBeNull();
    expect(kindOf(t, { venture: venture(null) })).toBeNull();
    expect(kindOf(t, null)).toBeNull();
  });

  it('the potter reads "Creative work" under the name, never "Service business"', async () => {
    window.location.hash = '#/today';
    render(<App client={await potter('creative')} language="en" />);
    const button = await railButton();
    await waitFor(() => expect(button.textContent).toContain('Creative work'));
    expect(button.textContent).not.toContain('Service business');
  });

  it('with no field kept and no way picked, the line is left out', async () => {
    window.location.hash = '#/today';
    render(<App client={await potter(null)} language="en" />);
    const button = await railButton();
    await waitFor(() => expect(button.textContent).toContain('Pune Handmade Pottery'));
    expect(button.textContent).not.toContain('Service business');
    expect(button.textContent).not.toContain('Creative');
  });
});

describe('Money and Today on a business with nothing in its books', () => {
  it('Books says there is nothing to add up yet, in words and with no bare amount, and writes no receipt', async () => {
    const client = await potter('creative');
    const books = await client.request('venture.books.summary', { period: 'this-month' });
    expect(books.figures.map((figure) => [figure.operation, figure.receiptId])).toEqual([['billed', null], ['received', null], ['earned', null]]);
    window.location.hash = '#/money/books';
    render(<App client={client} language="en" />);
    const main = await screen.findByRole('main');
    await waitFor(() => expect(main.querySelectorAll('[data-books-empty]')).toHaveLength(3));
    for (const empty of main.querySelectorAll('[data-books-empty]')) expect(empty.textContent).toBe('Nothing to add up yet.');
    // No amount stands without its receipt.
    expect(main.querySelector('[data-receipt-mark]')).toBeNull();
    expect(within(main).queryByText('₹0')).toBeNull();
  });

  it('Today draws although the books summary fails, and asks for it only when the goals view cannot be read', async () => {
    const plain = await potter('creative');
    const sent: string[] = [];
    const client: EngineClient = { ...plain, request: ((method: string, params?: unknown) => {
      sent.push(method);
      if (method === 'venture.books.summary') return Promise.reject(new EngineError('SQL_TIMEOUT', 'The database calculation exceeded its process deadline.'));
      return plain.request(method as never, params as never);
    }) as EngineClient['request'] };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    const main = await screen.findByRole('main');
    await waitFor(() => expect(main.querySelector('h1')).not.toBeNull());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    // The goals view answered, so Today never asked the books at all, and nothing on it says the books failed.
    expect(sent).toContain('venture.goals.get');
    expect(sent).not.toContain('venture.books.summary');
    expect(main.textContent).not.toContain('deadline');
    fireEvent.click(document.body);
  });
});
