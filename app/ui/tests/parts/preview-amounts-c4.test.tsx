import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PreviewFrame } from '../../src/parts/PreviewFrame';
import { AmountsText } from '../../src/parts/AmountsText';
import { assertFiguresProved } from '../helpers/ink-rules';
import { FakeEngine } from '../../src/engine/fake';
import type { DeliveryLite, OrderLite, QueueItemView } from '../../src/engine/types';
import { figureWords } from '../../../../platform/runtime/venture/delivery/template-outline';

/* One-shot C4 task 16: an amount in a quoted draft carries its receipt, or the model estimate label. */

const receiptName = /Receipt/;

describe('an amount in a draft (C4 task 16)', () => {
  it('draws the figure face with its receipt mark inside the quoted draft', () => {
    const { container } = render(
      <div data-content="">
        <PreviewFrame
          variant="text"
          view={{ title: 'Reply', sections: [{ heading: 'Next steps', lines: ['The fee for the month is below. INR 3,540.00 in total'] }], amounts: [{ display: 'INR 3,540.00', receiptId: 'R-1' }] }}
        />
      </div>,
    );
    const figure = container.querySelector('[data-figure]') as HTMLElement;
    expect(figure.textContent).toContain('INR 3,540.00');
    expect(within(figure).getByRole('button', { name: receiptName })).toBeTruthy();
    expect(container.textContent).toContain('The fee for the month is below.');
    expect(container.textContent).toContain('in total');
    expect(() => assertFiguresProved(container)).not.toThrow();
  });

  it('labels an amount no receipt backs as a model estimate', () => {
    const { container } = render(<div data-content=""><AmountsText text="About INR 99.00 for extras." amounts={[{ display: 'INR 99.00', estimate: true }]} /></div>);
    expect(screen.getByText('INR 99.00').closest('[data-estimate]')).toBeTruthy();
    expect(screen.getByText('model estimate')).toBeTruthy();
    expect(() => assertFiguresProved(container)).not.toThrow();
  });

  it('leaves the words alone when the engine listed nothing', () => {
    const { container } = render(<AmountsText text="Plain words." amounts={[]} />);
    expect(container.textContent).toBe('Plain words.');
    expect(container.querySelector('[data-figure]')).toBeNull();
  });

  it('marks each amount where it stands, also when it comes twice', () => {
    const { container } = render(<AmountsText text="INR 5.00 now, INR 5.00 later, INR 15.00 in all." amounts={[{ display: 'INR 5.00', receiptId: 'R-2' }, { display: 'INR 15.00', receiptId: 'R-3' }]} />);
    expect(container.querySelectorAll('[data-figure]').length).toBe(3);
    expect(container.textContent).toContain('now,');
    expect(container.textContent).toContain('later,');
  });

  it('the fake keeps in step: a template draft has no label and its view names the receipt', async () => {
    expect(figureWords('Total', '₹3,000')).toBe('₹3,000 in total');
    const engine = new FakeEngine();
    const orders = await engine.request('venture.order.list', {}) as OrderLite[];
    const open = orders.find((order) => order.status === 'open')!;
    const run = await engine.request('venture.delivery.run', { orderId: open.id }) as DeliveryLite;
    const listed = (await engine.request('venture.delivery.list', {}) as DeliveryLite[]).find((item) => item.id === run.id)!;
    expect(listed.renderedText ?? '').not.toMatch(/\bTotal:/);
    const view = await engine.request('venture.queue.view', { kind: 'draft', id: run.id }) as QueueItemView;
    if (/in total/.test(listed.renderedText ?? '')) {
      expect(view.amounts?.[0]?.receiptId).toBe(open.priceReceiptId);
    }
    expect(view.sections.length).toBeGreaterThan(0);
  });
});
