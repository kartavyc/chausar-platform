/**
 * What every Work page shares: its words, its reply host, the page frame with the common
 * states, and a few display helpers. Display only: amounts are formatted, never computed.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import type { Address, Language, ScreenState, StepItem } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { amountText, dayTime } from './kit/format.ts';
import { fill, kitWords } from './kit/words.ts';
import type { Loaded, ReplyHost } from './kit/reply.ts';
import type { Amount } from './kit/validate.ts';
import { Note, Page } from './kit/Page';
import type { Step } from './contract.ts';
import { workWords, type WorkKey, type WorkWords } from './text.ts';

export const SUBS = ['approvals', 'jobs', 'actions', 'cando', 'after-restore', 'driving', 'bill'] as const;
export type WorkSub = typeof SUBS[number];

export interface WorkProps extends PlaceRenderProps { readonly w: WorkWords; readonly host: ReplyHost; readonly sub: WorkSub }

/** A reply host for one sub-place: a reply stays live while the page shows that sub-place. */
export function useHost(p: PlaceRenderProps, sub: string): ReplyHost {
  const ref = useRef(p);
  ref.current = p;
  return useMemo<ReplyHost>(() => ({
    rpc: p.rpc,
    address: { place: 'work', sub },
    live: (a: Address) => ref.current.live(ref.current.address) && (ref.current.address.sub ?? 'approvals') === a.sub,
  }), [p.rpc, sub]);
}

export function say(w: WorkWords, key: WorkKey, values?: Readonly<Record<string, string | number>>): string { return fill(w[key], values); }

/** An amount from a prepared request, as text. Null when the request has no amount. */
export function money(value: Amount | null, language: Language): string | null { return value === null ? null : amountText(value, language); }

export const STEP_KEY: Readonly<Record<Step['name'], string>> = {
  prepared: 'STEP.prepared', approved: 'STEP.approve', done: 'STEP.send', 'read-back': 'STEP.read-back', recorded: 'STEP.recorded',
};
export function stepItems(steps: readonly Step[], language: Language): StepItem[] {
  return steps.map(s => (s.at === null ? { nameKey: STEP_KEY[s.name], state: s.state } : { nameKey: STEP_KEY[s.name], state: s.state, at: dayTime(s.at, language) }));
}

/** The time left before an approval expires, in whole hours, when it is under two days. */
export function expiryNote(expiresAt: string | null, w: WorkWords, language: Language, now = Date.now()): string | null {
  if (expiresAt === null) return null;
  const hours = Math.floor((Date.parse(expiresAt) - now) / 3_600_000);
  return hours >= 0 && hours < 48 ? say(w, 'left', { hours }) : say(w, 'expires', { date: dayTime(expiresAt, language) });
}

export interface FrameProps<T> {
  p: WorkProps;
  title: string;
  loaded: Loaded<T>;
  reload: () => void;
  count?: (value: T) => string;
  children: (value: T) => ReactNode;
}

/** The page frame with the common states: loading, not built, locked, read only, failed, stale. */
export function Frame<T>({ p, title, loaded, reload, count, children }: FrameProps<T>) {
  const value = loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined;
  const state: ScreenState | undefined = loaded.phase === 'refused' ? loaded.state : value === undefined ? { kind: 'loading' } : undefined;
  return (
    <Page place="work" sub={p.sub} subs={SUBS} title={title} count={value !== undefined && count ? count(value) : undefined}
      language={p.language} navigate={p.navigate} state={state} onRetry={reload}>
      {p.viewer && <Note>{kitWords(p.language).readOnly}</Note>}
      {loaded.phase === 'loading' && value !== undefined && <Note>{p.w.stale}</Note>}
      {value !== undefined && children(value)}
    </Page>
  );
}

export { workWords };
