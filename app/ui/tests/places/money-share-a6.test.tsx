import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, InvoiceShareResult } from '../../src/engine/types';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * One-shot A6 (sharing): Email it and Share on WhatsApp on an issued invoice. On the desktop the desktop makes the file
 * and opens the owner's own mail app (a draft with the PDF attached) or WhatsApp (the desktop app first, else the web
 * page); the sheet says what opened, never that anything was sent, and offers the file in its folder when it could not
 * be attached. On the web each press asks the engine again (S7: an email added later is used) and a failure names the
 * button that failed.
 */

type Call = [string, unknown];
const NOW = '2026-10-23T10:00:00.000Z';
type Extra = Partial<Pick<EngineClient, 'shareInvoice' | 'showShared'>>;

async function start(extra: Extra = {}) {
  const engine = new FakeEngine({ now: () => NOW });
  await engine.request('venture.billing.set', { upiId: 'lumen.studio@okaxis' });
  window.location.hash = '#/money/invoices?sheet=invoice:inv-0039';
  const base = createFakeClient(engine);
  const calls: Call[] = [];
  const request = base.request.bind(base);
  const client: EngineClient = { ...base, ...extra, request: (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as EngineClient['request'] };
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  const panel = await screen.findByRole('complementary', { name: 'INV-0039' });
  const pay = await within(panel).findByRole('region', { name: 'How clients pay' });
  return { calls, panel, pay };
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); }); };
const shared = (result: InvoiceShareResult) => vi.fn(async (_invoiceId: string, _how: 'email' | 'whatsapp') => result);

afterEach(() => { vi.restoreAllMocks(); });

describe('A6: Email it and Share on WhatsApp on the desktop', () => {
  it('B4 task 5: the result fills a slot that is there before the press, so what follows stays put', async () => {
    const shareInvoice = shared({ how: 'email', opened: 'draft', file: 'INV-0039.pdf', attached: 'INV-0039.pdf', to: true, note: null });
    const { pay } = await start({ shareInvoice });
    const slot = pay.querySelector('[data-result-line]')!;
    expect(slot.textContent).toBe('');
    const children = pay.children.length;
    await click(within(pay).getByRole('button', { name: 'Email it' }));
    await waitFor(() => expect(slot.textContent).toContain('Your mail app opened an email'));
    expect(pay.querySelector('[data-result-line]')).toBe(slot);
    expect(pay.children.length).toBe(children);
  });

  it('Email it opens an email in the mail app with the PDF attached, says what to do when it has no Send button, and offers the PDF', async () => {
    const shareInvoice = shared({ how: 'email', opened: 'draft', file: 'INV-0039.pdf', attached: 'INV-0039.pdf', to: true, note: null });
    const { calls, panel, pay } = await start({ shareInvoice, showShared: vi.fn(async () => undefined) });
    await click(within(pay).getByRole('button', { name: 'Email it' }));
    await waitFor(() => expect(shareInvoice).toHaveBeenCalledWith('inv-0039', 'email'));
    expect(await within(pay).findByText('Your mail app opened an email with INV-0039.pdf attached. Check it and send it. If it has no Send button, use Forward or Edit as new.')).toBeTruthy();
    expect(calls.map(([method]) => method)).not.toContain('venture.invoice.pdf');
    expect(within(pay).getByRole('button', { name: 'Show the PDF in its folder' })).toBeTruthy();
    // C4 (T20): the line that says what opened never says sent (Mark as sent is the owner's own button).
    expect(within(pay).getByRole('status').textContent).not.toMatch(/\bsent\b/i);
    assertInkRules(panel);
    assertOnePrimary(panel);
  });

  it('with no client email the To line is empty, and the sheet says to add the address', async () => {
    const { pay } = await start({ shareInvoice: shared({ how: 'email', opened: 'draft', file: 'INV-0039.pdf', attached: 'INV-0039.pdf', to: false, note: null }) });
    await click(within(pay).getByRole('button', { name: 'Email it' }));
    expect(await within(pay).findByText("Your mail app opened an email with INV-0039.pdf attached. Add the client's email address, then send it. If it has no Send button, use Forward or Edit as new.")).toBeTruthy();
  });

  it('when no mail app takes the draft, the sheet says what opened and offers the PDF in its folder', async () => {
    const showShared = vi.fn(async (_name: string) => undefined);
    const shareInvoice = shared({ how: 'email', opened: 'link', file: 'INV-0039.pdf', attached: 'INV-0039.pdf', to: true, note: null });
    const { pay } = await start({ shareInvoice, showShared });
    await click(within(pay).getByRole('button', { name: 'Email it' }));
    expect(await within(pay).findByText('Your mail app opened with the words filled in, but a mail link cannot carry a file. Attach INV-0039.pdf, then press send.')).toBeTruthy();
    await click(within(pay).getByRole('button', { name: 'Show the PDF in its folder' }));
    await waitFor(() => expect(showShared).toHaveBeenCalledWith('INV-0039.pdf'));

    shareInvoice.mockResolvedValueOnce({ how: 'email', opened: 'none', file: 'INV-0039.pdf', attached: 'INV-0039.pdf', to: true, note: null });
    await click(within(pay).getByRole('button', { name: 'Email it' }));
    expect(await within(pay).findByText('No mail app opened on this computer. INV-0039.pdf is saved, so you can attach it to an email yourself.')).toBeTruthy();
    expect(within(pay).getByRole('button', { name: 'Show the PDF in its folder' })).toBeTruthy();
  });

  it('WhatsApp says which opened, that its links cannot attach a file, and offers the PDF in its folder', async () => {
    const showShared = vi.fn(async (_name: string) => undefined);
    const shareInvoice = shared({ how: 'whatsapp', opened: 'app', file: 'INV-0039.pdf', note: null });
    const open = vi.spyOn(window, 'open');
    const { pay } = await start({ shareInvoice, showShared });
    await click(within(pay).getByRole('button', { name: 'Share on WhatsApp' }));
    await waitFor(() => expect(shareInvoice).toHaveBeenCalledWith('inv-0039', 'whatsapp'));
    expect(await within(pay).findByText('WhatsApp opened with the invoice note. A WhatsApp link cannot carry a file, so attach INV-0039.pdf and send it yourself.')).toBeTruthy();
    expect(open).not.toHaveBeenCalled();
    await click(within(pay).getByRole('button', { name: 'Show the PDF in its folder' }));
    await waitFor(() => expect(showShared).toHaveBeenCalledWith('INV-0039.pdf'));

    shareInvoice.mockResolvedValueOnce({ how: 'whatsapp', opened: 'web', file: 'INV-0039.pdf', note: null });
    await click(within(pay).getByRole('button', { name: 'Share on WhatsApp' }));
    expect(await within(pay).findByText('WhatsApp opened in your browser with the invoice note. A WhatsApp link cannot carry a file, so attach INV-0039.pdf and send it yourself.')).toBeTruthy();
    expect(within(pay).getByRole('status').textContent).not.toMatch(/\bsent\b/i);
  });

  it('A6 round 2 (low 7): the email names the file as the client gets it; the folder shows the copy kept on this computer', async () => {
    const showShared = vi.fn(async (_name: string) => undefined);
    const { pay } = await start({ shareInvoice: shared({ how: 'email', opened: 'draft', file: 'INV-0039-2.pdf', attached: 'INV-0039.pdf', to: true, note: null }), showShared });
    await click(within(pay).getByRole('button', { name: 'Email it' }));
    expect(await within(pay).findByText('Your mail app opened an email with INV-0039.pdf attached. Check it and send it. If it has no Send button, use Forward or Edit as new.')).toBeTruthy();
    await click(within(pay).getByRole('button', { name: 'Show the PDF in its folder' }));
    await waitFor(() => expect(showShared).toHaveBeenCalledWith('INV-0039-2.pdf'));
  });

  it('A6 round 1 (low 9): a file that cannot be shown says so in its own words, and the stale line goes', async () => {
    const showShared = vi.fn(async (_name: string): Promise<void> => { throw Object.assign(new Error('That file is not there any more. Press the button again to make it.'), { code: 'SHARE_FILE_GONE' }); });
    const { pay } = await start({ shareInvoice: shared({ how: 'whatsapp', opened: 'app', file: 'INV-0039.pdf', note: null }), showShared });
    await click(within(pay).getByRole('button', { name: 'Share on WhatsApp' }));
    await click(await within(pay).findByRole('button', { name: 'Show the PDF in its folder' }));
    expect(await within(pay).findByText("Couldn't show the file: That file is not there any more. Press the button again to make it.")).toBeTruthy();
    expect(pay.textContent).not.toContain('WhatsApp opened');
    expect(within(pay).queryByRole('button', { name: 'Show the PDF in its folder' })).toBeNull();
  });

  it('a refusal names the button that failed, in the desktop\'s words', async () => {
    const shareInvoice = vi.fn(async (_invoiceId: string, _how: 'email' | 'whatsapp'): Promise<InvoiceShareResult> => { throw Object.assign(new Error('The invoice file could not be made. Try again.'), { code: 'REQUEST_FAILED' }); });
    const { pay } = await start({ shareInvoice });
    await click(within(pay).getByRole('button', { name: 'Email it' }));
    expect(await within(pay).findByText("Email it didn't work: The invoice file could not be made. Try again.")).toBeTruthy();
    await click(within(pay).getByRole('button', { name: 'Share on WhatsApp' }));
    expect(await within(pay).findByText("Share on WhatsApp didn't work: The invoice file could not be made. Try again.")).toBeTruthy();
  });
});

describe('A6: sharing on the web', () => {
  it('each press asks the engine again, so an email added later is used (S7)', async () => {
    const tabs: { location: { replace: (url: string) => void }; close: () => void; opener: unknown }[] = [];
    const replaced: string[] = [];
    vi.spyOn(window, 'open').mockImplementation(() => { const tab = { location: { replace: (url: string) => { replaced.push(url); } }, close: () => {}, opener: null }; tabs.push(tab); return tab as unknown as Window; });
    const { calls, pay } = await start();
    await click(within(pay).getByRole('button', { name: 'Share on WhatsApp' }));
    await waitFor(() => expect(replaced).toHaveLength(1));
    await click(within(pay).getByRole('button', { name: 'Share on WhatsApp' }));
    await waitFor(() => expect(replaced).toHaveLength(2));
    expect(calls.filter(([method]) => method === 'venture.invoice.pdf')).toHaveLength(2);
    expect(replaced[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(within(pay).getByText('Your own app opens with the words filled in. Attach the file and send it yourself.')).toBeTruthy();
  });

  it('a blocked tab names the button that failed', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    const { pay } = await start();
    await click(within(pay).getByRole('button', { name: 'Share on WhatsApp' }));
    expect(await within(pay).findByText("Share on WhatsApp didn't work: Your browser blocked the new tab.")).toBeTruthy();
  });
});

/*
 * One-shot C4 (T20): each share the owner made is recorded on the invoice (venture.invoice.shared) and shows on its
 * timeline. Only "Mark as sent" makes it sent: until then the invoice reads "Issued, not sent".
 */
describe('C4: shares recorded on the invoice, and Mark as sent', () => {
  it('after WhatsApp opens, the share is recorded and the timeline says so; nothing says it was sent', async () => {
    const shareInvoice = shared({ how: 'whatsapp', opened: 'app', file: 'INV-0039.pdf', note: null });
    const { calls, panel, pay } = await start({ shareInvoice });
    expect(panel.textContent).toContain('not sent');
    await click(within(pay).getByRole('button', { name: 'Share on WhatsApp' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.shared', { invoiceId: 'inv-0039', how: 'whatsapp' }]));
    const timeline = await within(panel).findByRole('region', { name: 'Timeline' });
    await waitFor(() => expect(timeline.textContent).toContain('Opened in WhatsApp to share'));
    expect(within(pay).getByRole('status').textContent).not.toMatch(/\bsent\b/i);
    expect(panel.textContent).toContain('not sent');
  });

  it('Save file records the saved PDF on the timeline', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const { calls, panel, pay } = await start();
    await click(within(pay).getByRole('button', { name: 'Save file' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.shared', { invoiceId: 'inv-0039', how: 'file' }]));
    const timeline = await within(panel).findByRole('region', { name: 'Timeline' });
    await waitFor(() => expect(timeline.textContent).toContain('Saved the PDF'));
  });

  it('Mark as sent records the mark, and the invoice then reads Sent', async () => {
    const { calls, panel, pay } = await start();
    await click(within(pay).getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.invoice.shared', { invoiceId: 'inv-0039', how: 'marked' }]));
    const timeline = await within(panel).findByRole('region', { name: 'Timeline' });
    await waitFor(() => expect(timeline.textContent).toContain('You marked it sent'));
    await waitFor(() => expect(panel.textContent).toContain('marked sent'));
    expect(within(pay).queryByRole('button', { name: 'Mark as sent' })).toBeNull();
    const row = document.querySelector('[data-row-id="inv-0039"]') as HTMLElement;
    await waitFor(() => expect(within(row).getByText('Sent')).toBeTruthy());
  });
});
