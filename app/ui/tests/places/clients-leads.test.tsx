import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

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
  it('Clients and Leads sit side by side under the title', async () => {
    await start('#/clients');
    const nav = screen.getByRole('navigation', { name: 'Clients and leads' });
    expect(within(nav).getByRole('link', { name: 'Clients' }).getAttribute('aria-current')).toBe('page');
    await click(within(nav).getByRole('link', { name: 'Leads' }));
    await waitFor(() => expect(window.location.hash).toBe('#/clients/leads'));
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(within(screen.getByRole('navigation', { name: 'Clients and leads' })).getByRole('link', { name: 'Leads' }).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByRole('list', { name: 'Leads' })).toBeTruthy();
  });

  it('lists leads with their email check in words, where they stand and the page they were found on', async () => {
    await start();
    const list = await screen.findByRole('list', { name: 'Leads' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const asha = rows.find((r) => r.textContent?.includes('Asha Rao'))!;
    expect(asha.textContent).toContain('Pocket Audio');
    expect(asha.textContent).toContain('asha@pocketaudio.in · mail server answers');
    expect(asha.textContent).toContain('New');
    expect(asha.textContent).toContain('https://pocketaudio.in/about');
    expect(within(asha).queryByRole('link')).toBeNull();
    const kabir = rows.find((r) => r.textContent?.includes('Kabir Shah'))!;
    expect(kabir.textContent).toContain('kabir@studiokite.co · not checked');
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
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Leads' })).getAllByRole('listitem')).toHaveLength(3));
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
    expect(sheet.textContent).toContain('You wrote');
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
    const row = within(screen.getByRole('list', { name: 'Leads' })).getAllByRole('listitem').find((r) => r.textContent?.includes('Asha Rao'))!;
    expect(row.textContent).toContain('Blocked');
  });
});
