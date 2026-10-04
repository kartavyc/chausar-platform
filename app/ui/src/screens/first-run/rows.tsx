/**
 * Row furniture the two first-run steps share: the small arrow at the end of a row,
 * Up/Down movement between the row controls of one list, and the bounded preview of a
 * meaning for a closed row. The row control and any action under it are separate
 * buttons; nothing here nests one control in another.
 */

import type { KeyboardEvent } from 'react';
import type { View } from '../../app/presentation.ts';
import s from './FirstRun.module.css';

export function Arrow({ open }: { open: boolean }) {
  return (
    <svg className={[s.arrow, open ? s.arrowOpen : ''].filter(Boolean).join(' ')} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <path d="M2.5 1.5 5 4 2.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Up and Down move between the row controls of the first-run list the pressed control sits in. */
export function moveBetweenRows(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const list = event.currentTarget.closest('[data-first-run-list]');
  if (list === null) return;
  const mains = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-row-main]'));
  const index = mains.indexOf(event.currentTarget);
  if (index < 0) return;
  const next = mains[event.key === 'ArrowDown' ? index + 1 : index - 1];
  if (next !== undefined) {
    event.preventDefault();
    next.focus();
  }
}

/**
 * How many words of the exact meaning a closed row shows, by the parent's chosen view
 * (build.md part 4: Simple 90, Guided 120, Books 170 visible words in the main area at
 * rest). Two keeps the whole step, with one row open, inside the Guided budget in Hindi as
 * well as English; Books has room for three; Simple has room for none, so there a closed
 * row is the word and its state and the exact meaning opens with the row. The view is a
 * presentational choice handed down by the parent; this slice draws no view selector.
 */
export const PREVIEW_WORDS_BY_VIEW: Readonly<Record<View, number>> = Object.freeze({ simple: 0, guided: 2, books: 3 });
export const PREVIEW_WORDS = PREVIEW_WORDS_BY_VIEW.guided;

export interface MeaningPreview {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * The first words of the exact meaning, for the closed row. Never a paraphrase: the words
 * are the meaning's own, in order; a truncated preview ends with an ellipsis (U+2026), and
 * the open row carries the whole text. Zero words means no preview at all (null).
 */
export function previewOf(meaning: string, words = PREVIEW_WORDS): MeaningPreview | null {
  if (words <= 0) return null;
  const parts = meaning.split(/\s+/u).filter(part => part.length > 0);
  if (parts.length <= words) return { text: parts.join(' '), truncated: false };
  return { text: `${parts.slice(0, words).join(' ')}…`, truncated: true };
}
