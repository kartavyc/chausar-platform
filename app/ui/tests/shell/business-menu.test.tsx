// The business menu (catalogue U16): a 260 px menu used to open inside the 220 px rail, so the rail and the phone top
// bar clipped it. It now opens as a popover over the page, outside the rail, placed under its button; it still closes
// on a click elsewhere or Esc, and a click inside it keeps it open.
import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

function start() {
  window.location.hash = '#/today';
  render(<App client={createFakeClient(new FakeEngine())} language="en" />);
}
const open = async () => {
  const button = await within(screen.getByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ });
  await act(async () => { fireEvent.click(button); });
  return { button, menu: await screen.findByRole('dialog', { name: 'Business menu for Lumen Studio' }) };
};

describe('Business menu: a popover over the page', () => {
  it('renders outside the rail, so neither the rail nor the phone top bar clips it, placed under its button', async () => {
    start();
    const rail = screen.getByRole('navigation', { name: 'Places' });
    const trigger = await within(rail).findByRole('button', { name: /Lumen Studio/ });
    trigger.getBoundingClientRect = () => ({ top: 40, bottom: 92, left: 16, right: 220, width: 204, height: 52, x: 16, y: 40, toJSON: () => ({}) });
    const { button, menu } = await open();
    expect(rail.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect([menu.style.top, menu.style.left]).toEqual(['96px', '16px']);
    expect(menu.hasAttribute('style') && /position/.test(menu.getAttribute('style')!)).toBe(false);
  });

  it('never runs past the bottom of the window: its height is the room left under the button, at 1280 and at 390', async () => {
    for (const [width, height, bottom] of [[1280, 860, 120], [390, 844, 60]] as const) {
      Object.assign(window, { innerWidth: width, innerHeight: height });
      start();
      const rail = screen.getByRole('navigation', { name: 'Places' });
      const trigger = await within(rail).findByRole('button', { name: /Lumen Studio/ });
      trigger.getBoundingClientRect = () => ({ top: bottom - 52, bottom, left: 14, right: 218, width: 204, height: 52, x: 14, y: bottom - 52, toJSON: () => ({}) });
      const { menu } = await open();
      expect(menu.style.top).toBe(`${bottom + 4}px`);
      expect(menu.style.maxHeight).toBe(`${height - (bottom + 4) - 8}px`);
      cleanup();
    }
    Object.assign(window, { innerWidth: 1024, innerHeight: 768 });
  });

  it('a click inside keeps it open; a click elsewhere closes it; Esc closes it and returns to the button', async () => {
    start();
    const { button, menu } = await open();
    expect(document.activeElement).toBe(menu);
    fireEvent.mouseDown(within(menu).getByText('Switch business'));
    expect(screen.queryByRole('dialog', { name: 'Business menu for Lumen Studio' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Business menu for Lumen Studio' })).toBeNull();

    const again = await open();
    fireEvent.keyDown(again.menu, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Business menu for Lumen Studio' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Tab past its last item closes it and returns focus to the button; moving between its items keeps it open', async () => {
    start();
    const { button, menu } = await open();
    const prices = within(menu).getByRole('link', { name: 'Prices' });
    const last = within(menu).getByRole('link', { name: 'New business' });
    last.focus();
    fireEvent.focusOut(prices, { relatedTarget: last });
    expect(screen.queryByRole('dialog', { name: 'Business menu for Lumen Studio' })).toBeTruthy();
    // The popover is the last thing on the page, so Tab past its last item leaves the page: no next element.
    await act(async () => { fireEvent.focusOut(last, { relatedTarget: null }); });
    expect(screen.queryByRole('dialog', { name: 'Business menu for Lumen Studio' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  // The popover sits at the end of the body, so the browser's own Shift+Tab from its first item would land on the
  // last thing on the page. It goes back to the business button instead, and Tab from the button goes into it.
  it('Shift+Tab from its first item (or from the popover itself) goes back to the business button and keeps it open', async () => {
    start();
    const { button, menu } = await open();
    // Opened, the popover itself has the focus.
    expect(fireEvent.keyDown(menu, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(screen.queryByRole('dialog', { name: 'Business menu for Lumen Studio' })).toBeTruthy();

    // The open business is disabled, so the first item that takes focus is Ledgerline.
    const first = await within(menu).findByRole('button', { name: 'Ledgerline' });
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    // Shift+Tab from any later item is the browser's own.
    const prices = within(menu).getByRole('link', { name: 'Prices' });
    prices.focus();
    expect(fireEvent.keyDown(prices, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(prices);
  });

  it('Tab from the business button while the popover is open goes to its first item; closed, Tab is the browser\'s own', async () => {
    start();
    const { button, menu } = await open();
    const first = await within(menu).findByRole('button', { name: 'Ledgerline' });
    button.focus();
    expect(fireEvent.keyDown(button, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(document.activeElement).toBe(button);
    expect(fireEvent.keyDown(button, { key: 'Tab' })).toBe(true);
  });

  it('focus moving to something else on the page closes it without taking the focus back', async () => {
    start();
    const { button, menu } = await open();
    const today = within(screen.getByRole('navigation', { name: 'Places' })).getByRole('link', { name: /^Today/ });
    const last = within(menu).getByRole('link', { name: 'New business' });
    await act(async () => { fireEvent.focusOut(last, { relatedTarget: today }); });
    expect(screen.queryByRole('dialog', { name: 'Business menu for Lumen Studio' })).toBeNull();
    expect(document.activeElement).not.toBe(button);
  });
});
