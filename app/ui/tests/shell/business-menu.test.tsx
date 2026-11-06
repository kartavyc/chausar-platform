// The business menu (catalogue U16): a 260 px menu used to open inside the 220 px rail, so the rail and the phone top
// bar clipped it. It now opens as a popover over the page, outside the rail, placed under its button; it still closes
// on a click elsewhere or Esc, and a click inside it keeps it open.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

function start() {
  window.location.hash = '#/today';
  render(<App client={createFakeClient(new FakeEngine())} language="en" />);
}
const open = async () => {
  const button = await within(screen.getByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ });
  await act(async () => { fireEvent.click(button); });
  return { button, menu: await screen.findByRole('group', { name: 'Business menu for Lumen Studio' }) };
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

  it('a click inside keeps it open; a click elsewhere closes it; Esc closes it and returns to the button', async () => {
    start();
    const { button, menu } = await open();
    expect(document.activeElement).toBe(menu);
    fireEvent.mouseDown(within(menu).getByText('Switch business'));
    expect(screen.queryByRole('group', { name: 'Business menu for Lumen Studio' })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group', { name: 'Business menu for Lumen Studio' })).toBeNull();

    const again = await open();
    fireEvent.keyDown(again.menu, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Business menu for Lumen Studio' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Tab past its last item closes it and returns focus to the button; moving between its items keeps it open', async () => {
    start();
    const { button, menu } = await open();
    const prices = within(menu).getByRole('link', { name: 'Prices' });
    const last = within(menu).getByRole('link', { name: 'New business' });
    last.focus();
    fireEvent.focusOut(prices, { relatedTarget: last });
    expect(screen.queryByRole('group', { name: 'Business menu for Lumen Studio' })).toBeTruthy();
    // The popover is the last thing on the page, so Tab past its last item leaves the page: no next element.
    await act(async () => { fireEvent.focusOut(last, { relatedTarget: null }); });
    expect(screen.queryByRole('group', { name: 'Business menu for Lumen Studio' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('focus moving to something else on the page closes it without taking the focus back', async () => {
    start();
    const { button, menu } = await open();
    const today = within(screen.getByRole('navigation', { name: 'Places' })).getByRole('link', { name: /Today/ });
    const last = within(menu).getByRole('link', { name: 'New business' });
    await act(async () => { fireEvent.focusOut(last, { relatedTarget: today }); });
    expect(screen.queryByRole('group', { name: 'Business menu for Lumen Studio' })).toBeNull();
    expect(document.activeElement).not.toBe(button);
  });
});
