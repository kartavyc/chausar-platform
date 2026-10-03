/**
 * RowList: rows between hairlines, with keys for moving.
 *   Up / Down   move between rows (roving tabindex)
 *   Home / End  first and last row
 *   Enter       open the row (the row's own button, natively, once)
 *   Right       the row's figure, which opens its receipt; Left returns
 * "See all N" appears when the list was cut by the engine.
 * Each handler acts only on the control it belongs to. A key pressed on the figure never
 * reaches the row's handler, so Enter on a figure opens the receipt and nothing else.
 */

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { RowItem } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Row } from './Row';
import { Button } from './Button';
import s from './RowList.module.css';

export interface RowListProps {
  rows: ReadonlyArray<RowItem>;
  selectedId?: string | undefined;
  openId?: string | undefined;
  /** Absent when no row in this list opens anything. */
  onOpen?: ((id: string, origin: HTMLElement) => void) | undefined;
  /** Which rows open. Absent means every row, when `onOpen` is supplied. */
  opens?: ((row: RowItem) => boolean) | undefined;
  onReceipt: (receiptId: string) => void;
  expansion?: ((row: RowItem) => ReactNode) | undefined;
  /** Shown when the engine cut the list. `count` is the formatted total. */
  seeAll?: { count: string; onPress: () => void } | undefined;
  labelledBy?: string | undefined;
  registerOrigin?: ((id: string, el: HTMLButtonElement | null) => void) | undefined;
  className?: string | undefined;
}

const MAIN = '[data-row-main]';
const FIGURE = '[data-row-figure] button';

export function RowList({ rows, selectedId, openId, onOpen, opens, onReceipt, expansion, seeAll, labelledBy, registerOrigin, className }: RowListProps) {
  const t = useT();
  const listRef = useRef<HTMLUListElement>(null);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);

  const openable = (row: RowItem) => onOpen !== undefined && (opens === undefined || opens(row));
  const stops = rows.filter(openable);
  const tabId = stops.some((r) => r.id === focusId) ? focusId : stops[0]?.id;

  const focusMain = (from: HTMLButtonElement, pick: (at: number, last: number) => number) => {
    const list = listRef.current;
    if (!list) return;
    const mains = Array.from(list.querySelectorAll<HTMLButtonElement>(MAIN));
    const el = mains[pick(mains.indexOf(from), mains.length - 1)];
    if (!el) return;
    setFocusId(el.closest('li')?.dataset['rowId']);
    el.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.target !== e.currentTarget) return;
    const from = e.currentTarget;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusMain(from, (at, last) => Math.min(at + 1, last));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusMain(from, (at) => Math.max(at - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusMain(from, () => 0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusMain(from, (_at, last) => last);
    } else if (e.key === 'ArrowRight') {
      const fig = from.closest('li')?.querySelector<HTMLButtonElement>(FIGURE);
      if (fig) {
        e.preventDefault();
        fig.focus();
      }
    }
  };

  /* Left from a figure returns to its row. Nothing else is handled at the list. */
  const onFigureKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowLeft' || !(e.target instanceof HTMLElement) || !e.target.matches(FIGURE)) return;
    const main = e.target.closest('li')?.querySelector<HTMLButtonElement>(MAIN);
    if (main) {
      e.preventDefault();
      main.focus();
    }
  };

  return (
    <div className={className}>
      <ul ref={listRef} className={s.list} aria-labelledby={labelledBy} onKeyDown={onFigureKey}>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            selected={row.id === selectedId}
            open={row.id === openId}
            tabStop={row.id === tabId}
            onOpen={openable(row) ? onOpen : undefined}
            onReceipt={onReceipt}
            onKeyDown={onKey}
            expansion={expansion?.(row)}
            registerOrigin={registerOrigin}
          />
        ))}
      </ul>
      {seeAll && (
        <div className={s.seeAll}>
          <Button variant="link" onClick={seeAll.onPress}>
            {t('BTN.seeAll', { count: seeAll.count })}
          </Button>
        </div>
      )}
    </div>
  );
}
