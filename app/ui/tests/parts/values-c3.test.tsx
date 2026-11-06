import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Count, Figure } from '../../src/parts/Figure';
import { ProgressBar } from '../../src/parts/ProgressBar';
import { useChanged } from '../../src/parts/useChanged';
import { TextProvider } from '../../src/text';
import { cssOf, rule } from '../helpers/css';

/**
 * One-shot C3 task 14: values that change. A count rolls one step, once; money cross-fades and never rolls; a bar's fill
 * moves through a CSS transition on its own width, with the engine's counts staying attributes; a value the owner just
 * changed gets one tint. With animations off, only the new value.
 */
const real = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    const style = real(element, pseudo);
    if (!(element instanceof HTMLElement) || !(element.hasAttribute('data-roll-old') || element.hasAttribute('data-swap-old'))) return style;
    return new Proxy(style, { get: (target, key) => { if (key === 'animationDuration') return '120ms'; const value = Reflect.get(target, key) as unknown; return typeof value === 'function' ? value.bind(target) : value; } });
  });
});
afterEach(() => { delete document.documentElement.dataset.motion; });

const rolling = () => document.querySelector<HTMLElement>('[data-roll-old]');

describe('Count', () => {
  it('first render has no roll', () => {
    render(<Count value={5} />);
    expect(rolling()).toBeNull();
    expect(document.querySelector('[data-count]')!.children).toHaveLength(0);
  });

  it('a new value rolls once, and only the old and the new numbers are ever in the page', () => {
    const { rerender } = render(<Count value={5} />);
    rerender(<Count value={9} />);
    expect(rolling()?.textContent).toBe('5');
    expect(rolling()?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-roll-new]')?.textContent).toBe('9');
    expect(document.querySelector('[data-count]')?.textContent).toBe('59');
    fireEvent.animationEnd(rolling()!);
    expect(rolling()).toBeNull();
    expect(document.querySelector('[data-count]')?.textContent).toBe('9');
  });

  it('with animations off, the new value only', () => {
    document.documentElement.dataset.motion = 'off';
    const { rerender } = render(<Count value={5} />);
    rerender(<Count value={9} />);
    expect(rolling()).toBeNull();
    expect(document.querySelector('[data-count]')?.textContent).toBe('9');
  });
});

describe('Figure', () => {
  const figure = (value: string) => <TextProvider language="en"><Figure value={value} receiptId="R-1" onReceipt={() => {}} /></TextProvider>;
  it('a change is a cross-fade in place, never the roll', () => {
    const { rerender } = render(figure('₹1,000'));
    rerender(figure('₹2,000'));
    expect(document.querySelector('[data-swap-old]')?.textContent).toBe('₹1,000');
    expect(rolling()).toBeNull();
    fireEvent.animationEnd(document.querySelector('[data-swap-old]')!);
    expect(screen.getByText('₹2,000')).toBeTruthy();
  });

  it('source rule: Figure never imports the roll', () => {
    const text = readFileSync(join(import.meta.dirname, '../../src/parts/Figure.tsx'), 'utf8');
    expect(text).not.toMatch(/useOldCopy|data-roll|Count\.module/);
  });
});

describe('bars', () => {
  it('keeps the engine’s counts as attributes, with the fill’s width on the settle time', () => {
    render(<TextProvider language="en"><ProgressBar progress={{ done: 15, total: 20 }} /></TextProvider>);
    const fill = document.querySelector('[data-done]')!;
    expect(fill.getAttribute('width')).toBe('15');
    expect(rule('ProgressBar.module.css', '.fill')).toMatch(/transition:\s*width var\(--t-settle\)/);
    expect(rule('ProgressBar.module.css', '.segment')).toMatch(/background-color var\(--t-settle\)/);
    expect(cssOf('charts/Charts.module.css')).toMatch(/\.goalFill\s*\{[^}]*transition:\s*width var\(--t-settle\)/);
    expect(cssOf('charts/Charts.module.css')).toMatch(/\.bar\s*\{[^}]*transition:\s*height var\(--t-settle\)/);
    expect(rule('ProgressRing.module.css', '.arc')).toMatch(/transition:\s*stroke-dasharray var\(--t-settle\)/);
  });
});

describe('useChanged', () => {
  it('marks only a change after mount, once, and nothing with animations off', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useChanged(value), { initialProps: { value: 'a' } });
      expect(result.current).toBeUndefined();
      rerender({ value: 'a' });
      expect(result.current).toBeUndefined();
      rerender({ value: 'b' });
      expect(result.current).toBe('');
      act(() => { vi.advanceTimersByTime(600); });
      expect(result.current).toBeUndefined();
      document.documentElement.dataset.motion = 'off';
      rerender({ value: 'c' });
      expect(result.current).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the tint fades on the settle time', () => {
    const motion = readFileSync(join(import.meta.dirname, '../../src/tokens/motion.css'), 'utf8');
    expect(motion).toMatch(/\[data-changed\]\s*\{[^}]*ink-changed var\(--t-settle\)/);
  });
});
