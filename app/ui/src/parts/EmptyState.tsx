import type { ReactNode } from 'react';
import s from './EmptyState.module.css';

/** An empty list says so in one plain sentence, with at most one way forward. No art, no box. */
export function EmptyState({ title, line, action }: { title: string; line?: string | undefined; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <p className={s.title}>{title}</p>
      {line && <p className={s.line}>{line}</p>}
      {action && <div className={s.action}>{action}</div>}
    </div>
  );
}
