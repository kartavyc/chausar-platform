import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Count, Figure } from '../../src/parts/Figure';
import { ChatThread } from '../../src/parts/ChatThread';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import { Row } from '../../src/parts/Row';
import { Change } from '../../src/parts/Change';
import { ProgressBar } from '../../src/parts/ProgressBar';
import { ModelEstimate } from '../../src/parts/ModelEstimate';
import { ClockProvider } from '../../src/shell/clock';
import type { QueueRow } from '../../src/engine/types';

/*
 * One-shot B2 task 11 (the founder's answer of 5 Nov): times, counts and money are set in the body font with tabular
 * figures; DM Mono stays only on real codes (invoice numbers, pairing codes, tax ids).
 */

const NOW = new Date('2026-11-02T19:30:00.000Z');
const row: QueueRow = {
  id: 'q1', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'price', createdAt: '2026-11-02T19:11:00.000Z', digest: 'd1',
  title: 'Sponsor slot price', change: { before: '₹25,000', after: '₹30,000', receiptId: 'R-0415' },
  actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true }],
};

describe('figures, counts, times and elapsed are in the body font (B2 task 11)', () => {
  it('a Figure and a Count carry no mono class; their numbers keep the hooks for tabular figures', () => {
    const { container } = render(<p><Figure value="₹2,000" receiptId="R-1" /> <Count value="1,200" /></p>);
    expect(container.querySelector('[data-ui-number]')!.classList.contains('mono')).toBe(false);
    expect(container.querySelector('[data-count]')!.classList.contains('mono')).toBe(false);
  });

  it("an approval row's time, a chat time and a row's elapsed are not mono", () => {
    const { container } = render(
      <ClockProvider now={() => NOW} zone="Asia/Kolkata">
        <ApprovalRow layout="card" row={row} onDecide={vi.fn()} />
        <ChatThread agent={{ name: 'Editor' }} entries={[{ kind: 'agent', id: 'm1', at: '2026-11-02T19:12:00.000Z', text: 'Done.' }]} now={NOW} />
        <ul><Row id="run-1" title="Cutting shorts" end="4 min" /></ul>
      </ClockProvider>,
    );
    const time = [...container.querySelectorAll('[data-meta] span')].find((span) => span.textContent === '12:41 am')!;
    expect(time.classList.contains('mono')).toBe(false);
    expect(container.querySelector('time')!.classList.contains('mono')).toBe(false);
    const end = [...container.querySelectorAll('span')].find((span) => span.textContent === '4 min')!;
    expect(end.classList.contains('mono')).toBe(false);
  });

  it('a price change, a step count and a model estimate are in the body font too (B2 fix round 1)', () => {
    const { container } = render(
      <div>
        <Change label="Sponsor slot" before="₹25,000" after="₹30,000" receiptId="R-1" />
        <ProgressBar progress={{ done: 3, total: 5 } as never} />
        <ModelEstimate value="₹40,000 a month" />
      </div>,
    );
    const figures = [...container.querySelectorAll('del, span, b')].filter((el) => /₹|\d of \d|3/.test(el.textContent ?? '') && el.children.length === 0);
    expect(figures.length).toBeGreaterThan(2);
    for (const el of figures) expect(el.classList.contains('mono'), el.outerHTML).toBe(false);
    // The money legend and axis, Spend and the invoice table are held by the source rule (tests/source-rules.test.ts).
  });

  it('a real code keeps DM Mono', () => {
    const { container } = render(<p><span className="mono" data-code="">INV-0042</span></p>);
    expect(container.querySelector('[data-code]')!.classList.contains('mono')).toBe(true);
  });
});
