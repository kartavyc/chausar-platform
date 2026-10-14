/**
 * The page frame for Work and Books: where you are, the title (with a count for a list),
 * the sub-places as links, then either the page or its fixed state.
 */
import type { ReactNode } from 'react';
import type { Address, Language, ScreenState } from '../../../app/presentation.ts';
import { PageHeader } from '../../../app/PageHeader';
import { State } from '../../../patterns/States';
import { Button } from '../../../parts/Button';
import { kitWords, type KitKey } from './words.ts';
import s from './Page.module.css';

export interface PageProps {
  place: 'work' | 'books';
  sub: string;
  subs: readonly string[];
  title: string;
  count?: string | undefined;
  language: Language;
  navigate(address: Address | null): void;
  /** Set when the page has nothing to show but its state. */
  state?: ScreenState | undefined;
  onRetry?: (() => void) | undefined;
  aside?: ReactNode;
  children?: ReactNode;
}

export function Page({ place, sub, subs, title, count, language, navigate, state, onRetry, aside, children }: PageProps) {
  const w = kitWords(language);
  const subName = (id: string) => w[`sub.${id}` as KitKey] ?? id;
  return (
    <div className={s.page} data-place={place} data-sub={sub}>
      <PageHeader where={`${w[place]} · ${subName(sub)}`} title={title} count={count === undefined ? undefined : { exact: null, display: count }} aside={aside} />
      {subs.length > 1 && (
        <nav aria-label={w[place]}>
          <ul className={s.subs}>
            {subs.map(id => (
              <li key={id}>
                <a className={s.sub} href={`#/${place}/${id}`} aria-current={id === sub ? 'page' : undefined}
                  onClick={event => { event.preventDefault(); navigate({ place, sub: id }); }}>{subName(id)}</a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {state && state.kind !== 'ready'
        ? <State state={state} action={state.kind === 'failed' && onRetry ? { label: w.retry, onPress: onRetry } : undefined} />
        : children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className={s.section}><h2 className={s.sectionTitle}>{title}</h2>{children}</section>;
}
export function Note({ children }: { children: ReactNode }) { return <p className={s.note}>{children}</p>; }
export function Refusal({ code, language }: { code: string | null; language: Language }) {
  if (code === null) return null;
  return <p className={s.refusal} role="alert">{kitWords(language).refused.replace('{code}', code)}</p>;
}
export function Actions({ children }: { children: ReactNode }) { return <div className={s.actions}>{children}</div>; }
export { Button };
export const pageStyles = s;
