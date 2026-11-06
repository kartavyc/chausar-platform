import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { GUIDE_SECTIONS, GUIDE_URL, findGuide } from '../../src/shell/help';
import { notesFor } from '../../src/shell/WhatsNew';

/**
 * C7 tasks 24 and 27: Help quotes Chausar's own guide (code search, top three, the section's words as written, a link
 * to that part of the guide), and What's new shows once after an update, never on a fresh install or with no notes.
 */
function start(options: { seenVersion?: string } = {}, hash = '#/today') {
  window.location.hash = hash;
  const engine = new FakeEngine(options);
  const client = createFakeClient(engine);
  const calls: string[] = [];
  const request = client.request.bind(client);
  client.request = ((method: never, params?: never) => { calls.push(method); return request(method, params as never); }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { calls };
}

describe('C7: help from the guide', () => {
  it('findGuide is code only: title words first, top three; nothing for words the guide never uses', () => {
    expect(findGuide('how do I connect Codex')[0]!.anchor).toBe('chatgpt-plan-codex');
    expect(findGuide('how do I connect Codex').length).toBeLessThanOrEqual(3);
    expect(findGuide('zebra quantum')).toEqual([]);
  });

  it("the Help button opens the sheet; a question shows part 2's ChatGPT plan section word for word with its link", async () => {
    start();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Help' })); });
    const sheet = (await screen.findByRole('heading', { name: 'Help' })).closest('aside, section, div[class]') as HTMLElement;
    const box = await screen.findByLabelText('What do you want to do?');
    fireEvent.change(box, { target: { value: 'how do I connect Codex' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Find it' })); });
    const section = GUIDE_SECTIONS.find((item) => item.anchor === 'chatgpt-plan-codex')!;
    const quote = document.querySelector('[data-help-section="chatgpt-plan-codex"] blockquote[data-content]')!;
    expect(quote.textContent).toBe(section.text);
    const link = screen.getByRole('link', { name: 'Read it in the guide' });
    expect(link.getAttribute('href')).toBe(`${GUIDE_URL}#chatgpt-plan-codex`);
    expect(sheet).toBeTruthy();
  }, 30_000);

  it('no match shows the plain line and the guide link only', async () => {
    start();
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Help' })); });
    fireEvent.change(await screen.findByLabelText('What do you want to do?'), { target: { value: 'zebra quantum' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Find it' })); });
    const none = document.querySelector('[data-help-none]')!;
    expect(none.textContent).toBe("The guide doesn't cover that yet. Open the guide");
    expect(within(none as HTMLElement).getByRole('link').getAttribute('href')).toBe(GUIDE_URL);
    expect(document.querySelector('[data-help-section]')).toBeNull();
  }, 30_000);
});

describe("C7: What's new, once per version", () => {
  it('the running version has a notes entry (it may be empty)', () => {
    expect(Array.isArray(notesFor('0.1.0-preview.1'))).toBe(true);
  });

  it('shown once after an update; Close marks it seen and it does not come back', async () => {
    const { calls } = start({ seenVersion: '0.0.9' });
    const lines = notesFor('0.1.0-preview.1');
    expect(lines.length).toBeGreaterThan(0);
    expect(await screen.findByText(lines[0]!)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!); });
    await waitFor(() => expect(calls).toContain('whatsNew.seen'));
    await waitFor(() => expect(screen.queryByText(lines[0]!)).toBeNull());
  });

  it('never on a fresh install', async () => {
    start();
    await screen.findByRole('button', { name: 'Help' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(notesFor('0.1.0-preview.1')[0]!)).toBeNull();
  });
});
