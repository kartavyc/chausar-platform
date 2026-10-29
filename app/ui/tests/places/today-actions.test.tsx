import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { DELIVERIES, QUEUE } from '../../src/engine/fixtures';
import { EngineError, type DeliveryLite, type DraftChangesView, type QueueRow } from '../../src/engine/types';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * W4 4J19 on Today: the engine's previews on the big cards (4J3), Send back with the owner's words and the fix after
 * failed checks, Edit with its merge and replacement choices, Undo, Approve several with nothing preselected and no
 * approve all, Sort Today by, the "Since you left" filter, needs-you notices as compact cards whose Open goes where the
 * engine says, and an agent's question card. Each talks to the fake engine, which answers with the engine's codes and
 * words.
 */

type Seed = Omit<QueueRow, 'digest'>;
type Fake = ReturnType<typeof createFakeClient>;
const NOW = '2026-10-21T12:00:00.000Z';

function start(options: { queue?: Seed[]; stub?: (method: string, params: unknown) => unknown; now?: string } = {}) {
  window.location.hash = '#/today';
  const now = options.now ?? NOW;
  const client = createFakeClient(new FakeEngine({ now: () => now, ...(options.queue ? { queue: options.queue } : {}) }));
  const request = client.request.bind(client);
  const spy = vi.fn(async (method: string, params?: unknown) => {
    const stubbed = options.stub?.(method, params);
    return stubbed === undefined ? request(method as never, params as never) : structuredClone(stubbed);
  });
  client.request = spy as unknown as Fake['request'];
  render(<ClockProvider now={() => new Date(now)}><App client={client} language="en" /></ClockProvider>);
  return { client, spy };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); await settle(); };
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
/** A card by its title. Today shows the five most urgent cards (4Z3); one behind the fold is shown first. */
const cardTitled = async (title: string | RegExp) => {
  await waitFor(() => expect(document.querySelector('[data-row]')).not.toBeNull());
  if (!screen.queryByRole('heading', { level: 3, name: title })) {
    const more = screen.queryByRole('button', { name: /^Show [0-9]+ more$/ });
    if (more) fireEvent.click(more);
  }
  return (await screen.findByRole('heading', { level: 3, name: title })).closest('article') as HTMLElement;
};

afterEach(() => { window.location.hash = ''; });

describe('Today: the engine\'s previews on the cards (4J3)', () => {
  it('the video ground shows duration, chapters and "3 checks passed", and no still the engine did not take', async () => {
    start();
    const card = await cardTitled('Episode 14 is cut');
    const frame = card.querySelector('[data-preview="video"]')!;
    expect(frame.querySelector('[data-duration]')!.textContent).toContain('11:42');
    expect(frame.querySelector('[data-chapters]')!.textContent).toBe('5 chapters');
    expect(frame.querySelector('img')).toBeNull();
    expect(card.querySelector('[data-checks]')!.textContent).toBe('3 checks passed');
    assertInkRules(document.body);
  });

  it('a still shows only when the engine sent one, as the engine\'s own image', async () => {
    const src = 'data:image/jpeg;base64,/9j/AAAA';
    const draft = QUEUE.find((row) => row.id === 'run:d-ep14:review-1')!;
    start({ queue: [{ ...draft, preview: { kind: 'video', title: { text: 'Episode 14' }, format: 'long', checks: { passed: 2, run: 3, notRun: 1 }, poster: { uploadId: 'up-poster', src } } }] });
    const card = await cardTitled('Episode 14 is cut');
    expect(card.querySelector<HTMLImageElement>('[data-poster]')!.getAttribute('src')).toBe(src);
    expect(card.querySelector('[data-checks]')!.textContent).toBe('2 of 3 checks passed · 1 not run');
  });

  it('an invoice is paper lines in DM Mono with the total\'s receipt; a post has its exact text and counts; a choice labels each model estimate', async () => {
    // The invoice and the sign-off on their own, so each is one of the five full cards (4Z3) with its paper.
    start({ queue: QUEUE.filter((row) => row.id === 'q-invoice-mehta' || row.id === 'q-signoff-gst') });
    const invoice = await cardTitled('Invoice INV-0042 to Mehta Traders');
    const paper = invoice.querySelector('[data-preview="paper"]')!;
    expect([...paper.querySelectorAll('li .mono')].map((n) => n.textContent)).toEqual(['₹16,000.00', '₹1,440.00', '₹1,440.00']);
    expect(paper.querySelector('[data-figure-group] [data-receipt="R-0419"]')).not.toBeNull();
    // The line already says when it is due, and the title who it is to: neither is said twice (4J19 review).
    expect(invoice.querySelector('[data-due]')).toBeNull();
    expect(invoice.querySelector('[data-meta-client]')).toBeNull();
    const signoff = await cardTitled('GST working for September');
    expect(signoff.querySelector('[data-signer]')).toBeNull();
    assertInkRules(document.body);

    // The post and the title question sit past the five full cards in the sample: shown on their own, they are full.
    document.body.innerHTML = '';
    start({ queue: QUEUE.filter((row) => row.id === 'post:linkedin-ep13:v1' || row.id === 'q-question-title') });
    const post = await cardTitled('Post to X');
    expect(post.querySelector('[data-preview="post"] [data-content]')!.textContent).toContain('We tested five budget mics in one room.');
    expect(post.querySelector('[data-sends-to="public"]')!.textContent).toBe('Goes public');
    // 4Z2: far under the platform's limit, the count is not shown.
    expect(post.querySelector('[data-count-of]')).toBeNull();

    const question = await cardTitled('Which title for episode 15?');
    const estimate = question.querySelector('[data-option-estimate]')!;
    expect(estimate.textContent).toContain('Views in 30 days, option B');
    expect(estimate.querySelector('[data-estimate]')!.textContent).toContain('12,000 to 18,000');
    assertInkRules(document.body);
    assertOnePrimary(document.body);
  });

  it('a draft names the engine that wrote it', async () => {
    const row: Seed = {
      id: 'q-script', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
      title: 'Sponsor script for episode 14', line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    };
    start({ queue: [row], stub: (method) => (method === 'venture.delivery.list' ? DELIVERIES.lumen!.map((run) => (run.id === 'd-ep14-script' ? { ...run, writtenBy: 'Written by Claude Sonnet 5.5' } : run)) : undefined) });
    const card = await cardTitled('Sponsor script for episode 14');
    await waitFor(() => expect(card.querySelector('[data-written-by]')?.textContent).toBe('Written by Claude Sonnet 5.5'));
  });

  it('reads the draft replies once for the page, not per card, and not again on every step; again when a run finishes', async () => {
    const draft = (id: string, title: string): Seed => ({
      id, businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
      title, line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    });
    const { spy, client } = start({ queue: [draft('q-a', 'Script A'), draft('q-b', 'Script B')] });
    await cardTitled('Script B');
    await settle();
    const lists = () => calls(spy, 'venture.delivery.list').length;
    expect(lists()).toBe(1);
    expect(calls(spy, 'venture.delivery.changes')).toEqual([{ runId: 'd-ep14-script' }]);
    await act(async () => { client.engine.emit({ type: 'run.step', businessId: 'lumen', runId: '31', at: NOW }); });
    await settle();
    expect(lists()).toBe(1);
    await act(async () => { client.engine.emit({ type: 'run.done', businessId: 'lumen', runId: '31', at: NOW }); });
    await settle();
    expect(lists()).toBe(2);
    // A run that comes to wait on the owner (a revision for review, a fix) may have a new draft: read again.
    await act(async () => { client.engine.emit({ type: 'run.waiting', businessId: 'lumen', runId: '31', at: NOW }); });
    await settle();
    expect(lists()).toBe(3);
  });

  it('an agent\'s question card shows each answer\'s gains and costs, the recommended one first, and Use fills the answer box', async () => {
    const row: Seed = {
      id: 'q-card', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Researcher', kind: 'question', createdAt: '2026-10-21T09:45:00.000Z',
      title: 'Two questions about episode 15', line: 'Answer in one line.',
      actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'answer', label: 'Answer', primary: true }],
      preview: {
        kind: 'choice', question: { text: 'Two questions about episode 15' }, options: [],
        card: {
          round: 1, lead: 'Two quick ones before I cut.', freeText: true, escape: 'Or say skip and I will decide.', example: '1 A, 2 B',
          items: [{ number: 1, text: 'Which title?', guess: 'B', options: [
            { label: 'B', text: 'The budget mic that won', gains: 'More clicks', costs: 'Less clear', recommended: true },
            { label: 'A', text: 'I tried every budget mic', gains: 'Clear', costs: 'Fewer clicks', recommended: false },
          ] }],
        },
      },
    };
    start({ queue: [row] });
    const card = await cardTitled('Two questions about episode 15');
    const question = card.querySelector('[data-question-card]')!;
    const options = question.querySelectorAll('li li');
    expect(options[0]!.hasAttribute('data-recommended')).toBe(true);
    expect(options[0]!.textContent).toContain('Recommended');
    expect(options[0]!.textContent).toContain('Gains: More clicks');
    expect(options[0]!.textContent).toContain('Costs: Less clear');
    await press(within(question as HTMLElement).getByRole('button', { name: 'Use 1 B' }));
    expect((within(card).getByRole('textbox', { name: 'Your answer' }) as HTMLInputElement).value).toBe('1 B');
  });
});

describe('Today: a working paper\'s receipt from the work tools (4J19 review)', () => {
  it('a figure whose receipt is a work receipt opens it through venture.work.get, in the receipt sheet', async () => {
    const row: Seed = {
      id: 'q-working', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Bookkeeper', kind: 'signoff', createdAt: '2026-10-21T09:10:00.000Z',
      title: 'Totals for September', line: 'Read the working before it goes on.', viewRef: { kind: 'file', id: 'ca-req-gst-sep' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'send-to-ca', label: 'Send to CA', primary: true, requiresView: true }],
      preview: {
        kind: 'paper', paper: 'working', title: 'Totals for September', client: null, more: 0, signer: null,
        working: [{ label: 'Sales in September', value: '₹16,000.00', receiptId: 'wr-sept', receiptKind: 'work' }],
      },
    };
    const work = {
      id: 'wr-sept', at: '2026-10-21T09:00:00.000Z', operation: 'work.sum', currency: 'INR', explanation: 'Added the 4 sales rows of the September register.',
      figures: [{ key: 'total', label: 'Sales in September', minor: '1600000', display: '₹16,000.00', currency: 'INR', unit: 'money' }],
      steps: [{ op: 'add', inputs: ['r1', 'r2', 'r3', 'r4'], result: 'total', rule: 'sum of the amount column' }],
    };
    const { spy } = start({ queue: [row], stub: (method) => (method === 'venture.work.get' ? work : undefined) });
    const card = await cardTitled('Totals for September');
    const chip = card.querySelector<HTMLElement>('[data-receipt="wr-sept"]')!;
    expect(chip.getAttribute('data-receipt-source')).toBe('work');
    await press(chip);
    expect(calls(spy, 'venture.work.get')).toEqual([{ id: 'wr-sept' }]);
    expect(calls(spy, 'venture.receipt.get')).toEqual([]);
    const sheet = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-receipt-sheet]');
      expect(found?.textContent).toContain('Added the 4 sales rows of the September register.');
      return found!;
    });
    expect(sheet.textContent).toContain('₹16,000.00');
    assertInkRules(document.body);
  });
});

describe('Today: send back, edit and undo (O5, O6)', () => {
  it('Send back opens a box prefilled "Revise this to ", sends the owner\'s words as typed, and Undo restores the draft', async () => {
    const { spy } = start();
    const card = await cardTitled('Episode 14 is cut');
    await press(within(card).getByRole('button', { name: 'Send back' }));
    const box = card.querySelector<HTMLElement>('[data-send-back]')!;
    const field = within(box).getByRole('textbox', { name: 'What to change' }) as HTMLTextAreaElement;
    expect(field.value).toBe('Revise this to ');
    // One primary on the card while the box is open: the card's own buttons step aside.
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull();
    assertOnePrimary(document.body);
    fireEvent.change(field, { target: { value: 'Revise this to cut the intro to 20 seconds' } });
    await press(within(box).getByRole('button', { name: 'Send back' }));
    expect(calls(spy, 'venture.queue.sendBack')).toEqual([{ rowId: 'run:d-ep14:review-1', digest: expect.any(String), text: 'Revise this to cut the intro to 20 seconds' }]);
    const decided = document.querySelector<HTMLElement>('[data-row-id="run:d-ep14:review-1"][data-decided]')!;
    expect(decided.textContent).toContain('Sent back. The revision waits for your approval before anything goes to your AI.');
    await press(within(decided).getByRole('button', { name: 'Undo' }));
    expect(calls(spy, 'venture.queue.undo')).toEqual([{ rowId: 'run:d-ep14:review-1' }]);
    expect(document.querySelector('[data-row-id="run:d-ep14:review-1"]')!.textContent).toContain('Restored until you edit this again.');
    // The draft is back as a new version, after the cards already on the page (here, behind the fold).
    const fold = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-more]'); expect(found).not.toBeNull(); return found!; });
    const needs = fold.closest('section')!;
    await press(within(fold).getByRole('button', { name: /^Show [0-9]+ more$/ }));
    const rows = [...needs.querySelectorAll<HTMLElement>('[data-row-id]')];
    expect(rows.slice(5).some((row) => !row.hasAttribute('data-decided') && (row.textContent ?? '').includes('Episode 14 is cut'))).toBe(true);
    assertInkRules(document.body);
  });

  it('empty words are refused in the engine\'s words', async () => {
    start();
    const card = await cardTitled('Episode 14 is cut');
    await press(within(card).getByRole('button', { name: 'Send back' }));
    const box = card.querySelector<HTMLElement>('[data-send-back]')!;
    const send = () => within(box).getByRole('button', { name: 'Send back' }) as HTMLButtonElement;
    // Only the words it starts with: nothing to send yet.
    expect((within(box).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Revise this to ');
    expect(send().disabled).toBe(true);
    fireEvent.change(within(box).getByRole('textbox'), { target: { value: '  ' } });
    expect(send().disabled).toBe(true);
    fireEvent.change(within(box).getByRole('textbox'), { target: { value: 'Revise this to ' } });
    expect(send().disabled).toBe(true);
    fireEvent.change(within(box).getByRole('textbox'), { target: { value: 'Revise this to say the price' } });
    expect(send().disabled).toBe(false);
  });

  it('the box starts in Hindi in Hindi', async () => {
    window.location.hash = '#/today';
    const client = createFakeClient(new FakeEngine({ now: () => NOW }));
    render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="hi" /></ClockProvider>);
    const card = (await screen.findByRole('heading', { level: 3, name: 'Episode 14 is cut' })).closest('article') as HTMLElement;
    await press(within(card).getByRole('button', { name: 'वापस भेजें' }));
    const box = card.querySelector<HTMLElement>('[data-send-back]')!;
    expect((within(box).getByRole('textbox') as HTMLTextAreaElement).value).toBe('इसे ऐसे बदलें: ');
  });

  it('after failed checks it asks "Fix all, or tell me which?" and a pick calls venture.delivery.fix', async () => {
    const row: Seed = {
      id: 'q-script', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
      title: 'Sponsor script for episode 14', line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    };
    const failing = (list: DeliveryLite[]) => list.map((run) => (run.id === 'd-ep14-script'
      ? { ...run, checks: [{ check: 'length-bounds', passed: false, detail: 'The draft is 40 words over the limit.' }, { check: 'house-style', passed: false, detail: 'Two long dashes.' }] } : run));
    const real = DELIVERIES.lumen!;
    // The fake's own draft passed its checks, so the list and the fix answer here as the engine would for a failing one.
    const { spy } = start({ queue: [row], stub: (method) => (method === 'venture.delivery.list' ? failing(real) : method === 'venture.delivery.fix' ? { ...failing(real)[0], status: 'waiting-for-you' } : undefined) });
    const card = await cardTitled('Sponsor script for episode 14');
    await press(within(card).getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(card.querySelector('[data-fix]')).not.toBeNull());
    const fix = card.querySelector<HTMLElement>('[data-fix]')!;
    expect(within(fix).getByText('Fix all, or tell me which?')).toBeTruthy();
    fireEvent.click(within(fix).getByRole('checkbox', { name: 'Two long dashes.' }));
    await press(within(fix).getByRole('button', { name: 'Fix the ones ticked' }));
    expect(spy.mock.calls.find(([method]) => method === 'venture.delivery.fix')![1]).toEqual({ runId: 'd-ep14-script', checks: ['house-style'] });
    expect(document.querySelector('[data-row-id="q-script"]')!.textContent).toContain('Sent back to fix what the checks found.');
  });

  it('Edit opens the draft\'s text; Save keeps the owner\'s version (venture.queue.edit), and the draft comes back for review', async () => {
    const row: Seed = {
      id: 'q-script', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
      title: 'Sponsor script for episode 14', line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    };
    const { spy } = start({ queue: [row] });
    const card = await cardTitled('Sponsor script for episode 14');
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Edit' })).toBeTruthy());
    await press(within(card).getByRole('button', { name: 'Edit' }));
    const sheet = await screen.findByRole('dialog', { name: /Sponsor script for episode 14/ }).catch(() => document.querySelector<HTMLElement>('[data-sheet]')!);
    const text = await within(sheet).findByRole('textbox', { name: 'Your version' }) as HTMLTextAreaElement;
    expect(text.value).toBe('This episode is brought to you by Boat Audio.\n\nWe tested five budget mics in one room, and the one that won costs less than you think.');
    expect(text.closest('[data-content]') ?? text).toBeTruthy();
    fireEvent.change(text, { target: { value: 'This episode is brought to you by Boat Audio.\n\nFive budget mics, one room, one winner.' } });
    await press(within(sheet).getByRole('button', { name: 'Save my version' }));
    expect(calls(spy, 'venture.queue.edit')).toEqual([{ rowId: 'q-script', digest: expect.any(String), text: 'This episode is brought to you by Boat Audio.\n\nFive budget mics, one room, one winner.' }]);
    const decided = document.querySelector<HTMLElement>('[data-row-id="q-script"][data-decided]')!;
    expect(decided.textContent).toContain('Your version is kept. Approve it when it is ready.');
    expect(within(decided).getByRole('button', { name: 'Undo' })).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('article[data-card] h3')).toHaveLength(1));
  });

  it('a stale save reads the draft again and shows the newer version; Save waits until the owner has read it', async () => {
    const row: Seed = {
      id: 'q-script', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
      title: 'Sponsor script for episode 14', line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    };
    let revised = false;
    const NEWER = 'This episode is brought to you by Boat Audio.\n\nThe agent rewrote this part since you opened it.';
    const { spy, client } = start({
      queue: [row],
      stub: (method) => (method === 'venture.delivery.list' && revised ? DELIVERIES.lumen!.map((run) => (run.id === 'd-ep14-script' ? { ...run, renderedText: NEWER } : run)) : undefined),
    });
    const card = await cardTitled('Sponsor script for episode 14');
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Edit' })).toBeTruthy());
    await press(within(card).getByRole('button', { name: 'Edit' }));
    const sheet = document.querySelector<HTMLElement>('[data-sheet]')!;
    const text = await within(sheet).findByRole('textbox', { name: 'Your version' }) as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: 'My own words.' } });
    // The agent's newer version lands meanwhile: the row has a new digest.
    revised = true;
    act(() => { client.engine.touch('q-script'); });
    await press(within(sheet).getByRole('button', { name: 'Save my version' }));
    const shown = await waitFor(() => {
      const found = sheet.querySelector<HTMLElement>('[data-new-version]');
      expect(found?.textContent).toContain('The agent rewrote this part since you opened it.');
      return found!;
    });
    expect(shown.querySelector('[data-content]')).not.toBeNull();
    expect((within(sheet).getByRole('textbox', { name: 'Your version' }) as HTMLTextAreaElement).value).toBe('My own words.');
    const save = within(sheet).getByRole('button', { name: 'Save my version' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    await press(save);
    expect(calls(spy, 'venture.queue.edit')).toHaveLength(1);
    await press(within(shown).getByRole('button', { name: "I've read it" }));
    await press(within(sheet).getByRole('button', { name: 'Save my version' }));
    const edits = calls(spy, 'venture.queue.edit');
    expect(edits).toHaveLength(2);
    expect(edits[1]!.digest).not.toBe(edits[0]!.digest);
    expect(edits[1]!.text).toBe('My own words.');
  });

  it('when the newer version cannot be read after a stale save, Save stays locked until Try again shows it', async () => {
    const row: Seed = {
      id: 'q-script', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
      title: 'Sponsor script for episode 14', line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    };
    let revised = false;
    let readable = false;
    const NEWER = 'This episode is brought to you by Boat Audio.\n\nRead again after a failed load.';
    const { spy, client } = start({
      queue: [row],
      stub: (method) => {
        if (method !== 'venture.delivery.list' || !revised) return undefined;
        if (!readable) throw new Error('offline');
        return DELIVERIES.lumen!.map((run) => (run.id === 'd-ep14-script' ? { ...run, renderedText: NEWER } : run));
      },
    });
    const card = await cardTitled('Sponsor script for episode 14');
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Edit' })).toBeTruthy());
    await press(within(card).getByRole('button', { name: 'Edit' }));
    const sheet = document.querySelector<HTMLElement>('[data-sheet]')!;
    const text = await within(sheet).findByRole('textbox', { name: 'Your version' }) as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: 'My own words.' } });
    revised = true;
    act(() => { client.engine.touch('q-script'); });
    await press(within(sheet).getByRole('button', { name: 'Save my version' }));
    const missing = await waitFor(() => {
      const found = sheet.querySelector<HTMLElement>('[data-new-version]');
      expect(found?.textContent).toContain('The newer version could not be read.');
      return found!;
    });
    const save = within(sheet).getByRole('button', { name: 'Save my version' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(within(missing).queryByRole('button', { name: "I've read it" })).toBeNull();
    await press(save);
    expect(calls(spy, 'venture.queue.edit')).toHaveLength(1);
    readable = true;
    await press(within(missing).getByRole('button', { name: 'Try again' }));
    const shown = await waitFor(() => {
      const found = sheet.querySelector<HTMLElement>('[data-new-version]');
      expect(found?.textContent).toContain('Read again after a failed load.');
      return found!;
    });
    await press(within(shown).getByRole('button', { name: "I've read it" }));
    await press(within(sheet).getByRole('button', { name: 'Save my version' }));
    expect(calls(spy, 'venture.queue.edit')).toHaveLength(2);
  });

  it('a stale save under a new version id saves against that version, and only after the reloaded text is shown and read', async () => {
    const row: Seed = {
      id: 'run:d-ep14-script:review-1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
      title: 'Sponsor script for episode 14', line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    };
    let revised = false;
    const NEWER = 'This episode is brought to you by Boat Audio.\n\nA newer version under a new review.';
    const { spy, client } = start({
      queue: [row],
      stub: (method) => (method === 'venture.delivery.list' && revised ? DELIVERIES.lumen!.map((run) => (run.id === 'd-ep14-script' ? { ...run, renderedText: NEWER } : run)) : undefined),
    });
    const card = await cardTitled('Sponsor script for episode 14');
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Edit' })).toBeTruthy());
    await press(within(card).getByRole('button', { name: 'Edit' }));
    const sheet = document.querySelector<HTMLElement>('[data-sheet]')!;
    const text = await within(sheet).findByRole('textbox', { name: 'Your version' }) as HTMLTextAreaElement;
    fireEvent.change(text, { target: { value: 'My own words.' } });
    // Meanwhile the draft comes back as a new version, under a new row id with the same subject (as the engine's reopen).
    const listed = (await client.request('venture.queue.list', { scope: 'all' })).rows.find((item) => item.id === row.id)!;
    await act(async () => {
      await client.request('venture.queue.sendBack', { rowId: row.id, digest: listed.digest, text: 'Revise this to say less' });
      await client.request('venture.queue.undo', { rowId: row.id });
    });
    revised = true;
    await press(within(sheet).getByRole('button', { name: 'Save my version' }));
    const latest = (await client.request('venture.queue.list', { scope: 'all' })).rows.find((item) => item.title === row.title)!;
    expect(latest.id).not.toBe(row.id);
    const shown = await waitFor(() => {
      const found = sheet.querySelector<HTMLElement>('[data-new-version]');
      expect(found?.textContent).toContain('A newer version under a new review.');
      return found!;
    });
    expect(shown.textContent).not.toContain('the one that won costs less than you think');
    await press(within(shown).getByRole('button', { name: "I've read it" }));
    await press(within(sheet).getByRole('button', { name: 'Save my version' }));
    const edits = calls(spy, 'venture.queue.edit');
    expect(edits).toHaveLength(2);
    expect(edits[1]).toEqual({ rowId: latest.id, digest: latest.digest, text: 'My own words.' });
  });

  it('after the agent revised an edited draft: the merge notice, Review replacement, then Confirm replacement ("This does not merge the entries") or Keep current', async () => {
    const row: Seed = {
      id: 'q-script', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'draft', createdAt: '2026-10-21T08:30:00.000Z',
      title: 'Sponsor script for episode 14', line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'd-ep14-script' },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    };
    const merged: DraftChangesView = {
      line: "You edited this. The agent's new version is beside yours.",
      changes: [{ id: 'c1', paragraph: 1, before: 'Five budget mics, one room.', after: 'Five budget mics in one room, and one clear winner.', by: 'agent', status: 'open' }],
      replacement: { id: 'replacement', status: 'open', review: 'Review replacement', confirm: 'Confirm replacement', confirmLine: 'This does not merge the entries.', keep: 'Keep current, reject change' },
    };
    const { spy } = start({
      queue: [row],
      stub: (method) => (method === 'venture.delivery.changes' ? merged : method === 'venture.delivery.decideChange' ? { ...merged, replacement: { ...merged.replacement!, status: 'confirmed' }, changes: [{ ...merged.changes[0]!, status: 'taken' }] } : undefined),
    });
    const card = await cardTitled('Sponsor script for episode 14');
    await waitFor(() => expect(card.querySelector('[data-merged]')).not.toBeNull());
    const notice = card.querySelector<HTMLElement>('[data-merged]')!;
    expect(notice.textContent).toContain("You edited this. The agent's new version is beside yours.");
    await press(within(notice).getByRole('button', { name: 'Review changes' }));
    const sheet = document.querySelector<HTMLElement>('[data-sheet]')!;
    await press(await within(sheet).findByRole('button', { name: 'Review replacement' }));
    expect(within(sheet).getByText('This does not merge the entries.')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Keep current, reject change' })).toBeTruthy();
    await press(within(sheet).getByRole('button', { name: 'Confirm replacement' }));
    expect(calls(spy, 'venture.delivery.decideChange')).toEqual([{ runId: 'd-ep14-script', changeId: 'replacement', accept: true }]);
  });
});

describe('Today: approve several (O9)', () => {
  const rows: Seed[] = [
    {
      id: 'run:r1:review-1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'draft', createdAt: '2026-10-21T08:40:00.000Z',
      title: 'Episode 14 is cut', line: 'Watch it before approving.', viewRef: { kind: 'draft', id: 'draft-ep14' },
      actions: [{ id: 'watch', label: 'Watch', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    },
    {
      id: 'post:p13:v1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Publisher', kind: 'connector', createdAt: '2026-10-21T10:02:00.000Z',
      title: 'Post to X', line: 'From your own browser on this computer.', viewRef: { kind: 'draft', id: 'post-linkedin-ep13' }, descriptionComplete: true,
      actions: [{ id: 'deny', label: 'Do not post', primary: false }, { id: 'approve', label: 'Approve and post', primary: true, secondAsk: true }],
    },
    {
      id: 'q-price', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'price', createdAt: '2026-10-21T08:52:00.000Z',
      title: 'Sponsor slot price', change: { label: 'Sponsor slot', before: '₹25,000', after: '₹30,000', receiptId: 'R-0415' },
      actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }],
    },
  ];

  it('nothing is picked, money is not offered, an unread item blocks the set until it is opened, and the second ask comes once', async () => {
    const { spy } = start({ queue: rows });
    await cardTitled('Post to X');
    await press(screen.getByRole('button', { name: 'Approve several' }));
    const picker = document.querySelector<HTMLElement>('[data-set-picker]')!;
    expect(within(picker).queryByRole('button', { name: /approve all/i })).toBeNull();
    const boxes = within(picker).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([false, false]);
    expect(within(picker).queryByText('Sponsor slot price')).toBeNull();
    // "Approve" with nothing ticked, then "Approve 2": the count of what is ticked, never "all".
    const approve = () => within(picker).getByRole('button', { name: /^Approve( \d+)?$/ });
    expect(approve().getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(within(picker).getByRole('checkbox', { name: /Episode 14 is cut/ }));
    await settle();
    fireEvent.click(within(picker).getByRole('checkbox', { name: /Post to X/ }));
    await settle();
    expect(calls(spy, 'venture.queue.setPreview').at(-1)).toEqual({ rowIds: ['run:r1:review-1', 'post:p13:v1'] });
    // The cards drew their previews from the views, without opened: the engine kept no view mark for them.
    const drawn = calls(spy, 'venture.queue.view');
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((p) => p.opened === undefined)).toBe(true);
    const unread = picker.querySelector<HTMLElement>('[data-set-refusal="VIEW_FIRST"]')!;
    expect(unread.textContent).toContain('Open it and read it first.');
    expect(approve().getAttribute('aria-disabled')).toBe('true');
    await press(approve());
    expect(calls(spy, 'venture.queue.set')).toEqual([]);

    // A draft to watch is opened with Watch, as on its card.
    await press(within(unread).getByRole('button', { name: 'Watch' }));
    expect(calls(spy, 'venture.queue.view').some((p) => p.id === 'draft-ep14' && p.opened === true)).toBe(true);
    await waitFor(() => expect(picker.querySelector('[data-set-refusal]')).toBeNull());
    expect(picker.querySelector('[data-set-total] [data-receipt]')).not.toBeNull();
    expect(approve().getAttribute('aria-disabled')).toBeNull();

    await press(approve());
    expect(within(picker).getByText("This can't be undone. Approve these 2?")).toBeTruthy();
    expect(calls(spy, 'venture.queue.set')).toEqual([]);
    await press(within(picker).getByRole('button', { name: 'Approve 2' }));
    const sent = calls(spy, 'venture.queue.set');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ rowIds: ['run:r1:review-1', 'post:p13:v1'], digest: expect.any(String), secondAsk: true });
    expect(picker.textContent).toContain('Approved 2 of 2. Each one has its own record.');
    await waitFor(() => expect(document.querySelectorAll('[data-decided]')).toHaveLength(2));
    assertInkRules(document.body);
  });
});

describe('Today: approve several, the review round (4J19)', () => {
  const draft: Seed = {
    id: 'run:r1:review-1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'draft', createdAt: '2026-10-21T08:40:00.000Z',
    title: 'Spot of episode 14', line: 'Read it before approving.', viewRef: { kind: 'draft', id: 'post-linkedin-ep13' },
    actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true }],
  };
  const post: Seed = {
    id: 'post:p13:v1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Publisher', kind: 'connector', createdAt: '2026-10-21T10:02:00.000Z',
    title: 'Post to X', line: 'From your own browser.', viewRef: { kind: 'draft', id: 'post-linkedin-ep13' }, descriptionComplete: true,
    actions: [{ id: 'deny', label: 'Do not post', primary: false }, { id: 'approve', label: 'Approve and post', primary: true }],
  };
  const others: Seed[] = [
    { ...post, id: 'connector:github:v1', title: 'Connect GitHub' },
    { ...post, id: 'post:p14:v1', title: 'Post that hides part of what it sends', descriptionComplete: false },
    { ...draft, id: 'run:r2:review-1', businessId: 'ledgerline', businessName: 'Ledgerline', title: 'Books for October' },
    { ...draft, id: 'run:r3:send-c1', title: 'Send the brief to your AI' },
  ];

  it('the sample: the engine-shaped draft and post of the open business can be approved together, and one alone is no set', async () => {
    const { client } = start();
    await cardTitled('Post to X');
    // The open business is found the way the engine lists it (its id is a venture_ record id, never a row's business).
    expect((await client.request('venture.get', {}))!.venture.id).toMatch(/^venture_/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve several' })).toBeTruthy());
    document.body.innerHTML = '';
    start({ queue: [post] });
    await cardTitled('Post to X');
    await settle();
    expect(screen.queryByRole('button', { name: 'Approve several' })).toBeNull();
  });

  it('offers only the posts and drafts of the open business that a set takes', async () => {
    start({ queue: [draft, post, ...others] });
    await cardTitled('Post to X');
    await press(screen.getByRole('button', { name: 'Approve several' }));
    const picker = document.querySelector<HTMLElement>('[data-set-picker]')!;
    expect(within(picker).getAllByRole('checkbox').map((box) => box.closest('label')!.textContent)).toEqual(['Spot of episode 14Draft', 'Post to XPost']);
  });

  it('a set the engine calls stale says so in its own words and is read again; a row that left is dropped from the pick', async () => {
    let stale = true;
    const { spy, client } = start({
      queue: [draft, post],
      stub: (method) => {
        if (method === 'venture.queue.set' && stale) { stale = false; throw new EngineError('APPROVAL_STALE', 'One of these changed since you picked them. Nothing ran. Look at the set again.'); }
        return undefined;
      },
    });
    await cardTitled('Post to X');
    await press(screen.getByRole('button', { name: 'Approve several' }));
    const picker = document.querySelector<HTMLElement>('[data-set-picker]')!;
    fireEvent.click(within(picker).getByRole('checkbox', { name: /Spot of episode 14/ }));
    await settle();
    fireEvent.click(within(picker).getByRole('checkbox', { name: /Post to X/ }));
    await settle();
    const before = calls(spy, 'venture.queue.setPreview').length;
    await press(within(picker).getByRole('button', { name: 'Approve 2' }));
    expect(picker.textContent).toContain('Something here changed since you picked it. Nothing ran. Look again, then approve.');
    expect(calls(spy, 'venture.queue.setPreview').length).toBeGreaterThan(before);
    // The post is decided somewhere else: it leaves the pick, and the set is worked out again without it.
    const rows = (await client.request('venture.queue.list', { scope: 'all' })).rows;
    const live = rows.find((row) => row.id === 'post:p13:v1')!;
    await act(async () => { await client.request('venture.queue.decide', { id: live.id, digest: live.digest, action: 'deny' }); });
    await settle();
    await waitFor(() => expect(calls(spy, 'venture.queue.setPreview').at(-1)).toEqual({ rowIds: ['run:r1:review-1'] }));
    await press(within(picker).getByRole('button', { name: 'Approve 1' }));
    expect(calls(spy, 'venture.queue.set').at(-1)).toEqual({ rowIds: ['run:r1:review-1'], digest: expect.any(String) });
    expect(picker.textContent).toContain('Approved 1 of 1.');
  });
});

describe('Today: sort by the owner\'s words (O18)', () => {
  it('the fake has no AI, so it offers the fixed choices with a dry run; Save keeps the rule', async () => {
    const { spy } = start();
    await cardTitled('Episode 14 is cut');
    await press(screen.getByRole('button', { name: 'Sort' }));
    const box = document.querySelector<HTMLElement>('[data-triage]')!;
    fireEvent.change(within(box).getByRole('textbox', { name: 'How you want Today ordered' }), { target: { value: 'clients with a deadline first' } });
    await press(within(box).getByRole('button', { name: 'Show me' }));
    expect(calls(spy, 'venture.triage.preview')).toEqual([{ text: 'clients with a deadline first' }]);
    expect(box.querySelectorAll('[data-dry-run] li').length).toBeGreaterThan(0);
    expect(within(box).getByText('Nothing is hidden. A rule only orders.')).toBeTruthy();
    expect(within(box).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(within(box).getByRole('radio', { name: 'Nearest deadline first' }));
    await press(within(box).getByRole('button', { name: 'Save' }));
    expect(calls(spy, 'venture.triage.set')).toEqual([{ rule: { keys: [{ field: 'due', order: 'asc' }], words: 'Nearest deadline first' }, digest: expect.any(String) }]);
    expect(box.textContent).toContain('Today is ordered: nearest deadline first. Nothing is hidden.');
  });
});

describe('Today: since you left, and needs-you notices', () => {
  it('after time away, "Since you left" lists only the rows made while away', async () => {
    const draft = QUEUE.find((row) => row.id === 'run:d-ep14:review-1')!;
    const older = { ...QUEUE.find((row) => row.id === 'q-question-title')!, createdAt: '2026-10-19T09:45:00.000Z' };
    const { client } = start({ queue: [draft, older], now: '2026-10-21T12:00:00.000Z' });
    await client.request('venture.away.set', { from: '2026-10-20', to: '2026-10-22' });
    await act(async () => { client.engine.emit({ type: 'queue.changed', businessId: 'lumen', at: '2026-10-21T12:00:00.000Z' }); });
    await settle();
    const chip = await screen.findByRole('button', { name: /Since you left/ });
    await press(chip);
    await waitFor(() => expect(screen.queryByRole('heading', { level: 3, name: 'Which title for episode 15?' })).toBeNull());
    expect(screen.getByRole('heading', { level: 3, name: 'Episode 14 is cut' })).toBeTruthy();
  });

  it('a probe notice is a compact card whose Open goes where the engine says, never opening a business', async () => {
    const notice: Seed = {
      id: 'notice:connection:v1', businessId: 'lumen', businessName: 'Lumen Studio', kind: 'notice', createdAt: '2026-10-21T07:00:00.000Z',
      title: 'LinkedIn stopped working', line: 'The last connection check failed.',
      actions: [{ id: 'open', label: 'Open', primary: true }, { id: 'later', label: 'Later', primary: false }],
      notice: { probe: 'connection', severity: 'high', link: '#/connections' },
    };
    const { spy } = start({ queue: [notice] });
    const card = await cardTitled('LinkedIn stopped working');
    expect(card.getAttribute('data-layout')).toBe('compact');
    await press(within(card).getByRole('button', { name: 'Open' }));
    expect(window.location.hash).toBe('#/connections');
    expect(calls(spy, 'workspace.lock')).toEqual([]);
    expect(calls(spy, 'venture.queue.decide')).toEqual([]);
  });
});
