import type { ReactNode } from 'react';
import s from './PageTitle.module.css';

/** A place's title (28/600) and its one line under it. */
export function PageTitle({ title, line }: { title: string; line?: ReactNode }) {
  return (
    <header className={s.header}>
      <h1 className={s.title}>{title}</h1>
      {line && <p className={s.line}>{line}</p>}
    </header>
  );
}
