import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import axe from 'axe-core';
import { ApprovalRow, timeOf, type ApprovalHandle, type PressResult } from '../../src/parts/ApprovalRow';
import { Change } from '../../src/parts/Change';
import { TextProvider } from '../../src/text';
import { assertFiguresProved, assertInkRules } from '../helpers/ink-rules';
import type { QueueDecision, QueueRow } from '../../src/engine/types';

// Ink v2 wave 3, package 3B5a: the approval card (D-Today's `.qcard`) and the compact card (`.qk`). The row layout and
// every behaviour it had stay (tests/parts/approval-row.test.tsx); these tests hold the card look to the same rules.

const draft: QueueRow = {
  id: 'q-draft', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'draft', createdAt: '2026-10-21T08:40:00.000Z', digest: 'd1',
  title: 'Episode 14 is cut', line: '11 min 42 s. Watch it before approving.', viewRef: { kind: 'draft', id: 'ep14' },
  actions: [{ id: 'watch', label: 'Watch', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
};
const price: QueueRow = {
  id: 'q-price', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'price', createdAt: '2026-10-21T08:52:00.000Z', digest: 'd2',
  title: 'Sponsor slot price', line: 'The sponsor asked for two mentions in one episode.',
  change: { label: 'Sponsor slot', before: '₹25,000', after: '₹30,000', receiptId: 'R-0415' },
  actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }],
};
const plan: QueueRow = {
  id: 'q-plan', businessId: 'ledgerline', businessName: 'Ledgerline', kind: 'plan', createdAt: '2026-10-21T08:05:00.000Z', digest: 'd3',
  title: 'Your plan is ready. Read it.', line: 'Monthly books, GST working, ITR and TDS preparation.', viewRef: { kind: 'plan', id: 'plan-1' },
  actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, requiresView: true }],
};
const post: QueueRow = {
  id: 'q-post', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Publisher', kind: 'connector', createdAt: '2026-10-21T10:02:00.000Z', digest: 'd4',
  title: 'Post to LinkedIn', line: 'From your own browser on this computer.', viewRef: { kind: 'draft', id: 'post-1' },
  actions: [{ id: 'deny', label: 'Do not post', primary: false }, { id: 'approve', label: 'Approve and post', primary: true, secondAsk: true, requiresView: true }],
};
const quote: QueueRow = {
  id: 'q-quote', businessId: 'ledgerline', businessName: 'Ledgerline', agent: 'Billing', kind: 'quote', createdAt: '2026-10-21T09:31:00.000Z', digest: 'd5',
  title: 'Quote for Iyer & Co, monthly books', line: 'Held for one hour once you approve it.',
  change: { label: 'Monthly fee', before: '₹10,000', after: '₹12,000', receiptId: 'R-0420' },
  actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }],
};
const stopped: QueueRow = {
  id: 'q-again', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'question', createdAt: '2026-10-21T10:06:00.000Z', digest: 'd6',
  title: 'Thumbnail set stopped', line: 'ffmpeg was not found on this computer.', viewRef: { kind: 'run', id: '28' },
  actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'run-again', label: 'Run again', primary: true }],
};
const question: QueueRow = {
  id: 'q-title', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Researcher', kind: 'question', createdAt: '2026-10-21T09:45:00.000Z', digest: 'd7',
  title: 'Which title for episode 15?', line: 'A or B?',
  change: { label: 'Views in 30 days, option B', before: '12,000', after: '18,000', estimate: true },
  actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'answer', label: 'Answer', primary: true }],
};

const done = (line: string, receiptId?: string): QueueDecision => (receiptId ? { outcome: 'done', line, receiptId } : { outcome: 'done', line });
const card = () => document.querySelector<HTMLElement>('article[data-card]')!;
/** Locked the way Button locks: marked data-locked and aria-disabled (it stays in the Tab order and says why); a busy
 *  button is natively disabled instead. */
const isLocked = (button: HTMLElement) => button.hasAttribute('data-locked') && ((button as HTMLButtonElement).disabled || button.getAttribute('aria-disabled') === 'true');
const approveIn = (name = 'Approve') => within(card()).getByRole('button', { name }) as HTMLButtonElement;
const time = (at: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));

describe('ApprovalRow as a card (layout="card")', () => {
  it('is an article with the row id, a head with avatar, name, business and time, a kind chip, an h3 title and the line', () => {
    render(<ApprovalRow layout="card" row={draft} agentState="working" onDecide={vi.fn()} />);
    const article = card();
    expect(article.tagName).toBe('ARTICLE');
    expect(article.dataset.rowId).toBe('q-draft');
    expect(article.hasAttribute('data-row')).toBe(true);
    expect(article.getAttribute('aria-labelledby')).toBe(within(article).getByRole('heading', { level: 3, name: 'Episode 14 is cut' }).id);
    const avatar = article.querySelector('header [aria-hidden="true"][data-size="40"]')!;
    expect(avatar.textContent).toBe('ED');
    expect(avatar.getAttribute('data-state')).toBe('working');
    expect(within(article).getByText('Editor')).toBeTruthy();
    const meta = article.querySelector('[data-meta]')!;
    expect(meta.textContent).toBe(`Lumen Studio · ${time(draft.createdAt)}`);
    expect(meta.querySelector('.mono')!.textContent).toBe(time(draft.createdAt));
    const kind = article.querySelector('[data-kind]')!;
    expect(kind.textContent).toBe('Draft');
    expect(kind.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(article).getByText('11 min 42 s. Watch it before approving.')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('formats the time of day in the UI language', () => {
    expect(timeOf('2026-10-21T08:40:00.000Z', 'en')).toBe(time('2026-10-21T08:40:00.000Z'));
    expect(timeOf('not a date', 'en')).toBe('');
  });

  it('names only the agent and the time when the list holds one business; a row with no agent is Chausar', () => {
    render(<ApprovalRow layout="card" row={draft} showBusiness={false} onDecide={vi.fn()} />);
    expect(card().querySelector('[data-meta]')!.textContent).toBe(time(draft.createdAt));
  });

  it('a row without an agent comes from Chausar itself', () => {
    render(<ApprovalRow layout="card" row={plan} onDecide={vi.fn()} />);
    const head = card().querySelector('header')!;
    expect(within(head).getByText('Chausar')).toBeTruthy();
    expect(head.querySelector('[data-chausar]')).not.toBeNull();
  });

  it('the secondary comes first and the one primary last, both large; a single action fills the row', () => {
    const { unmount } = render(<ApprovalRow layout="card" row={price} onDecide={vi.fn()} />);
    const buttons = [...card().querySelectorAll<HTMLButtonElement>('[data-key]')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Deny', 'Approve']);
    expect(buttons.map((b) => b.dataset.size)).toEqual(['lg', 'lg']);
    expect(buttons.map((b) => b.dataset.variant)).toEqual(['secondary', 'primary']);
    assertInkRules(document.body);
    unmount();
    render(<ApprovalRow layout="card" row={{ ...plan, actions: [{ id: 'open', label: 'Open', primary: true }] }} onDecide={vi.fn()} />);
    expect([...card().querySelectorAll('[data-key]')].map((b) => b.getAttribute('data-key'))).toEqual(['primary']);
  });

  it('draws the change as a before-and-after pill with its receipt, proved', () => {
    render(<ApprovalRow layout="card" row={price} onDecide={vi.fn()} />);
    const article = card();
    // The old and the new price share one receipt, so the change is one figure group (3B1a's strict rule).
    const change = article.querySelector<HTMLElement>('[data-figure-group][data-size="pill"]')!;
    expect(change.querySelector('del')!.textContent).toBe('₹25,000');
    expect(within(change).getByText('₹30,000').className).toContain('mono');
    expect(within(change).getByRole('button', { name: 'Receipt R-0415' })).toBeTruthy();
    assertInkRules(document.body);
  });

  describe('the note line says why, in words', () => {
    it('while locked: the primary unlocks after you watch it, read it or open it, and the button points at that line', () => {
      const onDecide = vi.fn();
      const { unmount } = render(<ApprovalRow layout="card" row={draft} onDecide={onDecide} />);
      const approve = within(card()).getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
      expect(isLocked(approve)).toBe(true);
      fireEvent.click(approve);
      expect(onDecide).not.toHaveBeenCalled();
      expect(approve.dataset.variant).toBe('primary');
      expect(approve.hasAttribute('data-locked')).toBe(true);
      const note = card().querySelector<HTMLElement>('[data-note]')!;
      expect(note.textContent).toBe('Approve unlocks after you watch it');
      expect(approve.getAttribute('aria-describedby')!.split(' ')).toContain(note.id);
      unmount();

      const second = render(<ApprovalRow layout="card" row={plan} onDecide={vi.fn()} />);
      expect(card().querySelector('[data-note]')!.textContent).toBe('Accept unlocks after you read it');
      second.unmount();

      render(<ApprovalRow layout="card" row={post} onDecide={vi.fn()} />);
      expect(card().querySelector('[data-note]')!.textContent).toBe('Unlocks after you open it');
    });

    it('a primary that asks twice says "Asks once more"; a plan, once read, says nothing changes until you approve', () => {
      const { unmount } = render(<ApprovalRow layout="card" row={price} onDecide={vi.fn()} />);
      expect(card().querySelector('[data-note]')!.textContent).toBe('Asks once more');
      unmount();
      render(<ApprovalRow layout="card" row={plan} viewed onDecide={vi.fn()} />);
      expect(card().querySelector('[data-note]')!.textContent).toBe('Nothing changes until you approve');
    });

    it('a row with nothing to say has no note line', () => {
      render(<ApprovalRow layout="card" row={stopped} onDecide={vi.fn()} />);
      expect(card().querySelector('[data-note]')).toBeNull();
    });
  });

  describe('view before approve', () => {
    it('drawing a preview does not count as viewed; Approve unlocks only through Watch or the preview opening it', () => {
      const onView = vi.fn();
      render(
        <ApprovalRow
          layout="card"
          row={draft}
          onDecide={vi.fn()}
          onView={onView}
          preview={(view) => <button type="button" onClick={view}>Watch Episode 14</button>}
        />,
      );
      const approve = within(card()).getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
      expect(screen.getByRole('button', { name: 'Watch Episode 14' })).toBeTruthy();
      expect(isLocked(approve)).toBe(true);
      expect(onView).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Watch Episode 14' }));
      expect(onView).toHaveBeenCalledWith(draft);
      expect(isLocked(approve)).toBe(false);
      expect(card().querySelector('[data-note]')).toBeNull();
      assertInkRules(document.body);
    });

    it('a preview given as plain content is drawn as it is, and still unlocks nothing', () => {
      render(<ApprovalRow layout="card" row={draft} onDecide={vi.fn()} preview={<p>A still of the episode</p>} />);
      expect(card().querySelector('[data-preview]')!.textContent).toBe('A still of the episode');
      expect(isLocked(approveIn())).toBe(true);
      fireEvent.click(within(card()).getByRole('button', { name: 'Watch' }));
      expect(isLocked(approveIn())).toBe(false);
    });

    it('a controlled viewed flag unlocks it the same way', () => {
      const { rerender } = render(<ApprovalRow layout="card" row={draft} viewed={false} onDecide={vi.fn()} />);
      expect(isLocked(approveIn())).toBe(true);
      rerender(<ApprovalRow layout="card" row={draft} viewed onDecide={vi.fn()} />);
      expect(isLocked(approveIn())).toBe(false);
    });
  });

  describe('the second ask, inside the card', () => {
    it('Approve asks again in the card; Not now puts focus back on Approve; confirming decides once with the row', async () => {
      const onDecide = vi.fn(async () => done('Approved · R-0421', 'R-0421'));
      render(<ApprovalRow layout="card" row={price} onDecide={onDecide} />);
      fireEvent.click(within(card()).getByRole('button', { name: 'Approve' }));
      expect(onDecide).not.toHaveBeenCalled();
      expect(card().textContent).toContain("This can't be undone. Approve?");
      expect(document.activeElement).toBe(within(card()).getByRole('button', { name: 'Not now' }));
      assertInkRules(document.body);
      fireEvent.click(within(card()).getByRole('button', { name: 'Not now' }));
      expect(card().textContent).not.toContain("can't be undone");
      expect(document.activeElement).toBe(within(card()).getByRole('button', { name: 'Approve' }));
      fireEvent.click(within(card()).getByRole('button', { name: 'Approve' }));
      await act(async () => { fireEvent.click(within(card()).getAllByRole('button', { name: 'Approve' }).at(-1)!); });
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onDecide).toHaveBeenCalledWith(price, price.actions[1], { viewed: false });
    });

    it('a decided card shrinks to one line with its receipt', async () => {
      const onDecide = vi.fn(async () => done('Approved · R-0421', 'R-0421'));
      const { container } = render(<ApprovalRow layout="card" row={stopped} onDecide={onDecide} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run again' })); });
      const line = container.querySelector('article[data-decided]')!;
      expect(line.getAttribute('data-row-id')).toBe('q-again');
      expect(within(line as HTMLElement).getByRole('status').textContent).toBe('Thumbnail set stopped · Approved · R-0421');
      expect(screen.getByRole('button', { name: 'Receipt R-0421' })).toBeTruthy();
      expect(container.querySelectorAll('[data-key]')).toHaveLength(0);
      assertInkRules(document.body);
    });

    it('a digest change shows the new version in place and asks to look again', async () => {
      const latest: QueueRow = { ...draft, digest: 'd1b', line: 'Recut to 11 min 30 s.' };
      const onDecide = vi.fn(async (): Promise<QueueDecision> => ({ outcome: 'stale', line: 'This changed since you opened it.', latest }));
      render(<ApprovalRow layout="card" row={draft} onDecide={onDecide} />);
      fireEvent.click(within(card()).getByRole('button', { name: 'Watch' }));
      await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Approve' })); });
      expect(card().textContent).toContain('This changed. Here is the new version.');
      expect(card().textContent).toContain('Recut to 11 min 30 s.');
      expect(isLocked(approveIn())).toBe(true);
    });

    it('an answer is written inside the card', async () => {
      const onDecide = vi.fn(async () => done('Answered'));
      render(<ApprovalRow layout="card" row={question} onDecide={onDecide} />);
      fireEvent.click(within(card()).getByRole('button', { name: 'Answer' }));
      fireEvent.change(within(card()).getByLabelText('Your answer'), { target: { value: 'Option B' } });
      await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Send answer' })); });
      expect(onDecide).toHaveBeenCalledWith(question, question.actions[1], { viewed: false, answer: 'Option B' });
    });
  });

  // An engine-failed run is "Failed"; "Stopped" is kept for the owner's own Stop (W4 4F).
  it('a row whose run really failed says "Failed" on its kind chip, in the fail tone, with the stopped edge', () => {
    render(<ApprovalRow layout="card" row={stopped} agentState="failed" onDecide={vi.fn()} />);
    const kind = card().querySelector('[data-kind]')!;
    expect(kind.textContent).toBe('Failed');
    expect(kind.getAttribute('data-tone')).toBe('fail');
    expect(card().dataset.tone).toBe('fail');
  });

  it('an expired draft also offers Run again, but its run did not stop, so it says "Draft", never "Failed"', () => {
    // The engine's expired-draft row (views/queue.ts): kind draft, Run again, its run still waiting on the owner.
    const expired: QueueRow = { ...stopped, id: 'q-expired', kind: 'draft', title: 'The draft for Boat Audio needs to start again', line: 'The text waiting for your approval expired before it was sent.' };
    render(<ApprovalRow layout="card" row={expired} agentState="waiting" onDecide={vi.fn()} />);
    expect(card().querySelector('[data-kind]')!.textContent).toBe('Draft');
    expect(card().querySelector('[data-kind]')!.hasAttribute('data-tone')).toBe(false);
    expect(card().hasAttribute('data-tone')).toBe(false);
  });

  it('an incomplete description still says so on a card and on a compact card', () => {
    const INCOMPLETE = "This description is incomplete: part of what this will send isn't shown.";
    const { unmount } = render(<ApprovalRow layout="card" row={{ ...post, descriptionComplete: false }} onDecide={vi.fn()} />);
    expect(card().textContent).toContain(INCOMPLETE);
    unmount();
    render(<ApprovalRow layout="compact" row={{ ...post, descriptionComplete: false }} onDecide={vi.fn()} />);
    expect(card().textContent).toContain(INCOMPLETE);
  });

  it('reads in Hindi with no key showing', () => {
    render(<TextProvider language="hi"><ApprovalRow layout="card" row={draft} onDecide={vi.fn()} /></TextProvider>);
    for (const node of card().querySelectorAll('p, span, h3, button')) expect(node.textContent ?? '').not.toMatch(/^[a-z]+(\.[a-zA-Z0-9-]+)+$/);
  });
});

describe('ApprovalRow as a compact card (layout="compact")', () => {
  it('keeps the title, the line, the change as a small pill with its receipt, small buttons and one primary', () => {
    render(<ApprovalRow layout="compact" row={quote} onDecide={vi.fn()} />);
    const article = card();
    expect(article.dataset.layout).toBe('compact');
    expect(within(article).getByRole('heading', { level: 3, name: 'Quote for Iyer & Co, monthly books' })).toBeTruthy();
    expect(within(article).getByText('Held for one hour once you approve it.')).toBeTruthy();
    const change = article.querySelector('[data-figure-group][data-size="mini"]')!;
    expect(change.querySelector('del')!.textContent).toBe('₹10,000');
    expect(within(change as HTMLElement).getByText('Monthly fee').className).not.toContain('sr-only');
    expect(within(article).getByRole('button', { name: 'Receipt R-0420' })).toBeTruthy();
    expect([...article.querySelectorAll<HTMLButtonElement>('[data-key]')].map((b) => b.dataset.size)).toEqual(['sm', 'sm']);
    assertInkRules(document.body);
  });

  it('takes the phone\'s button size when asked: every button, the second ask\'s too', () => {
    render(<ApprovalRow layout="compact" buttonSize="xl" row={quote} onDecide={vi.fn()} />);
    expect([...card().querySelectorAll<HTMLButtonElement>('[data-key]')].map((b) => b.dataset.size)).toEqual(['xl', 'xl']);
    fireEvent.click(within(card()).getByRole('button', { name: 'Approve' }));
    expect([...card().querySelectorAll<HTMLButtonElement>('.confirm button, [class*="confirm"] button')].map((b) => b.dataset.size)).toEqual(['xl', 'xl']);
  });

  it('says the kind as a labelled icon, and keeps the second ask and the lock', () => {
    render(<ApprovalRow layout="compact" row={plan} onDecide={vi.fn()} />);
    expect(within(card()).getByRole('img', { name: 'Plan' })).toBeTruthy();
    const accept = within(card()).getByRole('button', { name: 'Accept' }) as HTMLButtonElement;
    expect(isLocked(accept)).toBe(true);
    const note = card().querySelector<HTMLElement>('[data-note]')!;
    expect(note.textContent).toBe('Accept unlocks after you read it');
    expect(accept.getAttribute('aria-describedby')!.split(' ')).toContain(note.id);
    assertInkRules(document.body);
  });
});

describe('Driving a card from outside (the swipe on phone)', () => {
  it('describes the primary: its words, whether it is locked and why, and whether it asks once more', () => {
    const handle = createRef<ApprovalHandle>();
    render(<ApprovalRow layout="card" row={post} onDecide={vi.fn()} handle={handle} />);
    expect(handle.current!.primary()).toEqual({ label: 'Approve and post', locked: true, note: 'Unlocks after you open it', asksAgain: true });
  });

  it('pressing a locked primary does nothing; once viewed, a second ask opens inside the card and decides nothing', async () => {
    const handle = createRef<ApprovalHandle>();
    const onDecide = vi.fn(async () => done('Posted'));
    const { rerender } = render(<ApprovalRow layout="card" row={post} onDecide={onDecide} handle={handle} />);
    let result: string | undefined;
    act(() => { result = handle.current!.pressPrimary(); });
    expect(result).toBe('locked');
    expect(card().textContent).not.toContain("can't be undone");
    rerender(<ApprovalRow layout="card" row={post} viewed onDecide={onDecide} handle={handle} />);
    act(() => { result = handle.current!.pressPrimary(); });
    expect(result).toBe('asking');
    expect(card().textContent).toContain("This can't be undone. Approve and post?");
    act(() => { result = handle.current!.pressPrimary(); });
    expect(result).toBe('asking');
    expect(onDecide).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(card()).getAllByRole('button', { name: 'Approve and post' }).at(-1)!); });
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it('a plain primary is pressed through the card, once; Later only when the row has it', async () => {
    const handle = createRef<ApprovalHandle>();
    const onDecide = vi.fn(() => new Promise<QueueDecision>(() => {}));
    const { unmount } = render(<ApprovalRow layout="card" row={stopped} onDecide={onDecide} handle={handle} />);
    let result: string | undefined;
    await act(async () => { result = handle.current!.pressPrimary(); });
    expect(result).toBe('pressed');
    await act(async () => { result = handle.current!.pressPrimary(); });
    expect(result).toBe('busy');
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith(stopped, stopped.actions[1], { viewed: false });
    unmount();

    const later = createRef<ApprovalHandle>();
    const deciding = vi.fn(async () => done('Later'));
    const second = render(<ApprovalRow layout="card" row={question} onDecide={deciding} handle={later} />);
    await act(async () => { result = later.current!.pressLater(); });
    expect(result).toBe('pressed');
    expect(deciding).toHaveBeenCalledWith(question, question.actions[0], { viewed: false });
    second.unmount();

    const none = createRef<ApprovalHandle>();
    const never = vi.fn();
    render(<ApprovalRow layout="card" row={price} onDecide={never} handle={none} />);
    act(() => { result = none.current!.pressLater(); });
    expect(result).toBe('none');
    expect(never).not.toHaveBeenCalled();
  });
});

describe('Change, in its three sizes', () => {
  it('a pill strikes the old value, points with an arrow to the new one in mono, with its receipt, and reads as was and now', () => {
    const onReceipt = vi.fn();
    const { container } = render(<Change size="pill" label="Sponsor slot" before="₹25,000" after="₹30,000" receiptId="R-0415" onReceipt={onReceipt} />);
    const root = container.querySelector<HTMLElement>('[data-figure-group]')!;
    expect(root.getAttribute('data-size')).toBe('pill');
    expect(root.querySelector('del')!.className).toContain('mono');
    expect(root.querySelector('svg.lucide-arrow-right')!.getAttribute('aria-hidden')).toBe('true');
    expect(within(root).getByText('₹30,000').className).toContain('mono');
    expect(root.textContent).toContain('Sponsor slot');
    expect(root.textContent).toContain('was ₹25,000');
    expect(root.textContent).toContain('now ₹30,000');
    fireEvent.click(screen.getByRole('button', { name: 'Receipt R-0415' }));
    expect(onReceipt).toHaveBeenCalledWith('R-0415');
    assertInkRules(document.body);
  });

  it('a change with no receipt and no estimate breaks the rule, so a bare price can never pass as proved', () => {
    render(<Change size="pill" before="₹25,000" after="₹30,000" />);
    expect(() => assertFiguresProved(document.body)).toThrow(/no receipt/);
  });

  it('a small change keeps its label on screen, at the label size', () => {
    render(<Change size="mini" label="Most it can cost" after="₹45.00" receiptId="R-0412" />);
    const label = screen.getByText('Most it can cost');
    expect(label.className).not.toContain('sr-only');
    expect(label.className).toMatch(/label/);
    const sheet = readFileSync(join(import.meta.dirname, '../../src/parts/Change.module.css'), 'utf8');
    expect(sheet).toMatch(/\.mini \.label\s*\{[^}]*font-size:\s*var\(--text-label\)/);
  });

  it('a model-written change says "model estimate" and never carries a receipt, in every size', () => {
    for (const size of ['inline', 'pill', 'mini'] as const) {
      const { container, unmount } = render(<Change size={size} after="18,000" before="12,000" receiptId="R-9999" estimate />);
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByText('model estimate')).toBeTruthy();
      assertInkRules(document.body);
      unmount();
    }
  });
});

// The review of 3B5a (23 Oct): what the engine says is never cut, a refresh closes an open ask, nothing is sent twice.

const LONG_NOTICE = 'Read it, then approve it. You send it yourself. The judge is reading this draft on your own AI; each check costs up to ₹4.20 and Accept waits until it has read it. The platform may restrict this account.';
const judged: QueueRow = { ...draft, id: 'q-judged', line: LONG_NOTICE, actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }] };
/** Phone width, as the app's useNarrow reads it. */
const phone = () => vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
  matches: /max-width:\s*759px/.test(query), media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
}) as unknown as MediaQueryList);
const sheetCss = readFileSync(join(import.meta.dirname, '../../src/parts/ApprovalRow.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of every rule whose selector names the class (`.line`, not `.lineX`). */
const rulesFor = (name: string) => [...sheetCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => new RegExp(`\\.${name}(?![\\w-])`).test(m[1]!)).map((m) => m[2]!);

describe('Review of 3B5a', () => {
  describe('B1: the engine\'s line is never cut', () => {
    it('no rule for the line clamps, ellipsises or hides it (the title may clamp on a compact card)', () => {
      const lines = rulesFor('line');
      expect(lines.length).toBeGreaterThan(0);
      for (const decls of lines) expect(decls).not.toMatch(/line-clamp|text-overflow|overflow\s*:\s*hidden|max-height|white-space\s*:\s*nowrap/);
    });

    it('a long judge notice with its cost shows in full on a card and on a compact card at phone width', () => {
      phone();
      for (const layout of ['card', 'compact'] as const) {
        const { unmount } = render(<ApprovalRow layout={layout} row={judged} onDecide={vi.fn()} />);
        const line = within(card()).getByText(LONG_NOTICE);
        expect(line.tagName).toBe('P');
        expect(line.textContent).toBe(LONG_NOTICE);
        unmount();
      }
    });
  });

  it('B2: card buttons may shrink and wrap their words, so a long label is never cut off', () => {
    const buttons = rulesFor('acts').join(';');
    expect(sheetCss).toMatch(/\.acts\s*>\s*button\s*\{/);
    expect(buttons).toMatch(/min-width\s*:\s*0/);
    expect(buttons).toMatch(/white-space\s*:\s*normal/);
  });

  describe('B3: a new version closes an open ask and is never sent unseen', () => {
    const newer: QueueRow = { ...price, digest: 'd2b', line: 'The sponsor wants three mentions.', change: { ...price.change!, after: '₹90,000' } };

    it('through the buttons: the ask closes, the card says it changed, and the next Approve asks again about the new price', async () => {
      const onDecide = vi.fn(async () => done('Approved'));
      const { rerender } = render(<ApprovalRow layout="card" row={price} onDecide={onDecide} />);
      fireEvent.click(approveIn());
      expect(card().textContent).toContain("can't be undone");
      rerender(<ApprovalRow layout="card" row={newer} onDecide={onDecide} />);
      expect(card().textContent).not.toContain("can't be undone");
      expect(card().textContent).toContain('This changed. Here is the new version.');
      expect(card().textContent).toContain('₹90,000');
      expect(within(card()).getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
      expect(onDecide).not.toHaveBeenCalled();
      fireEvent.click(approveIn());
      await act(async () => { fireEvent.click(within(card()).getAllByRole('button', { name: 'Approve' }).at(-1)!); });
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onDecide).toHaveBeenCalledWith(newer, newer.actions[1], { viewed: false });
    });

    it('through the swipe: the open ask closes on the refresh, and pressing again only asks about the new price', () => {
      const handle = createRef<ApprovalHandle>();
      const onDecide = vi.fn(async () => done('Approved'));
      const { rerender } = render(<ApprovalRow layout="card" row={price} onDecide={onDecide} handle={handle} />);
      act(() => { handle.current!.pressPrimary(); });
      rerender(<ApprovalRow layout="card" row={newer} onDecide={onDecide} handle={handle} />);
      expect(card().textContent).not.toContain("can't be undone");
      let result: PressResult | undefined;
      act(() => { result = handle.current!.pressPrimary(); });
      expect(result).toBe('asking');
      expect(card().textContent).toContain("can't be undone");
      expect(onDecide).not.toHaveBeenCalled();
    });

    it('a refresh after Watch locks Approve again until the new version is watched', () => {
      const { rerender } = render(<ApprovalRow layout="card" row={draft} onDecide={vi.fn()} />);
      fireEvent.click(within(card()).getByRole('button', { name: 'Watch' }));
      expect(isLocked(approveIn())).toBe(false);
      rerender(<ApprovalRow layout="card" row={{ ...draft, digest: 'd1b', line: 'Recut.' }} onDecide={vi.fn()} />);
      expect(isLocked(approveIn())).toBe(true);
      expect(card().textContent).toContain('This changed. Here is the new version.');
    });

    it('a stale decision locks the new version even when the place still says the old one was viewed', async () => {
      const latest: QueueRow = { ...draft, digest: 'd1b', line: 'Recut.' };
      const onDecide = vi.fn(async (): Promise<QueueDecision> => ({ outcome: 'stale', line: 'This changed since you opened it.', latest }));
      render(<ApprovalRow layout="card" row={draft} viewed onDecide={onDecide} />);
      await act(async () => { fireEvent.click(approveIn()); });
      expect(card().textContent).toContain('Recut.');
      expect(isLocked(approveIn())).toBe(true);
    });
  });

  it('S1: two presses in the same moment send one decision', async () => {
    const handle = createRef<ApprovalHandle>();
    const onDecide = vi.fn(() => new Promise<QueueDecision>(() => {}));
    render(<ApprovalRow layout="card" row={stopped} onDecide={onDecide} handle={handle} />);
    const results: PressResult[] = [];
    await act(async () => { results.push(handle.current!.pressPrimary(), handle.current!.pressPrimary()); });
    expect(results).toEqual(['pressed', 'busy']);
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it('S1: two clicks on the confirm in the same moment send one decision', async () => {
    const onDecide = vi.fn(() => new Promise<QueueDecision>(() => {}));
    render(<ApprovalRow layout="card" row={price} onDecide={onDecide} />);
    fireEvent.click(approveIn());
    const confirm = within(card()).getAllByRole('button', { name: 'Approve' }).at(-1)!;
    await act(async () => { fireEvent.click(confirm); fireEvent.click(confirm); });
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it('S2: a card decided from inside it keeps focus on its one-line result', async () => {
    const onDecide = vi.fn(async () => done('Started again'));
    render(<ApprovalRow layout="card" row={stopped} onDecide={onDecide} />);
    const again = within(card()).getByRole('button', { name: 'Run again' });
    again.focus();
    await act(async () => { fireEvent.click(again); });
    const line = document.querySelector<HTMLElement>('article[data-decided]')!;
    expect(document.activeElement).toBe(line);
  });

  it('S3: a compact card says the business and the time when the list holds more than one business', () => {
    const { unmount } = render(<ApprovalRow layout="compact" row={quote} onDecide={vi.fn()} />);
    expect(card().querySelector('[data-meta]')!.textContent).toBe(`Ledgerline · ${time(quote.createdAt)}`);
    unmount();
    render(<ApprovalRow layout="compact" row={quote} showBusiness={false} onDecide={vi.fn()} />);
    expect(card().querySelector('[data-meta]')).toBeNull();
  });

  it('a primary that opens the thing to look at says "opened", and decides nothing', () => {
    const handle = createRef<ApprovalHandle>();
    const onDecide = vi.fn();
    const onView = vi.fn();
    const readOnly: QueueRow = { ...draft, id: 'q-read', actions: [{ id: 'deny', label: 'Reject', primary: false }, { id: 'read', label: 'Read', primary: true }] };
    render(<ApprovalRow layout="card" row={readOnly} onDecide={onDecide} onView={onView} handle={handle} />);
    let result: PressResult | undefined;
    act(() => { result = handle.current!.pressPrimary(); });
    expect(result).toBe('opened');
    expect(onView).toHaveBeenCalledTimes(1);
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('a primary that asks once more points at the note that says so', () => {
    render(<ApprovalRow layout="card" row={price} onDecide={vi.fn()} />);
    const note = card().querySelector<HTMLElement>('[data-note]')!;
    expect(approveIn().getAttribute('aria-describedby')!.split(' ')).toContain(note.id);
  });

  it('Not now in the answer box puts focus back on Answer', () => {
    render(<ApprovalRow layout="card" row={question} onDecide={vi.fn()} />);
    fireEvent.click(within(card()).getByRole('button', { name: 'Answer' }));
    fireEvent.click(within(card()).getByRole('button', { name: 'Not now' }));
    expect(document.activeElement).toBe(within(card()).getByRole('button', { name: 'Answer' }));
  });

  it('a row with three actions shows each of them, so Read is there to unlock Send to CA', () => {
    const toCa: QueueRow = {
      ...draft, id: 'q-to-ca', kind: 'draft', title: 'Draft reply for Mehta Traders', line: 'Waits for your CA.',
      actions: [{ id: 'deny', label: 'Reject', primary: false }, { id: 'read', label: 'Read', primary: false }, { id: 'send-to-ca', label: 'Send to CA', primary: true, requiresView: true }],
    };
    render(<ApprovalRow layout="card" row={toCa} onDecide={vi.fn()} />);
    expect([...card().querySelectorAll('[data-key]')].map((b) => b.textContent)).toEqual(['Reject', 'Read', 'Send to CA']);
    expect(isLocked(approveIn('Send to CA'))).toBe(true);
    fireEvent.click(within(card()).getByRole('button', { name: 'Read' }));
    expect(isLocked(approveIn('Send to CA'))).toBe(false);
    assertInkRules(document.body);
  });

  it('axe finds nothing on a card, a compact card, the second ask and the answer box', async () => {
    const { container } = render(
      <main>
        <ApprovalRow layout="card" row={post} onDecide={vi.fn()} onOpen={vi.fn()} />
        <ApprovalRow layout="compact" row={price} onDecide={vi.fn()} />
        <ApprovalRow layout="card" row={question} onDecide={vi.fn()} />
      </main>,
    );
    const violations = async () => (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(' | ')}`);
    expect(await violations()).toEqual([]);
    fireEvent.click(within(container.querySelector<HTMLElement>('[data-row-id="q-price"]')!).getByRole('button', { name: 'Approve' }));
    fireEvent.click(within(container.querySelector<HTMLElement>('[data-row-id="q-title"]')!).getByRole('button', { name: 'Answer' }));
    expect(await violations()).toEqual([]);
  });
});

// The engine's own row line (the judge's notice with its cost bound, acceptBlocked, the posting risk) can hold an
// amount the engine composed in code. Until W4 4J1 moves those amounts into receipted row meta, the line is marked
// `data-engine-line` and its money text passes the money rule; a number shown as a figure inside it is still checked.
describe('Engine lines, until W4 4J1 gives their amounts receipts', () => {
  const COST = 'The judge reads it on your own AI; each check costs up to ₹2.10.';

  it('money text inside an engine line passes; the same text in a place\'s own heading still fails', () => {
    const { unmount } = render(<p data-engine-line="">{COST}</p>);
    expect(() => assertFiguresProved(document.body)).not.toThrow();
    unmount();
    render(<h2>{COST}</h2>);
    expect(() => assertFiguresProved(document.body)).toThrow(/looks like money/);
  });

  it('a number shown as a figure inside an engine line is still checked', () => {
    render(<p data-engine-line="">Each check costs up to <span data-ui-number="">₹2.10</span>.</p>);
    expect(() => assertFiguresProved(document.body)).toThrow(/not inside a \[data-figure\]/);
  });

  it('ApprovalRow marks the engine\'s line in every layout, so a cost in it passes the rules', () => {
    const costly: QueueRow = { ...draft, id: 'q-costly', line: COST };
    for (const layout of ['row', 'card', 'compact'] as const) {
      const { unmount } = render(layout === 'row' ? <ul><ApprovalRow row={costly} onDecide={vi.fn()} /></ul> : <ApprovalRow layout={layout} row={costly} onDecide={vi.fn()} />);
      const lines = document.querySelectorAll('[data-engine-line]');
      expect(lines, layout).toHaveLength(1);
      expect(lines[0]!.textContent, layout).toBe(COST);
      assertInkRules(document.body);
      unmount();
    }
  });

  it('a question\'s line is both the engine\'s line and the agent\'s quoted words', () => {
    for (const layout of ['row', 'card'] as const) {
      const { unmount } = render(layout === 'row' ? <ul><ApprovalRow row={question} onDecide={vi.fn()} /></ul> : <ApprovalRow layout="card" row={question} onDecide={vi.fn()} />);
      const line = document.querySelector('[data-engine-line]')!;
      expect(line.hasAttribute('data-content'), layout).toBe(true);
      unmount();
    }
  });
});
