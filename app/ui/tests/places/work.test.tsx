import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type MethodName } from '../../src/engine/types';

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en' | 'hi'; folder?: string; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> }

async function start(hash = '#/work', options: StartOptions = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine();
  if (options.folder) await engine.request('workspace.open', { folder: options.folder });
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { engine, client, calls, ...view };
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const rowOf = async (text: string, scope: HTMLElement = document.body) => (await within(scope).findByText(text)).closest('li')!;
const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('Work: runs', () => {
  it('puts work in progress on top: per-stage progress, indeterminate in words, waiting in amber', async () => {
    await start();
    expect(screen.getByRole('heading', { level: 1, name: 'Work' })).toBeTruthy();
    const working = await screen.findByRole('region', { name: 'Working now' });
    expect((await rowOf('Cutting shorts from episode 13', working)).textContent).toContain('3 of 5');
    expect((await rowOf('Checking titles against the last 30 videos', working)).textContent).toContain('indeterminate');
    const waiting = await rowOf('Pricing the sponsor slot', working);
    expect(within(waiting).getByText('Waiting on you').className).toMatch(/wait/);
    expect(waiting.textContent).toContain('paused');
    const orders = await screen.findByRole('region', { name: 'Orders' });
    const previous = await screen.findByRole('region', { name: 'Previous' });
    expect(follows(working, orders)).toBe(true);
    expect(follows(orders, previous)).toBe(true);
  });

  it('folds previous runs to one line: worked for, result, receipt; a model number is labelled and has no receipt', async () => {
    await start();
    const previous = await screen.findByRole('region', { name: 'Previous' });
    const books = await rowOf('Matched September bank lines to invoices', previous);
    expect(books.textContent).toContain('Worked for 4m · Matched 212 of 214 lines. 2 need your data. · R-0412');
    expect(within(books).getByRole('button', { name: 'Receipt R-0412' })).toBeTruthy();
    const reach = await rowOf('Estimated reach for episode 14', previous);
    expect(reach.textContent).toContain('Worked for 2m · About 18,000 views in 30 days model estimate');
    expect(within(reach).queryByRole('button', { name: /Receipt/ })).toBeNull();
  });

  it('shows a failed run with its real error, and runs it again through the engine', async () => {
    const { calls } = await start();
    const previous = await screen.findByRole('region', { name: 'Previous' });
    const failed = await rowOf('Rendering the thumbnail set', previous);
    await waitFor(() => expect(failed.textContent).toContain('The renderer stopped: ffmpeg was not found on this computer. Install ffmpeg, or turn off the finishing check, then run again.'));
    const again = await within(failed).findByRole('button', { name: 'Run again' });
    await act(async () => { fireEvent.click(again); });
    expect(calls.find((c) => c.method === 'venture.queue.decide')?.params).toMatchObject({ id: 'q-run-again-thumbs', action: 'run-again' });
    const working = screen.getByRole('region', { name: 'Working now' });
    await waitFor(() => expect(within(working).getByText('Rendering the thumbnail set')).toBeTruthy());
  });

  it('says so when a failed run has no way to run again, instead of offering a button', async () => {
    await start('#/work', { intercept: { 'venture.queue.list': () => ({ rows: [], summary: 'Nothing needs you.', needsYou: 0, businesses: 0 }) } });
    const failed = await rowOf('Rendering the thumbnail set');
    await waitFor(() => expect(failed.textContent).toContain("This one can't be run again from here."));
    expect(within(failed).queryByRole('button', { name: 'Run again' })).toBeNull();
  });

  it('opens every run in the shell run sheet', async () => {
    await start();
    const opener = await screen.findByRole('button', { name: 'Rendering the thumbnail set' });
    await act(async () => { fireEvent.click(opener); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(window.location.hash).toBe('#/work?sheet=run%3A28');
    expect(await screen.findByRole('complementary', { name: 'Rendering the thumbnail set' })).toBeTruthy();
    const active = await screen.findByRole('button', { name: 'Cutting shorts from episode 13' });
    await act(async () => { fireEvent.click(active); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByRole('complementary', { name: 'Cutting shorts from episode 13' })).toBeTruthy();
  });

  it('refreshes on run events without being asked', async () => {
    const { engine } = await start();
    const working = await screen.findByRole('region', { name: 'Working now' });
    await rowOf('Cutting shorts from episode 13', working);
    await act(async () => { await engine.request('venture.delivery.run', { orderId: 'o-boat-14' }); });
    await waitFor(() => expect(within(working).getByText('Draft a reply for Boat Audio')).toBeTruthy());
    const order = await rowOf('Two mentions in episode 14');
    await waitFor(() => expect(order.textContent).toContain('Working on it.'));
  });
});

describe('Work: filter in the address', () => {
  it('shows one state at a time, with counts, and the link for each', async () => {
    await start('#/work?state=failed');
    const nav = screen.getByRole('navigation', { name: 'Show' });
    const failedLink = await within(nav).findByRole('link', { name: 'Failed 1' });
    expect(failedLink.getAttribute('aria-current')).toBe('true');
    expect(within(nav).getByRole('link', { name: 'All' }).getAttribute('href')).toBe('#/work');
    expect(within(nav).getByRole('link', { name: /^Done/ }).getAttribute('href')).toBe('#/work?state=done');
    await waitFor(() => expect(within(nav).getByRole('link', { name: 'Working 3' })).toBeTruthy());
    expect(await screen.findByText('Rendering the thumbnail set')).toBeTruthy();
    expect(screen.queryByText('Matched September bank lines to invoices')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Working now' })).toBeNull();
    expect(screen.queryByText('Two mentions in episode 14')).toBeNull();

    await go('#/work?state=done');
    expect(await screen.findByText('Matched September bank lines to invoices')).toBeTruthy();
    expect(screen.queryByText('Rendering the thumbnail set')).toBeNull();

    await go('#/work?state=orders');
    expect(await screen.findByText('Two mentions in episode 14')).toBeTruthy();
    expect(screen.queryByText('Matched September bank lines to invoices')).toBeNull();

    await go('#/work?state=active');
    expect(await screen.findByRole('region', { name: 'Working now' })).toBeTruthy();
    expect(screen.queryByText('Two mentions in episode 14')).toBeNull();

    await go('#/work?state=nonsense');
    expect(await screen.findByText('Two mentions in episode 14')).toBeTruthy();
    expect(within(nav).getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBe('true');
  });

  it('says plainly when a filter has nothing, and when there is no work at all', async () => {
    await start('#/work?state=failed', { intercept: { 'venture.runs.list': () => ({ runs: [] }), 'venture.order.list': () => [] } });
    expect(await screen.findByText('Nothing has failed.')).toBeTruthy();
    await go('#/work');
    expect(await screen.findByText('No work yet.')).toBeTruthy();
    expect(screen.queryByText('Nothing is running.')).toBeNull();
  });
});

describe('Work: orders', () => {
  it('gives each order one plain sentence', async () => {
    await start();
    const orders = await screen.findByRole('region', { name: 'Orders' });
    const ep14 = await rowOf('Two mentions in episode 14', orders);
    await waitFor(() => expect(ep14.textContent).toContain('Draft ready. Read it before it goes to the client.'));
    expect(ep14.textContent).toContain('Boat Audio');
    const ep12 = await rowOf('Two mentions in episode 12', orders);
    await waitFor(() => expect(ep12.textContent).toContain('Invoiced as INV-0039. Waiting for payment.'));
  });

  it('marks an order delivered only after a second ask, and never from the keyboard', async () => {
    const { calls } = await start();
    const ep12 = await rowOf('Two mentions in episode 12');
    const mark = await within(ep12).findByRole('button', { name: 'Mark delivered' });
    ep12.focus();
    fireEvent.keyDown(ep12, { key: 'a' });
    fireEvent.click(mark);
    expect(within(ep12).getByText("This can't be undone. Mark delivered?")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(ep12).getByRole('button', { name: 'Not now' })));
    fireEvent.keyDown(document.activeElement!, { key: 'a' });
    expect(calls.some((c) => c.method === 'venture.order.deliver')).toBe(false);
    await act(async () => { fireEvent.click(within(ep12).getByRole('button', { name: 'Mark delivered' })); });
    const call = calls.find((c) => c.method === 'venture.order.deliver');
    expect(call?.params).toMatchObject({ orderId: 'o-boat-12' });
    expect((call!.params as { deliveredOn: string }).deliveredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await waitFor(() => expect(within(ep12).queryByRole('button', { name: 'Mark delivered' })).toBeNull());
    expect(ep12.textContent).toContain('Invoiced as INV-0039. Waiting for payment.');
  });

  it('starts a received order through the engine; it then shows as working and opens its run', async () => {
    const { calls } = await start('#/work', { folder: 'ledgerline' });
    const iyer = await rowOf('Monthly books from October');
    expect(iyer.textContent).toContain('Iyer & Co');
    expect(iyer.textContent).toContain('Received. Not started yet.');
    await act(async () => { fireEvent.click(within(iyer).getByRole('button', { name: 'Start' })); });
    expect(calls.find((c) => c.method === 'venture.delivery.run')?.params).toEqual({ orderId: 'o-iyer-oct' });
    await waitFor(() => expect(iyer.textContent).toContain('Working on it.'));
    expect(within(iyer).queryByRole('button', { name: 'Start' })).toBeNull();
    const opener = await within(iyer).findByRole('button', { name: 'Monthly books from October' });
    await act(async () => { fireEvent.click(opener); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByRole('complementary', { name: 'Draft a reply for Iyer & Co' })).toBeTruthy();
  });

  it('shows an engine refusal in the row, in its own words', async () => {
    await start('#/work', { folder: 'ledgerline', intercept: { 'venture.delivery.run': () => { throw new EngineError('NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.'); } } });
    const iyer = await rowOf('Monthly books from October');
    await act(async () => { fireEvent.click(within(iyer).getByRole('button', { name: 'Start' })); });
    await waitFor(() => expect(iyer.textContent).toContain("Couldn't start: Connect an AI first, or use built-in templates."));
  });
});

describe('Work: one order from the address', () => {
  it('shows the order with its state, price receipt and runs, and the filters still lead away', async () => {
    await start('#/work?order=o-boat-14');
    const order = await screen.findByRole('region', { name: 'Order' });
    const row = await rowOf('Two mentions in episode 14', order);
    await waitFor(() => expect(row.textContent).toContain('Draft ready. Read it before it goes to the client.'));
    expect(row.textContent).toContain('Boat Audio');
    expect(within(order).getByRole('button', { name: 'Receipt R-0415' })).toBeTruthy();
    const runs = screen.getByRole('region', { name: 'Runs' });
    expect((await rowOf('Sponsor script for episode 14', runs)).textContent).toContain('Draft ready.');
    expect((await rowOf('Practice sponsor script', runs)).textContent).toContain('Practice draft only.');
    expect(screen.queryByText('Two mentions in episode 12')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Working now' })).toBeNull();
    expect(screen.getByRole('link', { name: 'All orders' }).getAttribute('href')).toBe('#/work?state=orders');
    const nav = screen.getByRole('navigation', { name: 'Show' });
    expect(within(nav).getByRole('link', { name: /^Done/ }).getAttribute('href')).toBe('#/work?state=done');
    expect(within(nav).getByRole('link', { name: 'All' }).getAttribute('aria-current')).toBeNull();
    await go('#/work?state=done');
    expect(await screen.findByText('Matched September bank lines to invoices')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Runs' })).toBeNull();
  });

  it('lists the runs the engine knows for the order, and says when there are none or no such order', async () => {
    const { engine } = await start('#/work?order=o-iyer-oct', { folder: 'ledgerline' });
    expect(await screen.findByText('No runs yet.')).toBeTruthy();
    await act(async () => { await engine.request('venture.delivery.run', { orderId: 'o-iyer-oct' }); });
    const runs = screen.getByRole('region', { name: 'Runs' });
    const run = await rowOf('Draft a reply for Iyer & Co', runs);
    expect(run.textContent).toContain('Started 0s ago');
    await go('#/work?order=nope');
    expect(await screen.findByText("This order isn't in this business.")).toBeTruthy();
  });
});

describe('Work: preview links for the client', () => {
  it('offers sharing on each real draft, never a practice one; with no public address it says the engine reason', async () => {
    const { calls } = await start('#/work?order=o-boat-14');
    const share = await screen.findByRole('region', { name: 'Preview for the client' });
    const line = await rowOf('Sponsor script for episode 14', share);
    expect(within(share).queryByText('Practice sponsor script')).toBeNull();
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Share with client' })); });
    expect(calls.find((c) => c.method === 'venture.share.create')?.params).toEqual({ deliveryId: 'd-ep14-script' });
    await waitFor(() => expect(within(line).getByRole('status').textContent).toBe('This computer has no public address, so a client cannot open a link from it. Send them the file instead.'));
    expect(within(line).queryByRole('list')).toBeNull();
    expect(line.textContent).not.toMatch(/https?:/);
  });

  it('on hosted, shows the link as text with when it stops working, copies it, and revokes it', async () => {
    window.location.hash = '#/work?order=o-boat-14';
    const engine = new FakeEngine({ hosted: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App client={createFakeClient(engine)} language="en" />);
    const share = await screen.findByRole('region', { name: 'Preview for the client' });
    const line = await rowOf('Sponsor script for episode 14', share);
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Share with client' })); });
    const links = await within(line).findByRole('list', { name: 'Links for Sponsor script for episode 14' });
    const link = within(links).getByRole('listitem');
    expect(link.textContent).toContain('https://share.chausar.test/s/');
    expect(link.textContent).toMatch(/Works until \d{1,2} \w+/);
    await act(async () => { fireEvent.click(within(link).getByRole('button', { name: 'Copy' })); });
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/share\.chausar\.test\/s\//));
    await waitFor(() => expect(within(link).getByRole('button', { name: 'Copied' })).toBeTruthy());
    await act(async () => { fireEvent.click(within(link).getByRole('button', { name: 'Revoke' })); });
    await waitFor(() => expect(within(line).queryByRole('list')).toBeNull());
    expect((await engine.request('venture.share.list', { deliveryId: 'd-ep14-script' }) as { shares: unknown[] }).shares).toEqual([]);
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('a refusal to share is said in plain words', async () => {
    await start('#/work?order=o-boat-14', { intercept: { 'venture.share.create': () => { throw new EngineError('OFFLINE', 'The engine is not answering.'); } } });
    const line = await rowOf('Sponsor script for episode 14', await screen.findByRole('region', { name: 'Preview for the client' }));
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Share with client' })); });
    await waitFor(() => expect(within(line).getByRole('alert').textContent).toBe("Couldn't share this: The engine is not answering."));
  });
});

describe('Work: new order', () => {
  async function openForm(options: StartOptions = {}) {
    const started = await start('#/work', options);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'New order' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const sheet = await screen.findByRole('complementary', { name: 'New order' });
    const clientField = await within(sheet).findByLabelText('Client');
    await within(clientField).findByRole('option', { name: 'Boat Audio' });
    const service = within(sheet).getByLabelText('Service');
    await within(service).findByRole('option', { name: 'Sponsor slot' });
    return { ...started, sheet, clientField, service };
  }

  it('adds an order for a client with their files; it lands as received', async () => {
    const { calls, sheet, clientField, service } = await openForm();
    expect(within(service).getByRole('option', { name: 'Shorts from your long video, no price yet' }).hasAttribute('disabled')).toBe(true);
    expect((service as HTMLSelectElement).value).toBe('offer_sponsor');
    fireEvent.change(clientField, { target: { value: 'c-boat' } });
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    fireEvent.change(within(sheet).getByLabelText('What they asked for'), { target: { value: 'One mention in episode 16' } });
    const file = new File(['date,amount\n2026-10-01,100\n'], 'sales.csv', { type: 'text/csv' });
    fireEvent.change(within(sheet).getByLabelText('Files from the client'), { target: { files: [file] } });
    expect(within(sheet).getByText('sales.csv')).toBeTruthy();
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Add order' })); });
    const created = calls.find((c) => c.method === 'venture.order.create');
    expect(created?.params).toEqual({ clientId: 'c-boat', offerId: 'offer_sponsor', request: 'One mention in episode 16' });
    const added = calls.find((c) => c.method === 'venture.files.add')?.params as { orderId: string; name: string; contentBase64: string };
    expect(added.name).toBe('sales.csv');
    expect(atob(added.contentBase64)).toBe('date,amount\n2026-10-01,100\n');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'New order' })).toBeNull());
    const row = await rowOf('One mention in episode 16');
    expect(row.textContent).toContain('Received. Not started yet.');
    expect(added.orderId).toBe(row.getAttribute('data-row-id')!.replace(/^order-/, ''));
  });

  it('adds a new client from the same form', async () => {
    const { calls, sheet, clientField, service } = await openForm();
    fireEvent.change(clientField, { target: { value: '+new' } });
    fireEvent.change(within(sheet).getByLabelText("Client's name"), { target: { value: 'Kavya Rao' } });
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    fireEvent.change(within(sheet).getByLabelText('What they asked for'), { target: { value: 'One mention in her podcast' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Add order' })); });
    expect(calls.find((c) => c.method === 'venture.client.add')?.params).toEqual({ name: 'Kavya Rao' });
    const created = calls.find((c) => c.method === 'venture.order.create')?.params as { clientId: string };
    expect(created.clientId).not.toBe('+new');
    const row = await rowOf('One mention in her podcast');
    await waitFor(() => expect(row.textContent).toContain('Kavya Rao'));
  });

  it('refuses a file the engine would refuse before sending anything', async () => {
    const { calls, sheet, clientField, service } = await openForm();
    fireEvent.change(clientField, { target: { value: 'c-boat' } });
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    fireEvent.change(within(sheet).getByLabelText('What they asked for'), { target: { value: 'One mention' } });
    fireEvent.change(within(sheet).getByLabelText('Files from the client'), { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } });
    expect(within(sheet).getByText("notes.txt isn't a CSV, Excel or PDF file.")).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Add order' }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.some((c) => c.method === 'venture.order.create')).toBe(false);
  });

  it('shows the engine refusal and keeps what was typed', async () => {
    const { sheet, clientField, service } = await openForm({ intercept: { 'venture.order.create': () => { throw new EngineError('PRICE_NOT_SET', 'Set a price for this service first.'); } } });
    fireEvent.change(clientField, { target: { value: 'c-boat' } });
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    fireEvent.change(within(sheet).getByLabelText('What they asked for'), { target: { value: 'One mention' } });
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Add order' })); });
    expect(await within(sheet).findByText("Couldn't add the order: Set a price for this service first.")).toBeTruthy();
    expect((within(sheet).getByLabelText('What they asked for') as HTMLTextAreaElement).value).toBe('One mention');
  });
});

describe('Work: Hindi', () => {
  it('speaks Hindi', async () => {
    await start('#/work', { language: 'hi' });
    expect(await screen.findByRole('heading', { level: 1, name: 'काम' })).toBeTruthy();
    const ep12 = await rowOf('Two mentions in episode 12');
    await waitFor(() => expect(ep12.textContent).toContain('INV-0039'));
    expect(ep12.textContent).not.toContain('Waiting for payment');
  });
});
