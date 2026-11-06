import { it, expect } from 'vitest';
import { rule } from '../helpers/css';

it.each([
  ['../places/business/Decisions.module.css', '.row'],
  ['../places/work/Work.module.css', '.finishedRow'],
])('%s defers off-screen long rows without removing their layout space', (file, selector) => {
  const css = rule(file, selector);
  expect(css).toContain('content-visibility: auto');
  expect(css).toContain('contain-intrinsic-size: auto var(--target)');
});

it('the order track fills once on a changed stage using the settle token', () => {
  expect(rule('../places/work/OrderSteps.module.css', '.line::after')).toContain('transition: transform var(--t-settle) var(--ease)');
  expect(rule('../places/work/OrderSteps.module.css', '.line[data-reached]::after')).toContain('transform: scaleX(1)');
});