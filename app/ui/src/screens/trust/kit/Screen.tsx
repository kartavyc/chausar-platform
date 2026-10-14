/**
 * The page frame for a Reports, Tools or Trust screen: the header, then either the
 * design's common state for what the engine said, or the screen's own body.
 */
import type { ReactNode } from 'react';
import { PageHeader } from '../../../app/PageHeader';
import type { Count, ScreenState } from '../../../app/presentation.ts';
import { State } from '../../../patterns/States';
import type { Loaded } from './engine.ts';
import s from './Screen.module.css';

export function screenState(loaded: Loaded<unknown>): ScreenState {
  switch (loaded.kind) {
    case 'loading': return { kind: 'loading' };
    case 'not-built': return { kind: 'not-built' };
    case 'locked': return { kind: 'locked' };
    case 'failed': return { kind: 'failed', code: loaded.code };
    case 'ready': return { kind: 'ready' };
  }
}

export interface ScreenProps<T> {
  where: string;
  title: string;
  loaded: Loaded<T>;
  count?: Count | undefined;
  aside?: ReactNode;
  emptyKey?: string | undefined;
  children: (value: T) => ReactNode;
}

export function Screen<T>({ where, title, loaded, count, aside, children }: ScreenProps<T>) {
  return (
    <section className={s.screen} aria-label={title}>
      <PageHeader where={where} title={title} count={count} aside={aside} />
      {loaded.kind === 'ready' ? children(loaded.value) : <State state={screenState(loaded)} />}
    </section>
  );
}

/** A titled group inside a screen. */
export function Group({ title, note, children }: { title: string; note?: string | undefined; children: ReactNode }) {
  return (
    <section className={s.group}>
      <h2 className={s.heading}>{title}</h2>
      {note !== undefined && <p className={s.note}>{note}</p>}
      {children}
    </section>
  );
}

/** One plain sentence, in the quiet grey of a note, or as a status line when it reports a result. */
export function Note({ children, status = false }: { children: ReactNode; status?: boolean }) {
  return <p className={s.note} role={status ? 'status' : undefined}>{children}</p>;
}
