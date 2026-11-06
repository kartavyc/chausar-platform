import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { LoadingPlace, SKELETON_DELAY_MS, Skeleton } from '../../src/parts/Skeleton';
import { TextProvider } from '../../src/text';
import { Sheet } from '../../src/parts/Sheet';
import { cssOf } from '../helpers/css';

/** One-shot C3 task 12: still skeletons in place of "Loading": nothing before 150 ms, the blocks after, no animation. */
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const page = (node: React.ReactNode) => <TextProvider language="en">{node}</TextProvider>;

describe('Skeleton', () => {
  it('nothing before 150 ms, the blocks after, one status for screen readers, hidden blocks', () => {
    render(page(<LoadingPlace shape="list" />));
    expect(document.querySelector('[data-skeleton]')).toBeNull();
    act(() => { vi.advanceTimersByTime(SKELETON_DELAY_MS - 1); });
    expect(document.querySelector('[data-skeleton]')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(document.querySelector('[data-skeleton="list"]')).not.toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(document.querySelector('[data-block]')!.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('a load that ends in time never shows it', () => {
    const { rerender } = render(page(<LoadingPlace shape="list" loading />));
    act(() => { vi.advanceTimersByTime(100); });
    rerender(page(<LoadingPlace shape="list" loading={false} />));
    act(() => { vi.advanceTimersByTime(500); });
    expect(document.querySelector('[data-skeleton]')).toBeNull();
  });

  it('every shape draws, and its CSS has no animation or transition at all', () => {
    for (const shape of ['today', 'list', 'tiles', 'cards', 'sheet', 'settings', 'chat'] as const) {
      const { unmount } = render(page(<Skeleton shape={shape} />));
      expect(document.querySelector(`[data-skeleton="${shape}"]`)).not.toBeNull();
      unmount();
    }
    expect(cssOf('Skeleton.module.css')).not.toMatch(/animation|transition/);
  });
});

describe('source rule', () => {
  it('no place says a bare "Loading" for its first load: the place-level words are gone (an allow list for inline ones)', () => {
    const src = join(import.meta.dirname, '../../src');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
    // A sheet's heading says its state while it loads, for a screen reader (the eye sees the skeleton), and a step of a
    // list keeps its one line in its reserved slot.
    const allowed = /^(?:parts\/RunSheet|places\/work\/DraftSheet|places\/clients\/(?:CardSheet|ClientSheet|CompanySheet|Leads|ListsSheet|PersonSheet)|places\/business\/(?:CaRules|YourCa)|places\/money\/InvoiceSheet|places\/team\/AgentSheet|places\/today\/(?:EditSheet|ViewSheet))\.tsx$/;
    const found: string[] = [];
    for (const file of walk(src).filter((f) => f.endsWith('.tsx'))) {
      const name = relative(src, file).split(sep).join('/');
      if (allowed.test(name)) continue;
      if (/t\('(?:today|team|money|apps|business|connections\.ai|layout|sheet)\.loading'\)/.test(readFileSync(file, 'utf8'))) found.push(name);
    }
    expect(found).toEqual([]);
  });
});

it('sheet contents arrive only after a visible skeleton, never for a fast answer', () => {
  const show = (loading: boolean) => page(<Sheet label="Client" title={loading ? 'Loading' : 'Sample client'} onClose={() => {}} loading={loading}>{!loading && <p>Client details</p>}</Sheet>);
  const fast = render(show(true));
  act(() => { vi.advanceTimersByTime(100); });
  fast.rerender(show(false));
  expect(document.querySelector('[data-arrived]')).toBeNull();
  fast.unmount();
  const slow = render(show(true));
  act(() => { vi.advanceTimersByTime(200); });
  expect(document.querySelector('[data-skeleton="sheet"]')).not.toBeNull();
  slow.rerender(show(false));
  expect(document.querySelector('[data-arrived]')?.textContent).toBe('Client details');
});