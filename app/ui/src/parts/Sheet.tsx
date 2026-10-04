/**
 * Sheet: the panel at the right with the detail of the row you opened.
 * - One sheet at a time. The frame renders at most one.
 * - A labelled reading region. Its top line says what it is and where you are in the
 *   list ("Approval · 1 of 5") and how to close it ("Close · Esc").
 * - Opening moves focus to the title. Closing returns focus to the row that opened it.
 * - Something deeper (the receipt behind an approval) replaces the sheet's content and
 *   a link at the top leads back. The parent swaps the content through `back`; sheets
 *   never stack.
 * - Ctrl Enter runs the main action, never for money: a money action always asks again,
 *   so its `primary` is marked `money` and the frame refuses the key for it.
 */

import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../app/text';
import { Button } from './Button';
import s from './Sheet.module.css';

export interface SheetPrimary {
  label: string;
  onPress: () => void;
  /** Money, outside messages, deleting: never run from the keyboard shortcut. */
  money?: boolean | undefined;
  disabled?: boolean | undefined;
}

export interface SheetRegistry {
  setPrimary: (p: SheetPrimary | null) => void;
  setClose: (fn: (() => void) | null) => void;
  setAdjacent: (fn: ((delta: -1 | 1) => void) | null) => void;
}

const noop: SheetRegistry = { setPrimary: () => {}, setClose: () => {}, setAdjacent: () => {} };
export const SheetRegistryContext = createContext<SheetRegistry>(noop);

export interface SheetProps {
  /** What it is: "Approval", "Receipt". Already localised. */
  kind: string;
  position?: { index: string; total: string } | undefined;
  title: string;
  /** A deeper view replaced the content; this leads back. */
  back?: { label: string; onBack: () => void } | undefined;
  onClose: () => void;
  onAdjacent?: ((delta: -1 | 1) => void) | undefined;
  primary?: SheetPrimary | undefined;
  /** Other actions: quiet buttons and links. */
  actions?: ReactNode;
  /** Where focus returns on close. */
  origin: HTMLElement | SVGElement | null;
  /** A small label at the top right, such as a marking in the enterprise version. */
  corner?: ReactNode;
  children: ReactNode;
}

export function Sheet({ kind, position, title, back, onClose, onAdjacent, primary, actions, origin, corner, children }: SheetProps) {
  const t = useT();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const registry = useContext(SheetRegistryContext);
  const originRef = useRef(origin);
  originRef.current = origin ?? originRef.current;

  useEffect(() => {
    titleRef.current?.focus();
    return () => {
      originRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
  }, [title]);

  useEffect(() => {
    registry.setPrimary(primary ?? null);
    registry.setClose(onClose);
    registry.setAdjacent(onAdjacent ?? null);
    return () => {
      registry.setPrimary(null);
      registry.setClose(null);
      registry.setAdjacent(null);
    };
  }, [registry, primary, onClose, onAdjacent]);

  return (
    <section className={[s.sheet, 'm-sheet'].join(' ')} aria-labelledby={titleId} data-region="sheet">
      <div className={s.top}>
        <span className={s.kind}>
          {back ? (
            <Button variant="link" onClick={back.onBack} className={s.back}>
              {t('SHEET.back', { what: back.label })}
            </Button>
          ) : position ? (
            t('SHEET.position', { kind, index: position.index, total: position.total })
          ) : (
            kind
          )}
        </span>
        {corner}
        <Button variant="link" onClick={onClose} className={s.close}>
          {t('SHEET.close')}
        </Button>
      </div>
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className={s.title}>
        {title}
      </h2>
      <div className={s.body}>{children}</div>
      {(primary || actions) && (
        <div className={s.actions}>
          {primary && (
            <Button variant="filled" onClick={primary.onPress} disabled={primary.disabled}>
              {primary.label}
            </Button>
          )}
          {actions}
        </div>
      )}
    </section>
  );
}
