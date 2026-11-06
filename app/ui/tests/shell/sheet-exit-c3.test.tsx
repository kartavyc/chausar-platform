import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { rule } from '../helpers/css';

/**
 * One-shot C3 task 5: a sheet leaves the way it came. On close, focus is back on the opener at once while the sheet
 * stays as a leaving copy (data-leaving, inert, hidden from readers) until its exit animation ends; with animations
 * off it goes at once; a new sheet opening while one leaves replaces it at once.
 */
const MORNING = () => new Date('2026-10-23T04:30:00.000Z');
const real = window.getComputedStyle.bind(window);

beforeEach(() => {
  // jsdom loads no stylesheets: give each sheet the exit time Sheet.module.css gives it.
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    const style = real(element, pseudo);
    if (!(element instanceof HTMLElement) || !element.hasAttribute('data-leaving')) return style;
    return new Proxy(style, { get: (target, key) => { if (key === 'animationDuration') return '140ms'; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  });
});
afterEach(() => {
  delete document.documentElement.dataset.motion;
});

/** off: the owner turned animations off (the fake's app.preferences answers off, so the shell keeps data-motion). */
function start(hash = '#/today', off = false) {
  window.location.hash = hash;
  if (off) document.documentElement.dataset.motion = 'off';
  render(<ClockProvider now={MORNING}><App client={createFakeClient(new FakeEngine(off ? { motion: 'off' } : {}))} language="en" /></ClockProvider>);
}
const hashChange = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

async function openRun() {
  const opener = await screen.findByRole('button', { name: 'Cutting shorts from episode 13' });
  opener.focus();
  await act(async () => { fireEvent.click(opener); hashChange(); });
  await screen.findByRole('complementary', { name: 'Cutting shorts from episode 13' });
  return opener;
}
const leavingCopy = () => document.querySelector<HTMLElement>('aside[data-leaving]');

describe('sheets leave instead of vanishing (one-shot C3 task 5)', () => {
  it('on close, focus is back on the opener at once, and the sheet stays as an inert, hidden leaving copy until its exit ends', async () => {
    start();
    const opener = await openRun();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); hashChange(); });
    expect(document.activeElement).toBe(opener);
    const copy = leavingCopy();
    expect(copy).not.toBeNull();
    expect(copy!.closest('[inert]')).not.toBeNull();
    expect(copy!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    await act(async () => { fireEvent.animationEnd(copy!); });
    expect(leavingCopy()).toBeNull();
    expect(document.querySelector('aside[data-sheet]')).toBeNull();
  });

  it('with animations off, the sheet is gone at once', async () => {
    start('#/today', true);
    const opener = await openRun();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); hashChange(); });
    expect(document.querySelector('aside[data-sheet]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('a sheet opening while one leaves replaces it at once, its own title focused', async () => {
    start('#/money?sheet=receipt:R-0415');
    await screen.findByRole('complementary', { name: 'R-0415' });
    await act(async () => { window.location.hash = '#/money'; hashChange(); });
    expect(leavingCopy()).not.toBeNull();
    await act(async () => { window.location.hash = '#/money?sheet=receipt:R-0415'; hashChange(); });
    expect(leavingCopy()).toBeNull();
    const sheet = await screen.findByRole('complementary', { name: 'R-0415' });
    await waitFor(() => expect(document.activeElement).toBe(sheet.querySelector('h2')));
  });

  it('the leaving rule runs once on the exit time and ease', () => {
    expect(rule('Sheet.module.css', '.sheet[data-leaving]')).toMatch(/animation:\s*global\(ink-sheet-out\) var\(--t-exit\) var\(--ease-exit\) 1 both/);
  });
});
