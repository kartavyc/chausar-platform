import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import { EngineError, type ChiefThreadView, type EngineClient } from '../../src/engine/types';
import { NARROW } from '../../src/shell/useNarrow';
import { assertFiguresProved, assertInkRules, receiptMark } from '../helpers/ink-rules';

// Chats with Chausar as chief of staff (Ink v2 wave 4, package 4C2; spec 5.4; the direction D board D-Chats): the rail
// item, the Ask box and Ctrl K, the Chats place (the list, the thread, receipted figures, model estimates, the worked
// table, the plan card whose drafted steps become Today cards only when the owner presses Start), the consent before
// the first message, the Chausar story on Today and the fit tile and "Not sure which fits?" on Start. Everything shown
// comes from the fake engine, which answers as the engine's 4C1 does, or from answers written here.

type Fake = ReturnType<typeof createFakeClient>;
type Override = (client: Fake) => void;
const NOW = '2026-10-23T10:00:00.000Z';

async function start(hash = '#/chats', options: { override?: Override; language?: 'en' | 'hi'; fake?: FakeOptions; prepare?: (engine: FakeEngine) => Promise<unknown> } = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine({ now: () => NOW, ...options.fake });
  await options.prepare?.(engine);
  const fake = createFakeClient(engine);
  options.override?.(fake);
  const spy = vi.spyOn(fake, 'request');
  const view = render(<App client={fake} language={options.language ?? 'en'} />);
  return { engine, client: fake, spy, ...view };
}

/** Clicks something that may change the address, then lets the shell see the new hash. */
async function click(element: HTMLElement) {
  await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const hashChanged = () => act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });

/** The engine answers one method with this function instead (it may throw an EngineError). */
function answer(method: string, reply: (params: Record<string, unknown>, base: (m: string, p?: unknown) => Promise<unknown>) => unknown | Promise<unknown>): Override {
  return (client) => {
    const base = client.request.bind(client) as (m: string, p?: unknown) => Promise<unknown>;
    client.request = (async (m: string, params?: unknown) => (m === method ? reply((params ?? {}) as Record<string, unknown>, base) : base(m, params))) as EngineClient['request'];
  };
}
const both = (...overrides: Override[]): Override => (client) => { for (const override of overrides) override(client); };
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method) as [string, Record<string, unknown>][];

const chatList = () => screen.getByRole('navigation', { name: 'Your chats' });
const composer = () => screen.getByRole('textbox', { name: 'Ask Chausar' }) as HTMLTextAreaElement;
const thread = () => screen.getByRole('log');

function stubWidth(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? narrow : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

describe('the rail and the header (spec 4.3: Today, Chats, Team, Work, Clients, Money, Connections)', () => {
  it('Chats is second in the rail, with its icon; "New" shows only while the open business has no chat', async () => {
    stubWidth(false);
    await start('#/team');
    const rail = screen.getByRole('navigation', { name: 'Places' });
    const chats = within(rail).getByRole('link', { name: /^Chats/ });
    expect(chats.getAttribute('href')).toBe('#/chats');
    expect(chats.querySelector('svg')!.classList.contains('lucide-messages-square')).toBe(true);
    await settle();
    // Lumen Studio already has chats: no "New".
    expect(chats.querySelector('[data-new]')).toBeNull();
  });

  it('a business with no chat yet shows "New" beside Chats, said as words too', async () => {
    stubWidth(false);
    await start('#/team', { prepare: (engine) => engine.request('workspace.open', { folder: 'ledgerline' }) });
    const rail = screen.getByRole('navigation', { name: 'Places' });
    await waitFor(() => expect(within(rail).getByRole('link', { name: /^Chats/ }).querySelector('[data-new]')?.textContent).toBe('New'));
    expect(within(rail).getByRole('link', { name: 'Chats, new' })).toBeTruthy();
  });

  it('the header box: typed words and Enter open #/chats with them in the composer, never sent', async () => {
    stubWidth(false);
    const { spy } = await start('#/team');
    const box = await screen.findByRole('textbox', { name: 'Ask Chausar anything' });
    fireEvent.change(box, { target: { value: 'What waits on me this week?' } });
    await act(async () => { fireEvent.submit(box.closest('form')!); });
    await hashChanged();
    await settle();
    expect(window.location.hash).toBe('#/chats');
    await waitFor(() => expect(composer().value).toBe('What waits on me this week?'));
    expect(document.activeElement).toBe(composer());
    expect(calls(spy, 'venture.chief.thread.send')).toHaveLength(0);
    // The header box is empty again.
    expect((screen.getByRole('textbox', { name: 'Ask Chausar anything' }) as HTMLInputElement).value).toBe('');
  });

  it('Ctrl K opens #/chats from anywhere and puts the cursor in the composer; it sends nothing', async () => {
    stubWidth(false);
    const { spy } = await start('#/money');
    await screen.findByRole('textbox', { name: 'Ask Chausar anything' });
    expect(screen.getByRole('textbox', { name: 'Ask Chausar anything' }).getAttribute('aria-keyshortcuts')).toBe('Control+K');
    await act(async () => { fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true }); });
    await hashChanged();
    await settle();
    expect(window.location.hash).toBe('#/chats');
    await waitFor(() => expect(document.activeElement).toBe(composer()));
    expect(calls(spy, 'venture.chief.thread.send')).toHaveLength(0);
  });
});

describe('Ctrl K and the Ask box', () => {
  it('Ctrl K inside another field is left to that field; inside the Ask box it asks', async () => {
    stubWidth(false);
    await start('#/onboarding');
    const box = await screen.findByRole('textbox', { name: /^(What do you want to start\?|Or describe it in one sentence)$/ });
    box.focus();
    await act(async () => { fireEvent.keyDown(box, { key: 'k', ctrlKey: true }); });
    await hashChanged();
    expect(window.location.hash).toBe('#/onboarding');
    const ask = screen.getByRole('textbox', { name: 'Ask Chausar anything' });
    ask.focus();
    fireEvent.change(ask, { target: { value: 'Which way fits me?' } });
    await act(async () => { fireEvent.keyDown(ask, { key: 'k', ctrlKey: true }); });
    await hashChanged();
    await settle();
    expect(window.location.hash).toBe('#/chats');
    await waitFor(() => expect(composer().value).toBe('Which way fits me?'));
  });

  it('the keys show only while the box has focus or the pointer is over it', async () => {
    stubWidth(false);
    await start('#/money');
    const ask = await screen.findByRole('textbox', { name: 'Ask Chausar anything' });
    const form = ask.closest('form')!;
    expect(form.querySelector('kbd')).toBeNull();
    await act(async () => { fireEvent.focus(ask); });
    expect(form.querySelector('kbd')?.textContent).toBe('Ctrl K');
    await act(async () => { fireEvent.blur(ask); });
    expect(form.querySelector('kbd')).toBeNull();
    await act(async () => { fireEvent.mouseEnter(form); });
    expect(form.querySelector('kbd')).not.toBeNull();
  });
});

describe('#/chats: the list', () => {
  it('"Your chats" with New chat and a search box; groups in the engine\'s order, worded here; titles are the owner\'s words', async () => {
    stubWidth(false);
    await start('#/chats');
    const list = await screen.findByRole('navigation', { name: 'Your chats' });
    expect(within(list).getByRole('heading', { level: 2, name: 'Your chats' })).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'New chat' })).toBeTruthy();
    expect(within(list).getByRole('searchbox', { name: 'Search chats' })).toBeTruthy();
    await waitFor(() => expect(within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Today', 'This week', 'Last week']));
    const links = within(list).getAllByRole('link');
    expect(links[0]!.getAttribute('href')).toBe('#/chats?thread=chiefthread-billed');
    expect(links[0]!.querySelector('[data-content]')!.textContent).toBe('How much have we billed this month?');
    // The last line's amounts are Figures with their receipts (ChiefThreadSummary.amounts), outside the link.
    const line = list.querySelector('[data-last-line]')!;
    expect(assertFiguresProved(line).map((n) => n.textContent)).toEqual(['₹1,12,400.00', '₹86,200.00']);
    expect(line.closest('a')).toBeNull();
    expect(list.querySelector('[data-engine-line]')).toBeNull();
    assertInkRules(document.body);
  });

  it('Pinned comes first once a chat is pinned', async () => {
    stubWidth(false);
    await start('#/chats', { prepare: (engine) => engine.request('venture.chief.thread.pin', { threadId: 'chiefthread-trailer', pinned: true }) });
    const list = await screen.findByRole('navigation', { name: 'Your chats' });
    await waitFor(() => expect(within(list).getAllByRole('heading', { level: 3 })[0]!.textContent).toBe('Pinned'));
  });

  it('the search filters the titles shown and asks the engine nothing', async () => {
    stubWidth(false);
    const { spy } = await start('#/chats');
    const list = await screen.findByRole('navigation', { name: 'Your chats' });
    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(3));
    const before = spy.mock.calls.length;
    fireEvent.change(within(list).getByRole('searchbox', { name: 'Search chats' }), { target: { value: 'titles' } });
    expect(within(list).getAllByRole('link').map((a) => a.querySelector('[data-content]')!.textContent)).toEqual(['How are the titles for episode 15 doing?']);
    fireEvent.change(within(list).getByRole('searchbox', { name: 'Search chats' }), { target: { value: 'zzz' } });
    expect(within(list).queryAllByRole('link')).toHaveLength(0);
    expect(within(list).getByText('No chat has those words in its title.')).toBeTruthy();
    expect(spy.mock.calls.length).toBe(before);
  });
});

describe('#/chats: a thread', () => {
  it('the owner\'s words and the chief\'s answer: figures with receipts, the worked table, and the plan card', async () => {
    stubWidth(false);
    await start('#/chats?thread=chiefthread-billed');
    await waitFor(() => expect(within(thread()).getByText('How much have we billed this month?')).toBeTruthy());
    const log = thread();
    // Two figures inline and two in the worked table, every one with its receipt.
    const numbers = assertFiguresProved(log);
    expect(numbers.map((n) => n.textContent)).toEqual(['₹1,12,400.00', '₹86,200.00', '₹1,12,400.00', '₹86,200.00']);
    expect(within(log).getAllByRole('button', { name: receiptMark('R-0401') })).toHaveLength(2);
    const worked = within(log).getByRole('table', { name: 'Worked by the calculator' });
    expect(within(worked).getAllByRole('row').map((row) => row.textContent?.replace(/R-\d+/, '').trim())).toEqual(['Billed in October₹1,12,400.00', 'Received in October₹86,200.00']);
    const plan = within(log).getByRole('region', { name: 'A short plan' });
    expect(within(plan).getByText('2 steps · each one asks you first')).toBeTruthy();
    expect(within(plan).getAllByRole('listitem').map((li) => li.querySelector('[data-step-title]')!.textContent)).toEqual([
      'Draft a payment reminder for invoice INV-0039', "Start work on Boat Audio's order",
    ]);
    expect(within(plan).getByText('This becomes a card on Today for your approval.')).toBeTruthy();
    // Each step says what it does, in the engine's words (ProposalView.what).
    expect(within(plan).getAllByRole('listitem')[0]!.textContent).toContain('Chausar drafts a payment reminder. You send it yourself.');
    expect(within(plan).getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(within(plan).getByRole('button', { name: 'Start' }).getAttribute('data-variant')).toBe('primary');
    expect(screen.getByText('Every figure links to its receipt. Chausar never pays, posts or sends without you.')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('Start raises the step to Today (venture.proposals.raise), then says "On Today" with a link, and Today shows its card', async () => {
    stubWidth(false);
    const { spy, engine } = await start('#/chats?thread=chiefthread-billed');
    const plan = await screen.findByRole('region', { name: 'A short plan' });
    await click(within(plan).getByRole('button', { name: 'Start' }));
    await settle();
    expect(calls(spy, 'venture.proposals.raise').map(([, p]) => p)).toEqual([{ id: 'proposal-reminder-0039' }]);
    const today = (await engine.request('venture.queue.list', { scope: 'current' })) as { rows: { kind: string; title: string }[] };
    expect(today.rows.filter((row) => row.kind === 'proposal').map((row) => row.title)).toEqual(['Draft a payment reminder for invoice INV-0039']);
    const onToday = within(screen.getByRole('region', { name: 'A short plan' })).getByRole('link', { name: 'On Today' });
    // 4Z walk: the link names the card (?row=proposal:<id>, as an agent's chat does), so Today brings it into view even
    // when it would sit folded behind "Show more".
    expect(onToday.getAttribute('href')).toBe(`#/today?row=${encodeURIComponent('proposal:proposal-reminder-0039')}`);
    // The next drafted step is the one to start now.
    const next = screen.getByRole('region', { name: 'A short plan' }).querySelector('[data-next]')!;
    expect(next.textContent).toContain("Start work on Boat Audio's order");
    await click(onToday);
    expect(await screen.findByRole('article', { name: /Draft a payment reminder for invoice INV-0039/ }, { timeout: 5000 })).toBeTruthy();
  }, 15_000);

  it('a raised step is a card on Today: "Nothing changes until you approve", Approve and Not now', async () => {
    stubWidth(false);
    // Only this card on Today, so it is drawn big rather than folded behind "Show more".
    await start('#/today', { fake: { queue: [] }, prepare: (engine) => engine.request('venture.proposals.raise', { id: 'proposal-reminder-0039' }) });
    const card = await screen.findByRole('article', { name: /Draft a payment reminder for invoice INV-0039/ });
    expect(within(card).getByText('Proposal')).toBeTruthy();
    expect(card.textContent).toContain('Nothing changes until you approve.');
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Not now' })).toBeTruthy();
  }, 15_000);

  it('the fake engine as the engine: once the order closes, the card says why it cannot go ahead and offers only Dismiss', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.proposals.raise', { id: 'proposal-run-boat-14' });
    const before = ((await engine.request('venture.queue.list', { scope: 'current' })) as { rows: { id: string; kind: string; line?: string; actions: { id: string; label: string; primary: boolean }[] }[] }).rows.find((row) => row.kind === 'proposal')!;
    expect(before.actions.map((action) => [action.id, action.label, action.primary])).toEqual([['deny', 'Not now', false], ['approve', 'Approve', true]]);
    await engine.request('venture.order.deliver', { orderId: 'o-boat-14', deliveredOn: '2026-10-23' });
    const after = ((await engine.request('venture.queue.list', { scope: 'current' })) as { rows: { id: string; kind: string; line?: string; actions: { id: string; label: string; primary: boolean }[] }[] }).rows.filter((row) => row.kind === 'proposal');
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe(before.id);
    expect(after[0]!.line).toBe("This can't go ahead now: this order is no longer open.");
    expect(after[0]!.actions.map((action) => [action.id, action.label, action.primary])).toEqual([['deny', 'Dismiss', true]]);
  });

  it('Not now sets the step aside (venture.proposals.dismiss) and the next step comes up', async () => {
    stubWidth(false);
    const { spy } = await start('#/chats?thread=chiefthread-billed');
    const plan = await screen.findByRole('region', { name: 'A short plan' });
    await click(within(plan).getByRole('button', { name: 'Not now' }));
    await settle();
    expect(calls(spy, 'venture.proposals.dismiss').map(([, p]) => p)).toEqual([{ id: 'proposal-reminder-0039' }]);
    const after = screen.getByRole('region', { name: 'A short plan' });
    expect(within(after).getAllByRole('listitem')[0]!.textContent).toContain('Not now');
    expect(within(after).getByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('a raise the engine refuses says why in its words, and nothing moves', async () => {
    stubWidth(false);
    await start('#/chats?thread=chiefthread-billed', {
      override: answer('venture.proposals.raise', () => { throw new EngineError('APPROVAL_STALE', 'This changed since Chausar drafted it: this invoice has nothing left to pay. Ask Chausar again.'); }),
    });
    const plan = await screen.findByRole('region', { name: 'A short plan' });
    await click(within(plan).getByRole('button', { name: 'Start' }));
    await settle();
    expect(within(plan).getByRole('alert').textContent).toBe('This changed since Chausar drafted it: this invoice has nothing left to pay. Ask Chausar again.');
    expect(within(plan).queryByRole('link', { name: 'On Today' })).toBeNull();
  });

  it('a model estimate is labelled; a routed message links to the agent\'s chat', async () => {
    stubWidth(false);
    await start('#/chats?thread=chiefthread-titles');
    await waitFor(() => expect(thread().querySelector('[data-estimate]')).not.toBeNull());
    const estimate = thread().querySelector('[data-chief-message] [data-estimate]')!;
    expect(estimate.textContent).toContain('about 18,000 views');
    expect(within(thread()).getByText('model estimate')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('a message sent to an agent says where it went, with a link to that chat', async () => {
    stubWidth(false);
    await start('#/chats?thread=chiefthread-trailer');
    const link = await within(await screen.findByRole('log')).findByRole('link', { name: "Open Editor's chat" });
    expect(link.getAttribute('href')).toBe('#/team?sheet=agent:editor');
  });

  /** The billed chat with its answer replaced by the records answer the engine sends when the AI's answer failed. */
  const counted = answer('venture.chief.thread.list', async (params, base) => {
    const view = (await base('venture.chief.thread.list', params)) as ChiefThreadView;
    const last = view.messages.at(-1)!;
    last.parts = [{ kind: 'text', text: "Your AI's answer did not pass Chausar's checks, so here is what Chausar can say from its records." }];
    last.counted = {
      entities: [{ kind: 'clients', count: 4 }, { kind: 'orders', count: 1 }, { kind: 'invoices', count: 2 }, { kind: 'runs', count: 6 }, { kind: 'people', count: 0 }, { kind: 'leads', count: 3 }],
      months: [{ month: '2026-08', count: 2 }, { month: '2026-09', count: 5 }, { month: '2026-10', count: 9 }],
    };
    last.worked = []; last.proposals = []; last.dropped = ['One figure was left out: it had no receipt.'];
    return view;
  });

  it('counts by code arrive structured and are worded here, kind by kind and month by month, with no estimate label', async () => {
    stubWidth(false);
    await start('#/chats?thread=chiefthread-billed', { override: counted });
    const box = await within(await screen.findByRole('log')).findByRole('group', { name: "Counted by code; the summary didn't work." });
    expect(within(box).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '4 clients', '1 order', '2 invoices', '6 runs', '0 people in your network', '3 leads', 'August 2026: 2 new', 'September 2026: 5 new', 'October 2026: 9 new',
    ]);
    expect(box.querySelector('[data-estimate]')).toBeNull();
    expect(within(thread()).getByText('One figure was left out: it had no receipt.')).toBeTruthy();
  });

  it('counts by code in Hindi', async () => {
    stubWidth(false);
    await start('#/chats?thread=chiefthread-billed', { override: counted, language: 'hi' });
    const box = await within(await screen.findByRole('log')).findByRole('group', { name: 'कोड से गिना गया; सारांश नहीं बन सका।' });
    expect(within(box).getAllByRole('listitem')[0]!.textContent).toBe('4 क्लाइंट');
  });
});

describe('#/chats: asking', () => {
  it('New chat: Send asks venture.chief.thread.send with the words, opens the new chat and shows the answer', async () => {
    stubWidth(false);
    const { spy } = await start('#/chats');
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'What did we receive this month?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    expect(calls(spy, 'venture.chief.thread.send').map(([, p]) => p)).toEqual([{ text: 'What did we receive this month?' }]);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chats\?thread=/));
    await waitFor(() => expect(within(thread()).getByText('What did we receive this month?')).toBeTruthy());
    expect(assertFiguresProved(thread()).length).toBeGreaterThan(0);
    expect(composer().value).toBe('');
  });

  it('a suggestion fills the box and sends nothing', async () => {
    stubWidth(false);
    const { spy } = await start('#/chats');
    await screen.findByRole('navigation', { name: 'Your chats' });
    await click(screen.getByRole('button', { name: 'What is waiting on me?' }));
    expect(composer().value).toBe('What is waiting on me?');
    expect(calls(spy, 'venture.chief.thread.send')).toHaveLength(0);
  });

  /**
   * The engine as it stands with a consent to give: the thread list carries the consent (needed or stale) with its
   * text and digest; a send is refused until the owner agrees by that digest; `later` is the consent the list carries
   * after the refusal was read (the AI changed meanwhile), which the screen must not use.
   */
  function consentEngine(state: 'needed' | 'stale', text: string, later?: { text: string; digest: string }) {
    const seen = { agreed: false, refused: false, after: 0 };
    const override = both(
      answer('venture.chief.thread.send', (params, base) => {
        if (!seen.agreed) seen.refused = true;
        if (!seen.agreed) throw new EngineError(state === 'needed' ? 'CHAT_CONSENT_REQUIRED' : 'CHAT_CONSENT_STALE', state === 'needed' ? text : `Your AI connection changed since you agreed, so chats wait until you agree again. ${text}`);
        return base('venture.chief.thread.send', params);
      }),
      answer('venture.chief.threads', async (params, base) => {
        const view = (await base('venture.chief.threads', params)) as { groups: unknown[] };
        // The first read after the refusal is the one on screen; every later read sees the changed AI.
        const now = later && seen.after > 0 ? { text: later.text, digest: later.digest } : { text, digest: 'a'.repeat(64) };
        if (seen.refused) seen.after += 1;
        return { ...view, consent: seen.agreed ? { state: 'given', ...now, at: NOW } : { state, ...now, at: null } };
      }),
      answer('venture.chats.consent', (params) => { seen.agreed = true; return { state: 'given', text, digest: params.digest, at: NOW }; }),
    );
    return { seen, override };
  }

  it('before the first message: the consent the thread list carries, then Agree and send agrees with that digest and sends; no agent is needed', async () => {
    stubWidth(false);
    const consentText = 'Chats send your message and what Chausar reads to answer it to Claude Sonnet 5.5 with your key.';
    const { override } = consentEngine('needed', consentText);
    const { spy } = await start('#/chats', { override });
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'How is the month going?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    const consent = screen.getByRole('region', { name: 'Before your first message' });
    expect(within(consent).getByText(consentText)).toBeTruthy();
    expect(within(consent).getByText('How is the month going?')).toBeTruthy();
    await click(within(consent).getByRole('button', { name: 'Agree and send' }));
    await settle();
    expect(calls(spy, 'venture.chats.consent').map(([, p]) => p)).toEqual([{ digest: 'a'.repeat(64) }]);
    expect(calls(spy, 'venture.agents.thread.list')).toHaveLength(0);
    expect(calls(spy, 'venture.chief.thread.send').map(([, p]) => p)).toEqual([{ text: 'How is the month going?' }, { text: 'How is the month going?' }]);
    expect(screen.queryByRole('region', { name: 'Before your first message' })).toBeNull();
    await waitFor(() => expect(within(thread()).getByText('How is the month going?')).toBeTruthy());
  });

  it('the consent is read once, at the refusal: Agree sends the digest of the words on screen, never one read later', async () => {
    stubWidth(false);
    const shown = 'Chats send your message to Claude Sonnet 5.5 with your key.';
    const { override } = consentEngine('needed', shown, { text: 'Chats send your message to GPT-6 Luna with your key.', digest: 'b'.repeat(64) });
    const { spy } = await start('#/chats', { override });
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'How is the month going?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    const consent = screen.getByRole('region', { name: 'Before your first message' });
    expect(within(consent).getByText(shown)).toBeTruthy();
    // The list reads again (an answer elsewhere); the card keeps what it showed and agrees to that.
    await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await click(within(consent).getByRole('button', { name: 'Agree and send' }));
    await settle();
    expect(calls(spy, 'venture.chats.consent').map(([, p]) => p)).toEqual([{ digest: 'a'.repeat(64) }]);
  });

  it('a stale consent (the AI changed since): the engine\'s new words, agreed by their digest, then the words are sent', async () => {
    stubWidth(false);
    const text = 'Chats send your message and what Chausar reads to answer it to GPT-6 Luna with your key.';
    const { override } = consentEngine('stale', text);
    const { spy } = await start('#/chats', { override });
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'How is the month going?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    const consent = screen.getByRole('region', { name: 'Your AI changed: agree again' });
    expect(within(consent).getByText(text)).toBeTruthy();
    await click(within(consent).getByRole('button', { name: 'Agree and send' }));
    await settle();
    expect(calls(spy, 'venture.chats.consent').map(([, p]) => p)).toEqual([{ digest: 'a'.repeat(64) }]);
    expect(calls(spy, 'venture.chief.thread.send')).toHaveLength(2);
  });

  it('an agreement the engine refuses as stale says so in its words and shows the consent as it stands now', async () => {
    stubWidth(false);
    const { override } = consentEngine('needed', 'Old words.');
    let refused = false;
    await start('#/chats', {
      override: both(override, answer('venture.chats.consent', (params, base) => {
        if (!refused) { refused = true; throw new EngineError('APPROVAL_STALE', 'What chats send changed since you read it. Read it again.'); }
        return base('venture.chats.consent', params);
      })),
    });
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'How is the month going?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    const consent = screen.getByRole('region', { name: 'Before your first message' });
    await click(within(consent).getByRole('button', { name: 'Agree and send' }));
    await settle();
    expect(within(screen.getByRole('region', { name: 'Before your first message' })).getByRole('alert').textContent).toContain('What chats send changed since you read it. Read it again.');
  });

  it('Not now on the consent puts the words back in the box and sends nothing', async () => {
    stubWidth(false);
    await start('#/chats', { override: consentEngine('needed', 'Chats send your message to your AI.').override });
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'How is the month going?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    await click(within(screen.getByRole('region', { name: 'Before your first message' })).getByRole('button', { name: 'Not now' }));
    await settle();
    expect(screen.queryByRole('region', { name: 'Before your first message' })).toBeNull();
    expect(composer().value).toBe('How is the month going?');
  });

  it('a key in the words is refused in the engine\'s words, and the box is emptied so it is not sent again', async () => {
    stubWidth(false);
    await start('#/chats');
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'my key is sk-ant-abcdefghijklmnop1234' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('That looks like a key. Keys go in Connections, never in chat.');
    expect(composer().value).toBe('');
  });

  it('another refusal keeps the words and says why in the engine\'s words', async () => {
    stubWidth(false);
    await start('#/chats', { override: answer('venture.chief.thread.send', () => { throw new EngineError('MODEL_UNAVAILABLE', 'Your AI did not answer. Try again in a minute.'); }) });
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'How is the month going?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    expect(screen.getByRole('alert').textContent).toContain('Your AI did not answer. Try again in a minute.');
    expect(composer().value).toBe('How is the month going?');
  });

  it('a locked business is never read: the chief says so', async () => {
    stubWidth(false);
    await start('#/chats');
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'How is Sitara Events doing this month?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    await waitFor(() => expect(within(thread()).getByText('Sitara Events is locked. Open it to ask about it.')).toBeTruthy());
  });

  it('another business on this computer is answered from what was saved, "as of" then, every figure with its receipt', async () => {
    stubWidth(false);
    await start('#/chats');
    await screen.findByRole('navigation', { name: 'Your chats' });
    fireEvent.change(composer(), { target: { value: 'How is Ledgerline doing this month?' } });
    await click(screen.getByRole('button', { name: 'Send' }));
    await settle();
    await waitFor(() => expect(within(thread()).getByText(/^Ledgerline, as of .+, when you last opened it:$/)).toBeTruthy());
    expect(assertFiguresProved(thread()).length).toBeGreaterThan(0);
  });

  it('the place in Hindi shows no text key', async () => {
    stubWidth(false);
    await start('#/chats?thread=chiefthread-billed', { language: 'hi' });
    await screen.findByRole('region', { name: 'एक छोटा प्लान' });
    expect(document.body.textContent).not.toMatch(/\bchats\.[a-z]/);
  });
});

describe('Today: the Chausar story', () => {
  it('leads the stories with "Chausar, ask anything", which opens Chats', async () => {
    stubWidth(false);
    await start('#/today');
    const team = await screen.findByRole('region', { name: 'Team at work' });
    const stories = within(team).getByRole('list', { name: 'Your agents' });
    const first = within(stories).getAllByRole('button')[0]!;
    expect(first.getAttribute('aria-label')).toBe('Chausar, ask anything');
    expect(first.textContent).toBe('ChausarAsk anything');
    await click(first);
    expect(window.location.hash).toBe('#/chats');
  }, 15_000);
});

describe('Today with no agents, and the phone', () => {
  it('with no agents on the team, Today still shows the Chausar story and Add agent', async () => {
    stubWidth(false);
    await start('#/today', { override: answer('venture.team.list', async (params, base) => ({ ...((await base('venture.team.list', params)) as object), agents: [] })) });
    const team = await screen.findByRole('region', { name: 'Team at work' });
    const stories = within(team).getByRole('list', { name: 'Your agents' });
    expect(within(stories).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Chausar, ask anything', 'Add agent']);
  }, 15_000);

  it('on a phone, "All chats" leads the chat head, at the left', async () => {
    stubWidth(true);
    await start('#/chats?thread=chiefthread-billed');
    const back = await screen.findByRole('link', { name: 'All chats' });
    const head = back.closest('header')!;
    expect(head.firstElementChild).toBe(back);
  });
});

describe('Start: the fit and "Not sure which fits?"', () => {
  it('the fit is a model call, so it is asked only when the owner presses "Which way fits me?"', async () => {
    stubWidth(false);
    const { spy } = await start('#/onboarding');
    const unsure = await screen.findByRole('region', { name: 'Not sure which fits?' });
    await settle();
    expect(calls(spy, 'venture.chief.fit')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: /^Good fit for you/ })).toBeNull();
    await click(within(unsure).getByRole('button', { name: 'Which way fits me?' }));
    await settle();
    expect(calls(spy, 'venture.chief.fit').map(([, p]) => p)).toEqual([{}]);
    expect(screen.getByRole('region', { name: /^Good fit for you/ })).toBeTruthy();
  });

  it('"Good fit for you" from venture.chief.fit, its line labelled a model estimate; Start with this fills the box and sends nothing', async () => {
    stubWidth(false);
    const { spy } = await start('#/onboarding');
    await click(within(await screen.findByRole('region', { name: 'Not sure which fits?' })).getByRole('button', { name: 'Which way fits me?' }));
    const fit = await screen.findByRole('region', { name: /^Good fit for you/ });
    expect(calls(spy, 'venture.chief.fit').map(([, p]) => p)).toEqual([{}]);
    expect(within(fit).getByText('Good fit for you')).toBeTruthy();
    expect(within(fit).getByRole('heading', { level: 2 }).textContent).toBe('Social media agency');
    expect(within(fit).getByText('model estimate')).toBeTruthy();
    await click(within(fit).getByRole('button', { name: 'Start with this' }));
    const box = screen.getByRole('textbox', { name: /^(What do you want to start\?|Or describe it in one sentence)$/ }) as HTMLTextAreaElement;
    expect(box.value.length).toBeGreaterThan(10);
    expect(document.activeElement).toBe(box);
    expect(calls(spy, 'venture.preview')).toHaveLength(0);
    assertInkRules(document.body);
  });

  it('no fit (no AI, or no ways listed) is no tile, and says so', async () => {
    stubWidth(false);
    await start('#/onboarding', { override: answer('venture.chief.fit', () => null) });
    const unsure = await screen.findByRole('region', { name: 'Not sure which fits?' });
    await click(within(unsure).getByRole('button', { name: 'Which way fits me?' }));
    await settle();
    expect(screen.queryByRole('region', { name: /^Good fit for you/ })).toBeNull();
    expect(within(unsure).getByRole('status').textContent).toBe('No fit to show: Chausar needs your AI and the ways to earn for that.');
  });

  it('a fit the engine refuses keeps the Not sure tile, with the engine\'s words', async () => {
    stubWidth(false);
    await start('#/onboarding', { override: answer('venture.chief.fit', () => { throw new EngineError('MODEL_UNAVAILABLE', 'Your AI did not answer. Try again in a minute.'); }) });
    const unsure = await screen.findByRole('region', { name: 'Not sure which fits?' });
    await click(within(unsure).getByRole('button', { name: 'Which way fits me?' }));
    await settle();
    expect(within(unsure).getByRole('alert').textContent).toBe('Your AI did not answer. Try again in a minute.');
    expect(within(unsure).getAllByRole('button').map((b) => b.textContent)).toContain('Which way fits 5 hours a week?');
  });

  it('"Not sure which fits? Ask Chausar": two questions that prefill the composer in Chats, and Open Chats', async () => {
    stubWidth(false);
    const { spy } = await start('#/onboarding');
    const unsure = await screen.findByRole('region', { name: 'Not sure which fits?' });
    expect(within(unsure).getByRole('link', { name: 'Open Chats' }).getAttribute('href')).toBe('#/chats');
    const questions = within(within(unsure).getByRole('group', { name: 'Questions to ask' })).getAllByRole('button');
    expect(questions.map((b) => b.textContent)).toEqual(['Which way fits 5 hours a week?', 'What could I add to my business?']);
    await click(questions[0]!);
    await hashChanged();
    await settle();
    expect(window.location.hash).toBe('#/chats');
    await waitFor(() => expect(composer().value).toBe('Which way fits 5 hours a week?'));
    expect(calls(spy, 'venture.chief.thread.send')).toHaveLength(0);
  });
});
