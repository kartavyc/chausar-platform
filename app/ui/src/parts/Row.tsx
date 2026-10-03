/**
 * Row: the basic unit. Four slots: the square, what it is with a short grey note after
 * it, the figure at the right in the number face, and a small arrow.
 * One line; overflow is cut with three dots and the full text is in the sheet.
 * `selected`: its sheet is open (medium weight). `open`: opened in place, one more line
 * of detail and the Review button appear under it (Today only).
 * Text from the books (`asWritten`, names) is rendered as a text node, never as markup.
 *
 * The control that opens the row and the control that opens the figure's receipt are two
 * separate buttons side by side; neither is inside the other. A row with nothing to open
 * has no row button and no arrow: its words are plain text and its figure stays a button.
 */

import type { ReactNode, KeyboardEvent, MouseEvent } from 'react';
import type { RowItem } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Square } from './Square';
import { Figure } from './Figure';
import s from './Row.module.css';

export interface RowProps {
  row: RowItem;
  selected?: boolean | undefined;
  open?: boolean | undefined;
  /** Roving tabindex: the list says which row holds the tab stop. */
  tabStop: boolean;
  /** Absent when this row opens nothing. */
  onOpen?: ((id: string, origin: HTMLElement) => void) | undefined;
  onReceipt: (receiptId: string) => void;
  onKeyDown?: ((e: KeyboardEvent<HTMLButtonElement>) => void) | undefined;
  /** What shows under the row when it is open in place. */
  expansion?: ReactNode;
  /** Register the main control so a sheet can return focus here. */
  registerOrigin?: ((id: string, el: HTMLButtonElement | null) => void) | undefined;
}

function Arrow({ open }: { open: boolean }) {
  return (
    <svg className={[s.arrow, open ? s.arrowOpen : ''].join(' ')} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <path d="M2.5 1.5 5 4 2.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Row({ row, selected = false, open = false, tabStop, onOpen, onReceipt, onKeyDown, expansion, registerOrigin }: RowProps) {
  const t = useT();

  const what = (
    <>
      <Square mark={row.mark} wordsKey={row.markWordsKey} />
      <span className={s.what}>
        <span className={s.title}>{row.what}</span>
        {row.note !== undefined && row.note.length > 0 && <span className={s.note}>{row.note}</span>}
        {row.asWritten !== undefined && <span className={[s.asWritten, 'fig'].join(' ')}>{row.asWritten}</span>}
        {row.owner !== undefined && <span className={s.note}>{t('EN.owner', { name: row.owner })}</span>}
      </span>
    </>
  );

  return (
    <li className={[s.row, selected ? s.selected : '', open ? s.open : ''].filter(Boolean).join(' ')} data-row-id={row.id}>
      <div className={s.line}>
        {onOpen ? (
          <button
            type="button"
            className={s.main}
            data-row-main=""
            tabIndex={tabStop ? 0 : -1}
            aria-expanded={expansion !== undefined ? open : undefined}
            aria-current={selected ? 'true' : undefined}
            onClick={(e: MouseEvent<HTMLButtonElement>) => onOpen(row.id, e.currentTarget)}
            onKeyDown={onKeyDown}
            ref={(el) => registerOrigin?.(row.id, el)}
          >
            {what}
          </button>
        ) : (
          <div className={[s.main, s.static].join(' ')}>{what}</div>
        )}
        {row.figure !== undefined && (
          <span className={s.figure} data-row-figure="">
            {/* With a row button, the figure is reached with Right; without one it is a tab stop. */}
            <Figure value={row.figure} onReceipt={onReceipt} tabStop={onOpen === undefined} statement={row.statement} />
          </span>
        )}
        <span className={s.arrowSlot} aria-hidden="true">
          {onOpen && <Arrow open={open} />}
        </span>
      </div>
      {open && expansion !== undefined && <div className={s.expansion}>{expansion}</div>}
    </li>
  );
}
