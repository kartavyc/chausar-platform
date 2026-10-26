import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { assertInkRules, receiptMark } from '../helpers/ink-rules';

// Clients in the direction D look (Ink v2 wave 3, package 3E2): tabs held in the address (Clients and Pipeline; W4 4D4
// added Network, see clients-network.test.tsx), the clients as rows with initials, and the pipeline as a board of the engine's own lead
// stages. Everything shown comes from the fake engine or from data written here.

type Fake = ReturnType<typeof createFakeClient>;

async function start(hash = '#/clients', options: { language?: 'en' | 'hi'; prepare?: (client: Fake) => Promise<void>; override?: (client: Fake) => void } = {}) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  await options.prepare?.(client);
  options.override?.(client);
  const spy = vi.spyOn(client, 'request');
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { client, spy, ...view };
}

/** Clicks something that changes the address, then lets the shell see the new hash. */
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

/** The engine refuses this method, as an engine that stopped answering would. */
function failing(method: string) {
  return (client: Fake) => {
    const base = client.request.bind(client);
    client.request = ((m: string, params?: unknown) => (m === method
      ? Promise.reject(new EngineError('ENGINE_UNAVAILABLE', 'The engine is not answering.'))
      : base(m as never, params as never))) as EngineClient['request'];
  };
}

/** The engine has not answered this method yet (and does not during the test). */
function pending(method: string) {
  return (client: Fake) => {
    const base = client.request.bind(client);
    client.request = ((m: string, params?: unknown) => (m === method ? new Promise(() => {}) : base(m as never, params as never))) as EngineClient['request'];
  };
}

/** Lets the engine's answers land. */
const settle = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

/** The line under the page title. */
const headerLine = () => screen.getByRole('heading', { level: 1 }).nextElementSibling as HTMLElement | null;

const ledgerline = async (client: Fake) => { await client.request('workspace.open', { folder: 'ledgerline' }); };

const tabs = () => screen.getByRole('navigation', { name: 'Clients views' });
const board = () => screen.findByRole('group', { name: 'Pipeline board' });
const column = (root: HTMLElement, name: string) => within(root).getByRole('heading', { level: 2, name }).closest('section') as HTMLElement;
const cardOf = (root: HTMLElement, name: string) => within(root).getByRole('heading', { level: 3, name }).closest('article') as HTMLElement;

describe('Clients: the tabs', () => {
  it('are links held in the address, Clients, Pipeline and Network with their counts (W4 4D4 added Network)', async () => {
    await start('#/clients');
    await screen.findByRole('list', { name: 'Clients' });
    const nav = tabs();
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/clients', '#/clients/pipeline', '#/clients/network']);
    const clients = within(nav).getByRole('link', { name: /^Clients/ });
    const pipeline = within(nav).getByRole('link', { name: /^Pipeline/ });
    expect(clients.getAttribute('aria-current')).toBe('page');
    expect(pipeline.getAttribute('aria-current')).toBeNull();
    // The counts are Counts: how many clients and how many people on the pipeline (W4 4E4), never money.
    await waitFor(() => expect(clients.querySelector('[data-count]')?.textContent).toBe('2'));
    await waitFor(() => expect(pipeline.querySelector('[data-count]')?.textContent).toBe('9'));
    expect(within(nav).getByRole('link', { name: /^Network/ }).getAttribute('aria-current')).toBeNull();
    // An icon sits before each word, hidden from screen readers.
    for (const link of links) expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    assertInkRules();
  });

  it('Pipeline is current on #/clients/pipeline, and the old #/clients/leads address still opens it', async () => {
    await start('#/clients/pipeline');
    await board();
    expect(within(tabs()).getByRole('link', { name: /^Pipeline/ }).getAttribute('aria-current')).toBe('page');
    expect(within(tabs()).getByRole('link', { name: /^Clients/ }).getAttribute('aria-current')).toBeNull();
  });

  it('the old leads address shows Pipeline as current', async () => {
    await start('#/clients/leads');
    await board();
    expect(within(tabs()).getByRole('link', { name: /^Pipeline/ }).getAttribute('aria-current')).toBe('page');
  });

  it('moving between the tabs goes through the address', async () => {
    await start('#/clients');
    await screen.findByRole('list', { name: 'Clients' });
    await click(within(tabs()).getByRole('link', { name: /^Pipeline/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/clients/pipeline'));
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await board()).toBeTruthy();
  });
});

describe('Clients: the Clients tab', () => {
  it('one row per client with initials, the name, the last order line and what they owe as a Figure with its receipt', async () => {
    await start('#/clients');
    const list = await screen.findByRole('list', { name: 'Clients' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const boat = rows.find((row) => row.textContent?.includes('Boat Audio'))!;
    const initials = boat.querySelector('[aria-hidden="true"][data-dept]');
    expect(initials?.textContent).toBe('BA');
    expect(within(boat).getByRole('button', { name: 'Boat Audio' })).toBeTruthy();
    expect(boat.textContent).toContain('Order open: Two mentions in episode 14');
    const figure = boat.querySelector('[data-figure]') as HTMLElement;
    expect(figure.querySelector('[data-ui-number]')?.textContent).toBe('₹26,200.00');
    expect(within(figure).getByRole('button', { name: receiptMark('R-0416') })).toBeTruthy();
    const nimbus = rows.find((row) => row.textContent?.includes('Nimbus Mics'))!;
    expect(nimbus.querySelector('[data-figure]')).toBeNull();
    expect(nimbus.textContent).toContain('No orders yet.');
    assertInkRules();
  });

  it('opening a row opens the client sheet, and the sheet keeps every Ink rule', async () => {
    await start('#/clients');
    await click(await screen.findByRole('button', { name: 'Boat Audio' }));
    expect(window.location.hash).toMatch(/sheet=client%3Ac-boat/);
    const sheet = await screen.findByRole('complementary', { name: 'Boat Audio' });
    await within(sheet).findByRole('list', { name: 'Orders' });
    // What they owe, in the sheet line, is a Figure too.
    const figure = await waitFor(() => sheet.querySelector('[data-figure]') as HTMLElement);
    expect(figure.querySelector('[data-ui-number]')?.textContent).toBe('₹26,200.00');
    assertInkRules();
  });

  it('the toolbar holds Add client beside the tabs', async () => {
    await start('#/clients');
    await screen.findByRole('list', { name: 'Clients' });
    const add = screen.getByRole('button', { name: 'Add client' });
    expect(add.dataset.variant).toBe('secondary');
    expect(screen.queryByRole('button', { name: 'Add a lead' })).toBeNull();
    await click(add);
    expect(window.location.hash).toBe('#/clients?sheet=client%3Anew');
  });

  it('the header line counts the clients, the count in bold', async () => {
    await start('#/clients');
    await screen.findByRole('list', { name: 'Clients' });
    await waitFor(() => expect(headerLine()?.textContent).toBe('2 clients'));
    expect(headerLine()!.querySelector('b')?.textContent).toBe('2');
  });

  it('J and K move between the rows and Enter opens the focused one in the client sheet', async () => {
    await start('#/clients');
    const list = await screen.findByRole('list', { name: 'Clients' });
    const [first, second] = within(list).getAllByRole('listitem');
    await act(async () => { fireEvent.keyDown(document.body, { key: 'j' }); });
    expect(document.activeElement).toBe(first);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'j' }); });
    expect(document.activeElement).toBe(second);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'k' }); });
    expect(document.activeElement).toBe(first);
    const name = within(first!).getByRole('button', { name: /./ }).textContent!;
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(window.location.hash).toMatch(/^#\/clients\?sheet=client%3Ac-/);
    expect(await screen.findByRole('complementary', { name })).toBeTruthy();
  });

  it('while the clients load it shows no list and no empty sentence', async () => {
    await start('#/clients', { override: pending('venture.client.list') });
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Clients' })).toBeNull();
    expect(screen.queryByText('No clients yet.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the clients cannot be read, and never says there are none', async () => {
    await start('#/clients', { override: failing('venture.client.list') });
    expect((await screen.findByRole('alert')).textContent).toContain('The engine is not answering.');
    expect(screen.queryByText('No clients yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add client' })).toBeNull();
  });

  it('while the orders load, a row says nothing about orders rather than "No orders yet."', async () => {
    await start('#/clients', { override: pending('venture.order.list') });
    const list = await screen.findByRole('list', { name: 'Clients' });
    await settle();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list.textContent).not.toContain('No orders yet.');
    expect(list.textContent).not.toContain('Order open');
  });

  it('when the orders cannot be read it says so once, and never "No orders yet."', async () => {
    await start('#/clients', { override: failing('venture.order.list') });
    const list = await screen.findByRole('list', { name: 'Clients' });
    expect((await screen.findByRole('alert')).textContent).toContain('The engine is not answering.');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(list.textContent).not.toContain('No orders yet.');
    // What they owe comes with the client, so it still shows.
    expect(within(list).getByRole('button', { name: receiptMark('R-0416') })).toBeTruthy();
  });
});

describe('Clients: tax details, simple first', () => {
  const fold = (root: HTMLElement) => within(root).getByText('More details').closest('details') as HTMLDetailsElement;

  it('a business not registered for GST keeps the tax number behind "More details" in the client sheet', async () => {
    await start('#/clients?sheet=client:c-boat');
    const sheet = await screen.findByRole('complementary', { name: 'Boat Audio' });
    await waitFor(() => expect(within(sheet).getByText('partners@boataudio.in')).toBeTruthy());
    const details = await waitFor(() => fold(sheet));
    expect(details.open).toBe(false);
    const tax = within(sheet).getByText('Tax number').closest('[role="group"]') as HTMLElement;
    expect(details.contains(tax)).toBe(true);
    expect(details.contains(within(sheet).getByText('Email'))).toBe(false);
    fireEvent.click(within(details).getByText('More details'));
    await waitFor(() => expect(details.open).toBe(true));
    expect(tax.textContent).toContain('27AABCB4321K1Z3');
  });

  it('and keeps the GSTIN field behind "More details" in Add client, opening it when the engine refuses the number', async () => {
    await start('#/clients?sheet=client:new');
    const sheet = await screen.findByRole('complementary', { name: 'Add a client' });
    const details = await waitFor(() => fold(sheet));
    expect(details.open).toBe(false);
    expect(details.contains(within(sheet).getByLabelText('GSTIN or tax number'))).toBe(true);
    expect(details.contains(within(sheet).getByLabelText('Name'))).toBe(false);
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Kapoor Films' } });
    fireEvent.change(within(sheet).getByLabelText('GSTIN or tax number'), { target: { value: 'NOT-A-GSTIN' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Add client' })); });
    await waitFor(() => expect(within(sheet).getByLabelText('GSTIN or tax number').getAttribute('aria-invalid')).toBe('true'));
    expect(details.open).toBe(true);
  });

  it('a GST-registered business shows the tax number in the sheet and the form, with no fold', async () => {
    await start('#/clients?sheet=client:c-mehta', { prepare: ledgerline });
    const sheet = await screen.findByRole('complementary', { name: 'Mehta Traders' });
    await waitFor(() => expect(within(sheet).getByText('Tax number')).toBeTruthy());
    await settle();
    expect(within(sheet).queryByText('More details')).toBeNull();
    expect(within(sheet).getByText('Tax number').closest('details')).toBeNull();
    await click(within(sheet).getByRole('button', { name: /^Close/ }));
    await click(await screen.findByRole('button', { name: 'Add client' }));
    const form = await screen.findByRole('complementary', { name: 'Add a client' });
    await settle();
    expect(within(form).getByLabelText('GSTIN or tax number').closest('details')).toBeNull();
    expect(within(form).queryByText('More details')).toBeNull();
  });

  it('the client sheet has the client\'s initials in its head', async () => {
    await start('#/clients?sheet=client:c-boat');
    const sheet = await screen.findByRole('complementary', { name: 'Boat Audio' });
    expect(sheet.querySelector('[aria-hidden="true"][data-dept]')?.textContent).toBe('BA');
  });
});

describe('Clients: the Pipeline tab', () => {
  // W4 4E4 replaced the board of lead stages (W3 3E2) with the pipeline, Found to Not now: its tiles, chips, cards,
  // moves, follow-ups and sheets are tested in clients-pipeline.test.tsx and clients-outreach.test.tsx.
  it('is the pipeline board, Found to Not now, and a lead is one of its cards, opening the lead sheet', async () => {
    await start('#/clients/pipeline');
    const root = await board();
    await waitFor(() => expect(within(root).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Found', 'Asked', 'Talking', 'Proposal', 'Won']));
    const asha = cardOf(column(root, 'Found'), 'Asha Rao');
    expect(asha.querySelector('[aria-hidden="true"][data-dept]')?.textContent).toBe('AR');
    expect(asha.textContent).toContain('Email works');
    await click(within(asha).getByRole('button', { name: 'Asha Rao' }));
    expect(window.location.hash).toBe('#/clients/pipeline?sheet=lead%3Alead-pocket');
    expect(await screen.findByRole('complementary', { name: 'Asha Rao' })).toBeTruthy();
    assertInkRules();
  });

  it('the toolbar holds Import contacts and Add a lead, which opens the add sheet', async () => {
    await start('#/clients/pipeline');
    await board();
    expect(screen.getByRole('button', { name: 'Import contacts' })).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Add a lead' }));
    expect(window.location.hash).toBe('#/clients/pipeline?sheet=lead%3Anew');
    expect(await screen.findByRole('complementary', { name: 'Add a lead' })).toBeTruthy();
  });

  it('with nobody on it, it says so in one sentence with its ways forward', async () => {
    await start('#/clients/pipeline', { prepare: ledgerline });
    expect(await screen.findByText('Nobody is in your pipeline yet.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Pipeline board' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a lead' })).toBeTruthy();
    assertInkRules();
  });

  it('the header line counts the people in the pipeline, the count in bold, and says the owner sends every message', async () => {
    await start('#/clients/pipeline');
    await board();
    const line = await waitFor(() => {
      const found = headerLine();
      expect(found?.textContent).toBe('9 people you may write to. You send every message yourself.');
      return found!;
    });
    expect(line.querySelector('b')?.textContent).toBe('9');
  });

  it('J and K move between the cards and Enter opens the focused one', async () => {
    await start('#/clients/pipeline');
    const root = await board();
    await waitFor(() => expect(within(root).getAllByRole('article').length).toBeGreaterThan(2));
    const [first, second] = within(root).getAllByRole('article');
    await act(async () => { fireEvent.keyDown(document.body, { key: 'j' }); });
    expect(document.activeElement).toBe(first);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'j' }); });
    expect(document.activeElement).toBe(second);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'k' }); });
    expect(document.activeElement).toBe(first);
    const name = within(first!).getByRole('heading', { level: 3 }).textContent!;
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Enter' }); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(window.location.hash).toMatch(/^#\/clients\/pipeline\?sheet=(card|lead)%3A/);
    expect(await screen.findByRole('complementary', { name })).toBeTruthy();
  });

  it('says so when the pipeline cannot be read, and draws no board', async () => {
    await start('#/clients/pipeline', { override: failing('venture.pipeline.list') });
    expect((await screen.findByRole('alert')).textContent).toContain('The engine is not answering.');
    expect(screen.queryByRole('group', { name: 'Pipeline board' })).toBeNull();
  });
});

describe('Clients: the lead sheet', () => {
  it('has the person\'s initials in its head and says where they stand in the stage words', async () => {
    await start('#/clients/pipeline?sheet=lead:lead-pocket', {
      prepare: async (client) => {
        const { draft } = await client.request('venture.leads.draft', { leadId: 'lead-pocket', subject: 'Hello there', body: 'A short note about our mic tests.' });
        await client.request('venture.leads.recordSend', { leadId: 'lead-pocket', draftId: draft.id, sentAt: '2026-10-21T12:00:00.000Z' });
      },
    });
    const sheet = await screen.findByRole('complementary', { name: 'Asha Rao' });
    expect(sheet.querySelector('[aria-hidden="true"][data-dept]')?.textContent).toBe('AR');
    await waitFor(() => expect(sheet.textContent).toContain('Where it stands'));
    const stands = within(sheet).getByText('Where it stands').nextElementSibling;
    expect(stands?.textContent).toBe('Contacted');
    // The owner's send is read on this computer's clock, as on the card: never the raw stored time.
    expect(sheet.textContent).toContain('You sent it 21 Oct');
    expect(sheet.textContent).not.toContain('2026-10-21');
  });
});

describe('Clients in Hindi', () => {
  it('both tabs render with no key showing as text', async () => {
    const { container } = await start('#/clients', { language: 'hi' });
    await screen.findByRole('button', { name: 'Boat Audio' });
    expect(container.textContent).not.toMatch(/clients\.[a-z]/);
    expect(container.textContent).not.toMatch(/(board|state)\.[a-z]/);
  });

  it('the pipeline renders in Hindi with no key showing as text', async () => {
    const { container } = await start('#/clients/pipeline', { language: 'hi' });
    await screen.findByRole('button', { name: 'Asha Rao' });
    expect(container.textContent).not.toMatch(/clients\.[a-z]/);
    expect(container.textContent).not.toMatch(/(board|state)\.[a-z]/);
  });
});
