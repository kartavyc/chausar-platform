import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';

type Fake = ReturnType<typeof createFakeClient>;

async function start(hash = '#/clients/leads', prepare?: (client: Fake) => Promise<void>) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  await prepare?.(client);
  const spy = vi.spyOn(client, 'request');
  const view = render(<App client={client} language="en" />);
  return { client, spy, ...view };
}

/** Clicks something that changes the address, then lets the shell see the new hash. */
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });

async function openLead(name: string) {
  await click(await screen.findByRole('button', { name }));
  return screen.findByRole('complementary', { name });
}

async function draft(sheet: HTMLElement, subject: string, message: string) {
  type(within(sheet).getByLabelText('Subject'), subject);
  type(within(sheet).getByLabelText('Message'), message);
  await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Draft it' })); });
}

describe('Clients: leads', () => {
  // Ink v2 (3E2): the leads live on the Pipeline tab, as cards on a board of the engine's stages; the tabs are
  // "Clients views". The behaviour below (add, draft, the owner's send, block, the engine codes) is unchanged.
  it('Clients and Pipeline sit side by side under the title', async () => {
    await start('#/clients');
    const nav = screen.getByRole('navigation', { name: 'Clients views' });
    expect(within(nav).getByRole('link', { name: /^Clients/ }).getAttribute('aria-current')).toBe('page');
    await click(within(nav).getByRole('link', { name: /^Pipeline/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/clients/pipeline'));
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(within(screen.getByRole('navigation', { name: 'Clients views' })).getByRole('link', { name: /^Pipeline/ }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('group', { name: 'Pipeline board' })).toBeTruthy();
  });

  it('lists leads with their email check in words, where they stand and the page they were found on', async () => {
    await start();
    const board = await screen.findByRole('group', { name: 'Pipeline board' });
    const cards = await within(board).findAllByRole('article');
    expect(cards).toHaveLength(2);
    const asha = cards.find((r) => r.textContent?.includes('Asha Rao'))!;
    expect(asha.textContent).toContain('Pocket Audio');
    expect(asha.textContent).toContain('A mail server answers for pocketaudio.in.');
    expect(asha.closest('section')?.querySelector('h2')?.textContent).toBe('New');
    expect(within(asha).queryByRole('link')).toBeNull();
    const kabir = cards.find((r) => r.textContent?.includes('Kabir Shah'))!;
    expect(kabir.textContent).toContain('Not checked yet: no mail server answered for studiokite.co.');
    // The page they were found on is in their sheet, one step from the card.
    const sheet = await openLead('Asha Rao');
    expect(sheet.textContent).toContain('https://pocketaudio.in/about');
    expect(sheet.textContent).toContain('asha@pocketaudio.in');
  });

  it('adds a lead only with the page it was found on, and says the engine\'s words when the page is wrong', async () => {
    const { spy } = await start();
    await click(await screen.findByRole('button', { name: 'Add a lead' }));
    const sheet = await screen.findByRole('complementary', { name: 'Add a lead' });
    const add = within(sheet).getByRole('button', { name: 'Add lead' }) as HTMLButtonElement;
    type(within(sheet).getByLabelText('Name'), 'Ravi Menon');
    expect(add.disabled).toBe(true);
    expect(within(sheet).getByText('The web page, like https://example.in/team. A lead needs one.')).toBeTruthy();
    type(within(sheet).getByLabelText('Where you found them'), 'a friend told me');
    await act(async () => { fireEvent.click(add); });
    await waitFor(() => expect(within(sheet).getByText(/A lead needs the web page you found them on/)).toBeTruthy());
    expect(within(sheet).getByLabelText('Where you found them').getAttribute('aria-invalid')).toBe('true');
    type(within(sheet).getByLabelText('Where you found them'), 'https://example.in/team');
    type(within(sheet).getByLabelText('Email'), 'ravi@example.in');
    await click(within(sheet).getByRole('button', { name: 'Add lead' }));
    expect(spy).toHaveBeenCalledWith('venture.leads.add', { name: 'Ravi Menon', email: 'ravi@example.in', sourceUrl: 'https://example.in/team' });
    const lead = await screen.findByRole('complementary', { name: 'Ravi Menon' });
    expect(lead.textContent).toContain('https://example.in/team');
    expect(lead.textContent).toContain('A mail server answers for example.in.');
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Pipeline board' })).getAllByRole('article')).toHaveLength(3));
  });

  it('drafts an email with the lines the engine adds, and says plainly the owner sends it', async () => {
    const { spy } = await start();
    const sheet = await openLead('Asha Rao');
    expect(sheet.textContent).toContain('Nothing is sent: you send it yourself.');
    await draft(sheet, 'A mic for your next review', 'We tested five budget mics. Would you like the results for your channel?');
    expect(spy).toHaveBeenCalledWith('venture.leads.draft', { leadId: 'lead-pocket', subject: 'A mic for your next review', body: 'We tested five budget mics. Would you like the results for your channel?' });
    const drafts = await within(sheet).findByRole('list', { name: 'Drafts' });
    const item = within(drafts).getByRole('listitem');
    expect(item.textContent).toContain('To asha@pocketaudio.in');
    expect(item.textContent).toContain('A mic for your next review');
    expect(item.textContent).toContain('Lumen Studio');
    expect(item.textContent).toContain('Lumen Studio, 14 Lane 5, Koregaon Park, Pune 411001');
    expect(item.textContent).toContain('If you would rather not hear from us, reply "unsubscribe" and we will not write again.');
    expect(item.textContent).toContain('You send it from your own mailbox.');
    await waitFor(() => expect(sheet.textContent).toContain('Drafted'));
  });

  it('refuses to draft to an address no mail server answers for, in the engine\'s words', async () => {
    await start();
    const sheet = await openLead('Kabir Shah');
    await draft(sheet, 'Hello from Lumen', 'We make honest gear reviews. Could we send you one?');
    expect(within(sheet).getByRole('alert').textContent).toContain('Chausar drafts only to an address whose mail server answers.');
    expect(within(sheet).queryByRole('list', { name: 'Drafts' })).toBeNull();
  });

  it('asks for the postal address when the engine needs it, then drafts with it', async () => {
    const { spy } = await start('#/clients/leads', async (client) => {
      await client.request('workspace.open', { folder: 'ledgerline' });
      await client.request('venture.leads.add', { name: 'Neha Iyer', company: 'Iyer Stores', email: 'neha@example.in', sourceUrl: 'https://example.in/stores' });
    });
    const sheet = await openLead('Neha Iyer');
    expect(within(sheet).queryByLabelText('Your postal address')).toBeNull();
    await draft(sheet, 'Monthly books for your shop', 'We keep books for small traders in Pune. May I send our monthly plan?');
    expect(within(sheet).getByRole('alert').textContent).toContain('Add your postal address. Every outreach email carries it.');
    const address = within(sheet).getByLabelText('Your postal address');
    expect((within(sheet).getByRole('button', { name: 'Draft it' }) as HTMLButtonElement).disabled).toBe(true);
    type(address, 'Ledgerline, 2 FC Road, Pune 411004');
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Draft it' })); });
    expect(spy.mock.calls.filter(([method]) => method === 'venture.leads.draft').at(-1)![1]).toMatchObject({ postalAddress: 'Ledgerline, 2 FC Road, Pune 411004' });
    const drafts = await within(sheet).findByRole('list', { name: 'Drafts' });
    expect(drafts.textContent).toContain('Ledgerline, 2 FC Road, Pune 411004');
  });

  it('records a send the owner made from his own mailbox', async () => {
    const { spy } = await start('#/clients/leads', async (client) => {
      await client.request('venture.leads.draft', { leadId: 'lead-pocket', subject: 'Hello', body: 'A short note about our mic tests.' });
    });
    const sheet = await openLead('Asha Rao');
    const item = within(await within(sheet).findByRole('list', { name: 'Drafts' })).getByRole('listitem');
    fireEvent.click(within(item).getByRole('button', { name: 'I sent it' }));
    const when = within(item).getByLabelText('When you sent it') as HTMLInputElement;
    expect(when.type).toBe('datetime-local');
    type(when, '2026-10-21T11:30');
    await act(async () => { fireEvent.click(within(item).getByRole('button', { name: 'Record' })); });
    const call = spy.mock.calls.find(([method]) => method === 'venture.leads.recordSend')!;
    expect(call[1]).toMatchObject({ leadId: 'lead-pocket' });
    expect((call[1] as { sentAt: string }).sentAt).toBe(new Date('2026-10-21T11:30').toISOString());
    await waitFor(() => expect(sheet.textContent).toContain('You sent it'));
    // Ink v2 (3E2): where a lead stands uses the one set of stage words (states.ts), the board's column titles.
    expect(sheet.textContent).toContain('Contacted');
  });

  it('the sample engine refuses with the real engine codes, so the screens react to the codes the real engine sends', async () => {
    const client = createFakeClient(new FakeEngine());
    const refusal = (promise: Promise<unknown>) => promise.then(() => 'answered', (error: { code?: string }) => error.code);
    expect(await refusal(client.request('venture.leads.add', { name: 'Ravi Menon', sourceUrl: 'a friend told me' }))).toBe('LEADS_SOURCE_REQUIRED');
    expect(await refusal(client.request('venture.leads.draft', { leadId: 'lead-missing', subject: 'Hello there', body: 'A short note about our mic tests.' }))).toBe('LEADS_NOT_FOUND');
    expect(await refusal(client.request('venture.leads.draft', { leadId: 'lead-kite', subject: 'Hello there', body: 'A short note about our mic tests.' }))).toBe('LEADS_EMAIL_UNVERIFIED');
    await client.request('workspace.open', { folder: 'ledgerline' });
    const lead = await client.request('venture.leads.add', { name: 'Neha Iyer', email: 'neha@example.in', sourceUrl: 'https://example.in/stores' });
    const note = { leadId: lead.id, subject: 'Monthly books', body: 'We keep books for small traders in Pune.' };
    expect(await refusal(client.request('venture.leads.draft', note))).toBe('LEADS_ADDRESS_MISSING');
    expect(await refusal(client.request('venture.leads.recordSend', { leadId: lead.id, draftId: 'draft-missing', sentAt: '2026-10-21T06:00:00.000Z' }))).toBe('INVALID_VENTURE_REQUEST');
    await client.request('venture.leads.block', { value: 'example.in' });
    expect(await refusal(client.request('venture.leads.draft', { ...note, postalAddress: 'Ledgerline, 2 FC Road, Pune 411004' }))).toBe('LEADS_BLOCKED');
  });

  it('the sample engine keeps each stage move with its evidence, forward only, as the engine does', async () => {
    const client = createFakeClient(new FakeEngine());
    const listed = async () => (await client.request('venture.leads.list', {})).leads.find((l) => l.id === 'lead-pocket')!;
    expect((await listed()).moves).toEqual([]);
    const { draft, lead: drafted } = await client.request('venture.leads.draft', { leadId: 'lead-pocket', subject: 'Hello there', body: 'A short note about our mic tests.' });
    expect(drafted.moves).toEqual([{ from: 'new', to: 'drafted', at: draft.at, by: 'owner', evidence: { kind: 'draft', id: draft.id } }]);
    const sent = await client.request('venture.leads.recordSend', { leadId: 'lead-pocket', draftId: draft.id, sentAt: '2026-10-21T06:00:00.000Z' });
    expect(sent.status).toBe('contacted');
    expect(sent.moves.at(-1)).toMatchObject({ from: 'drafted', to: 'contacted', by: 'owner', evidence: { kind: 'send', id: draft.id } });
    const { draft: second } = await client.request('venture.leads.draft', { leadId: 'lead-pocket', subject: 'Following up', body: 'Thanks for reading our note.' });
    const again = await client.request('venture.leads.recordSend', { leadId: 'lead-pocket', draftId: second.id, sentAt: '2026-10-21T07:00:00.000Z' });
    expect(again.moves).toHaveLength(2);
    await client.request('venture.leads.block', { value: 'pocketaudio.in' });
    expect((await listed()).moves.at(-1)).toMatchObject({ from: 'contacted', to: 'blocked', by: 'owner', evidence: { kind: 'opt-out', id: 'pocketaudio.in' } });
  });

  it('the address field appears and the source field is marked when a real engine refuses with its codes', async () => {
    window.location.hash = '#/clients/leads';
    const client = createFakeClient(new FakeEngine());
    const real = client.request.bind(client);
    vi.spyOn(client, 'request').mockImplementation(async (method: string, params?: unknown) => {
      if (method === 'venture.leads.draft' && !(params as { postalAddress?: string }).postalAddress) throw new EngineError('LEADS_ADDRESS_MISSING', 'Add your business postal address. Every outreach email carries it.');
      if (method === 'venture.leads.add') throw new EngineError('LEADS_SOURCE_REQUIRED', 'Add the web page where this lead was found.');
      return real(method as never, params as never);
    });
    render(<App client={client} language="en" />);
    const sheet = await openLead('Asha Rao');
    await draft(sheet, 'A mic for your next review', 'We tested five budget mics. Would you like the results for your channel?');
    expect(within(sheet).getByRole('alert').textContent).toContain('Add your business postal address.');
    expect(within(sheet).getByLabelText('Your postal address')).toBeTruthy();
    await click(screen.getByRole('button', { name: 'Close' }));
    await click(await screen.findByRole('button', { name: 'Add a lead' }));
    const add = await screen.findByRole('complementary', { name: 'Add a lead' });
    type(within(add).getByLabelText('Name'), 'Ravi Menon');
    type(within(add).getByLabelText('Where you found them'), 'https://example.in/team');
    await act(async () => { fireEvent.click(within(add).getByRole('button', { name: 'Add lead' })); });
    await waitFor(() => expect(within(add).getByLabelText('Where you found them').getAttribute('aria-invalid')).toBe('true'));
    expect(add.textContent).toContain('Add the web page where this lead was found.');
  });

  it('blocks the address or its whole domain after a second ask', async () => {
    const { spy } = await start();
    const sheet = await openLead('Asha Rao');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Block' }));
    const ask = within(sheet).getByRole('group', { name: 'Never write to this again?' });
    expect(spy).not.toHaveBeenCalledWith('venture.leads.block', expect.anything());
    fireEvent.click(within(ask).getByRole('radio', { name: 'Everyone at pocketaudio.in' }));
    await act(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Block' })); });
    expect(spy).toHaveBeenCalledWith('venture.leads.block', { value: 'pocketaudio.in' });
    await waitFor(() => expect(sheet.textContent).toContain('Blocked'));
    expect(within(sheet).queryByRole('button', { name: 'Draft it' })).toBeNull();
    // On the board she has moved to Blocked, which stays folded until the owner opens it.
    const board = screen.getByRole('group', { name: 'Pipeline board' });
    expect(await within(board).findByRole('button', { name: 'Show Blocked, 1 person' })).toBeTruthy();
    expect(within(board).queryByRole('heading', { level: 3, name: 'Asha Rao' })).toBeNull();
  });
});
