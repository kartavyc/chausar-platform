import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import { NARROW } from '../../src/shell/useNarrow';

// One pane shows every chat in turn, so what belongs to one chat must not follow the owner into the next: a consent card
// and its waiting words, a refusal, a send still out, and the jump to a new chat once it exists.

type Fake = ReturnType<typeof createFakeClient>;
type Override = (client: Fake) => void;
const NOW = '2026-10-23T10:00:00.000Z';
const CONSENT = 'Chats send your message to Claude Sonnet 5.5 with your key.';

function answer(method: string, reply: (params: Record<string, unknown>, base: (m: string, p?: unknown) => Promise<unknown>) => unknown | Promise<unknown>): Override {
  return (client) => {
    const base = client.request.bind(client) as (m: string, p?: unknown) => Promise<unknown>;
    client.request = (async (m: string, params?: unknown) => (m === method ? reply((params ?? {}) as Record<string, unknown>, base) : base(m, params))) as EngineClient['request'];
  };
}
const both = (...overrides: Override[]): Override => (client) => { for (const override of overrides) override(client); };

async function start(hash: string, override: Override) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? false : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  window.location.hash = hash;
  const fake = createFakeClient(new FakeEngine({ now: () => NOW }));
  override(fake);
  const spy = vi.spyOn(fake, 'request');
  render(<App client={fake} language="en" />);
  await screen.findByRole('navigation', { name: 'Your chats' });
  return { spy };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
async function open(hash: string) {
  await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  await settle();
}
const composer = () => screen.getByRole('textbox', { name: 'Ask Chausar' }) as HTMLTextAreaElement;
async function say(words: string) {
  fireEvent.change(composer(), { target: { value: words } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  await settle();
}
const sends = (spy: { mock: { calls: unknown[][] } }) => (spy.mock.calls.filter(([m]) => m === 'venture.chief.thread.send') as [string, Record<string, unknown>][]).map(([, params]) => params);

/** The engine refuses every send until the owner agrees, and carries the consent on the list, as the engine does. */
function needsConsent(): Override {
  let agreed = false;
  return both(
    answer('venture.chief.thread.send', (params, base) => {
      if (!agreed) throw new EngineError('CHAT_CONSENT_REQUIRED', CONSENT);
      return base('venture.chief.thread.send', params);
    }),
    answer('venture.chief.threads', async (params, base) => ({ ...(await base('venture.chief.threads', params)) as object, consent: agreed ? { state: 'given', text: CONSENT, digest: 'a'.repeat(64), at: NOW } : { state: 'needed', text: CONSENT, digest: 'a'.repeat(64), at: null } })),
    answer('venture.chats.consent', (params) => { agreed = true; return { state: 'given', text: CONSENT, digest: params.digest, at: NOW }; }),
  );
}

describe('a reply in paragraphs', () => {
  it('words after words start a new paragraph; a figure after words follows on the same line', async () => {
    await start('#/chats?thread=chiefthread-billed', answer('venture.chief.thread.list', async (params, base) => {
      const view = (await base('venture.chief.thread.list', params)) as { messages: { from: string; parts: unknown[] }[] };
      const parts = [{ kind: 'text', text: 'First paragraph.' }, { kind: 'estimate', text: 'About 3 more this week.' }, { kind: 'text', text: 'What should I check next?' }];
      return { ...view, messages: view.messages.map((message) => (message.from === 'chief' ? { ...message, parts: [...parts, ...message.parts.filter((part) => (part as { kind: string }).kind === 'figure')] } : message)) };
    }));
    await settle();
    const reply = screen.getAllByText('First paragraph.')[0]!.closest('p')!;
    expect(reply.querySelectorAll('span[class*="paraBreak"]')).toHaveLength(2);
    expect(reply.textContent).toContain('What should I check next?');
  });
});

describe('one chat pane, many chats', () => {
  it('a consent card left open stays with its chat: in the next chat the card is gone and its words wait in the box', async () => {
    const { spy } = await start('#/chats?thread=chiefthread-billed', needsConsent());
    await say('Chase the oldest invoice first?');
    expect(within(screen.getByRole('region', { name: 'Before your first message' })).getByText('Chase the oldest invoice first?')).toBeTruthy();
    await open('#/chats?thread=chiefthread-titles');
    expect(screen.queryByRole('region', { name: 'Before your first message' })).toBeNull();
    expect(composer().value).toBe('Chase the oldest invoice first?');
    expect(sends(spy)).toEqual([{ threadId: 'chiefthread-billed', text: 'Chase the oldest invoice first?' }]);
  });

  it('Agree sends the waiting words into the chat they were written in', async () => {
    const { spy } = await start('#/chats?thread=chiefthread-billed', needsConsent());
    await say('Chase the oldest invoice first?');
    await act(async () => { fireEvent.click(within(screen.getByRole('region', { name: 'Before your first message' })).getByRole('button', { name: 'Agree and send' })); });
    await settle();
    expect(sends(spy)).toEqual([{ threadId: 'chiefthread-billed', text: 'Chase the oldest invoice first?' }, { threadId: 'chiefthread-billed', text: 'Chase the oldest invoice first?' }]);
    expect(window.location.hash).toBe('#/chats?thread=chiefthread-billed');
  });

  it('a second message written while the card shows waits with the first; neither is dropped', async () => {
    const { spy } = await start('#/chats?thread=chiefthread-billed', needsConsent());
    await say('Chase the oldest invoice first?');
    await say('And how late is it?');
    const card = screen.getByRole('region', { name: 'Before your first message' });
    expect(card.textContent).toContain('Chase the oldest invoice first?');
    expect(card.textContent).toContain('And how late is it?');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Agree and send' })); });
    await settle();
    expect(sends(spy).at(-1)).toEqual({ threadId: 'chiefthread-billed', text: 'Chase the oldest invoice first?\nAnd how late is it?' });
  });

  it('an answer to a new chat that comes after the owner opened another chat does not pull them away, and leaves a fresh box', async () => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { spy } = await start('#/chats', answer('venture.chief.thread.send', async (params, base) => { await held; return base('venture.chief.thread.send', params); }));
    await say('How is the month going?');
    expect(sends(spy)).toEqual([{ text: 'How is the month going?' }]);
    await open('#/chats?thread=chiefthread-billed');
    expect(composer().readOnly).toBe(false);
    expect(composer().value).toBe('');
    await act(async () => { release(); });
    await settle();
    expect(window.location.hash).toBe('#/chats?thread=chiefthread-billed');
    // Where the owner stays, a new chat still opens once it exists.
    await open('#/chats');
    await say('And next month?');
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chats\?thread=/));
    expect(window.location.hash).not.toBe('#/chats?thread=chiefthread-billed');
  });
});
