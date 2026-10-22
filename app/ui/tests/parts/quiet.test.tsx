import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Receipt } from '../../src/parts/Receipt';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import type { QueueRow } from '../../src/engine/types';
import { kindPrefix } from '../../src/shell/BusinessMenu';

describe('Receipt reads quietly', () => {
  it('shows a short reference as itself', () => {
    render(<Receipt id="R-0412" onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Receipt R-0412' }).textContent).toBe('R-0412');
  });

  it('shows a long engine id as the word, keeps the whole id for the screen reader, and opens it', () => {
    const onOpen = vi.fn();
    const id = 'sum_1792ea30-606a-4150-91e9-e30c0a428d4c';
    render(<Receipt id={id} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: `Receipt ${id}` });
    expect(button.textContent).toBe('receipt');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledWith(id);
  });
});

describe('ApprovalRow names the business only when it helps', () => {
  const row: QueueRow = {
    id: 'q-1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'draft', title: 'Episode 14 is cut',
    digest: 'd1', createdAt: '2026-10-21T09:00:00.000Z', actions: [{ id: 'approve', label: 'Approve', primary: true }],
  };
  const decide = vi.fn();

  it('says business and agent by default', () => {
    render(<ul><ApprovalRow row={row} onDecide={decide} /></ul>);
    expect(screen.getByText('Lumen Studio · Editor')).toBeTruthy();
  });

  it('says only the agent when the list holds one business', () => {
    render(<ul><ApprovalRow row={row} onDecide={decide} showBusiness={false} /></ul>);
    expect(screen.getByText('Editor')).toBeTruthy();
    expect(screen.queryByText(/Lumen Studio/)).toBeNull();
  });
});

describe('The business button says the kind once', () => {
  it('shows the kind before switch, but not when the business is named after it', () => {
    expect(kindPrefix('YouTube channel', 'Lumen Studio')).toBe('YouTube channel · ');
    expect(kindPrefix('YouTube channel', 'YouTube channel')).toBe('');
    expect(kindPrefix(null, 'Lumen Studio')).toBe('');
  });
});
