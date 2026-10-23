import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import type { QueueRow } from '../../src/engine/types';

// Ink v2 wave 1 (H21): a row that proposes an outside action says whether its description shows everything it will
// send. Only an explicit false shows the warning; rows that propose nothing outside leave the field out.
const INCOMPLETE = "This description is incomplete: part of what this will send isn't shown.";
const post = (descriptionComplete?: boolean): QueueRow => ({
  id: 'post:p1:abc', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Social writer', kind: 'connector', createdAt: '2026-10-23T08:00:00Z', digest: 'd1',
  title: 'Post to LinkedIn', line: 'From your own browser on this computer.', viewRef: { kind: 'draft', id: 'p1' },
  actions: [{ id: 'deny', label: 'Do not post', primary: false }, { id: 'approve', label: 'Approve and post', primary: true, secondAsk: true, requiresView: true }],
  ...(descriptionComplete === undefined ? {} : { descriptionComplete }),
});
const list = (row: QueueRow) => render(<ul><ApprovalRow row={row} onDecide={vi.fn()} /></ul>);

describe('ApprovalRow: incomplete descriptions', () => {
  it('says the description is incomplete when the engine marks it so', () => {
    const { container } = list(post(false));
    expect(screen.getByText(INCOMPLETE)).toBeTruthy();
    expect(container.querySelector('[data-row]')!.textContent).toContain(INCOMPLETE);
  });

  it('says nothing when the description is complete, or when the row proposes no outside action', () => {
    list(post(true));
    expect(screen.queryByText(INCOMPLETE)).toBeNull();
    list(post());
    expect(screen.queryByText(INCOMPLETE)).toBeNull();
  });
});
