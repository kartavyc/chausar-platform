import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoadingPlace, useArrived } from '../../src/parts/Skeleton';
import { CashLine } from '../../src/parts/charts/CashLine';
import { Stack } from '../../src/parts/charts/Stack';
import type { CashData } from '../../src/parts/charts/types';

const cash: CashData = { label: 'Cash forecast', axis: ['Now', 'Next'], assumptions: [], proof: { estimate: true }, points: [
  { key: 'now', label: 'Now', actualPermille: 400, actual: '40', forecastPermille: 400, forecast: '40' },
  { key: 'next', label: 'Next', actualPermille: null, actual: null, forecastPermille: 500, forecast: '50' },
] };
const next: CashData = { ...cash, points: [cash.points[0]!, { ...cash.points[1]!, forecastPermille: 700, forecast: '70' }] };
const real = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
    const style = real(element);
    return element.hasAttribute('data-forecast-old') ? new Proxy(style, { get: (target, key) => key === 'animationDuration' ? '220ms' : typeof Reflect.get(target, key) === 'function' ? Reflect.get(target, key).bind(target) : Reflect.get(target, key) }) : style;
  });
});
afterEach(() => { delete document.documentElement.dataset.motion; });

it('crossfades old and new forecasts once, without inventing intermediate path points', () => {
  const { container, rerender } = render(<CashLine data={cash} />);
  expect(container.querySelector('[data-forecast-old]')).toBeNull();
  expect(container.querySelector('[data-forecast-new]')).toBeNull();
  rerender(<CashLine data={next} />);
  const old = container.querySelector('[data-forecast-old]');
  expect(old?.getAttribute('aria-hidden')).toBe('true');
  expect(old?.querySelector('polyline')?.getAttribute('points')).toBe('50,400 150,500');
  expect(container.querySelector('[data-forecast-new] polyline')?.getAttribute('points')).toBe('50,400 150,700');
  fireEvent.animationEnd(old!);
  expect(container.querySelector('[data-forecast-old]')).toBeNull();
  expect(container.querySelectorAll('polyline')).toHaveLength(1);
});

it('shows only the new forecast when motion is off', () => {
  document.documentElement.dataset.motion = 'off';
  const { container, rerender } = render(<CashLine data={cash} />);
  rerender(<CashLine data={next} />);
  expect(container.querySelector('[data-forecast-old]')).toBeNull();
  expect(container.querySelector('polyline')?.getAttribute('points')).toBe('50,400 150,700');
});

it('keeps Stack geometry on the same nodes and transitions engine widths and offsets', () => {
  const segment = (id: string, permille: number) => ({ id, permille, attrs: { 'data-dept': id }, title: id });
  const { container, rerender } = render(<Stack label="Departments" segments={[segment('sales', 400), segment('mkt', 600)]} />);
  const rect = container.querySelector('rect[data-dept="sales"]');
  rerender(<Stack label="Departments" segments={[segment('sales', 700), segment('mkt', 300)]} />);
  expect(container.querySelector('rect[data-dept="sales"]')).toBe(rect);
  expect(rect?.getAttribute('width')).toBe('700');
  const css = readFileSync(join(import.meta.dirname, '../../src/parts/charts/Charts.module.css'), 'utf8');
  expect(css).toMatch(/\.seg\s*\{[^}]*transition:\s*width var\(--t-settle\)/);
  expect(css).toMatch(/\.offset\s*\{[^}]*transition:\s*transform var\(--t-settle\)/);
  expect(container.querySelector('[class*="offset"]')?.getAttribute('transform')).toBe('translate(700 0)');
});

it('gives journal and bank ledger rows intrinsic sizes without virtualizing their receipts', () => {
  const root = join(import.meta.dirname, '../../src/places');
  const journal = readFileSync(join(root, 'money/Journal.tsx'), 'utf8');
  const money = readFileSync(join(root, 'money/Money.module.css'), 'utf8');
  const bank = readFileSync(join(root, 'connections/BankSheet.module.css'), 'utf8');
  expect(journal).toContain('className={s.journalRow}');
  expect(money).toMatch(/\.journalRow\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:/);
  expect(bank).toMatch(/\.row\s*\{[^}]*content-visibility:\s*auto;[^}]*contain-intrinsic-size:/);
});


it('marks arrival when content lands after the skeleton timer at the same deadline', () => {
  vi.useFakeTimers();
  function Page({ loading }: { loading: boolean }) {
    const arrived = useArrived(loading);
    return <div data-arrived={arrived ? '' : undefined}><LoadingPlace loading={loading} shape="cards" /></div>;
  }
  try {
    const { container, rerender } = render(<Page loading />);
    act(() => { vi.advanceTimersToNextTimer(); });
    expect(container.querySelector('[data-skeleton]')).not.toBeNull();
    rerender(<Page loading={false} />);
    expect(container.querySelector('[data-arrived]')).not.toBeNull();
  } finally { vi.useRealTimers(); }
});
