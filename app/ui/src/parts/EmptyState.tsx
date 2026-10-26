import type { ReactNode } from 'react';
import { Icon } from './Icon';
import s from './EmptyState.module.css';

/** A way forward from an empty list: a link to an address, or a button with a handler. Never neither. */
export type EmptyAction = { label: string; href: string; onSelect?: never } | { label: string; onSelect: () => void; href?: never };

export interface EmptyStateProps {
  /** The one plain sentence that says why the list is empty. */
  title: string;
  line?: string | undefined;
  /** Ways forward, each a row with a chevron (D's `.more` links). */
  actions?: readonly EmptyAction[] | undefined;
  /** One way forward the place draws itself (kept for the places that pass a link of their own). */
  action?: ReactNode;
}

/**
 * An empty list says so in one plain sentence, then its ways forward (catalogue U12). No art and nothing sold. It
 * never draws a control that acts on nothing: with no action there is no button, and an action with neither an
 * address nor a handler is left out.
 */
export function EmptyState({ title, line, actions, action }: EmptyStateProps) {
  const ways = (actions ?? []).filter((way) => Boolean(way.href) || typeof way.onSelect === 'function');
  return (
    <div className={s.empty}>
      <p className={s.title}>{title}</p>
      {line && <p className={s.line}>{line}</p>}
      {ways.length > 0 && (
        <ul className={s.actions}>
          {ways.map((way) => (
            <li key={way.label}>
              {way.href ? (
                <a className={s.way} href={way.href}>{way.label}<Icon name="chevron-right" size={16} /></a>
              ) : (
                <button type="button" className={s.way} onClick={way.onSelect}>{way.label}<Icon name="chevron-right" size={16} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
}
