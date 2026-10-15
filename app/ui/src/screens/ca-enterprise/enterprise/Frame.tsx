/**
 * The page frame for an enterprise screen: the header, then either the design's common state
 * for what the engine said, or the screen's own body. Refusals this lane knows are drawn in
 * words; any other code is drawn as the failed state with its code.
 */
import type { ReactNode } from 'react';
import { PageHeader } from '../../../app/PageHeader';
import type { ScreenState } from '../../../app/presentation.ts';
import { useT } from '../../../app/text';
import { State } from '../../../patterns/States';
import { NOT_BUILT_CODES, type Loaded, type Sent } from './kit.ts';
import s from './Enterprise.module.css';

/** Refusal codes this lane draws in its own words. */
const REFUSAL_KEY: Readonly<Record<string, string>> = {
  ENTERPRISE_NOT_ON: 'ENX-refusal.notOn',
  FORBIDDEN: 'ENX-refusal.forbidden',
  ENTERPRISE_LAST_ADMINISTRATOR: 'ENX-refusal.lastAdmin',
  ENTERPRISE_REVIEW_SELF: 'ENX-refusal.reviewSelf',
  ENTERPRISE_HOLDS_NOT_ENFORCED: 'ENX-refusal.holds',
  ENTERPRISE_SHELL_TAKEN: 'ENX-refusal.shellTaken',
  INVALID_REPLY: 'ENX-refusal.invalidReply',
};

export function refusalKey(code: string, forbiddenKey?: string): string {
  if (code === 'FORBIDDEN' && forbiddenKey !== undefined) return forbiddenKey;
  if (NOT_BUILT_CODES.has(code)) return 'ENX-refusal.notBuilt';
  return REFUSAL_KEY[code] ?? 'ENX-refusal.other';
}

export function useWhere(): (place: string, sub?: string) => string {
  const t = useT();
  return (place, sub) => (sub === undefined ? t(`SH-01.place.${place}`) : t('ENX-where', { place: t(`SH-01.place.${place}`), sub: t(`SH-01.sub.${place}.${sub}`) }));
}

export interface FrameProps<T> {
  where: string;
  title: string;
  loaded: Loaded<T>;
  /** The words for FORBIDDEN on this screen ("Only an administrator sees Company"). */
  forbiddenKey?: string | undefined;
  aside?: ReactNode;
  children: (value: T) => ReactNode;
}

export function Frame<T>({ where, title, loaded, forbiddenKey, aside, children }: FrameProps<T>) {
  const t = useT();
  let body: ReactNode;
  if (loaded.kind === 'ready') body = children(loaded.value);
  else if (loaded.kind === 'failed') {
    const known = REFUSAL_KEY[loaded.code] !== undefined || (loaded.code === 'FORBIDDEN' && forbiddenKey !== undefined);
    const state: ScreenState = known ? { kind: 'failed', code: loaded.code, what: t(refusalKey(loaded.code, forbiddenKey)) } : { kind: 'failed', code: loaded.code };
    body = <State state={state} />;
  } else body = <State state={{ kind: loaded.kind }} />;
  return (
    <section className={s.screen} aria-label={title}>
      <PageHeader where={where} title={title} aside={aside} />
      {body}
    </section>
  );
}

export function Group({ title, note, children }: { title: string; note?: string | undefined; children: ReactNode }) {
  return (
    <section className={s.group}>
      <h2 className={s.heading}>{title}</h2>
      {note !== undefined && <p className={s.note}>{note}</p>}
      {children}
    </section>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className={s.note}>{children}</p>;
}

/** What became of one press: sending, done (with the screen's own words) or refused in words. */
export function Outcome<T>({ sent, done, forbiddenKey }: { sent: Sent<T>; done?: ((value: T) => string | null) | undefined; forbiddenKey?: string | undefined }) {
  const t = useT();
  if (sent.kind === 'idle') return null;
  if (sent.kind === 'sending') return <p className={s.status} role="status">{t('ENX-sending')}</p>;
  if (sent.kind === 'done') {
    const words = done === undefined ? t('ENX-saved') : done(sent.value);
    return words === null ? null : <p className={s.status} role="status">{words}</p>;
  }
  const key = refusalKey(sent.code, forbiddenKey);
  return <p className={s.status} role="alert" data-code={sent.code}>{t(key, { code: sent.code })}</p>;
}
