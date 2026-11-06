import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider, useClock } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type CustodyViewLite, type EngineClient } from '../../src/engine/types';

/** Today's title is the greeting for the hour (Ink v2, 3C), so the shell reads the app at 10:00 on this computer's clock. */
const MORNING = () => new Date(2026, 9, 23, 10, 0);
const TODAY = 'Good morning';

function start(hash = '#/today', language: 'en' | 'hi' = 'en') {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  const view = render(<ClockProvider now={MORNING}><App client={client} language={language} /></ClockProvider>);
  return { client, ...view };
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

describe('shell', () => {
  it('shows the rail with the business, six places and the needs-you count, and says the data is a sample', async () => {
    start();
    const nav = screen.getByRole('navigation', { name: 'Places' });
    await waitFor(() => expect(within(nav).getByText('Lumen Studio')).toBeTruthy());
    expect(within(nav).getByText('YouTube channel')).toBeTruthy();
    const [brand, ...links] = within(nav).getAllByRole('link');
    expect(brand!.getAttribute('href')).toBe('#/today');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/today', '#/team', '#/work', '#/clients', '#/money', '#/connections']);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(links[0]!.textContent).toMatch(/^Today12, 12 need you$/));
    expect(screen.getByRole('status').textContent).toBe('Sample data. Nothing here is real.');
  });

  it('moves between places by the address', async () => {
    start();
    await go('#/team');
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Team' }).getAttribute('aria-current')).toBe('page');
    await go('#/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: TODAY })).toBeTruthy();
  });

  it('opens a run beside the page, focuses its title, and Esc returns focus to the row that opened it', async () => {
    start();
    const opener = await screen.findByRole('button', { name: 'Cutting shorts from episode 13' });
    opener.focus();
    await act(async () => { fireEvent.click(opener); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const sheet = await screen.findByRole('complementary', { name: 'Cutting shorts from episode 13' });
    expect(window.location.hash).toBe('#/today?sheet=run%3A31');
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole('heading', { level: 2 })));
    expect(screen.getByRole('main').contains(opener)).toBe(true);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('shows a receipt from the address, and says so for a sheet nobody provides', async () => {
    start('#/money?sheet=receipt:R-0415');
    const sheet = await screen.findByRole('complementary', { name: 'R-0415' });
    await waitFor(() => expect(sheet.textContent).toContain('₹30,000.00'));
    await go('#/money?sheet=nobody:mehta');
    expect(await screen.findByRole('complementary', { name: "This can't be shown here." })).toBeTruthy();
  });

  it('switches business from the business menu', async () => {
    start();
    // The rail's business button: Today also has a filter chip per business (Ink v2, 3C).
    const button = await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ });
    fireEvent.click(button);
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
    const ledgerline = await within(menu).findByRole('button', { name: 'Ledgerline' });
    expect(within(menu).getByRole('button', { name: /Lumen Studio/ }).hasAttribute('disabled')).toBe(true);
    expect(within(menu).getByText('Locked')).toBeTruthy();
    await act(async () => { fireEvent.click(ledgerline); });
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name: /Ledgerline/ }).textContent).toContain('AI-native CA firm'));
    expect(screen.queryByRole('dialog', { name: /Business menu/ })).toBeNull();
  });

  it('decides a row on Today against the engine and shrinks it to its receipt line', async () => {
    start();
    const row = (await screen.findByText('Which title for episode 15?')).closest<HTMLElement>('[data-row]')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Later' })); });
    await waitFor(() => expect(screen.getByText(/Moved to later/)).toBeTruthy());
  });

  it('speaks Hindi when asked', async () => {
    start('#/today', 'hi');
    expect(await screen.findByRole('heading', { level: 1, name: 'सुप्रभात' })).toBeTruthy();
    // Exactly the rail's place: Today's team tile also links to Team (Ink v2, 3C).
    expect(screen.getByRole('link', { name: 'टीम' })).toBeTruthy();
  });
});

// Catalogue U14: the experimental storage notice is back beyond Keep. Today, Work and Money say it under the header.
describe('the experimental storage notice', () => {
  const EXPERIMENTAL = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";
  const STORAGE_PLACES = [['Today', '#/today', TODAY], ['Work', '#/work', 'Work'], ['Money', '#/money', 'Money']] as const;

  /**
   * The fake engine, whose custody view says the open business is kept in the storage asked for, that there is no
   * business (`no-business`), or refuses (`refused`). `read()` says the custody reply arrived, `methods()` lists every
   * method asked, `engine` emits events. `transport: 'hosted'` makes it the hosted tier.
   */
  function startWith(hash: string, storage: 'experimental-file' | 'postgres' | 'no-business' | 'refused', transport?: EngineClient['transport']) {
    window.location.hash = hash;
    const engine = new FakeEngine();
    const fake = createFakeClient(engine);
    const request = fake.request.bind(fake);
    const methods: string[] = [];
    let read = false;
    const client: EngineClient = {
      ...fake,
      transport: transport ?? fake.transport,
      request: (async (method: string, params?: unknown) => {
        methods.push(method);
        const reply = await request(method as never, params as never);
        if (method !== 'workspace.custody.get') return reply;
        const custody = reply as unknown as CustodyViewLite;
        read = true;
        if (storage === 'refused') throw new EngineError('CUSTODY_UNAVAILABLE', 'The custody view could not be read.');
        if (storage === 'no-business') return { ...custody, business: null };
        return { ...custody, business: custody.business && { ...custody.business, storage } };
      }) as EngineClient['request'],
    };
    render(<ClockProvider now={MORNING}><App client={client} language="en" /></ClockProvider>);
    return { engine, read: () => read, methods: () => methods };
  }
  const settled = async (read: () => boolean) => {
    await waitFor(() => expect(read()).toBe(true));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };

  for (const [place, hash, title] of STORAGE_PLACES) {
    it(`shows on ${place} as a note under the header when the business is in experimental storage`, async () => {
      startWith(hash, 'experimental-file');
      const note = await within(screen.getByRole('main')).findByRole('note');
      expect(note.textContent).toBe(EXPERIMENTAL);
      const header = screen.getByRole('heading', { level: 1, name: title }).closest('header')!;
      expect(header.contains(note)).toBe(false);
      expect(header.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(note.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it(`is absent on ${place} when the business is kept in Postgres`, async () => {
      const { read } = startWith(hash, 'postgres');
      await settled(read);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
      expect(screen.queryByRole('note')).toBeNull();
      expect(screen.queryByText(EXPERIMENTAL)).toBeNull();
    });
  }

  // Hosted keeps the business on the server, not in a local file, and never asks for a custody method (the hosted
  // Welcome back test in tests/places/welcome-custody.test.tsx holds the same rule).
  for (const [place, hash, title] of STORAGE_PLACES) {
    it(`asks nothing about custody on ${place} on the hosted tier, and shows no note`, async () => {
      const { methods } = startWith(hash, 'experimental-file', 'hosted');
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy();
      await waitFor(() => expect(methods()).toContain('venture.queue.list'));
      for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      expect(methods().filter((m) => m.startsWith('workspace.custody.'))).toEqual([]);
      expect(screen.queryByRole('note')).toBeNull();
    });
  }

  it('stays hidden when the engine refuses the custody view', async () => {
    const { read } = startWith('#/today', 'refused');
    await settled(read);
    expect(screen.getByRole('heading', { level: 1, name: TODAY })).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByText(EXPERIMENTAL)).toBeNull();
  });

  it('stays hidden when the custody view has no business in it', async () => {
    const { read } = startWith('#/today', 'no-business');
    await settled(read);
    expect(screen.getByRole('heading', { level: 1, name: TODAY })).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('asks again when the queue changes, not on every run event', async () => {
    const { engine, methods } = startWith('#/today', 'experimental-file');
    await within(screen.getByRole('main')).findByRole('note');
    const asked = () => methods().filter((m) => m === 'workspace.custody.get').length;
    const before = asked();
    await act(async () => {
      for (const type of ['run.started', 'run.step', 'run.done'] as const) engine.emit({ type, businessId: 'lumen', runId: '31', at: '2026-10-23T13:35:00.000Z' });
    });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(asked()).toBe(before);
    await act(async () => { engine.emit({ type: 'queue.changed', businessId: 'lumen', at: '2026-10-23T13:36:00.000Z' }); });
    await waitFor(() => expect(asked()).toBe(before + 1));
  });

  it('leaves Keep as it was: the sentence once, in its own section, not a second note', async () => {
    startWith('#/business/keep', 'experimental-file');
    expect(await screen.findByText(EXPERIMENTAL)).toBeTruthy();
    expect(screen.getAllByText(EXPERIMENTAL)).toHaveLength(1);
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('the clock', () => {
  function Now() {
    const now = useClock();
    return <p>{now().toISOString()}</p>;
  }

  it('useClock() gives the time a ClockProvider injects', () => {
    const at = new Date('2026-10-23T13:35:00.000Z');
    render(<ClockProvider now={() => at}><Now /></ClockProvider>);
    expect(screen.getByText('2026-10-23T13:35:00.000Z')).toBeTruthy();
  });

  it("without a provider it is the computer's own time", () => {
    const before = Date.now();
    const { container } = render(<Now />);
    const shown = Date.parse(container.textContent ?? '');
    expect(shown).toBeGreaterThanOrEqual(before);
    expect(shown).toBeLessThanOrEqual(Date.now());
  });
});
