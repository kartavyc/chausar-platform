import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { kindOf } from '../../src/engine/reads';
import { NARROW } from '../../src/shell/useNarrow';
import { catalogue } from '../../src/shell/find/catalogue';
import { CATALOGUES, format } from '../../src/text';
import { assertFiguresProved } from '../helpers/ink-rules';

// C2 task 6: the command bar beside the rail, on the fake engine. Find first (records, then pages), actions next, Ask
// last; choosing a row only navigates; the words stay in the box's own state.

const NOW = '2026-10-23T10:00:00.000Z';

function stubWidth(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? narrow : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

async function start(hash: string) {
  stubWidth(false);
  window.location.hash = hash;
  const engine = new FakeEngine({ now: () => NOW });
  const client = createFakeClient(engine);
  const spy = vi.spyOn(client, 'request');
  render(<App client={client} language="en" />);
  const box = await screen.findByRole('combobox', { name: 'Find or ask' }) as HTMLInputElement;
  return { engine, client, spy, box };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const hashChanged = () => act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
const list = () => screen.getByRole('listbox', { name: 'Find or ask' });
const options = () => within(list()).getAllByRole('option');

async function type(box: HTMLInputElement, text: string) {
  box.focus();
  await act(async () => { fireEvent.change(box, { target: { value: text } }); });
}
async function press(element: Element, key: string, init: Record<string, unknown> = {}) {
  await act(async () => { fireEvent.keyDown(element, { key, ...init }); });
  await hashChanged();
}
/** The group in the open list with this name. */
const group = (name: string) => within(list()).getByRole('group', { name });

afterEach(() => { vi.restoreAllMocks(); });

describe('the command bar (C2)', () => {
  it('"INV" lists the demo invoices with their receipts; Enter opens the invoice sheet', async () => {
    await start('#/money');
    const box = screen.getByRole('combobox', { name: 'Find or ask' }) as HTMLInputElement;
    await type(box, 'INV');
    await waitFor(() => expect(within(group('Invoices')).getAllByRole('option').length).toBeGreaterThan(0));
    const invoices = group('Invoices');
    expect(invoices.textContent).toContain('INV-0039');
    expect(assertFiguresProved(invoices).length).toBeGreaterThan(0);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
    await press(box, 'Enter');
    expect(decodeURIComponent(window.location.hash)).toBe('#/money/invoices?sheet=invoice:inv-0039');
    await waitFor(() => expect(document.querySelector('[data-sheet]')).not.toBeNull());
    expect(box.value).toBe('');
  });

  it('a client by name; the arrows move and wrap; Enter opens the client sheet, and closing it puts focus back on the box', async () => {
    const { box } = await start('#/money');
    await type(box, 'boat audio');
    await waitFor(() => expect(within(group('Clients')).getByRole('option').textContent).toContain('Boat Audio'));
    const rows = options();
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    await press(box, 'ArrowDown');
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true');
    await press(box, 'ArrowUp');
    await press(box, 'ArrowUp');
    expect(options().at(-1)!.getAttribute('aria-selected')).toBe('true');
    await press(box, 'Home');
    expect(options()[0]!.textContent).toContain('Boat Audio');
    await press(box, 'Enter');
    expect(decodeURIComponent(window.location.hash)).toBe('#/clients?sheet=client:c-boat');
    await waitFor(() => expect(document.querySelector('[data-sheet]')).not.toBeNull());
    await press(document.body, 'Escape');
    await settle();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Find or ask' })));
  });

  it('"invoice" lists the Invoices page, the demo chat whose answer says invoice with its line, and Ask last', async () => {
    const { box } = await start('#/today');
    await type(box, 'invoice');
    await waitFor(() => expect(within(list()).queryByRole('group', { name: 'Chats' })).not.toBeNull());
    expect(within(group('Pages')).getAllByRole('option').map((row) => row.textContent)).toContain('Invoices');
    const chat = within(group('Chats')).getAllByRole('option').find((row) => row.textContent!.includes('How much have we billed this month?'))!;
    expect(chat.textContent).toMatch(/invoice INV-0039/);
    expect(options().at(-1)!.textContent).toBe('Ask Chausar: invoice');
  });

  it('with a run sheet open, Esc closes the list only; a second Esc in the page closes the sheet', async () => {
    const { box } = await start('#/work?sheet=run:31');
    await waitFor(() => expect(document.querySelector('[data-sheet]')).not.toBeNull());
    await type(box, 'boat');
    await waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('true'));
    await press(box, 'Escape');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(decodeURIComponent(window.location.hash)).toBe('#/work?sheet=run:31');
    await press(document.body, 'Escape');
    expect(window.location.hash).toBe('#/work');
  });

  it('Ctrl K from Money focuses the box with its words selected; inside another field it is left to that field', async () => {
    const { box } = await start('#/money');
    await act(async () => { fireEvent.change(box, { target: { value: 'boat' } }); });
    (document.activeElement as HTMLElement | null)?.blur();
    await press(document.body, 'k', { ctrlKey: true });
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 4]);
    window.location.hash = '#/onboarding';
    await hashChanged();
    const field = await screen.findByRole('textbox', { name: /^(What do you want to start\?|Or describe it in one sentence)$/ });
    field.focus();
    await press(field, 'k', { ctrlKey: true });
    expect(document.activeElement).toBe(field);
  });

  it('writes nothing: choosing a row of every kind and every action calls only reads', async () => {
    const { box, spy } = await start('#/money');
    const t = (key: string) => format(CATALOGUES.en, 'en', key);
    const queries = ['Boat Audio', 'INV-0039', 'mentions', 'Cutting shorts', 'received',
      ...catalogue({ businessOpen: true, needsYou: 1, caFirm: false }).filter((entry) => entry.kind === 'action').map((entry) => t(entry.title))];
    for (const query of queries) {
      window.location.hash = '#/money';
      await hashChanged();
      const bar = await screen.findByRole('combobox', { name: 'Find or ask' }) as HTMLInputElement;
      await type(bar, query);
      await waitFor(() => expect(options().length).toBeGreaterThan(1));
      await press(bar, 'Enter');
      await settle();
    }
    const methods = spy.mock.calls.map(([method, params]) => [method, kindOf(method as string, params)] as const);
    // Connections opens with its checks' last result (venture.connectors.check { last: true }), a quiet look B3 counts
    // as sending nothing; every other call is a read.
    expect(JSON.stringify(methods.filter(([, kind]) => kind === 'write'))).toBe('[]');
    expect(methods.filter(([, kind]) => kind === 'quiet').map(([method]) => method).every((method) => method === 'venture.connectors.check')).toBe(true);
    expect(box).toBeTruthy();
  }, 60_000);

  it('keeps the words out of the address, the history and browser storage', async () => {
    const { box } = await start('#/money');
    const words = 'Fictional private find words';
    await type(box, words);
    await settle();
    expect(window.location.hash).not.toContain('Fictional');
    expect(JSON.stringify(window.history.state ?? null)).not.toContain('Fictional');
    for (const storage of [window.localStorage, window.sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) expect(storage.getItem(storage.key(index)!) ?? '').not.toContain('Fictional');
    }
  });

  it('Clear empties a long text; choosing a row empties the box', async () => {
    const { box } = await start('#/money');
    await type(box, 'x'.repeat(300));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear' })); });
    expect(box.value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    await type(box, 'Boat Audio');
    await waitFor(() => expect(within(list()).queryByRole('group', { name: 'Clients' })).not.toBeNull());
    await press(box, 'Enter');
    expect(box.value).toBe('');
  });

  it('F2: the keys show at rest, at a wide and a narrow desktop width', async () => {
    for (const width of [1364, 800]) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      const { box } = await start('#/money');
      expect(box.closest('[data-find-box]')!.querySelector('kbd[data-code]')!.textContent).toBe('Ctrl K');
      expect(document.activeElement).not.toBe(box);
      document.body.innerHTML = '';
    }
  });

  it('F3: a question puts the Ask row first; a name puts the client first', async () => {
    const { box } = await start('#/money');
    await type(box, 'How much does Boat Audio owe me?');
    await waitFor(() => expect(options().length).toBeGreaterThan(0));
    expect(options()[0]!.textContent).toBe('Ask Chausar: How much does Boat Audio owe me?');
    await type(box, 'boat');
    await waitFor(() => expect(within(list()).queryByRole('group', { name: 'Clients' })).not.toBeNull());
    expect(options()[0]!.textContent).toContain('Boat Audio');
  });
});
