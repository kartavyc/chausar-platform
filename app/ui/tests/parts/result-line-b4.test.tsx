// B4 task 5: a result ("Saved", "Shared", a refusal) fills a slot that is already there, so nothing below it moves.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultLine } from '../../src/parts/ResultLine';
import { rule } from '../helpers/css';

describe('ResultLine', () => {
  it('is in the DOM while empty, holding one line of height', () => {
    const { container } = render(<ResultLine />);
    const slot = container.querySelector('[data-result-line]')!;
    expect(slot).toBeTruthy();
    expect(slot.textContent).toBe('');
    expect(rule('ResultLine.module.css', '.slot')).toContain('min-height: 1lh');
  });

  it('a message fills the same node: nothing is added above what follows', () => {
    const page = (said?: string) => (
      <section>
        <ResultLine>{said}</ResultLine>
        <h2>Credit notes</h2>
      </section>
    );
    const { container, rerender } = render(page());
    const slot = container.querySelector('[data-result-line]')!;
    const next = screen.getByRole('heading', { name: 'Credit notes' });
    expect(next.previousElementSibling).toBe(slot);
    rerender(page('Saved INV-0001.pdf.'));
    expect(container.querySelector('[data-result-line]')).toBe(slot);
    expect(slot.textContent).toBe('Saved INV-0001.pdf.');
    expect(next.previousElementSibling).toBe(slot);
    expect(container.querySelector('section')!.children).toHaveLength(2);
  });

  it('a result is a status with a small check; a refusal is an alert with no check', () => {
    const { container, rerender } = render(<ResultLine>Saved</ResultLine>);
    expect(screen.getByRole('status').textContent).toBe('Saved');
    expect(container.querySelector('svg')).toBeTruthy();
    rerender(<ResultLine tone="problem">Couldn't save it.</ResultLine>);
    const slot = screen.getByRole('alert');
    expect(slot.textContent).toBe("Couldn't save it.");
    expect(slot.getAttribute('data-tone')).toBe('problem');
    expect(container.querySelector('svg')).toBeNull();
    expect(rule('ResultLine.module.css', ".slot[data-tone='problem']")).toContain('var(--fail)');
  });

  it('an empty slot draws no check and says nothing', () => {
    const { container } = render(<ResultLine>{null}</ResultLine>);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('passes its attributes through, for a line the engine wrote', () => {
    const { container } = render(<ResultLine data-engine-line="">Sent</ResultLine>);
    expect(container.querySelector('[data-result-line][data-engine-line]')).toBeTruthy();
  });
});
