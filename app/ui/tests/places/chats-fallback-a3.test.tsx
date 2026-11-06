import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NARROW } from '../../src/shell/useNarrow';
import type { ChiefSendResult } from '../../src/engine/types';
import { assertFiguresProved, assertInkRules } from '../helpers/ink-rules';

/*
 * One-shot A3 (S3): when the owner's AI call fails, Chats still answers from the business's own records. It says plainly
 * that the AI couldn't answer, says why when the failure has owner words, and shows what the records say, every figure
 * with its receipt, and the counts by code. No red error, and the question is not left in the box.
 */

const NOW = '2026-10-23T10:00:00.000Z';
const LEAD = "Your AI couldn't answer this time, so here is what Chausar's records say.";
const USED_UP = 'Codex has used up your plan for now. Wait for it to reset, or choose another AI under Connections, Your AI.';

function stubWidth() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? false : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

async function ask(engine: FakeEngine, words: string) {
  window.location.hash = '#/chats';
  render(<App client={createFakeClient(engine)} language="en" />);
  const box = await screen.findByRole('textbox', { name: 'Ask Chausar' }) as HTMLTextAreaElement;
  await act(async () => { fireEvent.change(box, { target: { value: words } }); });
  const form = box.closest('form')!;
  await act(async () => { fireEvent.submit(form); });
  await act(async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

describe('Chats when the AI call fails (A3, S3)', () => {
  it('answers from the records: the plain lead, the failure\'s own words, receipted figures and the counts by code', async () => {
    stubWidth();
    const engine = new FakeEngine({ now: () => NOW });
    engine.chatAiFails({ reason: USED_UP });
    await ask(engine, 'How is money this month?');
    const log = await screen.findByRole('log');
    await waitFor(() => expect(within(log).getByText(LEAD)).toBeTruthy());
    expect(within(log).getByText(USED_UP)).toBeTruthy();
    const figures = assertFiguresProved(log);
    expect(figures.length).toBeGreaterThan(0);
    expect(log.querySelector('[data-counted]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Ask Chausar' }) as HTMLTextAreaElement).value).toBe('');
    assertInkRules(document.body);
  });

  it('a failure with no owner words of its own gets the lead alone; the AI answering again is the AI\'s answer', async () => {
    stubWidth();
    const engine = new FakeEngine({ now: () => NOW });
    engine.chatAiFails({ reason: null });
    await ask(engine, 'How is money this month?');
    const log = await screen.findByRole('log');
    await waitFor(() => expect(within(log).getByText(LEAD)).toBeTruthy());
    expect(within(log).queryByText(USED_UP)).toBeNull();
    engine.chatAiFails(null);
    const reply = await engine.request('venture.chief.thread.send', { text: 'And now?' }) as ChiefSendResult;
    expect(reply.added[1]!.parts[0]).not.toEqual({ kind: 'text', text: LEAD });
  });
});
