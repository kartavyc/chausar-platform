/**
 * The ask lane's screen kit: the in-page navigation between Ask views, the per-screen word
 * catalogues, figures built from exact engine values, and the loading, refused and not-built
 * states every Ask screen shares.
 *
 * A view is local to the Ask place. Moving between views never changes the books and never
 * calls the engine by itself; each screen reads what it shows when it is drawn, fenced by the
 * host's `live` check for the exact address it was drawn at.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Address, Figure, FigureLabel, FigureOrMissing, Language, Missing, ScreenState, View } from '../../../app/presentation.ts';
import type { Catalogue, PlaceMember, PlaceRpc } from '../../../places/types.ts';
import { words } from '../../../places/types.ts';
import { PageHeader } from '../../../app/PageHeader';
import { State } from '../../../patterns/States';
import { Button } from '../../../parts/Button';
import { money, percent, count as countText, date as dateText } from '../../../format/index.ts';
import type { Reply } from './client.ts';

/** Every Ask view. The base view comes from the sub-place; the others are reached from it. */
export type AskView =
  | { readonly kind: 'menu' }
  | { readonly kind: 'answer'; readonly receiptId: string }
  | { readonly kind: 'receipt'; readonly receiptId: string }
  | { readonly kind: 'rows'; readonly receiptId: string; readonly tab: 'counted' | 'left-out' }
  | { readonly kind: 'sent'; readonly receiptId: string }
  | { readonly kind: 'why'; readonly operationId?: string; readonly whyId?: string }
  | { readonly kind: 'whatif' }
  | { readonly kind: 'forecast'; readonly operationId?: string }
  | { readonly kind: 'plan' }
  | { readonly kind: 'gst2b' }
  | { readonly kind: 'search'; readonly query?: string }
  | { readonly kind: 'saved' }
  | { readonly kind: 'decisions'; readonly receiptIds?: readonly string[] }
  | { readonly kind: 'decision'; readonly decisionId: string }
  | { readonly kind: 'checks' }
  | { readonly kind: 'check'; readonly checkId: string }
  | { readonly kind: 'notyet' };

export interface AskContext {
  readonly rpc: PlaceRpc;
  readonly language: Language;
  readonly view: View;
  readonly viewer: boolean;
  readonly member: PlaceMember;
  readonly address: Address;
  /** True while the exact address this page was drawn at is still the live surface. */
  readonly live: () => boolean;
  /** Opens another Ask view on top of this one. */
  go(next: AskView): void;
  /** Returns to the view underneath, if any. */
  back(): void;
  readonly canGoBack: boolean;
  /** Leaves Ask for another place. */
  leave(address: Address): void;
}

const Context = createContext<AskContext | null>(null);
export const AskProvider = Context.Provider;
export function useAsk(): AskContext {
  const value = useContext(Context);
  if (value === null) throw new Error('ASK_CONTEXT_MISSING');
  return value;
}

/** Fills {name} slots of one complete template. Values are text; no markup is ever built. */
export function fill(template: string, values: Readonly<Record<string, string | number>> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => Object.hasOwn(values, name) ? String(values[name]) : whole);
}
/** This screen's words in the current language. */
export function useWords<K extends string>(catalogue: Catalogue<K>): Readonly<Record<K, string>> {
  return words(catalogue, useAsk().language);
}

/** A known amount from the engine, as a figure that opens its receipt. */
export function moneyFigure(minorValue: string, receiptId: string, labels: readonly FigureLabel[] = []): Figure {
  return { kind: 'money', exact: minorValue, display: money(minorValue), receiptId, labels };
}
export function bpsFigure(bps: string, receiptId: string, labels: readonly FigureLabel[] = []): Figure {
  return { kind: 'percent', exact: bps, display: percent(bps), receiptId, labels };
}
export function figureOf(unit: 'money' | 'basis-points', minorValue: string, receiptId: string, labels: readonly FigureLabel[] = []): Figure {
  return unit === 'money' ? moneyFigure(minorValue, receiptId, labels) : bpsFigure(minorValue, receiptId, labels);
}
export const missingFigure = (missing: Missing): FigureOrMissing => ({ kind: 'missing', missing });
export const moneyText = money;
export const countWords = countText;
export function dayText(iso: string, language: Language): string { return dateText(iso.slice(0, 10), 'short', language); }
export function periodText(p: { from: string; to: string }, language: Language): string {
  return p.from === p.to ? dayText(p.from, language) : `${dayText(p.from, language)} – ${dayText(p.to, language)}`;
}

export type Load<T> = { readonly kind: 'loading' } | Reply<T>;

/**
 * Reads once when drawn and again when `key` changes. A reply that returns after the address
 * stopped being live, or after a newer read began, is dropped.
 */
export function useRead<T>(key: string, read: () => Promise<Reply<T>>): [Load<T>, () => void] {
  const ask = useAsk();
  const [state, setState] = useState<Load<T>>({ kind: 'loading' });
  const turn = useRef(0);
  const readRef = useRef(read);
  readRef.current = read;
  const start = useCallback(() => {
    const mine = ++turn.current;
    setState({ kind: 'loading' });
    if (!ask.live()) return;
    void readRef.current().then(reply => { if (mine === turn.current && ask.live()) setState(reply); });
  }, [ask]);
  useEffect(() => { start(); return () => { turn.current++; }; }, [key, start]);
  return [state, start];
}

/** The fixed screen state for a refusal code. Words for the lane's own codes come from the catalogue. */
export function refusalState(code: string, ruleWords: string, what?: string): ScreenState {
  if (code === 'ASK_STOPPED_BY_RULE') return { kind: 'stopped-by-rule', rule: ruleWords };
  if (code === 'VAULT_LOCKED') return { kind: 'locked' };
  if (code === 'FORBIDDEN') return { kind: 'read-only' };
  return what === undefined ? { kind: 'failed', code } : { kind: 'failed', code, what };
}

const KIT = {
  en: {
    ask: 'Ask', back: 'Back', rule: 'A rule in Trust stops this for your seat. The owner can change it in Trust.',
    noDictionary: 'Agree what your words mean in Books before asking for numbers.', openMeanings: 'Open Meanings',
    retry: 'Try again', readOnly: 'This seat can read, not change.',
  },
  hi: {
    ask: 'पूछें', back: 'वापस', rule: 'Trust का एक नियम आपकी सीट के लिए इसे रोकता है। मालिक इसे Trust में बदल सकते हैं।',
    noDictionary: 'संख्याएँ पूछने से पहले Books में तय करें कि आपके शब्दों का क्या अर्थ है।', openMeanings: 'अर्थ खोलें',
    retry: 'फिर से कोशिश करें', readOnly: 'यह सीट पढ़ सकती है, बदल नहीं सकती।',
  },
} as const satisfies Catalogue<'ask' | 'back' | 'rule' | 'noDictionary' | 'openMeanings' | 'retry' | 'readOnly'>;

/**
 * One Ask page: the header, then either the screen's body or the state it is in. `load` is the
 * screen's main read; while it is not `ok` the body is not drawn at all.
 */
export function AskPage<T>({ title, load, retry, empty, aside, explain, children }: {
  title: string;
  /** The screen's own fixed words for a refusal code, when it has them. */
  explain?: ((code: string) => string | undefined) | undefined;
  load?: Load<T> | undefined;
  retry?: (() => void) | undefined;
  /** True when the reply holds nothing to show; the page shows `emptyText` then. */
  empty?: ((value: T) => ReactNode | null) | undefined;
  aside?: ReactNode;
  children: (value: T) => ReactNode;
}) {
  const ask = useAsk(), w = words(KIT, ask.language);
  let body: ReactNode;
  if (load === undefined) body = children(undefined as T);
  else if (load.kind === 'loading') body = <State state={{ kind: 'loading' }} />;
  else if (load.kind === 'not-built') body = <State state={{ kind: 'not-built' }} />;
  else if (load.kind === 'refused') {
    body = load.code === 'ASK_NO_DICTIONARY'
      ? <p>{w.noDictionary} <Button variant="link" onClick={() => ask.leave({ place: 'books', sub: 'meanings' })}>{w.openMeanings}</Button></p>
      : <State state={refusalState(load.code, w.rule, explain?.(load.code))} action={retry && load.code !== 'ASK_STOPPED_BY_RULE' ? { label: w.retry, onPress: retry } : undefined} />;
  } else {
    const nothing = empty?.(load.value) ?? null;
    body = nothing ?? children(load.value);
  }
  return (
    <section aria-label={title} data-ask-view="">
      <PageHeader where={w.ask} title={title} aside={<>{aside}{ask.canGoBack && <Button variant="link" onClick={ask.back}>{w.back}</Button>}</>} />
      {ask.viewer && <p data-read-only="">{w.readOnly}</p>}
      {body}
    </section>
  );
}
