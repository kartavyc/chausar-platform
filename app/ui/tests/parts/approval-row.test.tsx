import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApprovalRow, readBack } from '../../src/parts/ApprovalRow';
import { EngineError, type QueueDecision, type QueueList, type QueueRow } from '../../src/engine/types';

const price: QueueRow = {
  id: 'q1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'price', createdAt: '2026-10-21T08:00:00Z', digest: 'd1',
  title: 'Sponsor slot price', change: { before: '₹25,000', after: '₹30,000', receiptId: 'R-0415' },
  actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }],
};
const draft: QueueRow = {
  id: 'q2', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'draft', createdAt: '2026-10-21T08:00:00Z', digest: 'd2',
  title: 'Episode 14 is cut', line: '11 min 42 s. Watch it before approving.', viewRef: { kind: 'draft', id: 'ep14' },
  actions: [{ id: 'watch', label: 'Watch', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
};
const signoff: QueueRow = {
  id: 'q3', businessId: 'ledgerline', businessName: 'Ledgerline', agent: 'Bookkeeper', kind: 'signoff', createdAt: '2026-10-21T08:00:00Z', digest: 'd3',
  title: 'GST working for September', line: 'Ready for your CA to sign off.',
  actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'send-to-ca', label: 'Send to CA', primary: true }],
};
const done = (line: string, receiptId?: string): QueueDecision => (receiptId ? { outcome: 'done', line, receiptId } : { outcome: 'done', line });
const list = (node: React.ReactNode) => render(<ul>{node}</ul>);

describe('ApprovalRow', () => {
  it('shows business · agent, title, line, the change and two actions with exactly one filled primary on the right', () => {
    const { container } = list(<ApprovalRow row={price} onDecide={vi.fn()} />);
    expect(container.textContent).toContain('Lumen Studio · Producer');
    expect(screen.getByText('Sponsor slot price')).toBeTruthy();
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-key]')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Deny', 'Approve']);
    expect(buttons.filter((b) => b.dataset.variant === 'primary')).toHaveLength(1);
    expect(buttons[1]!.dataset.variant).toBe('primary');
    expect(container.querySelector('del')?.textContent).toBe('₹25,000');
  });

  it('a second ask confirms inside the row before deciding, and marks the row so A never runs it', async () => {
    const onDecide = vi.fn(async () => done('Approved · R-0421', 'R-0421'));
    const { container } = list(<ApprovalRow row={price} onDecide={onDecide} />);
    expect(container.querySelector('[data-row]')!.hasAttribute('data-second-ask')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onDecide).not.toHaveBeenCalled();
    expect(container.textContent).toContain("This can't be undone. Approve?");
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(container.textContent).not.toContain("can't be undone");
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Approve' }).at(-1)!); });
    expect(onDecide).toHaveBeenCalledWith(price, price.actions[1], { viewed: false });
  });

  it('a decided row shrinks to its receipt line', async () => {
    const onDecide = vi.fn(async () => done('Sent to your CA'));
    const { container } = list(<ApprovalRow row={signoff} onDecide={onDecide} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(container.querySelector('[data-row]')!.hasAttribute('data-decided')).toBe(true);
    expect(container.textContent).toBe('GST working for September · Sent to your CA');
    expect(container.querySelectorAll('[data-key]')).toHaveLength(0);
  });

  it('the receipt in a decided line opens the receipt', async () => {
    const onDecide = vi.fn(async () => done('Approved · R-0421', 'R-0421'));
    list(<ApprovalRow row={signoff} onDecide={onDecide} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(screen.getByRole('button', { name: 'Receipt R-0421' })).toBeTruthy();
  });

  it('requiresView locks the primary until the draft was opened', async () => {
    const onView = vi.fn();
    const onDecide = vi.fn(async () => done('Approved'));
    list(<ApprovalRow row={draft} onDecide={onDecide} onView={onView} />);
    const approve = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    // Ink v2 (3B1a, 3B5a): a locked primary is Button's `locked`, aria-disabled rather than disabled, so it stays in
    // the Tab order; its description holds the reason among Button's own words.
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(approve);
    expect(onDecide).not.toHaveBeenCalled();
    const described = approve.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('Approve unlocks after you open it.');
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(onView).toHaveBeenCalledWith(draft);
    expect(approve.hasAttribute('aria-disabled')).toBe(false);
    expect(approve.disabled).toBe(false);
    await act(async () => { fireEvent.click(approve); });
    expect(onDecide).toHaveBeenCalledWith(draft, draft.actions[1], { viewed: true });
  });

  it('a controlled viewed flag works the same way', () => {
    const { rerender } = render(<ul><ApprovalRow row={draft} onDecide={vi.fn()} viewed={false} /></ul>);
    expect(screen.getByRole('button', { name: 'Approve' }).getAttribute('aria-disabled')).toBe('true');
    rerender(<ul><ApprovalRow row={draft} onDecide={vi.fn()} viewed /></ul>);
    expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('aria-disabled')).toBe(false);
  });

  it('a stale decision says so, shows the new version and asks again', async () => {
    const latest: QueueRow = { ...signoff, digest: 'd3b', line: 'The client sent two more invoices. Ready again.' };
    const onDecide = vi.fn<(...args: unknown[]) => Promise<QueueDecision>>()
      .mockResolvedValueOnce({ outcome: 'stale', line: 'This changed since you opened it.', latest })
      .mockResolvedValueOnce(done('Sent to your CA'));
    const { container } = list(<ApprovalRow row={signoff} onDecide={onDecide} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(container.textContent).toContain('This changed since you opened it.');
    expect(container.textContent).toContain('The client sent two more invoices. Ready again.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(onDecide).toHaveBeenLastCalledWith(latest, latest.actions[1], { viewed: false });
  });

  it('a refusal is shown in words; a row decided elsewhere shrinks', async () => {
    const onDecide = vi.fn<(...args: unknown[]) => Promise<QueueDecision>>()
      .mockResolvedValueOnce({ outcome: 'refused', line: 'Open it first, then approve.', reason: 'VIEW_FIRST' })
      .mockResolvedValueOnce({ outcome: 'refused', line: 'You decided this already.', reason: 'ALREADY_DECIDED' });
    const { container } = list(<ApprovalRow row={signoff} onDecide={onDecide} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(container.textContent).toContain('Open it first, then approve.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(container.textContent).toBe('GST working for September · Resolved elsewhere');
  });

  describe('a decision that timed out (REQUEST_TIMEOUT)', () => {
    const timedOut = () => Promise.reject(new EngineError('REQUEST_TIMEOUT', 'The engine did not answer in time.'));
    const send = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });

    it('reads back what the engine stored and shows that, not "Couldn\'t send"', async () => {
      const onReread = vi.fn(async () => done('Sent to your CA'));
      const onDecide = vi.fn(timedOut);
      const { container } = list(<ApprovalRow row={signoff} onDecide={onDecide} onReread={onReread} />);
      await send();
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onReread).toHaveBeenCalledTimes(1);
      expect(onReread).toHaveBeenCalledWith(signoff);
      expect(container.textContent).toBe('GST working for September · Sent to your CA');
    });

    it('a read-back that finds a newer version shows it, as any stale decision does', async () => {
      const latest: QueueRow = { ...signoff, digest: 'd3b', line: 'The client sent two more invoices. Ready again.' };
      const onDecide = vi.fn(timedOut);
      const { container } = list(<ApprovalRow row={signoff} onDecide={onDecide} onReread={async () => ({ outcome: 'stale', line: 'This changed since you opened it.', latest })} />);
      await send();
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(container.textContent).toContain('This changed since you opened it.');
      expect(container.textContent).toContain('The client sent two more invoices. Ready again.');
      expect(container.textContent).not.toContain("Couldn't send");
    });

    it('says "Couldn\'t send" only when the read-back fails too, or there is no way to read back', async () => {
      const onReread = vi.fn(async (): Promise<QueueDecision> => { throw new EngineError('ENGINE_STOPPED', 'The engine stopped.'); });
      const onDecide = vi.fn(timedOut);
      const first = list(<ApprovalRow row={signoff} onDecide={onDecide} onReread={onReread} />);
      await send();
      expect(onDecide).toHaveBeenCalledTimes(1);
      expect(onReread).toHaveBeenCalledTimes(1);
      expect(first.container.textContent).toContain("Couldn't send: The engine did not answer in time.");
      first.unmount();

      const second = list(<ApprovalRow row={signoff} onDecide={vi.fn(timedOut)} />);
      await send();
      expect(second.container.textContent).toContain("Couldn't send: The engine did not answer in time.");
      second.unmount();

      const other = vi.fn(async (): Promise<QueueDecision> => done('Sent'));
      const third = list(<ApprovalRow row={signoff} onDecide={vi.fn(() => Promise.reject(new EngineError('ENGINE_STOPPED', 'The engine stopped.')))} onReread={other} />);
      await send();
      expect(other).not.toHaveBeenCalled();
      expect(third.container.textContent).toContain("Couldn't send: The engine stopped.");
    });

    it('readBack never decides again: it reads the list and says what the engine holds', () => {
      const t = (key: string) => key;
      const listOf = (rows: QueueRow[]): QueueList => ({ rows, summary: '', needsYou: rows.length, businesses: 1 });
      expect(readBack(listOf([price]), signoff, t)).toEqual({ outcome: 'done', line: 'approval.afterWait' });
      expect(readBack(listOf([signoff]), signoff, t)).toEqual({ outcome: 'refused', reason: 'NOT_RECORDED', line: 'approval.notYet' });
      const newer = { ...signoff, digest: 'd3b' };
      expect(readBack(listOf([newer]), signoff, t)).toEqual({ outcome: 'stale', line: 'approval.stale', latest: newer });
    });
  });

  it('an answer row asks for words inside the row', async () => {
    const question: QueueRow = { ...signoff, kind: 'question', actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'answer', label: 'Answer', primary: true }] };
    const onDecide = vi.fn(async () => done('Answered'));
    list(<ApprovalRow row={question} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Option B' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send answer' })); });
    expect(onDecide).toHaveBeenCalledWith(question, question.actions[1], { viewed: false, answer: 'Option B' });
  });

  it('while a post is going out, its row asks the owner not to type in the browser window (Ink v2 wave 2, K1)', async () => {
    const post: QueueRow = {
      id: 'post:p1', businessId: 'lumen', businessName: 'Lumen Studio', kind: 'connector', createdAt: '2026-10-23T08:00:00Z', digest: 'dp',
      title: 'Post to LinkedIn', line: "Chausar will post in a browser window on this computer. Please don't type in that window until the post is done.",
      actions: [{ id: 'deny', label: 'Do not post', primary: false }, { id: 'approve', label: 'Approve and post', primary: true, secondAsk: true }],
    };
    const POSTING = "Chausar is posting. Please don't type in that window until it is done.";
    let finish: (decision: QueueDecision) => void = () => {};
    const onDecide = vi.fn(() => new Promise<QueueDecision>((resolve) => { finish = resolve; }));
    const first = list(<ApprovalRow row={post} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and post' }));
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Approve and post' }).at(-1)!); });
    expect(screen.getByText(POSTING)).toBeTruthy();
    await act(async () => { finish(done('Posted to LinkedIn.')); });
    expect(screen.queryByText(POSTING)).toBeNull();
    first.unmount();

    // Do not post sends nothing to a browser: no such line while it is recorded.
    const denying = vi.fn(() => new Promise<QueueDecision>(() => {}));
    const second = list(<ApprovalRow row={post} onDecide={denying} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Do not post' })); });
    expect(denying).toHaveBeenCalled();
    expect(screen.queryByText(POSTING)).toBeNull();
    second.unmount();

    // Another kind of row says nothing of the kind while it sends.
    const pending = vi.fn(() => new Promise<QueueDecision>(() => {}));
    list(<ApprovalRow row={signoff} onDecide={pending} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send to CA' })); });
    expect(screen.queryByText(POSTING)).toBeNull();
  });
});
