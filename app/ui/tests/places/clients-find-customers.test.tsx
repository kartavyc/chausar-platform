import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NO_TOOL_ON_CARD } from '../../../../platform/runtime/venture/customers/find-words';

// Finding customers from the Pipeline tab (places/clients/FindCustomers.tsx): the owner starts a search, reads the
// card in the engine's exact words, and approves it with Today's own decision. Until what is sold is ready there is
// no form, only the engine's line. Nothing is sent.

type Fake = ReturnType<typeof createFakeClient>;

async function start(prepare?: (client: Fake) => Promise<void>) {
  window.location.hash = '#/clients/pipeline';
  const client = createFakeClient(new FakeEngine());
  await prepare?.(client);
  const spy = vi.spyOn(client, 'request');
  render(<App client={client} language="en" />);
  return { client, spy };
}
/** The sample business has one offer with no price; with it set, what is sold is ready. */
async function priced(client: Fake) {
  const plan = (await client.request('venture.blueprint.get', {}))!;
  const offers = plan.blueprint.offers.filter((offer) => offer.pricing.unitPriceMinor === null).map((offer) => ({ id: offer.id, unitPrice: '4000' }));
  await client.request('venture.blueprint.update', { patch: { offers } });
}
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter((call) => call[0] === method).map((call) => call[1]);

async function openSheet() {
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Find customers' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  return screen.findByRole('complementary', { name: 'Find customers' });
}

describe('Clients: find customers', () => {
  it('until what is sold is ready, the sheet shows the engine\'s line and offers no search', async () => {
    const { spy } = await start();
    const sheet = await openSheet();
    expect(await within(sheet).findByText('Finding customers waits until what you sell is ready. Set your price for Shorts from your long video.')).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Review' })).toBeNull();
    expect(within(sheet).queryByLabelText('City')).toBeNull();
    expect(calls(spy, 'venture.leads.find.propose')).toEqual([]);
  });

  it('customers who are not places: the sheet says in one line that the public map lists places only', async () => {
    await start(async (client) => {
      await priced(client);
      await client.request('venture.owner.set', { way: { customer: 'YouTube creators and small production houses pay for subtitles.', reach: 'Through contacts you provide.', teamDoes: 'Drafts each message for your approval.', youDo: 'Send each message.', firstWeek: ['Prepare sample subtitles.'] } });
    });
    const sheet = await openSheet();
    const note = await within(sheet).findByText('The public map lists places only, and your customers are not a kind of place on it. For now, add people you already know in Clients, or use a lead tool once you connect one.');
    expect(note.getAttribute('data-map-note')).toBe('');
    // The form is still there: the owner's own search is theirs to choose.
    expect(within(sheet).getByLabelText('City')).toBeTruthy();
  });

  it('the sources carry the engine\'s honest labels, and Connect a lead tool opens the MCP servers form', async () => {
    await start(priced);
    const sheet = await openSheet();
    const sources = await within(sheet).findByRole('list', { name: 'Where it can look' });
    const [map, monid] = within(sources).getAllByRole('listitem');
    expect(map!.textContent).toContain('Public map');
    expect(map!.textContent).toContain('Reads');
    expect(monid!.textContent).toContain('Monid');
    expect(monid!.textContent).toContain('Planned');
    expect(monid!.textContent).toContain('Needs your own Monid account, added in Connections, MCP servers. Not tried on a live account yet.');
    expect(within(sheet).getByText('No lead tool is connected. The public map search needs nothing.')).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: 'Connect a lead tool' }).getAttribute('href')).toBe('#/connections/ai');
    // With only the public map usable, there is no source to choose and no tool to name.
    expect(within(sheet).queryByLabelText('Look with')).toBeNull();
    expect(within(sheet).queryByLabelText('Tool')).toBeNull();
  });

  it('the owner fills the brief, reads the card, approves it, and sees what was found with its source', async () => {
    const { spy } = await start(priced);
    const sheet = await openSheet();
    type(await within(sheet).findByLabelText('Who to look for'), 'Cafes that buy handmade tableware');
    type(within(sheet).getByLabelText('City'), 'Pune');
    type(within(sheet).getByLabelText('Kind of place'), 'amenity=cafe');
    type(within(sheet).getByLabelText('How many'), '3');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Review' })); });
    expect(calls(spy, 'venture.leads.find.propose')).toEqual([{ brief: { who: 'Cafes that buy handmade tableware', place: 'Pune', category: 'amenity=cafe', count: 3, source: { kind: 'public-map' } } }]);
    expect(await within(sheet).findByRole('heading', { name: 'Find possible customers: cafes in Pune' })).toBeTruthy();
    expect(within(sheet).getByText('Looks on OpenStreetMap, a public map, for up to 3 cafes in Pune, and reads each one\'s own website for a contact email. It finds only places listed there by name, so some will be missing. It is free and needs no account. No lead tool is connected; you can add one in Connections. Nothing is sent. You check the list and write to each one yourself.')).toBeTruthy();
    expect(calls(spy, 'venture.queue.decide')).toEqual([]);
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Approve' })); });
    await waitFor(() => expect(calls(spy, 'venture.queue.decide').length).toBe(1));
    expect(calls(spy, 'venture.queue.decide')[0]).toMatchObject({ action: 'approve' });
    expect(await within(sheet).findByText('Found 2 possible customers in Pune. None showed a contact email. They are in Clients, Pipeline, each with its source. Nothing was sent.', { selector: '[role="status"]' })).toBeTruthy();
    const found = await within(sheet).findByRole('list', { name: 'Searches and what they found' });
    expect(within(found).getByRole('button', { name: 'Lotus Cafe (sample)' })).toBeTruthy();
    expect(within(found).getAllByText('OpenStreetMap. © OpenStreetMap contributors, ODbL').length).toBe(2);
    expect(found.textContent).toContain('https://www.openstreetmap.org/node/900000001');
  });

  // Found on Windows, 16 Nov 2026 (screen 205): two tries the map did not answer and a third entry, "On Today for your
  // approval. Nothing has run.", for the same card put back. Each try is one entry; the newest failed one carries the
  // way back to its card on Today to try again, and an older one carries nothing.
  it('the list of searches tells one entry for each try, and a failed one offers to try again on Today', async () => {
    const row = 'proposal:prop-1';
    const busy = 'The public map is busy right now, so it gave no list. Nothing was added and nothing was sent. Try again in a few minutes, or add a lead you know yourself.';
    await start(async (client) => {
      await priced(client);
      const request = client.request.bind(client);
      client.request = (async (method: string, params: unknown) => {
        const answer = await request(method as never, params as never) as Record<string, unknown>;
        if (method !== 'venture.leads.find.view') return answer;
        const tried = (id: string, at: string, rowId: string | null) => ({ id, state: 'failed', title: 'Find possible customers: company offices in Indore', line: busy, at, found: 0, proposalId: 'prop-1', rowId });
        return { ...answer, searches: [tried('s2', '2026-11-16T14:40:00.000Z', row), tried('s1', '2026-11-16T14:30:00.000Z', null)], found: [] };
      }) as never;
    });
    const sheet = await openSheet();
    const list = await within(sheet).findByRole('list', { name: 'Searches and what they found' });
    const entries = [...list.querySelectorAll('[data-search-state]')];
    expect(entries.map((item) => item.getAttribute('data-search-state'))).toEqual(['failed', 'failed']);
    expect(entries.every((item) => item.textContent?.includes(busy))).toBe(true);
    expect(list.textContent).not.toContain('Nothing has run');
    const again = within(entries[0] as HTMLElement).getByRole('link', { name: 'Try again on Today' });
    expect(again.getAttribute('href')).toBe(`#/today?row=${encodeURIComponent(row)}`);
    expect(entries[1]!.querySelector('[data-search-card]')).toBeNull();
  });

  // Found on Windows, 16 Nov 2026 (screens 088 against 068): "Open" on the next best step did nothing the owner could
  // see when the step was a search's card. The card took focus where it stood, and a card already on screen never moved.
  it('Open on the next best step takes the owner to the search card: brought to the middle of the view, with focus', async () => {
    const client = createFakeClient(new FakeEngine());
    await priced(client);
    const proposed = await client.request('venture.leads.find.propose', { brief: { who: 'Cafes', place: 'Pune', category: 'amenity=cafe', count: 3, source: { kind: 'public-map' } } });
    const request = client.request.bind(client);
    vi.spyOn(client, 'request').mockImplementation((async (method: string, params: unknown) => {
      const answer = await request(method as never, params as never) as Record<string, unknown>;
      if (method !== 'venture.chief.plan.get') return answer;
      return { ...answer, next: { kind: 'row', title: proposed.title, line: null, action: { id: 'row', label: 'Approve', rowId: proposed.rowId }, agent: null, figure: null, goalAfterPercent: null, by: 'records', also: null } };
    }) as never);
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    const step = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-next-step]'); expect(found?.textContent).toContain(proposed.title); return found!; });
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    await act(async () => { fireEvent.click(within(step).getByRole('button', { name: 'Open' })); });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-row-id')).toBe(proposed.rowId));
    const card = document.activeElement as HTMLElement;
    expect(card.textContent).toContain(proposed.title);
    expect(scrolled.mock.contexts.at(-1)).toBe(card);
    expect(scrolled).toHaveBeenLastCalledWith({ block: 'center' });
  });

  // Found by running the real app (15 Nov 2026): the card said "you can add one in Connections" in words, with no way there.
  it('on Today the search card that says no lead tool is connected carries the way to connect one', async () => {
    const client = createFakeClient(new FakeEngine());
    await priced(client);
    const proposed = await client.request('venture.leads.find.propose', { brief: { who: 'Cafes', place: 'Pune', category: 'amenity=cafe', count: 3, source: { kind: 'public-map' } } });
    expect(proposed.line).toContain(NO_TOOL_ON_CARD);
    // Opened by its row, as an agent's chat opens a card on Today.
    window.location.hash = `#/today?row=${encodeURIComponent(proposed.rowId)}`;
    render(<App client={client} language="en" />);
    const card = (await screen.findByText('Find possible customers: cafes in Pune')).closest('article, li') as HTMLElement;
    const link = await within(card).findByRole('link', { name: 'Connect a lead tool' });
    // The same place the Find customers sheet sends the owner: the MCP servers form on Connections.
    expect(link.getAttribute('href')).toBe('#/connections/ai');
    // A card that does not say it carries no such link.
    expect(screen.getAllByRole('link', { name: 'Connect a lead tool' })).toHaveLength(1);
  });

  it('Change it takes the card off Today and opens the brief again', async () => {
    const { client, spy } = await start(priced);
    const sheet = await openSheet();
    type(await within(sheet).findByLabelText('Who to look for'), 'Cafes');
    type(within(sheet).getByLabelText('City'), 'Pune');
    type(within(sheet).getByLabelText('Kind of place'), 'amenity=cafe');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Review' })); });
    await within(sheet).findByRole('heading', { name: 'Find possible customers: cafes in Pune' });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Change it' })); });
    await waitFor(() => expect(calls(spy, 'venture.queue.decide')[0]).toMatchObject({ action: 'deny' }));
    expect(await within(sheet).findByRole('button', { name: 'Review' })).toBeTruthy();
    expect((await client.request('venture.leads.find.view', {})).searches).toEqual([]);
  });
});
