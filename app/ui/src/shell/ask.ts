/**
 * Asking Chausar from anywhere (Ink v2 wave 4, 4C2): the header's "Ask Chausar anything" box, Ctrl K, the Chausar
 * story on Today and the questions on Start all hand their words to Chats this way. The words wait here, in memory
 * only (never in the address, where they would sit in the history, and never in browser storage), until the Chats
 * place takes them into its composer. Nothing is sent: the owner presses Send.
 */

import { useEffect, useRef } from 'react';
import { goTo } from './navigation';

let draft = '';
let pending: string | null = null;
const listeners = new Set<() => void>();

/** What the header box holds right now, so Ctrl K carries it (the box keeps it as the owner types). */
export function setAskDraft(text: string): void {
  draft = text;
}

/**
 * Opens a new chat with these words in the composer, unsent. Left out, the header box's words go (Ctrl K). Every box
 * that showed the words is emptied.
 */
export function askChausar(text?: string): void {
  pending = (text ?? draft).trim();
  draft = '';
  goTo('chats');
  for (const listener of [...listeners]) listener();
}

/** The words waiting for Chats, taken once; null when there are none. */
export function takeAsk(): string | null {
  const words = pending;
  pending = null;
  return words;
}

/** Calls back after every ask (the header box empties itself; Chats takes the words). */
export function onAsk(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Chats' side: the words waiting when it opens, then each later ask, handed to `take` (and taken, so they show once).
 */
export function useAskWords(take: (words: string) => void): void {
  const latest = useRef(take);
  latest.current = take;
  useEffect(() => {
    const receive = () => {
      const words = takeAsk();
      if (words !== null) latest.current(words);
    };
    receive();
    return onAsk(receive);
  }, []);
}

/** A field the owner types in, other than the Ask box itself: Ctrl K there is the field's own (a link, say). */
function typingElsewhere(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) && !el.closest('[data-ask-box]');
}

/**
 * Ctrl K (Cmd K on a Mac) opens a new chat with what the header box holds, from anywhere but another field the owner is
 * typing in, and never while an input method composes.
 */
export function useAskKey(): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
      if (typingElsewhere(event.target)) return;
      event.preventDefault();
      askChausar();
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
}
