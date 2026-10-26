import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { receiptMark } from '../helpers/ink-rules';

type Fake = ReturnType<typeof createFakeClient>;

function start(hash = '#/clients', options: { language?: 'en' | 'hi'; override?: (client: Fake) => void } = {}) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  options.override?.(client);
  const spy = vi.spyOn(client, 'request');
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { client, spy, ...view };
}

/** Clicks something that changes the address, then lets the shell see the new hash. */
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

function withNoClients(client: Fake) {
  const base = client.request.bind(client);
  client.request = ((method: string, params?: unknown) => (method === 'venture.client.list' ? Promise.resolve([]) : base(method as never, params as never))) as EngineClient['request'];
}

async function openClient(name: string) {
  const opener = await screen.findByRole('button', { name });
  await click(opener);
  const sheet = await screen.findByRole('complementary', { name });
  return sheet;
}

const field = (sheet: HTMLElement, label: string) => within(sheet).getByRole('group', { name: label });

describe('Clients place', () => {
  it('lists clients with their last order in one sentence and what they owe, with its receipt', async () => {
    start();
    expect(screen.getByRole('heading', { level: 1, name: 'Clients' })).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Clients' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const boat = rows.find((r) => r.textContent?.includes('Boat Audio'))!;
    expect(boat.textContent).toContain('Order open: Two mentions in episode 14');
    expect(within(boat).getByText('₹26,200.00').className).toContain('mono');
    expect(within(boat).getByRole('button', { name: receiptMark('R-0416') })).toBeTruthy();
    const nimbus = rows.find((r) => r.textContent?.includes('Nimbus Mics'))!;
    expect(nimbus.textContent).toContain('No orders yet.');
    expect(within(nimbus).queryByRole('button', { name: /Receipt/ })).toBeNull();
    // Ink v2 (3E2): the count in the header line is set in bold, so the line is one paragraph with a <b> in it.
    const line = screen.getByRole('heading', { level: 1, name: 'Clients' }).nextElementSibling!;
    expect(line.textContent).toBe('2 clients');
    expect(line.querySelector('b')?.textContent).toBe('2');
  });

  it('opens a receipt from what a client owes', async () => {
    start();
    await click(await screen.findByRole('button', { name: receiptMark('R-0416') }));
    const sheet = await screen.findByRole('complementary', { name: 'R-0416' });
    await waitFor(() => expect(sheet.textContent).toContain('₹13,100.00'));
  });

  it('says "No clients yet." with one way to add one', async () => {
    start('#/clients', { override: withNoClients });
    expect(await screen.findByText('No clients yet.')).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Add client' });
    expect(add.dataset.variant).toBe('primary');
    await click(add);
    expect(window.location.hash).toBe('#/clients?sheet=client%3Anew');
    expect(await screen.findByRole('complementary', { name: 'Add a client' })).toBeTruthy();
  });

  it('adds a client through venture.client.add, sending only what was typed, then shows the new client', async () => {
    const { spy } = start();
    await click(await screen.findByRole('button', { name: 'Add client' }));
    const sheet = await screen.findByRole('complementary', { name: 'Add a client' });
    const submit = within(sheet).getByRole('button', { name: 'Add client' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Kapoor Films' } });
    fireEvent.change(within(sheet).getByLabelText('Email'), { target: { value: 'hello@kapoorfilms.in' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(submit); });
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(spy).toHaveBeenCalledWith('venture.client.add', { name: 'Kapoor Films', email: 'hello@kapoorfilms.in' });
    const created = await screen.findByRole('complementary', { name: 'Kapoor Films' });
    expect(window.location.hash).toMatch(/sheet=client%3Ac-new-1/);
    await waitFor(() => expect(field(created, 'Email').textContent).toContain('hello@kapoorfilms.in'));
    const list = screen.getByRole('list', { name: 'Clients' });
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
  });

  it('shows the engine refusal of a bad tax number at the field, in plain words', async () => {
    start('#/clients?sheet=client:new');
    const sheet = await screen.findByRole('complementary', { name: 'Add a client' });
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Kapoor Films' } });
    fireEvent.change(within(sheet).getByLabelText('GSTIN or tax number'), { target: { value: 'NOT-A-GSTIN' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Add client' })); });
    const input = within(sheet).getByLabelText('GSTIN or tax number');
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    expect(sheet.textContent).toContain("Check the client's GSTIN.");
    expect(window.location.hash).toMatch(/sheet=client(:|%3A)new$/);
  });
});

describe('client sheet', () => {
  it('shows evidence-backed fields with a dotted underline whose source shows on hover and on focus', async () => {
    start();
    const sheet = await openClient('Boat Audio');
    const email = field(sheet, 'Email');
    await waitFor(() => expect(within(email).getByText('partners@boataudio.in')).toBeTruthy());
    const value = within(email).getByText('partners@boataudio.in').closest('[tabindex="0"]') as HTMLElement;
    const tip = within(email).getByRole('tooltip', { hidden: true });
    expect(tip.hidden).toBe(true);
    fireEvent.focus(value);
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe('Source: You entered this. (observed)');
    fireEvent.blur(value);
    fireEvent.mouseEnter(value);
    expect(tip.hidden).toBe(false);
  });

  it('says in words when a stored value was inferred, not observed', async () => {
    start();
    const sheet = await openClient('Boat Audio');
    const note = field(sheet, 'Note');
    await waitFor(() => expect(note.textContent).toContain('Sponsors two episodes a month.'));
    expect(within(note).getByText('inferred')).toBeTruthy();
    expect(field(sheet, 'Email').textContent).not.toContain('inferred');
  });

  it('places a weaker suggestion right under the value it would replace, with a reason and two actions', async () => {
    start();
    const sheet = await openClient('Boat Audio');
    const email = field(sheet, 'Email');
    const suggestion = await within(email).findByRole('group', { name: 'Suggested email' });
    expect(suggestion.textContent).toContain('sponsorships@boataudio.in');
    expect(suggestion.textContent).toContain('observed · strong · Read from a file in the run (tc-31-2): signature on the sponsor brief');
    expect(within(suggestion).getByRole('button', { name: 'Use this' }).dataset.key).toBe('primary');
    expect(within(suggestion).getByRole('button', { name: 'Dismiss' }).dataset.key).toBe('secondary');
    expect(suggestion.hasAttribute('data-row')).toBe(true);
  });

  it('says plainly when the engine keeps a checked value over weaker evidence (EVIDENCE_WEAK)', async () => {
    const { spy } = start();
    const sheet = await openClient('Boat Audio');
    const suggestion = await within(field(sheet, 'Email')).findByRole('group', { name: 'Suggested email' });
    await act(async () => { fireEvent.click(within(suggestion).getByRole('button', { name: 'Use this' })); });
    expect(spy).toHaveBeenCalledWith('venture.evidence.apply', { id: 'ev-b3' });
    await waitFor(() => expect(suggestion.textContent).toContain('Kept as it is. A checked value is stored here, and this evidence is weaker.'));
    expect(field(sheet, 'Email').textContent).toContain('partners@boataudio.in');
  });

  it('uses a suggestion where nothing checked is stored, and the value lands in its place', async () => {
    start();
    const sheet = await openClient('Nimbus Mics');
    const email = field(sheet, 'Email');
    const suggestion = await within(email).findByRole('group', { name: 'Suggested email' });
    expect(suggestion.textContent).toContain('inferred · weak · Unchecked: the AI said a web page shows this');
    await act(async () => { fireEvent.click(within(suggestion).getByRole('button', { name: 'Use this' })); });
    await waitFor(() => expect(within(email).queryByRole('group', { name: 'Suggested email' })).toBeNull());
    expect(within(email).getByText('hello@nimbusmics.in')).toBeTruthy();
    expect(within(email).getByText('inferred')).toBeTruthy();
  });

  it('keeps the shell keys in the sheet: J reaches the suggestion, A uses it', async () => {
    const { spy } = start();
    const sheet = await openClient('Nimbus Mics');
    const suggestion = await within(field(sheet, 'Email')).findByRole('group', { name: 'Suggested email' });
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole('heading', { level: 2 })));
    fireEvent.keyDown(document.activeElement!, { key: 'j' });
    expect(document.activeElement).toBe(suggestion);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'a' }); });
    expect(spy).toHaveBeenCalledWith('venture.evidence.apply', { id: 'ev-n2' });
    await waitFor(() => expect(field(sheet, 'Email').textContent).toContain('hello@nimbusmics.in'));
  });

  it('dismisses a suggestion in the engine, so it stays dismissed after reopening and in a new session', async () => {
    const { client, spy, unmount } = start();
    let sheet = await openClient('Nimbus Mics');
    const suggestion = await within(field(sheet, 'Email')).findByRole('group', { name: 'Suggested email' });
    await act(async () => { fireEvent.click(within(suggestion).getByRole('button', { name: 'Dismiss' })); });
    expect(spy).toHaveBeenCalledWith('venture.evidence.dismiss', { id: 'ev-n2' });
    expect(within(field(sheet, 'Email')).queryByRole('group', { name: 'Suggested email' })).toBeNull();
    expect(document.activeElement).toBe(field(sheet, 'Email'));
    await click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    sheet = await openClient('Nimbus Mics');
    await waitFor(() => expect(field(sheet, 'Email').textContent).toContain('Not given'));
    expect(within(field(sheet, 'Email')).queryByRole('group', { name: 'Suggested email' })).toBeNull();
    // The engine keeps it: a new window on the same engine does not show it either.
    unmount();
    window.location.hash = '#/clients';
    render(<App client={client} language="en" />);
    sheet = await openClient('Nimbus Mics');
    await waitFor(() => expect(field(sheet, 'Email').textContent).toContain('Not given'));
    expect(within(field(sheet, 'Email')).queryByRole('group', { name: 'Suggested email' })).toBeNull();
    const items = (await client.request('venture.evidence.list', { subject: 'client:c-nimbus' })).items;
    expect(items.find((item) => item.id === 'ev-n2')?.dismissed).toBe(true);
  });

  it('a refused dismiss brings the suggestion back with the reason in words', async () => {
    start('#/clients', {
      override: (client) => {
        const base = client.request.bind(client);
        client.request = ((method: string, params?: unknown) => (method === 'venture.evidence.dismiss'
          ? Promise.reject(new EngineError('EVIDENCE_APPLIED', 'This value is in use. Apply a different one to replace it.'))
          : base(method as never, params as never))) as EngineClient['request'];
      },
    });
    const sheet = await openClient('Nimbus Mics');
    const suggestion = await within(field(sheet, 'Email')).findByRole('group', { name: 'Suggested email' });
    await act(async () => { fireEvent.click(within(suggestion).getByRole('button', { name: 'Dismiss' })); });
    const back = await within(field(sheet, 'Email')).findByRole('group', { name: 'Suggested email' });
    expect(within(back).getByRole('alert').textContent).toBe("Couldn't dismiss this: This value is in use. Apply a different one to replace it.");
  });

  it('asks for data Chausar cannot see, where the value would go, with no value to use', async () => {
    start();
    const sheet = await openClient('Nimbus Mics');
    const tax = field(sheet, 'Tax number');
    await waitFor(() => expect(tax.textContent).toContain('needs your data'));
    expect(tax.textContent).toContain('ask them for their GSTIN before the first invoice');
    expect(within(tax).queryByRole('button', { name: 'Use this' })).toBeNull();
  });

  it('lists their orders as links into Work, their drafts with plain state words, and the files they sent', async () => {
    start();
    const sheet = await openClient('Boat Audio');
    const orders = await within(sheet).findByRole('list', { name: 'Orders' });
    const link = within(orders).getByRole('link', { name: 'Two mentions in episode 14' });
    expect(link.getAttribute('href')).toBe('#/work?order=o-boat-14');
    expect(orders.textContent).toContain('Open');
    // o-boat-12 is delivered (its fixture says so since 4Z2), so it reads Delivered in plain words.
    expect(orders.textContent).toContain('Delivered');
    expect(within(orders).getByRole('button', { name: receiptMark('R-0416') })).toBeTruthy();
    const drafts = await within(sheet).findByRole('list', { name: 'Drafts' });
    expect(drafts.textContent).toContain('Sponsor script for episode 14');
    expect(drafts.textContent).toContain('Ready for you to read');
    expect(drafts.textContent).toContain('Sponsor script for episode 12');
    expect(drafts.textContent).toContain('You accepted it');
    expect(drafts.textContent).not.toContain('Practice');
    const files = await within(sheet).findByRole('list', { name: 'Files they sent' });
    expect(files.textContent).toContain('boat-audio-brief-ep14.pdf');
    expect(files.textContent).not.toContain('practice');
  });

  it('shows what the client owes in the sheet line, with its receipt', async () => {
    start();
    const sheet = await openClient('Boat Audio');
    const owes = await within(sheet).findByText('owes');
    const line = owes.parentElement!;
    // Ink v2 (3E2): the amount is a Figure, its receipt chip beside it with a gap rather than a space character.
    // 4Z3: the receipt is a mark beside it; its code is not printed.
    expect(line.textContent).toMatch(/^owes ₹26,200\.00\s*$/);
    expect(within(line).getByRole('button', { name: 'Receipt for ₹26,200.00' }).getAttribute('data-receipt')).toBe('R-0416');
    expect(within(line).getByText('₹26,200.00').className).toContain('mono');
    expect(within(line).getByText('₹26,200.00').closest('[data-figure]')).toBeTruthy();
    expect(within(line).getByRole('button', { name: receiptMark('R-0416') })).toBeTruthy();
  });

  it('says so for a client that is not in this business', async () => {
    start('#/clients?sheet=client:c-gone');
    expect(await screen.findByRole('complementary', { name: "This client isn't in this business." })).toBeTruthy();
  });

  it('follows the open business', async () => {
    start('#/clients');
    await screen.findByRole('button', { name: 'Boat Audio' });
    fireEvent.click(screen.getByRole('button', { name: /Lumen Studio/ }));
    const menu = await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' });
    const ledgerline = await within(menu).findByRole('button', { name: 'Ledgerline' });
    await act(async () => { fireEvent.click(ledgerline); });
    expect(await screen.findByRole('button', { name: 'Mehta Traders' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Boat Audio' })).toBeNull();
  });

  it('renders in Hindi with no missing text', async () => {
    const { container } = start('#/clients?sheet=client:c-boat', { language: 'hi' });
    await screen.findByRole('complementary', { name: 'Boat Audio' });
    await waitFor(() => expect(container.textContent).toContain('partners@boataudio.in'));
    expect(container.textContent).not.toMatch(/clients\.[a-z]/);
  });
});
