/**
 * Asking Chausar from anywhere (Ink v2 wave 4, 4C2; C2): the command bar's Ask row, the Chausar story on Today and the
 * questions on Start all hand their words to Chats this way. The words wait here, in memory only (never in the
 * address, where they would sit in the history, and never in browser storage), until the Chats place takes them. The
 * Ask row sends them through Chats' own send and its consent card (the founder's F1); every other caller puts them in
 * the composer, unsent. Ctrl K (useFindKey) goes to the command bar.
 */

import { useEffect, useRef } from 'react';
import { goTo } from './navigation';

let pending: string | null = null;
let pendingSend = false;
const listeners = new Set<() => void>();

/** Forget clears the in-memory handoff, including words not yet taken by Chats. */
export function forgetAskWords(): void {
  pending = null;
  pendingSend = false;
}

/** Opens a new chat with these words in the composer, unsent, or sent with `send`; left out, an empty new chat. */
export function askChausar(text?: string, options: { send?: boolean } = {}): void {
  pending = (text ?? '').trim();
  pendingSend = options.send === true && pending !== '';
  goTo('chats');
  for (const listener of [...listeners]) listener();
}

/** The words waiting for Chats, taken once; null when there are none. */
export function takeAsk(): string | null {
  const words = pending;
  pending = null;
  pendingSend = false;
  return words;
}

/** Calls back after every ask (Chats takes the words). */
export function onAsk(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Chats' side: the words waiting when it opens, then each later ask, handed to `take` (and taken, so they show once),
 * with whether Chats sends them.
 */
export function useAskWords(take: (words: string, send: boolean) => void): void {
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    const receive = () => {
      const send = pendingSend;
      const words = takeAsk();
      if (words !== null) latest.current(words, send);
    };
    receive();
    return onAsk(receive);
  }, []);
}

/** A field the owner types in, other than the command bar itself: Ctrl K there is the field's own (a link, say). */
function typingElsewhere(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) && !el.closest('[data-find-box]');
}

/**
 * Ctrl K (Cmd K on a Mac), from anywhere but another field the owner is typing in, and never while an input method
 * composes: beside the rail it puts the cursor in the header's command bar with its words selected; where no header
 * bar shows (a phone, Chats) it calls `openDialog`, which opens the bar as a dialog.
 */
export function useFindKey(openDialog: () => void): void {
  const latest = useRef(openDialog);
  latest.current = openDialog;
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      if (typingElsewhere(event.target)) return;
      event.preventDefault();
      const box = document.querySelector<HTMLInputElement>('[data-find-header] input[role="combobox"]');
      if (box) { box.focus(); box.select(); return; }
      latest.current();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
}
