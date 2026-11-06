import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One-shot C3 task 4: a place, or a page inside one, changes inside one view transition, so the old page fades and the
 * new one rises in while the rail stays still. A sheet or a filter alone changes at once; the first render is not a
 * change; with animations off, or under the computer's reduce-motion setting, nothing transitions and the place still
 * changes.
 */
const MORNING = () => new Date('2026-10-23T04:30:00.000Z');
type Doc = { startViewTransition?: unknown };
let calls = 0;

function stubReduce(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}
/** off: the owner turned animations off (the fake's app.preferences answers off, so the shell keeps data-motion). */
function start(hash = '#/today', off = false) {
  window.location.hash = hash;
  if (off) document.documentElement.dataset.motion = 'off';
  render(<ClockProvider now={MORNING}><App client={createFakeClient(new FakeEngine(off ? { motion: 'off' } : {}))} language="en" /></ClockProvider>);
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

beforeEach(() => {
  calls = 0;
  stubReduce(false);
  (document as unknown as Doc).startViewTransition = (update: () => void) => {
    calls += 1;
    update();
    return { finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
  };
});
afterEach(() => {
  delete (document as unknown as Doc).startViewTransition;
  delete document.documentElement.dataset.motion;
});

describe('places swap with one cross-fade (one-shot C3 task 4)', () => {
  it('the first render starts no transition; a rail move from Today to Work starts one, and Work is drawn after', async () => {
    start();
    await screen.findByRole('heading', { level: 1, name: 'Good morning' });
    expect(calls).toBe(0);
    await go('#/work');
    expect(calls).toBe(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Work' })).toBeTruthy();
  });

  it('opening a sheet or changing a filter on the same place starts none', async () => {
    start('#/work');
    await screen.findByRole('heading', { level: 1, name: 'Work' });
    await go('#/work?filter=running');
    await go('#/work?filter=running&sheet=run%3A31');
    expect(calls).toBe(0);
  });

  it('Back (a hashchange from history) starts one, as any place change does', async () => {
    start('#/team');
    await screen.findByRole('heading', { level: 1, name: 'Team' });
    await go('#/work');
    await go('#/team');
    expect(calls).toBe(2);
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
  });

  it('a page inside Business cross-fades too', async () => {
    start('#/business/plan');
    await go('#/business/prices');
    expect(calls).toBe(1);
  });

  it('with animations off, nothing transitions and the place still changes', async () => {
    start('#/today', true);
    await go('#/work');
    expect(calls).toBe(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Work' })).toBeTruthy();
  });

  it('under the computer’s reduce-motion setting, nothing transitions and the place still changes', async () => {
    stubReduce(true);
    start();
    await go('#/team');
    expect(calls).toBe(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
  });
});

describe('the transition’s CSS', () => {
  const app = readFileSync(join(import.meta.dirname, '../../src/shell/App.module.css'), 'utf8');
  const motion = readFileSync(join(import.meta.dirname, '../../src/tokens/motion.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('names the page, and only the page, for the transition: the rail and the bars stay still', () => {
    expect(app).toMatch(/\.page\s*\{[^}]*view-transition-name:\s*page/);
    expect(app.match(/view-transition-name/g)).toHaveLength(1);
  });

  it('fades the old page out on the exit time and the new one in with a rise on the sheet time; the root does not move', () => {
    expect(motion).toMatch(/::view-transition-old\(page\)\s*\{[^}]*animation:\s*ink-page-out var\(--t-exit\) var\(--ease-exit\)/);
    expect(motion).toMatch(/::view-transition-new\(page\)\s*\{[^}]*animation:\s*ink-page-in var\(--t-sheet\) var\(--ease\)/);
    expect(motion).toMatch(/::view-transition-old\(root\),\s*::view-transition-new\(root\)\s*\{[^}]*animation:\s*none/);
    expect(motion).toMatch(/\[data-swap='sub'\]::view-transition-new\(page\)\s*\{[^}]*animation:\s*ink-fade-in var\(--t-press\) var\(--ease\)/);
  });
});
