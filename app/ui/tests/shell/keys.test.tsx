import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { useShellKeys, readKey } from '../../src/shell/keys';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import type { QueueRow } from '../../src/engine/types';

const row = (id: string, label: string, secondAsk = false): QueueRow => ({
  id, businessId: 'lumen', businessName: 'Lumen Studio', kind: 'price', createdAt: '2026-10-21T08:00:00Z', digest: `d-${id}`, title: `Row ${id}`,
  actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label, primary: true, secondAsk }],
});

function Harness({ onDecide, onClose, onOpen }: { onDecide: (...args: unknown[]) => Promise<never>; onClose: () => void; onOpen: () => void }) {
  const main = useRef<HTMLElement>(null);
  useShellKeys({ mainRef: main, onClose });
  return (
    <main ref={main}>
      <input aria-label="Search" />
      <ul>
        <ApprovalRow row={row('1', 'Approve one')} onDecide={onDecide} onOpen={onOpen} />
        <ApprovalRow row={row('2', 'Approve money', true)} onDecide={onDecide} />
      </ul>
    </main>
  );
}

const press = (key: string, target: Element = document.activeElement ?? document.body) => fireEvent.keyDown(target, { key });

describe('keys', () => {
  it('reads only plain keys, and Esc everywhere', () => {
    expect(readKey(new KeyboardEvent('keydown', { key: 'j' }))).toBe('next');
    expect(readKey(new KeyboardEvent('keydown', { key: 'J' }))).toBe('next');
    expect(readKey(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true }))).toBeNull();
    expect(readKey(new KeyboardEvent('keydown', { key: 'a', altKey: true }))).toBeNull();
    const input = document.createElement('input');
    expect(readKey(Object.assign(new KeyboardEvent('keydown', { key: 'a' }), {}), input)).toBeNull();
    expect(readKey(new KeyboardEvent('keydown', { key: 'Escape' }), input)).toBe('close');
  });

  it('J and K move between rows, Enter opens, A runs the primary, D the secondary', async () => {
    const onDecide = vi.fn(async () => ({ outcome: 'done', line: 'Done' }) as never);
    const onOpen = vi.fn();
    const { container } = render(<Harness onDecide={onDecide} onClose={vi.fn()} onOpen={onOpen} />);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-row]')];
    press('j', document.body);
    expect(document.activeElement).toBe(rows[0]);
    press('j');
    expect(document.activeElement).toBe(rows[1]);
    press('k');
    expect(document.activeElement).toBe(rows[0]);
    press('Enter');
    expect(onOpen).toHaveBeenCalledOnce();
    rows[0]!.focus();
    await act(async () => { press('a'); });
    expect(onDecide).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), expect.objectContaining({ id: 'approve' }), { viewed: false });
  });

  it('A and D never act on a row that takes a second ask', async () => {
    const onDecide = vi.fn(async () => ({ outcome: 'done', line: 'Done' }) as never);
    const { container } = render(<Harness onDecide={onDecide} onClose={vi.fn()} onOpen={vi.fn()} />);
    const money = container.querySelectorAll<HTMLElement>('[data-row]')[1]!;
    money.focus();
    await act(async () => { press('a'); press('d'); });
    expect(onDecide).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("can't be undone");
    screen.getByRole('button', { name: 'Approve money' }).focus();
    await act(async () => { press('a'); });
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('typing in a field is never a shortcut; Esc closes the sheet even from a field', () => {
    const onDecide = vi.fn();
    const onClose = vi.fn();
    render(<Harness onDecide={onDecide as never} onClose={onClose} onOpen={vi.fn()} />);
    const input = screen.getByLabelText('Search');
    input.focus();
    press('a', input);
    press('j', input);
    expect(document.activeElement).toBe(input);
    expect(onDecide).not.toHaveBeenCalled();
    press('Escape', input);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
