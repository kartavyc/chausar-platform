/**
 * Table: the Books view's rows, 32 pixels high, between hairlines.
 * - Columns have a kind: text, as written, money, count, date, state, action.
 * - Sorting by a header compares what the engine supplied: a cell's `sortKey` string, or
 *   for money and count the exact whole value as BigInt. A displayed string is never
 *   parsed. Missing values sort after known ones either way. Ties keep the engine's order.
 * - Virtualized: only the rows in the viewport, plus a few either side, are drawn.
 * - A grid for assistive technology: aria-rowcount and aria-rowindex count every row,
 *   drawn or not. The header is row 1.
 * - The sorted header is underlined; its direction is in aria-sort.
 * - Keys: Up and Down move the row focus, Home and End go to the first and last row,
 *   Page Up and Page Down move by a screen, Enter opens the row, Right reaches the row's
 *   figures and actions one by one and Left goes back.
 * - The control that opens the row and the control that opens a money cell's receipt are
 *   separate buttons side by side, as in Row.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type UIEvent } from 'react';
import type { FigureOrMissing, Mark } from '../app/presentation.ts';
import { useT } from '../app/text';
import { Button } from './Button';
import { Figure } from './Figure';
import { Square } from './Square';
import s from './Table.module.css';

export const TABLE_ROW_PX = 32;

export type TableColumnKind = 'text' | 'as-written' | 'money' | 'count' | 'date' | 'state' | 'action';

export interface TableColumn {
  readonly id: string;
  /** The header, already localised. */
  readonly label: string;
  readonly kind: TableColumnKind;
  readonly sortable?: boolean;
  /** A CSS grid track, such as "minmax(0, 2fr)" or "120px". */
  readonly width?: string;
}

export type TableCell =
  | { readonly kind: 'text' | 'as-written' | 'date'; readonly text: string; readonly sortKey?: string }
  | { readonly kind: 'money' | 'count'; readonly value: FigureOrMissing }
  | { readonly kind: 'state'; readonly mark: Mark; readonly words: string; readonly sortKey?: string }
  | { readonly kind: 'action'; readonly actionId: string; readonly label: string };

export interface TableRow {
  readonly id: string;
  readonly cells: Readonly<Record<string, TableCell>>;
}

export type TableSort = { readonly columnId: string; readonly direction: 'ascending' | 'descending' };

export interface TableProps {
  /** What the table holds, for screen readers. */
  label: string;
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<TableRow>;
  /** Absent when rows open nothing. */
  onOpen?: ((rowId: string, origin: HTMLElement) => void) | undefined;
  onReceipt: (receiptId: string) => void;
  /** An action cell's press. Action cells are drawn only when this is given. */
  onAction?: ((rowId: string, actionId: string) => void) | undefined;
  /** Controlled sort. Without it the table keeps its own, starting from `initialSort`. */
  sort?: TableSort | null | undefined;
  initialSort?: TableSort | null | undefined;
  onSortChange?: ((sort: TableSort) => void) | undefined;
  /** The viewport's height in pixels. */
  height?: number | undefined;
  /** Rows drawn beyond each edge of the viewport. */
  overscan?: number | undefined;
  className?: string | undefined;
}

type Key = { known: boolean; text: string; exact: bigint };

function keyOf(cell: TableCell | undefined): Key {
  const none: Key = { known: false, text: '', exact: 0n };
  if (cell === undefined) return none;
  switch (cell.kind) {
    case 'action':
      return none;
    case 'money':
    case 'count': {
      const v = cell.value;
      if (v.kind === 'missing' || !/^-?\d+$/.test(v.exact)) return none;
      return { known: true, text: '', exact: BigInt(v.exact) };
    }
    case 'state':
      return { known: true, text: cell.sortKey ?? cell.words, exact: 0n };
    default:
      return { known: true, text: cell.sortKey ?? cell.text, exact: 0n };
  }
}

function compareKeys(a: Key, b: Key, exact: boolean): number {
  if (a.known !== b.known) return a.known ? -1 : 1;
  if (!a.known) return 0;
  if (exact) return a.exact < b.exact ? -1 : a.exact > b.exact ? 1 : 0;
  return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
}

/** Sorted row order. Exported for checks; it reads only supplied keys and exact values. */
export function sortRows(rows: ReadonlyArray<TableRow>, columns: ReadonlyArray<TableColumn>, sort: TableSort | null): ReadonlyArray<TableRow> {
  if (sort === null) return rows;
  const column = columns.find((c) => c.id === sort.columnId);
  if (column === undefined || column.kind === 'action') return rows;
  const exact = column.kind === 'money' || column.kind === 'count';
  const sign = sort.direction === 'ascending' ? 1 : -1;
  const keyed = rows.map((row, index) => ({ row, index, key: keyOf(row.cells[column.id]) }));
  keyed.sort((a, b) => {
    /* Missing stays last in both directions. */
    if (a.key.known !== b.key.known) return a.key.known ? -1 : 1;
    const c = compareKeys(a.key, b.key, exact);
    return c !== 0 ? c * sign : a.index - b.index;
  });
  return keyed.map((k) => k.row);
}

/* A cell control: a money or count figure, or an action. Reached with Right from the row. */
const CONTROL = '[data-table-control] button';

export function Table({ label, columns, rows, onOpen, onReceipt, onAction, sort, initialSort = null, onSortChange, height = 480, overscan = 6, className }: TableProps) {
  const t = useT();
  const gridId = useId();
  const [ownSort, setOwnSort] = useState<TableSort | null>(initialSort);
  const current = sort !== undefined ? sort : ownSort;
  const ordered = useMemo(() => sortRows(rows, columns, current), [rows, columns, current]);
  const [scrollTop, setScrollTop] = useState(0);
  const [active, setActive] = useState(0);
  const focusPending = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<number, HTMLElement>());

  const last = ordered.length - 1;
  const activeIndex = Math.min(Math.max(active, 0), Math.max(last, 0));
  const visibleRows = Math.max(1, Math.ceil(height / TABLE_ROW_PX));
  const first = Math.max(0, Math.floor(scrollTop / TABLE_ROW_PX) - overscan);
  const end = Math.min(ordered.length, Math.floor(scrollTop / TABLE_ROW_PX) + visibleRows + overscan);
  const drawn: number[] = [];
  for (let i = first; i < end; i++) drawn.push(i);
  /* The row holding the tab stop is always drawn, so focus is never lost to scrolling. */
  if (ordered.length > 0 && (activeIndex < first || activeIndex >= end)) drawn.push(activeIndex);

  const template = columns.map((c) => c.width ?? (c.kind === 'text' || c.kind === 'as-written' ? 'minmax(0, 2fr)' : 'minmax(0, 1fr)')).join(' ');
  const gridStyle = { '--cols': template } as CSSProperties;

  const pressSort = (column: TableColumn) => {
    const next: TableSort = current !== null && current.columnId === column.id && current.direction === 'ascending'
      ? { columnId: column.id, direction: 'descending' }
      : { columnId: column.id, direction: 'ascending' };
    if (sort === undefined) setOwnSort(next);
    onSortChange?.(next);
  };

  const moveTo = useCallback((index: number) => {
    if (last < 0) return;
    const next = Math.min(Math.max(index, 0), last);
    const el = viewport.current;
    if (el) {
      const top = next * TABLE_ROW_PX;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + TABLE_ROW_PX > el.scrollTop + height) el.scrollTop = top + TABLE_ROW_PX - height;
      setScrollTop(el.scrollTop);
    }
    focusPending.current = true;
    setActive(next);
  }, [last, height]);

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    rowEls.current.get(activeIndex)?.focus();
  });

  const onRowKey = (e: KeyboardEvent<HTMLElement>, index: number, row: TableRow) => {
    if (e.target instanceof HTMLElement && e.target.matches(CONTROL)) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const controls = [...(e.currentTarget.closest('[role="row"]')?.querySelectorAll<HTMLElement>(CONTROL) ?? [])];
      const at = controls.indexOf(e.target);
      const next = e.key === 'ArrowRight' ? controls[at + 1] : at > 0 ? controls[at - 1] : rowEls.current.get(index);
      next?.focus();
      return;
    }
    const page = Math.max(1, visibleRows - 1);
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveTo(index + 1); break;
      case 'ArrowUp': e.preventDefault(); moveTo(index - 1); break;
      case 'PageDown': e.preventDefault(); moveTo(index + page); break;
      case 'PageUp': e.preventDefault(); moveTo(index - page); break;
      case 'Home': e.preventDefault(); moveTo(0); break;
      case 'End': e.preventDefault(); moveTo(last); break;
      case 'ArrowRight': {
        const control = e.currentTarget.closest('[role="row"]')?.querySelector<HTMLElement>(CONTROL);
        if (control) { e.preventDefault(); control.focus(); }
        break;
      }
      case 'Enter':
        if (onOpen && e.target === e.currentTarget && e.currentTarget.tagName !== 'BUTTON') {
          e.preventDefault();
          onOpen(row.id, e.currentTarget);
        }
        break;
      default:
    }
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop);

  /* The first text column carries the row's open button; otherwise the row itself holds focus. */
  const mainColumn = columns.find((c) => c.kind === 'text' || c.kind === 'as-written')?.id;

  const cellContent = (column: TableColumn, row: TableRow, index: number) => {
    const cell = row.cells[column.id];
    if (cell === undefined) return null;
    switch (cell.kind) {
      case 'money':
      case 'count':
        return (
          <span data-table-control="">
            <Figure value={cell.value} onReceipt={onReceipt} tabStop={false} />
          </span>
        );
      case 'state':
        return (
          <span className={s.state}>
            <Square mark={cell.mark} />
            <span>{cell.words}</span>
          </span>
        );
      case 'action':
        return onAction ? (
          <span data-table-control="">
            <Button variant="link" tabIndex={-1} onClick={() => onAction(row.id, cell.actionId)}>
              {cell.label}
            </Button>
          </span>
        ) : null;
      default: {
        const text = <span className={[s.text, cell.kind === 'as-written' ? 'fig' : ''].join(' ')}>{cell.text}</span>;
        if (onOpen && column.id === mainColumn) {
          return (
            <button
              type="button"
              className={s.open}
              data-row-main=""
              tabIndex={index === activeIndex ? 0 : -1}
              onClick={(e) => { setActive(index); onOpen(row.id, e.currentTarget); }}
              onKeyDown={(e) => onRowKey(e, index, row)}
              onFocus={() => setActive(index)}
              ref={(el) => { if (el) rowEls.current.set(index, el); else rowEls.current.delete(index); }}
            >
              {text}
            </button>
          );
        }
        return text;
      }
    }
  };

  const rowsFocus = !onOpen || mainColumn === undefined;

  return (
    <div className={[s.table, className].filter(Boolean).join(' ')} style={gridStyle}>
      <div
        role="grid"
        id={gridId}
        aria-label={label}
        aria-rowcount={ordered.length + 1}
        aria-colcount={columns.length}
        className={s.grid}
      >
        <div role="rowgroup" className={s.head}>
          <div role="row" aria-rowindex={1} className={s.row}>
            {columns.map((column, ci) => {
              const sorted = current !== null && current.columnId === column.id ? current.direction : undefined;
              const canSort = column.sortable === true && column.kind !== 'action';
              return (
                <div
                  key={column.id}
                  role="columnheader"
                  aria-colindex={ci + 1}
                  aria-sort={canSort ? (sorted ?? 'none') : undefined}
                  className={[s.cell, s[kindClass(column.kind)]].join(' ')}
                >
                  {canSort ? (
                    <button type="button" className={[s.sort, sorted ? s.sorted : ''].join(' ')} onClick={() => pressSort(column)}>
                      {column.label}
                    </button>
                  ) : (
                    column.label
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div ref={viewport} role="rowgroup" className={s.body} style={{ height: `${height}px` }} onScroll={onScroll}>
          {ordered.length === 0 ? (
            <div role="row" aria-rowindex={2} className={s.row}>
              <div role="gridcell" className={s.cell} aria-colspan={columns.length}>{t('TABLE.empty')}</div>
            </div>
          ) : (
            <div className={s.spacer} style={{ height: `${ordered.length * TABLE_ROW_PX}px` }}>
              {drawn.map((index) => {
                const row = ordered[index];
                if (row === undefined) return null;
                return (
                  <div
                    key={row.id}
                    role="row"
                    aria-rowindex={index + 2}
                    data-row-id={row.id}
                    className={[s.row, s.bodyRow, index === activeIndex ? s.active : ''].join(' ')}
                    style={{ transform: `translateY(${index * TABLE_ROW_PX}px)` }}
                    tabIndex={rowsFocus ? (index === activeIndex ? 0 : -1) : undefined}
                    onKeyDown={rowsFocus ? (e) => onRowKey(e, index, row) : (e) => { if (e.target instanceof HTMLElement && e.target.matches(CONTROL)) onRowKey(e, index, row); }}
                    onFocus={rowsFocus ? () => setActive(index) : undefined}
                    ref={rowsFocus ? (el) => { if (el) rowEls.current.set(index, el); else rowEls.current.delete(index); } : undefined}
                  >
                    {columns.map((column, ci) => (
                      <div key={column.id} role="gridcell" aria-colindex={ci + 1} className={[s.cell, s[kindClass(column.kind)]].join(' ')}>
                        {cellContent(column, row, index)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function kindClass(kind: TableColumnKind): string {
  return kind === 'money' || kind === 'count' ? 'number' : kind === 'action' ? 'action' : kind === 'state' ? 'stateCol' : 'textCol';
}
