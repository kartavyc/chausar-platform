// B4 task 8: one fold. A disclosure looks the same everywhere: the app's chevron and plain dark words, never link blue.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Fold } from '../../src/parts/Fold';
import { rule } from '../helpers/css';

describe('Fold', () => {
  it('is a closed details whose summary holds the chevron and the words', () => {
    const { container } = render(<Fold summary="More options"><p>Inside</p></Fold>);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.hasAttribute('data-fold')).toBe(true);
    const summary = details.querySelector('summary')!;
    expect(summary.textContent).toBe('More options');
    expect(summary.querySelector('svg')).not.toBeNull();
    expect(summary.querySelector('[data-fold-mark]')).not.toBeNull();
    expect(screen.getByText('Inside').closest('details')).toBe(details);
  });

  it('draws the chevron, so no native marker and no link colour', () => {
    const summary = rule('Fold.module.css', '.summary');
    expect(summary).toContain('list-style: none');
    expect(summary).toContain('color: var(--fg)');
    expect(summary).not.toContain('--link');
    expect(rule('Fold.module.css', '.summary::-webkit-details-marker')).toContain('display: none');
    expect(rule('Fold.module.css', '.fold[open] > .summary > [data-fold-mark]')).toContain('rotate(90deg)');
  });

  it('has no animation: the height motion comes later', () => {
    expect(rule('Fold.module.css', '.summary > [data-fold-mark]')).not.toContain('transition');
  });

  it('keeps a danger tone: Delete stays red', () => {
    const { container } = render(<Fold summary="Delete this business" tone="danger">x</Fold>);
    expect(container.querySelector('summary')!.getAttribute('data-tone')).toBe('danger');
    expect(rule('Fold.module.css', ".summary[data-tone='danger']")).toContain('var(--fail)');
  });

  it('has no tone unless asked', () => {
    const { container } = render(<Fold summary="Each drill">x</Fold>);
    expect(container.querySelector('summary')!.hasAttribute('data-tone')).toBe(false);
  });

  it('passes the details attributes through, with the place class beside its own', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <Fold summary="Each drill" className="place" summaryClassName="head" summaryId="the-head" data-fold="drills" open onToggle={onToggle}>x</Fold>,
    );
    const details = container.querySelector('details')!;
    expect(details.open).toBe(true);
    expect(details.dataset.fold).toBe('drills');
    expect(details.classList.contains('place')).toBe(true);
    const summary = details.querySelector('summary')!;
    expect(summary.classList.contains('head')).toBe(true);
    expect(summary.id).toBe('the-head');
    fireEvent(details, new Event('toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
