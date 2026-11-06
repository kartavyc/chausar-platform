import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError } from '../../src/engine/types';
import type { Language } from '../../src/text';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * W4 4J22b on Today, from 4J18 (catalogue A11): ideas and who is waiting on you, folded at the end of the page. Code
 * makes each idea from the business's own records (an invoice past its due day, an order delivered with no invoice,
 * an order with no run a day after it came in) and shows the records it rests on. An idea is a suggestion only:
 * Start drafts a proposal and nothing reaches Today until the owner puts it there; Dismiss sets it aside for good.
 * "Waiting on you" lists only real records (orders and unanswered mail), newest first, each opening where it is.
 */

type Fake = ReturnType<typeof createFakeClient>;
/** After INV-0039's due day (28 Oct 2026): the sample's overdue invoice makes an idea. */
const LATE = '2026-11-02T06:30:00.000Z';
/** Before it: no rule holds for the sample, so there is no idea. */
const EARLY = '2026-10-21T12:00:00.000Z';

function start({ now = LATE, language = 'en', pipelineDue, stub }: { now?: string; language?: Language; pipelineDue?: boolean; stub?: (method: string) => unknown } = {}) {
  window.location.hash = '#/today';
  const client = createFakeClient(new FakeEngine({ now: () => now, ...(pipelineDue ? { pipelineDue } : {}) }));
  const request = client.request.bind(client);
  const spy = vi.fn(async (method: string, params?: unknown) => {
    const stubbed = stub?.(method);
    if (stubbed instanceof Error) throw stubbed;
    return stubbed === undefined ? request(method as never, params as never) : stubbed;
  });
  client.request = spy as unknown as Fake['request'];
  render(<ClockProvider now={() => new Date(now)}><App client={client} language={language} /></ClockProvider>);
  return { spy, request };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);

/** The fold, opened as the owner opens it (its summary). */
async function openFold(name: RegExp): Promise<HTMLElement> {
  const summary = await screen.findByText(name, { selector: 'summary *, summary' });
  const fold = summary.closest('details') as HTMLDetailsElement;
  await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
  await settle();
  return fold;
}

afterEach(() => { window.location.hash = ''; });

describe('Today: ideas, folded at the end (W4 4J22b, from 4J18)', () => {
  it('a refused Start says why at the fold, and the words stay once the list is read again', async () => {
    let gone = false;
    start({ stub: (method) => {
      if (method === 'venture.ideas.start') { gone = true; return new EngineError('IDEA_RETIRED', 'This idea no longer holds: what it was based on changed. Nothing was started.'); }
      if (method === 'venture.ideas.list' && gone) return { ideas: [], waiting: [] };
      return undefined;
    } });
    const fold = await openFold(/^Ideas$/);
    await press(within(fold).getByRole('button', { name: 'Start' }));
    await settle();
    expect(within(fold).queryByRole('article')).toBeNull();
    expect(within(fold).getByRole('alert').textContent).toBe('This idea no longer holds: what it was based on changed. Nothing was started.');
  });

  it('stays folded at rest, after Working now and Earlier, with how many there are', async () => {
    start();
    const fold = (await screen.findByText(/^Ideas$/, { selector: 'summary *' })).closest('details') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toMatch(/Ideas\s*1/);
    // At the end of the page: nothing of Today comes after the folds.
    const main = screen.getByRole('main');
    const folds = [...main.querySelectorAll('details[data-today-fold]')];
    expect(folds.at(-1)!.compareDocumentPosition(main.querySelector('[data-row]')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    assertInkRules(document.body);
  });

  it('each idea shows why and the records it rests on, from code', async () => {
    start();
    const fold = await openFold(/^Ideas$/);
    const idea = within(fold).getByRole('article', { name: 'Remind Boat Audio about INV-0039' });
    expect(idea.textContent).toContain('INV-0039 was due on 28 Oct 2026 and is not paid in full.');
    expect(within(idea).getByRole('list', { name: 'Based on' }).textContent).toContain('INV-0039 for Boat Audio, due 28 Oct 2026.');
    expect(within(idea).getByRole('button', { name: 'Start' }).getAttribute('data-variant')).toBe('primary');
    expect(within(idea).getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    assertInkRules(document.body);
  });

  it('Start only drafts a proposal: nothing reaches Today until the owner puts it there', async () => {
    const { spy, request } = start();
    const fold = await openFold(/^Ideas$/);
    const idea = within(fold).getByRole('article', { name: 'Remind Boat Audio about INV-0039' });
    const proposals = async () => (await request('venture.queue.list', { scope: 'all' })).rows.filter((row) => row.kind === 'proposal');
    expect(await proposals()).toEqual([]);
    await press(within(idea).getByRole('button', { name: 'Start' }));
    expect(calls(spy, 'venture.ideas.start')).toEqual([{ id: expect.stringMatching(/^idea_/) }]);
    expect(within(idea).getByRole('status').textContent).toBe('Drafted. Put it on Today when you are ready: nothing changes until you approve it there.');
    expect(calls(spy, 'venture.proposals.raise')).toEqual([]);
    expect(await proposals()).toEqual([]);
    await press(within(idea).getByRole('button', { name: 'Put on Today' }));
    expect(calls(spy, 'venture.proposals.raise')).toHaveLength(1);
    const raised = await proposals();
    expect(raised).toHaveLength(1);
    expect(within(idea).getByRole('link', { name: 'On Today' }).getAttribute('href')).toBe(`#/today?row=${encodeURIComponent(raised[0]!.id)}`);
  });

  it('Dismiss sets the idea aside for good, in the engine\'s words', async () => {
    const { spy } = start();
    const fold = await openFold(/^Ideas$/);
    const idea = within(fold).getByRole('article', { name: 'Remind Boat Audio about INV-0039' });
    await press(within(idea).getByRole('button', { name: 'Dismiss' }));
    expect(calls(spy, 'venture.ideas.dismiss')).toHaveLength(1);
    expect(within(fold).getByRole('status').textContent).toBe("Dismissed. Chausar won't suggest this again.");
    expect(within(fold).queryByRole('article', { name: 'Remind Boat Audio about INV-0039' })).toBeNull();
  });

  it('with no idea, there is no Ideas fold at all', async () => {
    start({ now: EARLY });
    await screen.findByText(/^Waiting on you$/, { selector: 'summary *' });
    expect(screen.queryByText(/^Ideas$/, { selector: 'summary *' })).toBeNull();
  });
});

describe('Today: who is waiting on you (W4 4J22b, from 4J18)', () => {
  it('lists only real records, each opening where it is', async () => {
    start({ now: EARLY });
    const fold = await openFold(/^Waiting on you$/);
    const line = within(fold).getByRole('link', { name: 'For Boat Audio: the new price and the episode draft wait on you.' });
    expect(line.getAttribute('href')).toBe('#/work?order=o-boat-14');
    assertInkRules(document.body);
  });

  it('lists mail the owner answers themselves, newest first, each opening its reply card on Today', async () => {
    const { request } = start({ now: EARLY, pipelineDue: true });
    const fold = await openFold(/^Waiting on you$/);
    const links = within(fold).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Tara Iyer wrote on 21 Oct 2026 and waits for your reply.',
      'For Boat Audio: the new price and the episode draft wait on you.',
    ]);
    expect(links[0]!.getAttribute('href')).toMatch(/^#\/today\?row=reply%3Ainbound_\w+$/);
    const rowId = decodeURIComponent(links[0]!.getAttribute('href')!.split('row=')[1]!);
    expect((await request('venture.queue.list', { scope: 'all' })).rows.some((row) => row.id.startsWith(`${rowId}:`))).toBe(true);
    assertInkRules(document.body);
  });

  it('is worded in Hindi around the engine\'s own lines', async () => {
    start({ language: 'hi' });
    expect(await screen.findByText('आपका इंतज़ार', { selector: 'summary *' })).toBeTruthy();
    expect(screen.getByText('सुझाव', { selector: 'summary *' })).toBeTruthy();
  });
});
