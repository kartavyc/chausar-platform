import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../text';
import { Button } from './Button';
import s from './Sheet.module.css';

export interface SheetProps {
  /** What kind of sheet this is, for the top line: "Run", "Receipt". */
  label: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  line?: ReactNode;
  onClose: () => void;
  /** Puts focus back where the sheet was opened from. Left out, focus returns to whatever had it before. */
  returnFocus?: (() => void) | undefined;
  children?: ReactNode;
  footer?: ReactNode;
}

/**
 * The panel beside the list, never modal: the page stays usable. The shell shows one at a time. Opening moves focus
 * to the title; closing returns it to the row or control that opened the sheet. Esc closes it (shell keys).
 */
export function Sheet({ label, eyebrow, title, line, onClose, returnFocus, children, footer }: SheetProps) {
  const t = useT();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const restore = useRef(returnFocus);
  restore.current = returnFocus;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => {
      if (restore.current) restore.current();
      else if (before?.isConnected) before.focus();
    };
  }, []);

  return (
    <aside className={s.sheet} aria-labelledby={titleId} data-sheet="">
      <div className={s.top}>
        <span className={s.label}>{label}</span>
        <Button variant="quiet" className={s.close} onClick={onClose}>{t('sheet.close')}</Button>
      </div>
      {eyebrow && <div className={s.eyebrow}>{eyebrow}</div>}
      <h2 id={titleId} ref={titleRef} tabIndex={-1} className={s.title}>{title}</h2>
      {line && <div className={s.line}>{line}</div>}
      <div className={s.body}>{children}</div>
      {footer && <div className={s.footer}>{footer}</div>}
    </aside>
  );
}
