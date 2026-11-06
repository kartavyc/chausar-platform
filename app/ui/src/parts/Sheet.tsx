import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from 'react';
import { useT } from '../text';
import { Icon } from './Icon';
import s from './Sheet.module.css';

/**
 * Where a sheet tells the shell the id of its title (w3 3I). On a phone a sheet covers the screen and the page behind it
 * is inert, so the shell makes the sheet's container a modal dialog named by that title; beside the page there is no
 * listener and nothing changes.
 */
export const SheetTitleContext = createContext<((titleId: string | undefined) => void) | null>(null);

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
  /** An avatar at the left of the head (the agent of a run, the agent the panel is about). Decorative: the title says
   *  who it is. */
  avatar?: ReactNode;
  /** `panel`: the agent panel beside Team, at the panel width (`--panel`, 440 px; the founder's decision). */
  width?: 'panel' | undefined;
  /** The sheet's name in words, for its close button: "Close Editor". Left out, the button says "Close". */
  name?: string | undefined;
  /** A receipt sheet (w3 3I): the sheet IS the proof, so its figures are the receipt's own lines in plain DM Mono with
   *  no receipt chip. Marks the root `data-receipt-sheet`, which the Ink rules helper lets money text sit inside. */
  receipt?: boolean | undefined;
}

/**
 * The panel beside the list, never modal: the page stays usable. The shell shows one at a time. Opening moves focus
 * to the title; closing returns it to the row or control that opened the sheet. Esc closes it (shell keys).
 * Its head is D's panel head (D-TeamChat `.cp-h`): an optional avatar, the kind and eyebrow, the title and its line,
 * and the close button at the right.
 */
export function Sheet({ label, eyebrow, title, line, onClose, returnFocus, children, footer, avatar, width, name, receipt }: SheetProps) {
  const t = useT();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const restore = useRef(returnFocus);
  restore.current = returnFocus;
  const reportTitle = useContext(SheetTitleContext);

  useEffect(() => {
    reportTitle?.(titleId);
    return () => reportTitle?.(undefined);
  }, [reportTitle, titleId]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => {
      if (restore.current) restore.current();
      else if (before?.isConnected) before.focus();
    };
  }, []);

  return (
    <aside className={s.sheet} aria-labelledby={titleId} data-sheet="" data-width={width} data-receipt-sheet={receipt ? '' : undefined}>
      <header className={s.head}>
        {avatar && <span className={s.avatar}>{avatar}</span>}
        <div className={s.id}>
          {(label || eyebrow) && (
            <div className={s.kicker}>
              {label && <span className={s.label}>{label}</span>}
              {label && eyebrow && <span className={s.dot} aria-hidden="true">·</span>}
              {eyebrow && <span className={s.eyebrow}>{eyebrow}</span>}
            </div>
          )}
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className={s.title}>{title}</h2>
          {line && <div className={s.line}>{line}</div>}
        </div>
        <button type="button" className={s.close} aria-label={name ? t('sheet.closeNamed', { name }) : t('sheet.close')} onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
      </header>
      <div className={s.body}>{children}</div>
      {footer && <div className={s.footer}>{footer}</div>}
    </aside>
  );
}
