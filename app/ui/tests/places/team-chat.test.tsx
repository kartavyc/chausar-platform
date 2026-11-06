import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import axe from 'axe-core';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type AgentThreadView, type EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * The agent panel's chat and instructions (Ink v2 wave 4, package 4B3; spec 5.2; catalogue A2, A3, A4, A7, O16). The
 * founder's decisions: the owner reads every run as chat and talks to an agent; a "from now on" request becomes a
 * proposed change to its instructions that the owner accepts, versioned and undoable; the chat is not in your face (a
 * quiet Chat button beside each agent on Team, nothing on Today). The fake engine answers as 4B1 and 4B2 do.
 */

type FakeClient = ReturnType<typeof createFakeClient>;
type Intercept = (method: string, params: Record<string, unknown>, base: FakeClient) => Promise<unknown> | undefined;

function start(hash = '#/team', options: { language?: 'en' | 'hi'; intercept?: Intercept; engine?: FakeEngine } = {}) {
  window.location.hash = hash;
  const engine = options.engine ?? new FakeEngine();
  const base = createFakeClient(engine);
  const spy = vi.fn();
  const client: EngineClient = {
    ...base,
    request: ((method: string, params?: Record<string, unknown>) => {
      spy(method, params);
      return options.intercept?.(method, params ?? {}, base) ?? base.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { base, spy, engine, ...view };
}

const hashChanged = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); hashChanged(); }); };
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const panelOf = (name: string) => screen.findByRole('complementary', { name });
const calls = (spy: ReturnType<typeof vi.fn>, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
const axeOn = async (root: Element) => (await axe.run(root, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] }))
  .violations.flatMap((v) => v.nodes.map((node) => `${v.id}: ${node.target.join(' ')}`));

async function type(panel: HTMLElement, text: string) {
  const box = within(panel).getByRole('textbox', { name: /^(Message|Your answer to) / });
  await act(async () => { fireEvent.change(box, { target: { value: text } }); });
  await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Send' })); });
  await settle();
}

const ledgerline = (engine: FakeEngine) => engine.request('workspace.open', { folder: 'ledgerline' });

describe('Team: the quiet Chat button', () => {
  it('each agent card but Keeper has a chat-variant button named for the agent that opens its panel on Chat', async () => {
    start();
    const editor = await screen.findByRole('button', { name: 'Chat with Editor' });
    expect(editor.getAttribute('data-variant')).toBe('chat');
    expect(editor.textContent).toBe('Chat');
    for (const name of ['Researcher', 'Producer', 'Publisher']) expect(screen.getByRole('button', { name: `Chat with ${name}` })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chat with Keeper' })).toBeNull();

    await click(editor);
    expect(window.location.hash).toBe('#/team?sheet=agent%3Aeditor&tab=chat');
    const panel = await panelOf('Editor');
    expect(within(panel).getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
    expect(await within(panel).findByRole('log', { name: 'Conversation with Editor' })).toBeTruthy();
    // The first test of the file also pays for warming jsdom up.
  }, 15_000);

  it('opened by its name, the panel shows Instructions; closing it takes the tab out of the address', async () => {
    start('#/team?sheet=agent:editor&tab=chat');
    const panel = await panelOf('Editor');
    await click(within(panel).getByRole('button', { name: 'Close Editor' }));
    expect(window.location.hash).toBe('#/team');
    await click(await screen.findByRole('button', { name: 'Editor' }));
    const again = await panelOf('Editor');
    expect(within(again).getByRole('tab', { name: /^Instructions/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('nothing about chat is on Today', async () => {
    start('#/today');
    await screen.findByRole('heading', { level: 1 });
    await settle();
    const main = screen.getByRole('main');
    expect(within(main).queryAllByRole('button', { name: /^Chat with / })).toEqual([]);
    expect(main.querySelector('[data-variant="chat"]')).toBeNull();
    expect(within(main).queryByRole('log')).toBeNull();
  });
});

describe('The Chat tab', () => {
  it('reads the runs as conversation: day lines, messages, folded runs that open their steps, and the Recalled chip', async () => {
    start('#/team?sheet=agent:editor&tab=chat');
    const panel = await panelOf('Editor');
    const log = await within(panel).findByRole('log', { name: 'Conversation with Editor' });
    expect(log.querySelectorAll('[data-day]').length).toBeGreaterThan(0);
    expect(within(log).getByText('Remember that Nimbus Mics wants every file as MP4, never MOV.').closest('[data-from="owner"]')).not.toBeNull();
    expect(within(log).getByText('Here is the note I would keep. Nothing is saved until you accept it.')).toBeTruthy();

    const fold = within(log).getByRole('button', { name: /Cutting shorts from episode 13 · 3 of 5 steps/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    await click(fold);
    const steps = within(log).getByRole('group', { name: 'Steps in Cutting shorts from episode 13' });
    expect(within(steps).getByText('Read the transcript')).toBeTruthy();
    expect(within(log).getByRole('button', { name: /Rendering the thumbnail set · failed/ })).toBeTruthy();

    const chip = within(log).getByRole('button', { name: 'Recalled 1 note' });
    await click(chip);
    const list = within(log).getByRole('list', { name: 'Notes Cutting shorts from episode 13 used' });
    expect(within(list).getByText('Nimbus Mics wants every file as MP4, never MOV.')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('pins the question the run waits on above the thread, and Answer sends the owner words as the answer', async () => {
    const { spy } = start('#/team?sheet=agent:producer&tab=chat');
    const panel = await panelOf('Producer');
    const waiting = await within(panel).findByRole('region', { name: 'Waiting on you' });
    expect(waiting.textContent).toContain('Share a private preview link with them?');
    const log = within(panel).getByRole('log');
    expect(waiting.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await click(within(waiting).getByRole('button', { name: 'Answer' }));
    expect(within(panel).getByRole('textbox', { name: 'Your answer to Producer' })).toBeTruthy();
    await type(panel, 'Yes, share a private link');
    expect(calls(spy, 'venture.agents.thread.send').at(-1)).toEqual({ agent: 'producer', text: 'Yes, share a private link' });
    expect(within(panel).getByRole('status').textContent).toBe('I passed this on as your answer to my question. The next step waits for your approval on Today.');
    await waitFor(() => expect(within(panel).queryByRole('region', { name: 'Waiting on you' })).toBeNull());
  });

  it('steps between the agents that have a chat with ‹ and ›, saying where it is', async () => {
    start('#/team?sheet=agent:editor&tab=chat');
    const panel = await panelOf('Editor');
    const nav = within(panel).getByRole('navigation', { name: 'Other agents' });
    expect(nav.textContent).toContain('1 of 4');
    expect((within(nav).getByRole('button', { name: 'This is the first agent' }) as HTMLButtonElement).disabled).toBe(true);
    await click(within(nav).getByRole('button', { name: 'Next agent: Researcher' }));
    expect(window.location.hash).toBe('#/team?sheet=agent%3Aresearcher&tab=chat');
    const next = await panelOf('Researcher');
    expect(within(next).getByRole('navigation', { name: 'Other agents' }).textContent).toContain('2 of 4');
    expect(within(next).getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
  });

  it('suggestion chips put words in the box and never send', async () => {
    const { spy } = start('#/team?sheet=agent:researcher&tab=chat');
    const panel = await panelOf('Researcher');
    await within(panel).findByRole('log');
    const chips = within(panel).getByRole('group', { name: 'Suggestions' });
    await click(within(chips).getByRole('button', { name: 'From now on,' }));
    expect((within(panel).getByRole('textbox', { name: 'Message Researcher' }) as HTMLTextAreaElement).value).toBe('From now on, ');
    expect(calls(spy, 'venture.agents.thread.send')).toEqual([]);
  });

  it('a key is refused and the words stay in the box', async () => {
    start('#/team?sheet=agent:researcher&tab=chat');
    const panel = await panelOf('Researcher');
    await within(panel).findByRole('log');
    await type(panel, 'here it is sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(within(panel).getByRole('alert').textContent).toContain('That looks like a key. Keys go in Connections, never in chat.');
    expect((within(panel).getByRole('textbox', { name: 'Message Researcher' }) as HTMLTextAreaElement).value).toContain('sk-ant-');
  });
});

describe('The chat consent', () => {
  it('a first message to an agent the owner AI would read asks first, in the engine words; Agree and send records it, then sends', async () => {
    const engine = new FakeEngine();
    await ledgerline(engine);
    const { spy } = start('#/team?sheet=agent:bookkeeper&tab=chat', { engine });
    const panel = await panelOf('Bookkeeper');
    await within(panel).findByRole('log');
    await act(async () => { fireEvent.change(within(panel).getByRole('textbox', { name: 'Message Bookkeeper' }), { target: { value: 'What did you match last?' } }); });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Send' })); });
    const consent = await within(panel).findByRole('region', { name: 'Before your first message' });
    expect(consent.textContent).toContain('to Claude Sonnet 5.5 with your key. Keys, passphrases and bank or card numbers are never sent.');
    expect(calls(spy, 'venture.agents.thread.send')).toEqual([]);

    await click(within(consent).getByRole('button', { name: 'Agree and send' }));
    await settle();
    const digest = calls(spy, 'venture.chats.consent')[0]!.digest as string;
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(calls(spy, 'venture.agents.thread.send')).toEqual([{ agent: 'bookkeeper', text: 'What did you match last?' }]);
    expect(within(panel).queryByRole('region', { name: 'Before your first message' })).toBeNull();
    expect(within(within(panel).getByRole('log')).getByText('What did you match last?')).toBeTruthy();
  });

  it('Not now sends nothing and keeps the words', async () => {
    const engine = new FakeEngine();
    await ledgerline(engine);
    const { spy } = start('#/team?sheet=agent:bookkeeper&tab=chat', { engine });
    const panel = await panelOf('Bookkeeper');
    await within(panel).findByRole('log');
    await act(async () => { fireEvent.change(within(panel).getByRole('textbox', { name: 'Message Bookkeeper' }), { target: { value: 'Hello' } }); });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Send' })); });
    await click(within(await within(panel).findByRole('region', { name: 'Before your first message' })).getByRole('button', { name: 'Not now' }));
    await settle();
    expect(calls(spy, 'venture.agents.thread.send')).toEqual([]);
    expect(within(panel).getByRole('alert').textContent).toContain("You didn't agree, so nothing was sent.");
    expect((within(panel).getByRole('textbox', { name: 'Message Bookkeeper' }) as HTMLTextAreaElement).value).toBe('Hello');
  });
});

describe('Proposals in the thread', () => {
  it('a "from now on" change is a DiffCard: the applies-to line, the lines, the versions, Reject and the one primary Accept', async () => {
    const { spy } = start('#/team?sheet=agent:editor&tab=chat');
    const panel = await panelOf('Editor');
    const card = await within(panel).findByRole('article', { name: "Proposed change to Editor's instructions" });
    expect(card.textContent).toContain('Applies to "Cut the episode" from the next run.');
    const lines = within(card).getByRole('group', { name: 'The change, with the lines around it' });
    expect(lines.textContent).toContain('Keep the length the client asked for.');
    expect(within(lines).getByText("Put the episode's name in the first line of every short's description.").tagName).toBe('INS');
    expect(card.textContent).toContain('Version 4 to 5, you can undo');
    expect(card.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeTruthy();
    assertInkRules(document.body);

    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: /Accept/ })); });
    await settle();
    const decided = calls(spy, 'venture.agents.proposal.decide');
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({ decision: 'accept' });
    expect(decided[0]!.digest).toMatch(/^[a-f0-9]{64}$/);
    const after = within(panel).getByRole('article', { name: "Proposed change to Editor's instructions" });
    expect(after.textContent).toContain('Accepted. Editor works to version 5 from the next run.');
    expect(within(after).getByRole('button', { name: 'Undo' })).toBeTruthy();
    // The engine's own line about the run already going, in the thread.
    expect(within(within(panel).getByRole('log')).getByText(/Version 5 is in use from the next run\. Runs .* keep version 4\./)).toBeTruthy();
    expect(within(panel).getByRole('tab', { name: 'Instructions v5' })).toBeTruthy();

    await act(async () => { fireEvent.click(within(after).getByRole('button', { name: 'Undo' })); });
    await settle();
    expect(calls(spy, 'venture.agents.version.undo')).toHaveLength(1);
    expect(within(panel).getByText('Back to version 4. Version 5 stays stored.')).toBeTruthy();
    expect(within(panel).getByRole('tab', { name: 'Instructions v4' })).toBeTruthy();
    // Review 4B3: once undone, the card says so and offers Undo no more.
    const undone = within(panel).getByRole('article', { name: "Proposed change to Editor's instructions" });
    expect(undone.textContent).toContain('Undone. Editor is back on version 4.');
    expect(within(undone).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('a stale change hides Accept and Reject and says why in the engine words', async () => {
    const stale = "This was drafted against version 4; version 5 is in use now. Ask again and I will redraft it.";
    start('#/team?sheet=agent:editor&tab=chat', {
      intercept: (method, params, base) => (method === 'venture.agents.thread.list'
        ? base.request('venture.agents.thread.list', params as never).then((view: AgentThreadView) => ({
            ...view, items: view.items.map((item) => (item.type === 'proposal' && item.proposal.kind === 'instruction' ? { ...item, proposal: { ...item.proposal, status: 'stale' as const, line: stale } } : item)),
          }))
        : undefined),
    });
    const panel = await panelOf('Editor');
    const card = await within(panel).findByRole('article', { name: "Proposed change to Editor's instructions" });
    expect(card.textContent).toContain(stale);
    expect(within(card).queryByRole('button', { name: /Accept/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  it('words to remember become a small "Save this note?" card that quotes them; Accept keeps it', async () => {
    const { spy } = start('#/team?sheet=agent:researcher&tab=chat');
    const panel = await panelOf('Researcher');
    await within(panel).findByRole('log');
    await type(panel, 'Remember that the channel posts on Fridays');
    const card = await within(panel).findByRole('article', { name: 'Save this note?' });
    expect(card.textContent).toContain("You said: 'Remember that the channel posts on Fridays'");
    expect(card.textContent).toContain('The channel posts on Fridays.');
    expect(card.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Accept' })); });
    await settle();
    expect(calls(spy, 'venture.agents.proposal.decide').at(-1)).toMatchObject({ decision: 'accept' });
    // 4Z2: once kept, the card is headed as the agent's note, not as a question.
    expect(within(panel).getByRole('article', { name: 'Note for Researcher' }).textContent).toContain("Saved in Researcher's notes.");
  });

  it('a request for work opens New order with the request filled in; a request on the floor says it needs approval on Today', async () => {
    start('#/team?sheet=agent:researcher&tab=chat');
    const panel = await panelOf('Researcher');
    await within(panel).findByRole('log');
    await type(panel, 'Publish the titles to YouTube');
    expect(within(within(panel).getByRole('log')).getByText('That needs your approval on Today.')).toBeTruthy();
    // Review 4B3: the reply names the proposal it raised, and its link opens that card on Today.
    const today = within(within(panel).getByRole('log')).getByRole('link', { name: 'Open on Today' });
    expect(today.getAttribute('href')).toMatch(/^#\/today\?row=proposal%3Aproposal-\d+$/);

    await type(panel, 'Write three titles for episode 15');
    const open = within(panel).getByRole('button', { name: 'Open New order' });
    await click(open);
    expect(window.location.hash).toBe('#/team?sheet=new-order%3Anew');
    const sheet = await screen.findByRole('complementary', { name: /New order/ });
    await waitFor(() => expect((within(sheet).getByRole('textbox', { name: /asked for/i }) as HTMLTextAreaElement).value).toBe('Write three titles for episode 15'));
  });
});

describe('The Instructions tab', () => {
  it('shows the version in use, each step with its guidance and the checks it must pass, and who set the posture', async () => {
    start('#/team?sheet=agent:editor');
    const panel = await panelOf('Editor');
    expect(within(panel).getByRole('tab', { name: /^Instructions/ }).getAttribute('aria-selected')).toBe('true');
    const how = await within(panel).findByRole('region', { name: 'How Editor works' });
    await waitFor(() => expect(how.querySelector('[data-version]')?.textContent).toMatch(/^Version 4, made from your plan on 14 Oct/));
    expect(within(panel).getByRole('tab', { name: 'Instructions v4' })).toBeTruthy();
    const shorts = within(how).getByRole('heading', { level: 4, name: 'Cut shorts from the episode' }).closest('li')!;
    expect(shorts.textContent).toContain('Pick moments that make sense without the episode.');
    expect(shorts.textContent).toContain("Done when these checks pass: the length is within limits, it claims no work it didn't do.");
    expect(within(panel).getByText('Posture set for the whole business')).toBeTruthy();
    // What Steps held before stays: the posture and when each step asks the owner.
    expect(within(panel).getByRole('group', { name: 'Posture' })).toBeTruthy();
    expect(within(panel).getByRole('list', { name: 'Steps' })).toBeTruthy();
    assertInkRules(document.body);
  });

  it('lists standing orders with their version and the owner words, and goes back after asking once more', async () => {
    const { spy } = start('#/team?sheet=agent:editor&tab=chat');
    const panel = await panelOf('Editor');
    const card = await within(panel).findByRole('article', { name: "Proposed change to Editor's instructions" });
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: /Accept/ })); });
    await settle();
    await click(within(panel).getByRole('tab', { name: /^Instructions/ }));
    await settle();
    const orders = await within(panel).findByRole('region', { name: 'Standing orders' });
    const item = within(orders).getByText("Put the episode's name in the first line of every short's description.").closest('li')!;
    expect(item.textContent).toContain('Since version 5');
    expect(item.textContent).toContain("You said: From now on, put the episode's name in the first line of every short's description.");

    await click(within(orders).getByRole('button', { name: 'Go back to version 4' }));
    const ask = within(orders).getByRole('group');
    expect(ask.textContent).toContain('Version 5 stays stored, so nothing is lost.');
    expect(calls(spy, 'venture.agents.version.undo')).toEqual([]);
    await act(async () => { fireEvent.click(within(ask).getByRole('button', { name: 'Yes, go back' })); });
    await settle();
    expect(calls(spy, 'venture.agents.version.undo')).toHaveLength(1);
    expect(within(panel).getByText('Back to version 4. Version 5 stays stored.')).toBeTruthy();
    await waitFor(() => expect(within(panel).getByText('No standing orders yet. Tell Editor in chat what to do from now on.')).toBeTruthy());
  });
});

describe('The agent panel tabs, by keyboard and axe', () => {
  it('has Chat, Instructions, Runs, Notes and (W4 4J22b) Can do, in one row; arrow keys, Home and End move between them', async () => {
    start('#/team?sheet=agent:editor');
    const panel = await panelOf('Editor');
    const tabs = within(within(panel).getByRole('tablist', { name: 'Editor' })).getAllByRole('tab');
    await waitFor(() => expect(tabs.map((tab) => tab.textContent)).toEqual(['Chat', 'Instructions v4', 'Runs 2', 'Notes', 'Can do']));
    const [chat, instructions, runs] = tabs;
    const last = tabs.at(-1)!;
    await act(async () => { instructions!.focus(); fireEvent.keyDown(instructions!, { key: 'ArrowRight' }); });
    expect(runs!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(runs);
    await act(async () => { fireEvent.keyDown(runs!, { key: 'End' }); });
    expect(last.getAttribute('aria-selected')).toBe('true');
    await act(async () => { fireEvent.keyDown(last, { key: 'Home' }); });
    expect(chat!.getAttribute('aria-selected')).toBe('true');
  });

  it('passes axe on every tab', async () => {
    const { container } = start('#/team?sheet=agent:editor&tab=chat');
    const panel = await panelOf('Editor');
    await within(panel).findByRole('log');
    await settle();
    expect(await axeOn(container)).toEqual([]);
    for (const name of [/^Instructions/, 'Runs', 'Notes']) {
      await click(within(panel).getByRole('tab', { name }));
      await settle();
      expect(await axeOn(container)).toEqual([]);
    }
  }, 30_000);

  it('Keeper has no chat: its panel shows its jobs, and the engine refuses its thread', async () => {
    const { base } = start('#/team?sheet=agent:keeper&tab=chat');
    const panel = await panelOf('Keeper');
    expect(within(panel).queryByRole('tab', { name: 'Chat' })).toBeNull();
    await expect(base.request('venture.agents.thread.list', { agent: 'keeper' })).rejects.toThrow(EngineError);
  });
});

describe('Review 4B3: reading, never writing; Undo as the engine says; the consent read again; tabs and earlier pages', () => {
  const WRITES = /^venture\.(agents\.(thread\.send|proposal\.decide|version\.undo|notes\.(edit|forget|undo))|chats\.consent|delivery\.playbook)$/;

  it('opening the panel on every tab calls only reads, and never venture.delivery.playbook', async () => {
    const { spy } = start('#/team?sheet=agent:editor&tab=chat');
    const panel = await panelOf('Editor');
    await within(panel).findByRole('log');
    for (const name of [/^Instructions/, 'Runs', 'Notes']) {
      await click(within(panel).getByRole('tab', { name }));
      await settle();
    }
    expect(spy.mock.calls.map(([method]) => method as string).filter((method) => WRITES.test(method))).toEqual([]);
    expect(calls(spy, 'venture.agents.orders.list').length).toBeGreaterThan(0);
  });

  it('Undo is worded by what the engine says it does: a rebuild when a later change sits on top', async () => {
    start('#/team?sheet=agent:editor&tab=chat');
    let panel = await panelOf('Editor');
    const card = await within(panel).findByRole('article', { name: "Proposed change to Editor's instructions" });
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: /Accept/ })); });
    await settle();
    await click(within(panel).getByRole('button', { name: 'Next agent: Researcher' }));
    panel = await panelOf('Researcher');
    await within(panel).findByRole('log');
    await type(panel, 'From now on, keep every title under eight words.');
    const theirs = await within(panel).findByRole('article', { name: "Proposed change to Researcher's instructions" });
    await act(async () => { fireEvent.click(within(theirs).getByRole('button', { name: /Accept/ })); });
    await settle();
    window.location.hash = '#/team?sheet=agent:editor';
    hashChanged();
    panel = await panelOf('Editor');
    const orders = await within(panel).findByRole('region', { name: 'Standing orders' });
    await waitFor(() => expect(within(orders).getByRole('button', { name: 'Undo your last change' })).toBeTruthy());
    await click(within(orders).getByRole('button', { name: 'Undo your last change' }));
    expect(within(orders).getByRole('group').textContent).toContain('Chausar makes a new version without it');
  });

  it('a consent that changed since it was read is read again, with the engine words', async () => {
    const engine = new FakeEngine();
    await ledgerline(engine);
    let refused = false;
    const { spy } = start('#/team?sheet=agent:bookkeeper&tab=chat', {
      engine,
      intercept: (method) => {
        if (method !== 'venture.chats.consent' || refused) return undefined;
        refused = true;
        return Promise.reject(new EngineError('APPROVAL_STALE', 'What chats send changed since you read it. Read it again.'));
      },
    });
    const panel = await panelOf('Bookkeeper');
    await within(panel).findByRole('log');
    await act(async () => { fireEvent.change(within(panel).getByRole('textbox', { name: 'Message Bookkeeper' }), { target: { value: 'Hello' } }); });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Send' })); });
    const consent = await within(panel).findByRole('region', { name: 'Before your first message' });
    const reads = calls(spy, 'venture.agents.thread.list').length;
    await click(within(consent).getByRole('button', { name: 'Agree and send' }));
    await settle();
    expect(within(consent).getByRole('alert').textContent).toContain('What chats send changed since you read it.');
    expect(calls(spy, 'venture.agents.thread.list').length).toBeGreaterThan(reads);
    await click(within(consent).getByRole('button', { name: 'Agree and send' }));
    await settle();
    expect(calls(spy, 'venture.agents.thread.send')).toEqual([{ agent: 'bookkeeper', text: 'Hello' }]);
  });

  it('only the selected tab names its panel', async () => {
    start('#/team?sheet=agent:editor');
    const panel = await panelOf('Editor');
    const tabs = within(within(panel).getByRole('tablist', { name: 'Editor' })).getAllByRole('tab');
    expect(tabs.filter((tab) => tab.hasAttribute('aria-controls')).map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true']);
  });

  it('earlier messages load into a part of the log that is not read out again', async () => {
    start('#/team?sheet=agent:editor&tab=chat', {
      intercept: (method, params, base) => {
        if (method !== 'venture.agents.thread.list') return undefined;
        return base.request('venture.agents.thread.list', { agent: 'editor' }).then((view: AgentThreadView) => (params.before === undefined
          ? { ...view, items: view.items.slice(2), more: true }
          : { ...view, items: view.items.slice(0, 2), more: false }));
      },
    });
    const panel = await panelOf('Editor');
    const log = await within(panel).findByRole('log');
    expect(log.querySelector('[data-older]')).toBeNull();
    await click(within(panel).getByRole('button', { name: 'Show earlier messages' }));
    await settle();
    const older = log.querySelector('[data-older]')!;
    expect(older.getAttribute('aria-live')).toBe('off');
    expect(within(older as HTMLElement).getByText('Remember that Nimbus Mics wants every file as MP4, never MOV.')).toBeTruthy();
  });
});

describe('Review 4B3: Today opens the card a chat links to', () => {
  it('#/today?row=proposal:<id> brings that card into view and lets go of the address', async () => {
    start('#/team?sheet=agent:researcher&tab=chat');
    const panel = await panelOf('Researcher');
    await within(panel).findByRole('log');
    await type(panel, 'Publish the titles to YouTube');
    const href = within(within(panel).getByRole('log')).getByRole('link', { name: 'Open on Today' }).getAttribute('href')!;
    await act(async () => { window.location.hash = href; hashChanged(); });
    await settle();
    const card = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[data-row-id^="proposal:proposal-"]')][0];
      expect(found).toBeTruthy();
      return found!;
    });
    expect(card.textContent).toContain('Publish the titles to YouTube');
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
  }, 15_000);
});
