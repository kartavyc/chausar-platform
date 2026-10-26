import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Receipt } from '../../src/parts/Receipt';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import type { QueueRow } from '../../src/engine/types';
import { kindLine } from '../../src/shell/BusinessMenu';

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

  it('keeps the receipt icon on a long id too, and the word is not set in mono', () => {
    render(<Receipt id="sum_1792ea30-606a-4150-91e9-e30c0a428d4c" onOpen={vi.fn()} />);
    const button = screen.getByRole('button', { name: /^Receipt sum_/ });
    expect(button.querySelector('svg.lucide-receipt-text')).not.toBeNull();
    expect(button.classList.contains('mono')).toBe(false);
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
  it('shows the kind under the name, but not when the business is named after it', () => {
    expect(kindLine('YouTube channel', 'Lumen Studio')).toBe('YouTube channel');
    expect(kindLine('YouTube channel', 'YouTube channel')).toBeNull();
    expect(kindLine(null, 'Lumen Studio')).toBeNull();
  });
});

describe('Rows and lines stay quiet (Ink v2, 3B5b)', () => {
  it("a row's sub line and end time are grey, and its end time is DM Mono", async () => {
    const { Row } = await import('../../src/parts/Row');
    const { container } = render(<ul><Row id="r" title="Matched September bank lines" line="212 of 214 lines" end="4m" /></ul>);
    const end = container.querySelector('li')!.lastElementChild!;
    expect(end.textContent).toBe('4m');
    expect(end.classList.contains('mono')).toBe(true);
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/Row.module.css'), 'utf8');
    expect(css).toMatch(/\.line\s*\{[^}]*color:\s*var\(--mute\)/);
    expect(css).toMatch(/\.end\s*\{[^}]*color:\s*var\(--mute\)/);
  });

  it('the sample-data line has no icon and no ground: it is a note, not an alarm', async () => {
    const { StatusLine } = await import('../../src/parts/StatusLine');
    const { container } = render(<StatusLine status={{ state: 'ok' }} transport="fake" />);
    expect(container.querySelector('svg')).toBeNull();
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/StatusLine.module.css'), 'utf8');
    expect(css).toMatch(/\[data-state='fake'\]\s*\{[^}]*background:\s*var\(--bg\)[^}]*color:\s*var\(--mute\)/);
  });
});
