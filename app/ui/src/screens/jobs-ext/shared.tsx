/**
 * What both jobs-ext screens share: typed words, the reply host, the page frame with the
 * common states, and display helpers. Display only: paise are formatted with BigInt by the
 * shared money formatter, never turned into floats or added up here.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import type { Address, Language, ScreenState } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { PageHeader } from '../../app/PageHeader';
import { useT } from '../../app/text';
import { State } from '../../patterns/States';
import { money } from '../../format/money.ts';
import { date } from '../../format/dates.ts';
import type { JobsxKey } from '../../text/lanes/jobs-ext.ts';
import type { Loaded, ReplyHost } from './reply.ts';
import s from './jobs-ext.module.css';

export type Say = (key: JobsxKey, values?: Readonly<Record<string, string | number>>) => string;

/** The lane's words through the shared catalogue, typed to this lane's keys. */
export function useSay(): Say {
  const t = useT();
  return (key, values) => t(key, values === undefined ? undefined : { ...values });
}

/** A reply host for one sub-place: a reply stays live while the page shows that sub-place. */
export function useHost(p: PlaceRenderProps, sub: string): ReplyHost {
  const ref = useRef(p);
  ref.current = p;
  return useMemo<ReplyHost>(() => ({
    rpc: p.rpc,
    address: { place: 'work', sub },
    live: (a: Address) => ref.current.live(ref.current.address) && ref.current.address.place === 'work' && ref.current.address.sub === a.sub,
  }), [p.rpc, sub]);
}

/** Rupees from whole paise as a string: exact, with Indian grouping. */
export function rupees(paise: string): string { return money(paise); }
/** The calendar day of an instant, day first. */
export function day(iso: string, language: Language): string { return date(iso.slice(0, 10), 'short', language); }
/** A confidence from 0 to 1 as a whole percent, rounded down. Display only, never money. */
export function percent(confidence: number): number { return Math.floor(confidence * 100 + 1e-9); }

const KNOWN_REFUSALS = new Set(['PROCEDURE_NOT_ENOUGH_RUNS', 'PROCEDURE_TRACES_DIFFER', 'PROCEDURE_NO_RULE', 'PREVIEW_CHANGED', 'PROCEDURE_NOT_PROPOSED',
  'PROCEDURE_NOT_APPROVED', 'INVALID_STOP_RULE', 'FORBIDDEN', 'APP_APPROVAL_REQUIRED', 'TAINTED_JOB']);
/** A refusal as a plain sentence when the lane knows it, else its short code. */
export function refusalText(code: string, say: Say): string {
  return KNOWN_REFUSALS.has(code) ? say(`jobsx.refusal.${code}` as JobsxKey) : say('jobsx.refused', { code });
}
export function Refusal({ code, say }: { code: string | null; say: Say }) {
  if (code === null) return null;
  return <p className={s.refusal} role="alert">{refusalText(code, say)}</p>;
}

export function Note({ children }: { children: ReactNode }) { return <p className={s.note}>{children}</p>; }

/** The state a section draws for a reply that is not ready. */
export function loadedState<T>(loaded: Loaded<T>): ScreenState | null {
  if (loaded.phase === 'ready') return null;
  return loaded.phase === 'refused' ? loaded.state : { kind: 'loading' };
}

/** A section's reply: its state with Check again, or its content. */
export function Part<T>({ loaded, reload, say, children }: { loaded: Loaded<T>; reload: () => void; say: Say; children: (value: T) => ReactNode }) {
  if (loaded.phase === 'ready') return <>{children(loaded.value)}</>;
  if (loaded.phase === 'loading' && loaded.last !== undefined) return <>{children(loaded.last)}</>;
  const state = loadedState(loaded) ?? { kind: 'loading' as const };
  return <State state={state} action={loaded.phase === 'refused' && state.kind !== 'not-built' ? { label: say('jobsx.checkAgain'), onPress: reload } : undefined} />;
}

/** The page frame: where you are, the title (with a count for a list), then the page or its state. */
export function Frame({ where, title, count, state, onRetry, say, children }: {
  where: string; title: string; count?: string | undefined; state: ScreenState | null; onRetry: () => void; say: Say; children?: ReactNode;
}) {
  return (
    <div className={s.page} data-place="work" data-jobsx-page="">
      <PageHeader where={where} title={title} count={count === undefined ? undefined : { exact: null, display: count }} />
      {state !== null && state.kind !== 'ready'
        ? <State state={state} action={state.kind === 'failed' ? { label: say('jobsx.checkAgain'), onPress: onRetry } : undefined} />
        : children}
    </div>
  );
}
