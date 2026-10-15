/**
 * What the write-back screens share: their words (from the lane's own catalogue), the reply
 * host for one sub-place, the page frame with the design's common states, and refusal words.
 * Display only: nothing here computes a figure.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import type { Address, Language, ScreenState, View } from '../../app/presentation.ts';
import { PageHeader } from '../../app/PageHeader';
import { State } from '../../patterns/States';
import { Button } from '../../parts/Button';
import type { PlaceRenderProps } from '../../places/types.ts';
import { wb4Catalogue, type Wb4Key } from '../../text/lanes/writeback.ts';
import { fill } from '../work/kit/words.ts';
import type { Loaded, ReplyHost } from '../work/kit/reply.ts';
import { pageStyles } from '../work/kit/Page';
import s from './writeback.module.css';

export const WB_SUBS = ['write', 'caps'] as const;
export type WbSub = typeof WB_SUBS[number];

export type Words = Readonly<Record<Wb4Key, string>>;
export function wbWords(language: Language): Words { return wb4Catalogue[language] ?? wb4Catalogue.en; }
export function say(w: Words, key: Wb4Key, values?: Readonly<Record<string, string | number>>): string { return fill(w[key], values); }
/** A word for an engine code or id when the catalogue has it; else null. */
export function known(w: Words, key: string): string | null { return Object.hasOwn(w, key) ? w[key as Wb4Key] : null; }

/** A refusal code as plain words, never the engine's raw message. */
export function refusalWords(w: Words, code: string): string {
  return known(w, `wb4.code.${code}`) ?? say(w, 'wb4.code.other', { code });
}

export function systemName(w: Words, system: string): string { return known(w, `wb4.sys.${system}`) ?? system; }
export function fieldLabel(w: Words, name: string): string { return known(w, `wb4.field.${name}`) ?? name; }

export interface WbProps extends PlaceRenderProps {
  readonly w: Words;
  readonly host: ReplyHost;
  readonly sub: WbSub;
  /** An owner or co-founder on a seat that may change things. */
  readonly admin: boolean;
}

export function isAdmin(p: PlaceRenderProps): boolean { return !p.viewer && (p.member.role === 'owner' || p.member.role === 'cofounder'); }

/** A reply host for one sub-place: a reply stays live while the page shows that sub-place. */
export function useWbHost(p: PlaceRenderProps, sub: string): ReplyHost {
  const ref = useRef(p);
  ref.current = p;
  return useMemo<ReplyHost>(() => ({
    rpc: p.rpc,
    address: { place: 'work', sub },
    live: (a: Address) => ref.current.live(ref.current.address) && ref.current.address.sub === a.sub,
  }), [p.rpc, sub]);
}

export function Note({ children }: { children: ReactNode }) { return <p className={pageStyles.note}>{children}</p>; }
export function Refused({ w, code }: { w: Words; code: string | null }) {
  if (code === null) return null;
  return <p className={pageStyles.refusal} role="alert">{refusalWords(w, code)}</p>;
}
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className={s.section}><h2 className={s.h}>{title}</h2>{children}</section>;
}
export { Button };

export interface FrameProps<T> {
  p: WbProps;
  title: string;
  loaded: Loaded<T>;
  reload: () => void;
  count?: ((value: T) => string) | undefined;
  children: (value: T) => ReactNode;
}

/** The page: where you are, the title, the two sub-places, then the page or its fixed state. */
export function Frame<T>({ p, title, loaded, reload, count, children }: FrameProps<T>) {
  const { w } = p;
  const value = loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined;
  const state: ScreenState | undefined = loaded.phase === 'refused' ? loaded.state : value === undefined ? { kind: 'loading' } : undefined;
  const subName = (id: WbSub) => w[`SH-01.sub.work.${id}`];
  return (
    <div className={s.page} data-place="work" data-sub={p.sub} data-view={p.view}>
      <PageHeader where={`${w['wb4.where']} · ${subName(p.sub)}`} title={title} count={value !== undefined && count ? { exact: null, display: count(value) } : undefined} />
      <nav aria-label={w['wb4.where']}>
        <ul className={s.subs}>
          {WB_SUBS.map(id => (
            <li key={id}>
              <a className={s.sub} href={`#/work/${id}`} aria-current={id === p.sub ? 'page' : undefined}
                onClick={event => { event.preventDefault(); p.navigate({ place: 'work', sub: id }); }}>{subName(id)}</a>
            </li>
          ))}
        </ul>
      </nav>
      {state && state.kind !== 'ready'
        ? <State state={state} action={state.kind === 'failed' ? { label: w['wb4.retry'], onPress: reload } : undefined} />
        : (
          <>
            {p.viewer ? <Note>{w['wb4.readOnly']}</Note> : !p.admin && <Note>{w['wb4.adminOnly']}</Note>}
            {loaded.phase === 'loading' && value !== undefined && <Note>{w['wb4.stale']}</Note>}
            {value !== undefined && children(value)}
          </>
        )}
    </div>
  );
}

export function dense(view: View): string { return view === 'books' ? s.dense ?? '' : ''; }
