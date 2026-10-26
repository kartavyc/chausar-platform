/**
 * Keys that work on every list:
 *   J / K   next and previous row
 *   Enter   open the focused row in the sheet
 *   A       the row's primary action
 *   D       the row's secondary action
 *   Esc     close the sheet, from anywhere, even inside a field
 * A and D never act on a row whose primary takes a second ask (money, irreversible sends): those always need the
 * confirm inside the row. Letters do nothing while typing, during IME composition, or with Ctrl, Alt or Cmd held.
 * Rows mark themselves with data-row; their buttons with data-key="primary" / "secondary"; the title with data-open.
 */

import { useEffect, type RefObject } from 'react';

export type KeyIntent = 'next' | 'previous' | 'open' | 'primary' | 'secondary' | 'close';

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

export function readKey(event: KeyboardEvent, target: EventTarget | null = event.target): KeyIntent | null {
  if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === 'Escape') return 'close';
  if (typing(target)) return null;
  if (event.key === 'Enter') {
    const el = target as HTMLElement | null;
    return el?.hasAttribute?.('data-row') ? 'open' : null;
  }
  switch (event.key.toLowerCase()) {
    case 'j': return 'next';
    case 'k': return 'previous';
    case 'a': return 'primary';
    case 'd': return 'secondary';
    default: return null;
  }
}

/** Run an intent against the rows in the region that has focus (the page or the sheet). Returns whether it acted. */
export function runKey(intent: KeyIntent, main: HTMLElement | null, close: () => void): boolean {
  if (intent === 'close') { close(); return true; }
  const active = document.activeElement as HTMLElement | null;
  const region = (active?.closest('[data-sheet]') as HTMLElement | null) ?? main;
  if (!region) return false;
  const current = active?.closest<HTMLElement>('[data-row]') ?? null;
  if (intent === 'next' || intent === 'previous') {
    const rows = [...region.querySelectorAll<HTMLElement>('[data-row]')];
    if (rows.length === 0) return false;
    const at = current ? rows.indexOf(current) : -1;
    const next = intent === 'next' ? (at < 0 ? 0 : Math.min(at + 1, rows.length - 1)) : (at < 0 ? 0 : Math.max(at - 1, 0));
    rows[next]!.focus();
    rows[next]!.scrollIntoView({ block: 'nearest' });
    return true;
  }
  if (!current) return false;
  if (intent === 'open') {
    const opener = current.querySelector<HTMLElement>('[data-open]');
    opener?.click();
    return Boolean(opener);
  }
  if (current.hasAttribute('data-second-ask')) return false;
  const button = current.querySelector<HTMLButtonElement>(`[data-key="${intent}"]`);
  // A locked button (view before approve) is aria-disabled, not disabled, so it stays reachable: A and D skip it too.
  if (!button || button.disabled || button.hasAttribute('data-locked') || button.getAttribute('aria-disabled') === 'true') return false;
  button.click();
  return true;
}

export function useShellKeys({ mainRef, onClose }: { mainRef: RefObject<HTMLElement | null>; onClose: () => void }): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const intent = readKey(event);
      if (!intent) return;
      if (runKey(intent, mainRef.current, onClose) && intent !== 'close') event.preventDefault();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [mainRef, onClose]);
}
