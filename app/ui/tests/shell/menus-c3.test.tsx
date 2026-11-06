import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

/**
 * One-shot C3 task 6: menus open and close. The business menu comes in with a fade and a 4 px drop (@starting-style)
 * and leaves the same way, faster: after Escape it stays with data-state="closing" until its transition ends, focus
 * already back on its button; with animations off it goes at once.
 */
const real = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    const style = real(element, pseudo);
    if (!(element instanceof HTMLElement) || element.getAttribute('role') !== 'dialog') return style;
    return new Proxy(style, { get: (target, key) => { if (key === 'transitionDuration') return '140ms'; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  });
});
afterEach(() => {
  delete document.documentElement.dataset.motion;
});

function start(off = false) {
  window.location.hash = '#/today';
  if (off) document.documentElement.dataset.motion = 'off';
  render(<App client={createFakeClient(new FakeEngine(off ? { motion: 'off' } : {}))} language="en" />);
}
async function open() {
  const button = await within(screen.getByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ });
  await act(async () => { fireEvent.click(button); });
  return { button, menu: await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' }) };
}

describe('the business menu closes with an exit (one-shot C3 task 6)', () => {
  it('stays with data-state="closing" after Escape until its transitionend, focus already back on the button', async () => {
    start();
    const { button, menu } = await open();
    expect(menu.dataset.state).toBe('open');
    await act(async () => { fireEvent.keyDown(menu, { key: 'Escape' }); });
    expect(document.activeElement).toBe(button);
    expect(menu.isConnected).toBe(true);
    expect(menu.dataset.state).toBe('closing');
    expect(menu.hasAttribute('inert')).toBe(true);
    await act(async () => { fireEvent.transitionEnd(menu); });
    expect(menu.isConnected).toBe(false);
  });

  it('with animations off it goes at once', async () => {
    start(true);
    const { menu } = await open();
    await act(async () => { fireEvent.keyDown(menu, { key: 'Escape' }); });
    expect(menu.isConnected).toBe(false);
  });

  it('opening again while it closes keeps the same popover, open', async () => {
    start();
    const { button, menu } = await open();
    await act(async () => { fireEvent.keyDown(menu, { key: 'Escape' }); });
    await act(async () => { fireEvent.click(button); });
    expect(screen.getByRole('dialog', { name: 'Business menu for Lumen Studio' })).toBe(menu);
    expect(menu.dataset.state).toBe('open');
  });
});

describe('the menus’ CSS', () => {
  const css = (file: string) => readFileSync(join(import.meta.dirname, '../../src', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('the business menu starts from a fade and a drop and leaves on the exit time', () => {
    const menu = css('shell/BusinessMenu.module.css');
    expect(menu).toMatch(/@starting-style\s*\{\s*\.menu\s*\{[^}]*opacity:\s*0/);
    expect(menu).toMatch(/\.menu\[data-state='closing'\]\s*\{[^}]*transition-duration:\s*var\(--t-exit\)/);
  });
});
