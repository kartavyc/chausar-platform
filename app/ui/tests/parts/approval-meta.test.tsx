import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { ApprovalRow, timeOf, type ApprovalHandle, type ApprovalToolsApi } from '../../src/parts/ApprovalRow';
import { SwipeCard } from '../../src/parts/SwipeCard';
import { ClockProvider } from '../../src/shell/clock';
import { TextProvider } from '../../src/text';
import { assertInkRules } from '../helpers/ink-rules';
import type { QueueDecision, QueueRow } from '../../src/engine/types';

/*
 * W4 4J19: what the engine says about a row beyond its title and line (4J1's row meta, 4J16's quote fixes), on the
 * card: who it is for, the business, the time and a real expiry, how long it waited, where approving sends something,
 * the try and its last error, counts against the platform's limits, the price beside Approve with its receipt and the
 * free way, a plan's change count folded with its coverage line, amounts at their exact places with their receipts, the
 * stale click's words, and Ctrl+Enter for a plain yes or no only.
 */

const NOW = new Date('2026-10-23T10:00:00.000Z');
const at = '2026-10-23T09:20:00.000Z';

const invoice: QueueRow = {
  id: 'invoice:inv-42:v1', businessId: 'ledgerline', businessName: 'Ledgerline', agent: 'Billing', kind: 'invoice', createdAt: at, digest: 'd1',
  title: 'Invoice INV-0042', line: 'Monthly books for September, due in 15 days.',
  actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'issue', label: 'Issue', primary: true, secondAsk: true }],
  meta: { client: 'Mehta Traders', business: 'Ledgerline', at, expiresAt: '2026-10-23T12:00:00.000Z', waitingLong: 'Waiting since yesterday' },
};

const quote: QueueRow = {
  id: 'run:r1:send-c1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'quote', createdAt: at, digest: 'd2',
  title: 'Send the draft to your AI', line: 'The judge reads it on your own AI; each check costs up to ₹2.10.',
  actions: [{ id: 'deny', label: 'No', primary: false }, { id: 'approve', label: 'Approve', primary: true }],
  meta: { client: null, business: 'Lumen Studio', at, quoteFixes: ['Moved the quote "five mics" to 04:12, where the transcript says it.'] },
  price: { display: '₹4.20', receiptId: 'fig:cost:r1:c1', line: 'Nothing spent yet', free: 'Or use the built-in template, free' },
  amounts: [
    { text: '₹2.10', where: 'line', start: 58, length: 5, receiptId: 'fig:judge:r1:c1' },
    { text: '₹4.20', where: 'price', start: 0, length: 5, receiptId: 'fig:cost:r1:c1' },
  ],
};

const post: QueueRow = {
  id: 'post:p1:v1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Publisher', kind: 'connector', createdAt: at, digest: 'd3',
  title: 'Post to LinkedIn', line: 'From your own browser on this computer.', viewRef: { kind: 'draft', id: 'p1' }, descriptionComplete: true,
  actions: [{ id: 'deny', label: 'Do not post', primary: false }, { id: 'approve', label: 'Approve and post', primary: true, secondAsk: true }],
  sendsTo: 'public', counts: [{ label: 'Characters', count: 212, limit: 3000 }],
};

const again: QueueRow = {
  id: 'run:r9:again', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'question', createdAt: at, digest: 'd4',
  title: 'Thumbnail set failed', line: 'ffmpeg was not found on this computer.', viewRef: { kind: 'run', id: 'r9' },
  actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'run-again', label: 'Run again', primary: true }],
  attempt: { n: 2, lastError: 'ffmpeg was not found on this computer.' },
};

const plan: QueueRow = {
  id: 'plan:bp2:v2', businessId: 'ledgerline', businessName: 'Ledgerline', kind: 'plan', createdAt: at, digest: 'd5',
  title: 'Your plan changed. Read it.', line: 'Monthly books for small traders.', viewRef: { kind: 'plan', id: 'bp2' },
  change: { label: 'Monthly books', before: '₹10,000', after: '₹12,000' },
  actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, requiresView: true }],
  changeCount: { line: '1 price changed · 2 steps added', details: ['Monthly books: ₹10,000 to ₹12,000', 'Step added: GST working'], coverage: "This comparison doesn't cover wording changes." },
  amounts: [
    { text: '₹10,000', where: 'change.before', start: 0, length: 7, receiptId: 'fig:plan:bp2' },
    { text: '₹12,000', where: 'change.after', start: 0, length: 7, receiptId: 'fig:plan:bp2' },
    { text: '₹10,000', where: 'details', index: 0, start: 15, length: 7, receiptId: 'fig:plan:bp2' },
    { text: '₹12,000', where: 'details', index: 0, start: 26, length: 7, receiptId: 'fig:plan:bp2' },
  ],
  meta: { client: null, business: 'Ledgerline', at, staleDraft: 'This draft is 15 days old. Check it still fits.' },
};

const plain: QueueRow = {
  id: 'spot:s1:v1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'draft', createdAt: at, digest: 'd6',
  title: 'Spot check of episode 13', line: 'Read it and say yes or no.',
  actions: [{ id: 'deny', label: 'No', primary: false }, { id: 'approve', label: 'Approve', primary: true }],
};

function card(row: QueueRow, props: Partial<Parameters<typeof ApprovalRow>[0]> = {}) {
  const onDecide = vi.fn(async (): Promise<QueueDecision> => ({ outcome: 'done', line: 'Approved' }));
  render(
    <ClockProvider now={() => NOW}>
      <TextProvider language="en"><main><ApprovalRow layout="card" row={row} onDecide={onDecide} showBusiness {...props} /></main></TextProvider>
    </ClockProvider>,
  );
  return { onDecide, article: document.querySelector<HTMLElement>('article[data-card]')! };
}

describe('the card meta line (4J1 meta)', () => {
  it('reads "for Mehta Traders · Ledgerline · 09:20 · expires in 2 h" and how long it waited, in the wait tone', () => {
    const { article } = card(invoice);
    const meta = article.querySelector('[data-meta]')!;
    expect(meta.textContent).toBe(`for Mehta Traders · Ledgerline · ${timeOf(at, 'en')} · expires in 2 h · Waiting since yesterday`);
    expect(meta.querySelector('[data-meta-expires]')).not.toBeNull();
    expect(meta.querySelector('[data-meta-waiting]')!.textContent).toBe('Waiting since yesterday');
    assertInkRules(document.body);
  });

  it('leaves the client out where the card already names them: in its title, or on the paper it shows', () => {
    const { article } = card({ ...invoice, title: 'Invoice INV-0042 to Mehta Traders' });
    expect(article.querySelector('[data-meta-client]')).toBeNull();
    document.body.innerHTML = '';
    const paper = card({
      ...invoice,
      preview: { kind: 'paper', paper: 'working', title: 'GST working', client: 'Mehta Traders', working: [{ label: 'Net', value: 'INR 1.00', receiptId: 'w-1', receiptKind: 'ca' }], more: 0, signer: null },
    });
    expect(paper.article.querySelector('[data-meta-client]')).toBeNull();
  });

  it('says nothing about an expiry or a client the engine did not send, and "expired" once the time is past', () => {
    const { article, onDecide: _ } = card({ ...invoice, meta: { client: null, business: 'Ledgerline', at, expiresAt: '2026-10-23T09:00:00.000Z' } });
    expect(article.querySelector('[data-meta]')!.textContent).toBe(`Ledgerline · ${timeOf(at, 'en')} · expired`);
    expect(article.querySelector('[data-meta-client]')).toBeNull();
  });
});

describe('the facts under the line', () => {
  it('a post says where it goes; its count against the platform limit shows only near the limit (4Z2)', () => {
    const far = card(post).article;
    expect(far.querySelector('[data-sends-to="public"]')!.textContent).toBe('Goes public');
    expect(far.querySelector('[data-count-of]')).toBeNull();
    document.body.innerHTML = '';
    const { article } = card({ ...post, counts: [{ label: 'Characters', count: 2850, limit: 3000 }] });
    const count = article.querySelector('[data-count-of]')!;
    expect(count.textContent).toBe('Characters 2,850 of 3,000');
    expect(count.querySelectorAll('[data-count]')).toHaveLength(2);
    expect(count.hasAttribute('data-over')).toBe(false);
    assertInkRules(document.body);
  });

  it('a count over the limit says so in words and with a mark, not by colour alone', () => {
    const { article } = card({ ...post, counts: [{ label: 'Characters', count: 3120, limit: 3000 }] });
    const count = article.querySelector('[data-count-of]')!;
    expect(count.hasAttribute('data-over')).toBe(true);
    expect(count.textContent).toBe('Characters 3,120 of 3,000 · over the limit');
    expect(count.querySelector('svg')).not.toBeNull();
  });

  it('a Run again row says the try and what went wrong last time', () => {
    const { article } = card(again);
    expect(article.querySelector('[data-attempt]')!.textContent).toBe('Try 2. Last time: ffmpeg was not found on this computer.');
  });

  it('"Sends to the client" when the engine says the approval sends to the client, and nothing when it sends nothing', () => {
    const { article } = card({ ...plain, sendsTo: 'client' });
    expect(within(article).getByText('Sends to the client')).toBeTruthy();
  });

  it('a plan shows its change count with the details folded, each amount with its receipt, and the coverage line', () => {
    const { article } = card(plan);
    const fold = article.querySelector<HTMLDetailsElement>('details[data-change-count]')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('1 price changed · 2 steps added');
    expect(fold.querySelector('[data-coverage]')!.textContent).toBe("This comparison doesn't cover wording changes.");
    const first = fold.querySelectorAll('li')[0]!;
    expect([...first.querySelectorAll('[data-figure] [data-ui-number]')].map((n) => n.textContent)).toEqual(['₹10,000', '₹12,000']);
    expect(first.querySelectorAll('[data-receipt="fig:plan:bp2"]')).toHaveLength(2);
    expect(first.hasAttribute('data-engine-line')).toBe(false);
    // The change itself takes the plan's receipt from its amounts.
    expect(article.querySelector('[data-figure-group] [data-receipt="fig:plan:bp2"]')).not.toBeNull();
    expect(article.querySelector('[data-stale-draft]')!.textContent).toBe('This draft is 15 days old. Check it still fits.');
    assertInkRules(document.body);
  });
});

describe('the price beside Approve and amounts at their places', () => {
  it('shows "₹4.20, nothing spent yet" with its receipt, the free way, and the quotes code moved', () => {
    const { article } = card(quote);
    const price = article.querySelector('[data-price]')!;
    expect(price.querySelector('[data-ui-number]')!.textContent).toBe('₹4.20');
    expect(price.querySelector('[data-receipt="fig:cost:r1:c1"]')).not.toBeNull();
    expect(price.textContent).toContain('Nothing spent yet');
    expect(article.querySelector('[data-free]')!.textContent).toBe('Or use the built-in template, free');
    expect(article.querySelector('[data-quote-fixes]')!.textContent).toContain('Moved the quote "five mics" to 04:12');
    assertInkRules(document.body);
  });

  it('the line draws each amount the engine proved as a figure with its receipt, and drops the engine-line stopgap', () => {
    const { article } = card(quote);
    const line = article.querySelector('h3 + p')!;
    expect(line.textContent).toContain('each check costs up to ₹2.10');
    expect(line.hasAttribute('data-engine-line')).toBe(false);
    expect(line.querySelector('[data-figure] [data-receipt="fig:judge:r1:c1"]')).not.toBeNull();
    assertInkRules(document.body);
  });

  it('keeps the stopgap on a line whose amount the engine did not prove', () => {
    const { article } = card({ ...quote, amounts: [] });
    expect(article.querySelector('h3 + p')!.hasAttribute('data-engine-line')).toBe(true);
  });
});

describe('a stale click', () => {
  it('says "This click did not run anything. Here is the new version." and shows the new version', async () => {
    const latest = { ...plain, digest: 'd6b', title: 'Spot check of episode 13, revised' };
    const onDecide = vi.fn(async (): Promise<QueueDecision> => ({ outcome: 'stale', line: 'This click did not run anything. Here is the new version.', latest }));
    const { article } = card(plain, { onDecide });
    await act(async () => { fireEvent.click(within(article).getByRole('button', { name: 'Approve' })); });
    expect(article.textContent).toContain('This click did not run anything. Here is the new version.');
    expect(within(article).getByRole('heading', { level: 3 }).textContent).toBe('Spot check of episode 13, revised');
  });
});

describe('Ctrl+Enter approves only a plain yes or no (O7)', () => {
  it('approves a plain row, with Cmd+Enter too', async () => {
    const { article, onDecide } = card(plain);
    article.focus();
    await act(async () => { fireEvent.keyDown(article, { key: 'Enter', ctrlKey: true }); });
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect((onDecide.mock.calls[0] as unknown[])[1]).toMatchObject({ id: 'approve' });
  });

  it('never a row that asks twice, needs an answer, or is locked until read', async () => {
    for (const row of [post, again, plan]) {
      const { article, onDecide } = card(row);
      await act(async () => { fireEvent.keyDown(article, { key: 'Enter', ctrlKey: true }); });
      expect(onDecide, row.id).not.toHaveBeenCalled();
      document.body.innerHTML = '';
    }
  });

  it('never while a draft tool is open on the card, or while the owner types', async () => {
    let api: ApprovalToolsApi | undefined;
    const tools = (given: ApprovalToolsApi) => { api = given; return given.open ? <textarea aria-label="Your words" /> : null; };
    const { article, onDecide } = card(plain, { tools });
    await act(async () => { api!.setOpen(true); });
    expect(within(article).queryByRole('button', { name: 'Approve' })).toBeNull();
    await act(async () => { fireEvent.keyDown(article, { key: 'Enter', ctrlKey: true }); });
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your words' }), { key: 'Enter', ctrlKey: true }); });
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('a tool\'s decision shrinks the card to its line with Undo, which shows the engine\'s words', async () => {
    let api: ApprovalToolsApi | undefined;
    const tools = (given: ApprovalToolsApi) => { api = given; return null; };
    const { article } = card(plain, { tools });
    const undo = vi.fn(async () => 'Restored until you edit this again.');
    await act(async () => { api!.finish({ outcome: 'done', line: 'Sent back. The revision waits for your approval before anything goes to your AI.' }, undo); });
    const decided = document.querySelector('[data-decided]')!;
    expect(decided.textContent).toContain('Sent back.');
    await act(async () => { fireEvent.click(within(decided as HTMLElement).getByRole('button', { name: 'Undo' })); });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-decided]')!.textContent).toContain('Restored until you edit this again.');
  });

  it('on a phone, Undo is as large as the card\'s other buttons', async () => {
    let api: ApprovalToolsApi | undefined;
    const tools = (given: ApprovalToolsApi) => { api = given; return null; };
    card(plain, { tools, buttonSize: 'xl' });
    await act(async () => { api!.finish({ outcome: 'done', line: 'Sent back.' }, async () => 'Restored until you edit this again.'); });
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('data-size')).toBe('xl');
  });
});

describe('an open tool holds the card: no press and no swipe decides it (4J19 review)', () => {
  it('pressing through the handle while Send back is open only keeps asking, and decides nothing', async () => {
    let api: ApprovalToolsApi | undefined;
    const tools = (given: ApprovalToolsApi) => { api = given; return given.open ? <textarea aria-label="Your words" /> : null; };
    const handle = createRef<ApprovalHandle>();
    const { onDecide } = card(plain, { tools, handle });
    await act(async () => { api!.setOpen(true); });
    let result: string | undefined;
    await act(async () => { result = handle.current!.pressPrimary(); });
    expect(result).toBe('asking');
    await act(async () => { handle.current!.pressLater(); });
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('a swipe that starts in a field or inside an open tool is not a swipe', () => {
    const onRight = vi.fn();
    const pointer = { pointerId: 9, button: 0, pointerType: 'touch' };
    const dragFrom = (target: Element) => {
      fireEvent.pointerDown(target, { ...pointer, clientX: 100, clientY: 100 });
      for (const part of [0.25, 0.5, 1]) fireEvent.pointerMove(target, { ...pointer, clientX: 100 + 120 * part, clientY: 100 });
      fireEvent.pointerUp(target, { ...pointer, clientX: 220, clientY: 100 });
    };
    render(
      <TextProvider language="en">
        <SwipeCard rightLabel="Approve" leftLabel="Later" onRight={onRight} onLeft={vi.fn()}>
          <article data-card="">
            <textarea aria-label="Your words" />
            <div data-no-swipe=""><p>Send back box</p></div>
            <h3>Spot check</h3>
          </article>
        </SwipeCard>
      </TextProvider>,
    );
    dragFrom(screen.getByRole('textbox', { name: 'Your words' }));
    dragFrom(screen.getByText('Send back box'));
    expect(onRight).not.toHaveBeenCalled();
    dragFrom(screen.getByRole('heading', { name: 'Spot check' }));
    expect(onRight).toHaveBeenCalledTimes(1);
  });
});
