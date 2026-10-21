import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import type { QueueDecision, QueueRow } from '../../src/engine/types';

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
    expect(approve.disabled).toBe(true);
    expect(document.getElementById(approve.getAttribute('aria-describedby')!)?.textContent).toBe('Approve unlocks after you open it.');
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    expect(onView).toHaveBeenCalledWith(draft);
    expect(approve.disabled).toBe(false);
    await act(async () => { fireEvent.click(approve); });
    expect(onDecide).toHaveBeenCalledWith(draft, draft.actions[1], { viewed: true });
  });

  it('a controlled viewed flag works the same way', () => {
    const { rerender } = render(<ul><ApprovalRow row={draft} onDecide={vi.fn()} viewed={false} /></ul>);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ul><ApprovalRow row={draft} onDecide={vi.fn()} viewed /></ul>);
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(false);
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

  it('an answer row asks for words inside the row', async () => {
    const question: QueueRow = { ...signoff, kind: 'question', actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'answer', label: 'Answer', primary: true }] };
    const onDecide = vi.fn(async () => done('Answered'));
    list(<ApprovalRow row={question} onDecide={onDecide} />);
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'Option B' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send answer' })); });
    expect(onDecide).toHaveBeenCalledWith(question, question.actions[1], { viewed: false, answer: 'Option B' });
  });
});
