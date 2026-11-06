import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import s from './WindowedList.module.css';

/** The list draws rows past the window on each side, so a keypress or a small scroll never lands on blank. */
const OVERSCAN = 8;
/** Used only when the list has no measured height yet (the first frame, or jsdom). */
const FALLBACK_VIEW = 480;

export interface WindowedListProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  /** The row's height in layout pixels, from the same token its CSS uses. Rows are all this tall. */
  rowHeight: number;
  renderRow: (item: T, index: number) => ReactNode;
  /** The list's name for a screen reader. */
  label: string;
  className?: string | undefined;
}

/**
 * A list over 300 rows (one-shot C3 task 16): only the rows near the view are in the page, with spacers keeping the
 * scroll height honest. It stays one list to a screen reader (`role="list"`, each row's `aria-setsize` and
 * `aria-posinset`), and every row can be reached: Arrow keys, Home and End move through all of them, and a focused row
 * that scrolls out stays drawn, so focus is never lost. Rows are placed with spacer heights through the element's style
 * object (CSSOM): layout pixels, never a figure.
 */
export function WindowedList<T>({ items, keyOf, rowHeight, renderRow, label, className }: WindowedListProps<T>) {
  const box = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLDivElement>(null);
  const after = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [view, setView] = useState(FALLBACK_VIEW);
  const [focused, setFocused] = useState<number | null>(null);

  const first = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
  const last = Math.min(items.length - 1, Math.ceil((top + view) / rowHeight) + OVERSCAN);
  const shown: number[] = [];
  for (let index = first; index <= last; index += 1) shown.push(index);
  // A focused row stays drawn wherever the scroll goes.
  if (focused !== null && focused < items.length) {
    if (focused < first) shown.unshift(focused);
    else if (focused > last) shown.push(focused);
  }

  useLayoutEffect(() => {
    if (box.current?.clientHeight) setView(box.current.clientHeight);
    if (before.current) before.current.style.height = `${first * rowHeight}px`;
    if (after.current) after.current.style.height = `${Math.max(0, items.length - 1 - last) * rowHeight}px`;
  }, [first, last, items.length, rowHeight]);

  const moveTo = useCallback((index: number) => {
    const target = Math.max(0, Math.min(items.length - 1, index));
    setFocused(target);
    const element = box.current;
    if (element) {
      const y = target * rowHeight;
      if (y < element.scrollTop) element.scrollTop = y;
      else if (y + rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = y + rowHeight - element.clientHeight;
      setTop(element.scrollTop);
    }
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`[aria-posinset="${target + 1}"]`)?.focus());
  }, [items.length, rowHeight]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[aria-posinset]');
    if (!row) return;
    const at = Number(row.getAttribute('aria-posinset')) - 1;
    const page = Math.max(1, Math.floor(view / rowHeight) - 1);
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'PageDown' ? at + page : event.key === 'PageUp' ? at - page : null;
    if (next === null) return;
    event.preventDefault();
    moveTo(next);
  };

  return (
    <div ref={box} className={className ? `${s.box} ${className}` : s.box} role="list" aria-label={label} onScroll={(event) => setTop(event.currentTarget.scrollTop)} onKeyDown={onKeyDown}>
      <div ref={before} aria-hidden="true" />
      {shown.map((index) => (
        <div
          key={keyOf(items[index]!)} role="listitem" tabIndex={index === (focused ?? 0) ? 0 : -1} aria-setsize={items.length} aria-posinset={index + 1}
          onFocus={() => setFocused(index)} className={s.row}
        >
          {renderRow(items[index]!, index)}
        </div>
      ))}
      <div ref={after} aria-hidden="true" />
    </div>
  );
}
