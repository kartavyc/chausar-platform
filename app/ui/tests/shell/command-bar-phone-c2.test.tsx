import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NARROW } from '../../src/shell/useNarrow';

// C2 task 8: the phone's search button and the dialog, and Ctrl K on Chats beside the rail, where no header box shows.

function stubWidth(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? narrow : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}
const hashChanged = () => act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); });

async function start(hash: string, narrow: boolean) {
  stubWidth(narrow);
  window.location.hash = hash;
  const view = render(<App client={createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }))} language="en" />);
  await waitFor(() => expect(view.container.querySelector('h1')).not.toBeNull());
  return view;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the bar on a phone (C2)', () => {
  it('the top bar has the button; pressing it opens the dialog with the box focused; what is behind is inert', async () => {
    const { container } = await start('#/today', true);
    const top = container.querySelector<HTMLElement>('header[data-top-bar]')!;
    const button = within(top).getByRole('button', { name: 'Find or ask' });
    expect(screen.queryByRole('combobox', { name: 'Find or ask' })).toBeNull();
    button.focus();
    await act(async () => { fireEvent.click(button); });
    const dialog = screen.getByRole('dialog', { name: 'Find or ask' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.hasAttribute('data-cover')).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox', { name: 'Find or ask' }));
    expect(top.parentElement!.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(true);
  });

  it('choosing a client opens its sheet; closing it returns focus to the button', async () => {
    const { container } = await start('#/today', true);
    const button = within(container.querySelector<HTMLElement>('header[data-top-bar]')!).getByRole('button', { name: 'Find or ask' });
    button.focus();
    await act(async () => { fireEvent.click(button); });
    const box = screen.getByRole('combobox', { name: 'Find or ask' }) as HTMLInputElement;
    await act(async () => { fireEvent.change(box, { target: { value: 'boat audio' } }); });
    await waitFor(() => expect(within(screen.getByRole('listbox', { name: 'Find or ask' })).queryByRole('group', { name: 'Clients' })).not.toBeNull());
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    await hashChanged();
    expect(decodeURIComponent(window.location.hash)).toBe('#/clients?sheet=client:c-boat');
    expect(screen.queryByRole('dialog', { name: 'Find or ask' })).toBeNull();
    await waitFor(() => expect(container.querySelector('[data-sheet]')).not.toBeNull());
    await act(async () => { fireEvent.keyDown(document.body, { key: 'Escape' }); });
    await hashChanged();
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Find or ask'));
    expect(document.activeElement!.closest('header[data-top-bar]')).not.toBeNull();
  });

  it('Esc closes the list, then the dialog, and focus goes back to the button', async () => {
    const { container } = await start('#/today', true);
    const button = within(container.querySelector<HTMLElement>('header[data-top-bar]')!).getByRole('button', { name: 'Find or ask' });
    button.focus();
    await act(async () => { fireEvent.click(button); });
    const box = screen.getByRole('combobox', { name: 'Find or ask' });
    await act(async () => { fireEvent.change(box, { target: { value: 'boat' } }); });
    await act(async () => { fireEvent.keyDown(box, { key: 'Escape' }); });
    expect(screen.getByRole('dialog', { name: 'Find or ask' })).toBeTruthy();
    await act(async () => { fireEvent.keyDown(box, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog', { name: 'Find or ask' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('nothing in the phone styles can push the page sideways', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(import.meta.dirname, '../../src/shell/find/CommandBox.module.css'), 'utf8');
    const cover = /\.dialog\[data-cover\] \{([^}]*)\}/.exec(css)![1]!;
    expect(cover).toMatch(/width: auto/);
    expect(cover).toMatch(/grid-column: 1 \/ -1/);
    expect(css).toMatch(/\.inDialog\s*\{[^}]*flex: 1/);
  });
});

describe('the bar on Chats beside the rail (C2)', () => {
  it('has no header box; Ctrl K opens the dialog, and Esc hands focus back', async () => {
    const { container } = await start('#/chats', false);
    await screen.findByRole('navigation', { name: 'Your chats' });
    expect(screen.queryByRole('combobox', { name: 'Find or ask' })).toBeNull();
    await act(async () => { fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true }); });
    const dialog = screen.getByRole('dialog', { name: 'Find or ask' });
    expect(dialog.hasAttribute('data-cover')).toBe(false);
    const box = within(dialog).getByRole('combobox', { name: 'Find or ask' });
    expect(document.activeElement).toBe(box);
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(true);
    await act(async () => { fireEvent.keyDown(box, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog', { name: 'Find or ask' })).toBeNull();
    expect(container.querySelector('main')!.hasAttribute('inert')).toBe(false);
  });
});
