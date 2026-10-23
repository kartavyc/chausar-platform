import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, queueOrder } from '../../src/engine/fake';
import { QUEUE, SETUP_ROWS } from '../../src/engine/fixtures';
import { EngineError, type EngineClient, type QueueDecision, type QueueKind, type QueueRow } from '../../src/engine/types';

type Seed = Omit<QueueRow, 'digest'>;

function start({ engine = new FakeEngine(), client, hash = '#/today', language = 'en' }: { engine?: FakeEngine; client?: EngineClient; hash?: string; language?: 'en' | 'hi' } = {}) {
  window.location.hash = hash;
  const used = client ?? createFakeClient(engine);
  const view = render(<App client={used} language={language} />);
  return { engine, client: used, ...view };
}

/** The same client with its event feed cut, so nothing refreshes on its own. */
function quiet(engine: FakeEngine): EngineClient {
  return { ...createFakeClient(engine), subscribe: () => () => {} };
}

/** jsdom fires hashchange late; the shell tests dispatch it at once, inside act. */
const settleHash = async () => { await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const needsYou = () => screen.getByRole('region', { name: 'Needs you' });
const rowOf = async (title: string) => (await within(needsYou()).findByText(title)).closest('li')!;
const rowIds = () => [...needsYou().querySelectorAll('[data-row]')].map((li) => li.getAttribute('data-row-id'));
const press = (key: string, target: Element = document.activeElement ?? document.body) => fireEvent.keyDown(target, { key });
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); }); };
/** A sign-off row's Send to CA unlocks once its papers were read (the engine's requiresView). */
async function readFirst(row: HTMLElement) {
  await click(within(row).getByRole('button', { name: 'Read' }));
  await settleHash();
  await screen.findByRole('complementary', { name: 'GST working for September' });
  await waitFor(() => expect((within(row).getByRole('button', { name: 'Send to CA' }) as HTMLButtonElement).disabled).toBe(false));
}

const lockedLedgerline: Seed = {
  id: 'q-locked-ledgerline', businessId: 'ledgerline', businessName: 'Ledgerline', kind: 'locked', createdAt: '2026-10-21T10:11:00.000Z',
  title: 'Ledgerline is locked.', line: 'Open it to see what needs you.', actions: [{ id: 'open', label: 'Open', primary: true }],
};
const missingDraft: Seed = {
  id: 'q-draft-missing', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
  title: 'Episode 12 recut', line: 'Watch it before approving.', viewRef: { kind: 'draft', id: 'draft-gone' },
  actions: [{ id: 'watch', label: 'Watch', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
};

describe('Today: the header and the list', () => {
  it('says Today and the engine summary line', async () => {
    start();
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeTruthy();
    expect(await screen.findByText('12 need you, across 3 businesses')).toBeTruthy();
  });

  it('lists every row in the engine order, across businesses, each tagged with its business and agent', async () => {
    start();
    await rowOf('Connect your AI');
    expect(rowIds()).toEqual([...QUEUE].map((r) => ({ ...r, digest: '' })).sort(queueOrder).map((r) => r.id));
    expect((await rowOf('Episode 14 is cut')).textContent).toContain('Lumen Studio · Editor');
    expect((await rowOf('GST working for September')).textContent).toContain('Ledgerline · Bookkeeper');
    expect((await rowOf('Your plan is ready. Read it.')).textContent).toContain('Ledgerline');
  });

  it('keeps the engine order: a plan row listed first stays first even when it is newer than the setup rows', async () => {
    const setup: Seed = { id: 'q-setup-ai', businessId: 'lumen', businessName: 'Lumen Studio', kind: 'setup', createdAt: '2026-10-21T09:00:00.000Z',
      title: 'Connect your AI', line: 'Templates work without one.', actions: [{ id: 'connect', label: 'Connect', primary: true }] };
    const plan: Seed = { id: 'q-plan-new', businessId: 'lumen', businessName: 'Lumen Studio', kind: 'plan', createdAt: '2026-10-21T09:05:00.000Z',
      title: 'Your plan is ready. Read it.', viewRef: { kind: 'plan', id: 'plan-lumen' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, requiresView: true }] };
    start({ engine: new FakeEngine({ queue: [plan, setup] }) });
    await rowOf('Connect your AI');
    expect(rowIds()).toEqual(['q-plan-new', 'q-setup-ai']);
  });

  it('shows a row for every kind, setup rows included, each with its primary last and never two filled', async () => {
    start({ engine: new FakeEngine({ queue: [...QUEUE, ...SETUP_ROWS] }) });
    await rowOf('Connect your AI');
    expect(await rowOf('Set your prices')).toBeTruthy();
    expect(await rowOf('Keep this business')).toBeTruthy();
    const kinds = new Set<QueueKind>([...QUEUE, ...SETUP_ROWS].map((r) => r.kind));
    expect(kinds.size).toBe(10);
    for (const li of needsYou().querySelectorAll<HTMLElement>('[data-row]')) {
      const buttons = [...li.querySelectorAll<HTMLButtonElement>('[data-key]')];
      expect(buttons.length === 1 || buttons.length === 2, li.dataset.rowId).toBe(true);
      expect(buttons.at(-1)!.dataset.key, li.dataset.rowId).toBe('primary');
      const filled = buttons.filter((b) => b.dataset.variant === 'primary');
      expect(filled.length, li.dataset.rowId).toBe(buttons.at(-1)!.disabled ? 0 : 1);
    }
  });

  it('a change shows the old value struck through, the new one, and its receipt; a model number says so', async () => {
    start();
    const price = await rowOf('Sponsor slot price');
    expect(price.querySelector('del')?.textContent).toBe('₹25,000');
    expect(within(price).getByRole('button', { name: 'Receipt R-0415' })).toBeTruthy();
    const question = await rowOf('Which title for episode 15?');
    expect(question.textContent).toContain('model estimate');
    expect(question.querySelector('[data-receipt]')).toBeNull();
  });
});

describe('Today: deciding', () => {
  it('a licensed sign-off is read first, then goes to the CA and shrinks to one line', async () => {
    start();
    const row = await rowOf('GST working for September');
    expect((within(row).getByRole('button', { name: 'Send to CA' }) as HTMLButtonElement).disabled).toBe(true);
    await readFirst(row);
    await click(within(row).getByRole('button', { name: 'Send to CA' }));
    await waitFor(() => expect((needsYou().querySelector('[data-row-id="q-signoff-gst"]') as HTMLElement).textContent).toBe('GST working for September · Sent to your CA'));
    expect(screen.getByText('11 need you, across 3 businesses')).toBeTruthy();
  });

  it('a second ask confirms inside the row; the decided line carries the receipt', async () => {
    const { client } = start();
    const spy = vi.spyOn(client, 'request');
    const row = await rowOf('Sponsor slot price');
    await click(within(row).getByRole('button', { name: 'Approve' }));
    expect(spy.mock.calls.some(([m]) => m === 'venture.queue.decide')).toBe(false);
    expect(row.textContent).toContain("This can't be undone. Approve?");
    await click(within(row).getByRole('button', { name: 'Approve' }));
    const line = await waitFor(() => {
      const li = needsYou().querySelector<HTMLElement>('[data-row-id="q-price-sponsor"][data-decided]');
      expect(li).toBeTruthy();
      return li!;
    });
    expect(line.textContent).toBe('Sponsor slot price · Approved · R-0421');
    fireEvent.click(within(line).getByRole('button', { name: 'Receipt R-0421' }));
    expect(window.location.hash).toContain('sheet=receipt%3AR-0421');
  });

  it('a question is answered inside the row, then decided with the answer', async () => {
    const { client } = start();
    const spy = vi.spyOn(client, 'request');
    const row = await rowOf('Which title for episode 15?');
    fireEvent.click(within(row).getByRole('button', { name: 'Answer' }));
    fireEvent.change(within(row).getByLabelText('Your answer'), { target: { value: 'Option B' } });
    await click(within(row).getByRole('button', { name: 'Send answer' }));
    const decide = spy.mock.calls.find(([m]) => m === 'venture.queue.decide')!;
    expect(decide[1]).toMatchObject({ id: 'q-question-title', action: 'answer', answer: 'Option B' });
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-question-title"]')!.textContent).toBe('Which title for episode 15? · Answered'));
  });

  it('a draft opens in a sheet first; Approve unlocks only once it was shown, and says it was viewed', async () => {
    const { client } = start();
    const spy = vi.spyOn(client, 'request');
    const row = await rowOf('Episode 14 is cut');
    const approve = within(row).getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(within(row).getByRole('button', { name: 'Watch' }));
    await settleHash();
    expect(window.location.hash).toBe('#/today?sheet=view%3Adraft%3Adraft-ep14');
    const sheet = await screen.findByRole('complementary', { name: 'Episode 14' });
    expect(sheet.textContent).toContain('Cold open');
    await waitFor(() => expect(approve.disabled).toBe(false));
    await click(approve);
    expect(spy.mock.calls.find(([m]) => m === 'venture.queue.decide')![1]).toMatchObject({ id: 'q-draft-ep14', action: 'approve', viewed: true });
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-draft-ep14"]')!.textContent).toBe('Episode 14 is cut · Approved'));
  });

  it('a plan is read the same way before Accept unlocks', async () => {
    start();
    const row = await rowOf('Your plan is ready. Read it.');
    const accept = within(row).getByRole('button', { name: 'Accept' }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(within(row).getByRole('button', { name: 'Read' }));
    await settleHash();
    expect((await screen.findByRole('complementary', { name: 'Ledgerline plan' })).textContent).toContain('GST working');
    await waitFor(() => expect(accept.disabled).toBe(false));
  });

  it('every draft, file and plan a sample row points at can be opened', async () => {
    const engine = new FakeEngine();
    for (const row of QUEUE) {
      if (!row.viewRef || row.viewRef.kind === 'run') continue;
      const view = await engine.request('venture.queue.view', { kind: row.viewRef.kind, id: row.viewRef.id });
      expect(view, row.id).toMatchObject({ kind: row.viewRef.kind, id: row.viewRef.id });
    }
  });

  it('a draft that does not load stays locked', async () => {
    start({ engine: new FakeEngine({ queue: [missingDraft] }) });
    const row = await rowOf('Episode 12 recut');
    fireEvent.click(within(row).getByRole('button', { name: 'Watch' }));
    await settleHash();
    const sheet = await screen.findByRole('complementary');
    await waitFor(() => expect(sheet.textContent).toContain("Couldn't load this"));
    expect((within(row).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a stale row says it changed, shows the new version, and decides again with the new digest', async () => {
    const engine = new FakeEngine();
    const { client } = start({ engine, client: quiet(engine) });
    const spy = vi.spyOn(client, 'request');
    const row = await rowOf('Quote for Iyer & Co, monthly books');
    const changed = engine.touch('q-quote-iyer');
    await click(within(row).getByRole('button', { name: 'Approve' }));
    await click(within(row).getByRole('button', { name: 'Approve' }));
    expect(row.textContent).toContain('This changed since you opened it.');
    expect(row.textContent).toContain('Updated after the client replied.');
    expect(row.textContent).toContain('₹12,000 (revised)');
    await click(within(row).getByRole('button', { name: 'Approve' }));
    await click(within(row).getByRole('button', { name: 'Approve' }));
    expect(spy.mock.calls.filter(([m]) => m === 'venture.queue.decide').at(-1)![1]).toMatchObject({ digest: changed.digest });
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-quote-iyer"]')!.textContent).toMatch(/· Approved · R-\d{4}$/));
  });

  it('a stale draft has to be opened again before Approve unlocks', async () => {
    const engine = new FakeEngine();
    start({ engine, client: quiet(engine) });
    const row = await rowOf('Episode 14 is cut');
    fireEvent.click(within(row).getByRole('button', { name: 'Watch' }));
    await settleHash();
    await screen.findByRole('complementary', { name: 'Episode 14' });
    const approve = () => within(row).getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    await waitFor(() => expect(approve().disabled).toBe(false));
    engine.touch('q-draft-ep14');
    await click(approve());
    expect(row.textContent).toContain('This changed since you opened it.');
    expect(approve().disabled).toBe(true);
    fireEvent.click(within(row).getByRole('button', { name: 'Watch' }));
    await waitFor(() => expect(approve().disabled).toBe(false));
  });

  it('a refusal shows the reason in plain words and keeps the row', async () => {
    const engine = new FakeEngine();
    const fake = createFakeClient(engine);
    const client: EngineClient = {
      ...fake,
      request: ((method: string, params?: unknown) => (method === 'venture.queue.decide'
        ? Promise.resolve<QueueDecision>({ outcome: 'refused', line: 'Mehta Traders has no GSTIN yet. Add it under Clients, then send it.', reason: 'GSTIN_MISSING' })
        : fake.request(method as never, params as never))) as EngineClient['request'],
    };
    start({ engine, client });
    const row = await rowOf('GST working for September');
    await readFirst(row);
    await click(within(row).getByRole('button', { name: 'Send to CA' }));
    expect(row.textContent).toContain('Mehta Traders has no GSTIN yet. Add it under Clients, then send it.');
    expect(within(row).getByRole('button', { name: 'Send to CA' })).toBeTruthy();
  });

  it('a decision that times out after the engine took it reads the list back and shows that, not "Couldn\'t send"', async () => {
    const engine = new FakeEngine();
    const fake = quiet(engine);
    const timedOut = { left: 1 };
    const methods: string[] = [];
    const client: EngineClient = {
      ...fake,
      request: (async (method: string, params?: unknown) => {
        methods.push(method);
        const answer = await fake.request(method as never, params as never);
        if (method === 'venture.queue.decide' && timedOut.left-- > 0) throw new EngineError('REQUEST_TIMEOUT', 'The engine did not answer in time.');
        return answer;
      }) as EngineClient['request'],
    };
    start({ engine, client });
    const row = await rowOf('GST working for September');
    await readFirst(row);
    await click(within(row).getByRole('button', { name: 'Send to CA' }));
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-signoff-gst"][data-decided]')?.textContent)
      .toBe('GST working for September · Went through after a delay, or was settled elsewhere'));
    expect(needsYou().textContent).not.toContain("Couldn't send");
    expect(methods.filter((method) => method === 'venture.queue.decide')).toHaveLength(1);
  });

  it('a decided line stays for the rest of the session, after leaving Today and coming back', async () => {
    start();
    const row = await rowOf('GST working for September');
    await readFirst(row);
    await click(within(row).getByRole('button', { name: 'Send to CA' }));
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-signoff-gst"][data-decided]')).toBeTruthy());
    await go('#/team');
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull();
    await go('#/today');
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-signoff-gst"]')?.textContent).toBe('GST working for September · Sent to your CA'));
    expect(rowIds().indexOf('q-signoff-gst')).toBe(QUEUE.findIndex((r) => r.id === 'q-signoff-gst'));
  });

  it('a row decided somewhere else shrinks to "Resolved elsewhere"', async () => {
    const { client } = start();
    await rowOf('GST working for September');
    const target = (await client.request('venture.queue.list', { scope: 'all' })).rows.find((r) => r.id === 'q-signoff-gst')!;
    await act(async () => { await client.request('venture.queue.decide', { id: target.id, digest: target.digest, action: 'send-to-ca', viewed: true }); });
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-signoff-gst"]')?.textContent).toBe('GST working for September · Resolved elsewhere'));
  });
});

describe('Today: setup and locked rows', () => {
  it('Connect, Set prices and Keep take you where that is done, without deciding anything', async () => {
    const { client } = start({ engine: new FakeEngine({ queue: [...QUEUE, ...SETUP_ROWS] }) });
    const spy = vi.spyOn(client, 'request');
    fireEvent.click(within(await rowOf('Connect your AI')).getByRole('button', { name: 'Connect' }));
    expect(window.location.hash).toBe('#/connections');
    await go('#/today');
    fireEvent.click(within(await rowOf('Set your prices')).getByRole('button', { name: 'Set prices' }));
    expect(window.location.hash).toBe('#/business/prices');
    await go('#/today');
    fireEvent.click(within(await rowOf('Keep this business')).getByRole('button', { name: 'Keep it' }));
    expect(window.location.hash).toBe('#/business/keep');
    expect(spy.mock.calls.some(([m]) => m === 'venture.queue.decide')).toBe(false);
  });

  it('Later on a setup row is a decision and shrinks it', async () => {
    start();
    const row = await rowOf('Connect your AI');
    await click(within(row).getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-setup-ai"]')!.textContent).toBe('Connect your AI · Moved to later'));
  });

  it('a business that needs its passphrase: Open closes this one and Welcome back asks for it under its own row', async () => {
    start();
    const row = await rowOf('Sitara Events is locked. Open to see what needs you.');
    expect(row.textContent).toContain('Sitara Events');
    await click(within(row).getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Passphrase for Sitara Events'));
  });

  it('a business this computer can open opens from its locked row', async () => {
    const { client } = start({ engine: new FakeEngine({ queue: [...QUEUE.filter((r) => r.kind !== 'locked'), lockedLedgerline] }) });
    const spy = vi.spyOn(client, 'request');
    const row = await rowOf('Ledgerline is locked.');
    await click(within(row).getByRole('button', { name: 'Open' }));
    expect(spy).toHaveBeenCalledWith('workspace.open', { folder: 'ledgerline' });
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-locked-ledgerline"]')).toBeNull());
    await waitFor(() => expect(within(screen.getByRole('navigation')).getByRole('button', { name: /Ledgerline/ })).toBeTruthy());
  });
});

describe('Today: working now', () => {
  const working = () => screen.getByRole('region', { name: 'Working now' });
  const line = (purpose: string) => within(working()).getByRole('button', { name: purpose }).closest('li')!;

  it('one line per active run: agent, purpose and elapsed; a waiting run says so in place of its timer', async () => {
    start();
    await within(await screen.findByRole('region', { name: 'Working now' })).findByRole('button', { name: 'Cutting shorts from episode 13' });
    expect([...working().querySelectorAll('li')].map((li) => li.getAttribute('data-row-id'))).toEqual(['run-31', 'run-30', 'run-29']);
    expect(line('Cutting shorts from episode 13').textContent).toBe('EditorCutting shorts from episode 134m');
    const waiting = line('Pricing the sponsor slot');
    expect(waiting.textContent).toContain('Producer');
    expect(waiting.textContent).toContain('Waiting on you');
    expect(waiting.textContent).not.toContain('6m');
    expect(working().textContent).not.toContain('Rendering the thumbnail set');
  });

  it('a line opens its run sheet', async () => {
    start();
    const opener = await screen.findByRole('button', { name: 'Pricing the sponsor slot' });
    fireEvent.click(opener);
    await settleHash();
    expect(window.location.hash).toBe('#/today?sheet=run%3A29');
    expect(await screen.findByRole('complementary', { name: 'Pricing the sponsor slot' })).toBeTruthy();
  });

  it('"Waiting on you" takes you to the row that answers it', async () => {
    start();
    await rowOf('The sponsor wants to see the video before it goes up');
    fireEvent.click(await screen.findByRole('button', { name: /^Waiting on you/ }));
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('q-question-preview');
  });

  it('stays when nothing needs you', async () => {
    start({ engine: new FakeEngine({ queue: [] }) });
    expect(await screen.findByText('Nothing needs you.')).toBeTruthy();
    expect(screen.getAllByText('Nothing needs you.')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: 'Cutting shorts from episode 13' })).toBeTruthy();
  });

  it('refreshes on run events: a run started again joins the list', async () => {
    start();
    const row = await rowOf('Thumbnail set stopped');
    expect(within(working()).queryByRole('button', { name: 'Rendering the thumbnail set' })).toBeNull();
    await click(within(row).getByRole('button', { name: 'Run again' }));
    expect(await within(working()).findByRole('button', { name: 'Rendering the thumbnail set' })).toBeTruthy();
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-run-again-thumbs"]')!.textContent).toBe('Thumbnail set stopped · Started again'));
  });
});

describe('Today: keys', () => {
  it('J and K move through the rows, Enter opens, A runs the primary, D the secondary', async () => {
    start();
    await rowOf('GST working for September');
    const [first, second] = rowIds();
    press('j', document.body);
    expect(document.activeElement?.getAttribute('data-row-id')).toBe(first);
    press('j');
    expect(document.activeElement?.getAttribute('data-row-id')).toBe(second);
    press('k');
    expect(document.activeElement?.getAttribute('data-row-id')).toBe(first);

    (await rowOf('Episode 14 is cut')).focus();
    press('Enter');
    await settleHash();
    expect(window.location.hash).toBe('#/today?sheet=view%3Adraft%3Adraft-ep14');

    const signoff = await rowOf('GST working for September');
    await readFirst(signoff);
    signoff.focus();
    await act(async () => { press('a'); });
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-signoff-gst"]')!.textContent).toBe('GST working for September · Sent to your CA'));
    expect(document.activeElement?.getAttribute('data-row-id')).toBe('q-signoff-gst');

    (await rowOf('Which title for episode 15?')).focus();
    await act(async () => { press('d'); });
    await waitFor(() => expect(needsYou().querySelector('[data-row-id="q-question-title"]')!.textContent).toBe('Which title for episode 15? · Moved to later'));
  });

  it('A and D never act on a money row', async () => {
    const { client } = start();
    const spy = vi.spyOn(client, 'request');
    const row = await rowOf('Sponsor slot price');
    row.focus();
    await act(async () => { press('a'); press('d'); });
    expect(row.textContent).not.toContain("can't be undone");
    expect(spy.mock.calls.some(([m]) => m === 'venture.queue.decide')).toBe(false);
  });
});

describe('Today in Hindi', () => {
  it('speaks Hindi', async () => {
    start({ language: 'hi' });
    expect(screen.getByRole('heading', { level: 1, name: 'आज' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'अभी चल रहा है' })).toBeTruthy();
  });
});
