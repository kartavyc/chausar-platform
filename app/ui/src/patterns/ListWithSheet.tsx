/**
 * ListWithSheet: a RowList and, when a row is open, its sheet beside it. The list keeps
 * its place. The pattern owns which row is selected, where focus returns, and the
 * next/previous callbacks for Alt Up/Down.
 *
 * The sheet is derived, never published. The parent that owns both the page and the
 * frame's sheet slot calls `useListWithSheet` once, gives the controller to
 * `ListWithSheet` to draw the list, and builds the sheet node itself from
 * `controller.render` in the same render. Nothing here calls a setter that belongs to an
 * ancestor while rendering, and no node is handed upward: that would set state with a
 * fresh node on every pass and render without end. The pattern's own state changes only
 * inside event handlers. The sheet's content may replace itself with a deeper view (a
 * receipt) and lead back; sheets never stack.
 */

import { useCallback, useRef, useState } from 'react';
import type { RowItem } from '../app/presentation.ts';
import { RowList, type RowListProps } from '../parts/RowList';

export interface SheetRender {
  row: RowItem;
  index: number;
  total: number;
  origin: HTMLElement | null;
  close: () => void;
  adjacent: (delta: -1 | 1) => void;
}

export interface ListWithSheetController {
  rows: ReadonlyArray<RowItem>;
  openSheetId: string | undefined;
  open: (id: string, origin: HTMLElement) => void;
  close: () => void;
  registerOrigin: (id: string, el: HTMLButtonElement | null) => void;
  /** The open row and what its sheet needs, or null when no row of this list is open. */
  render: SheetRender | null;
}

export function useListWithSheet(rows: ReadonlyArray<RowItem>, openSheetId: string | undefined, onOpenSheet: (id: string | undefined) => void): ListWithSheetController {
  const origins = useRef(new Map<string, HTMLElement>());
  const [lastOrigin, setLastOrigin] = useState<HTMLElement | null>(null);

  const registerOrigin = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) origins.current.set(id, el);
    else origins.current.delete(id);
  }, []);

  const open = useCallback(
    (id: string, origin: HTMLElement) => {
      setLastOrigin(origin);
      onOpenSheet(id);
    },
    [onOpenSheet],
  );

  const close = useCallback(() => onOpenSheet(undefined), [onOpenSheet]);

  const index = openSheetId === undefined ? -1 : rows.findIndex((r) => r.id === openSheetId);

  const adjacent = useCallback(
    (delta: -1 | 1) => {
      const next = index >= 0 ? rows[index + delta] : undefined;
      if (!next) return;
      const el = origins.current.get(next.id);
      if (el) setLastOrigin(el);
      onOpenSheet(next.id);
    },
    [index, rows, onOpenSheet],
  );

  const current = index >= 0 ? rows[index] : undefined;
  const render: SheetRender | null = current ? { row: current, index, total: rows.length, origin: lastOrigin, close, adjacent } : null;

  return { rows, openSheetId, open, close, registerOrigin, render };
}

export interface ListWithSheetProps extends Omit<RowListProps, 'rows' | 'onOpen' | 'opens' | 'selectedId' | 'registerOrigin'> {
  /** From `useListWithSheet`, called by the parent that also places the sheet. */
  controller: ListWithSheetController;
}

/** The list half. The sheet half is the parent's: `controller.render`. */
export function ListWithSheet({ controller, ...rest }: ListWithSheetProps) {
  return <RowList {...rest} rows={controller.rows} selectedId={controller.openSheetId} onOpen={controller.open} registerOrigin={controller.registerOrigin} />;
}
