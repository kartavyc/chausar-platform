/**
 * AskPlace: the Ask place drawn by the ask lane's place module.
 *   ask / new        the menu, a typed question, the answer and everything an answer opens
 *   ask / saved      saved answers with their stale marks
 *   ask / decisions  the inbox and the decision journal
 *   ask / checks     your own questions with known answers
 *   ask / notyet     what was asked for and could not be done
 * A view opened from another sits on a small stack inside the page; Back returns. An address
 * with `?sheet=why` (and the other names below) opens that view first, for links from Today,
 * Reports and the receipt. The host's own `receipt` sheet is left to the host.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Address } from '../../../app/presentation.ts';
import { formatAddress, sameAddress } from '../../../app/routes.ts';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { AskProvider, type AskContext, type AskView } from './kit';
import { MenuScreen } from './Menu';
import { AnswerScreen } from './Answer';
import { ReceiptScreen } from './Receipt';
import { RowsScreen } from './Rows';
import { SentScreen } from './Sent';
import { WhyScreen } from './Why';
import { WhatIfScreen } from './WhatIf';
import { ForecastScreen } from './Forecast';
import { PlanScreen } from './Plan';
import { Gst2bScreen } from './Gst2b';
import { SearchScreen } from './Search';
import { SavedScreen } from './Saved';
import { DecisionsScreen } from './Decisions';
import { DecisionScreen } from './Decision';
import { ChecksScreen } from './Checks';
import { CheckScreen } from './Check';
import { NotYetScreen } from './NotYet';

export const ASK_SUBS = ['new', 'saved', 'decisions', 'checks', 'notyet'] as const;
export type AskSub = (typeof ASK_SUBS)[number];

/** The base view for a sub-place, and the first view a sheet name opens. */
export function baseView(sub: string | undefined): AskView {
  switch (sub) {
    case 'saved': return { kind: 'saved' };
    case 'decisions': return { kind: 'decisions' };
    case 'checks': return { kind: 'checks' };
    case 'notyet': return { kind: 'notyet' };
    default: return { kind: 'menu' };
  }
}
const SHEET_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/;
export function sheetView(sheet: string | undefined): AskView | null {
  if (sheet === undefined) return null;
  const simple: Readonly<Record<string, AskView>> = { why: { kind: 'why' }, whatif: { kind: 'whatif' }, forecast: { kind: 'forecast' }, plan: { kind: 'plan' }, gst2b: { kind: 'gst2b' }, search: { kind: 'search' } };
  if (Object.hasOwn(simple, sheet)) return simple[sheet]!;
  const [head, ...rest] = sheet.split('.'), value = rest.join('.');
  if (!SHEET_ID.test(value)) return null;
  if (head === 'answer') return { kind: 'answer', receiptId: value };
  if (head === 'decision') return { kind: 'decision', decisionId: value };
  if (head === 'check') return { kind: 'check', checkId: value };
  if (head === 'why') return { kind: 'why', whyId: value };
  return null;
}

/**
 * The sub-places this module draws. Ask › New (and the bare place) stay with the host, which
 * composes the model route picker and the conversation there; the host can draw the menu in
 * New through `AskPlace` with that address (see docs/lanes/ask.md). From every page drawn here
 * the menu and all the views it opens are one press away.
 */
export const DRAWN_SUBS: readonly AskSub[] = ['saved', 'decisions', 'checks', 'notyet'];
export function handlesAsk(address: Address): boolean {
  return address.place === 'ask' && address.sub !== undefined && (DRAWN_SUBS as readonly string[]).includes(address.sub);
}

export function AskPlace(props: PlaceRenderProps) {
  const { address } = props;
  const placeKey = `${address.sub ?? 'new'}|${address.sheet === 'receipt' ? '' : address.sheet ?? ''}`;
  const [stack, setStack] = useState<readonly AskView[]>(() => initial(address));
  // A new sub-place or a new sheet name starts its own stack; the host's receipt sheet does not.
  const [shownKey, setShownKey] = useState(placeKey);
  if (shownKey !== placeKey) { setShownKey(placeKey); setStack(initial(address)); }

  const live = useCallback(() => props.live(address), [props, address]);
  const go = useCallback((next: AskView) => { if (live()) setStack(current => [...current, next].slice(-20)); }, [live]);
  const back = useCallback(() => setStack(current => current.length > 1 ? current.slice(0, -1) : current), []);
  const leave = useCallback((next: Address) => {
    props.navigate(next);
    // The frame's navigate records the address; the hash is what moves the page.
    if (typeof window !== 'undefined' && !sameAddress(next, address) && window.location.hash !== formatAddress(next)) window.location.hash = formatAddress(next);
  }, [props, address]);
  const top = stack[stack.length - 1]!;
  const context = useMemo<AskContext>(() => ({
    rpc: props.rpc, language: props.language, view: props.view, viewer: props.viewer, member: props.member, address,
    live, go, back, canGoBack: stack.length > 1, menuLink: stack.length === 1 && stack[0]!.kind !== 'menu', leave,
  }), [props.rpc, props.language, props.view, props.viewer, props.member, address, live, go, back, stack.length, leave]);
  useEffect(() => { if (typeof window !== 'undefined') window.scrollTo?.(0, 0); }, [top]);

  return <AskProvider value={context}><ViewSwitch key={stack.length} view={top} /></AskProvider>;
}

function initial(address: Address): readonly AskView[] {
  const base = baseView(address.sub), first = sheetView(address.sheet);
  return first === null ? [base] : [base, first];
}

function ViewSwitch({ view }: { view: AskView }) {
  switch (view.kind) {
    case 'menu': return <MenuScreen view={view} />;
    case 'answer': return <AnswerScreen view={view} />;
    case 'receipt': return <ReceiptScreen view={view} />;
    case 'rows': return <RowsScreen view={view} />;
    case 'sent': return <SentScreen view={view} />;
    case 'why': return <WhyScreen view={view} />;
    case 'whatif': return <WhatIfScreen view={view} />;
    case 'forecast': return <ForecastScreen view={view} />;
    case 'plan': return <PlanScreen view={view} />;
    case 'gst2b': return <Gst2bScreen view={view} />;
    case 'search': return <SearchScreen view={view} />;
    case 'saved': return <SavedScreen view={view} />;
    case 'decisions': return <DecisionsScreen view={view} />;
    case 'decision': return <DecisionScreen view={view} />;
    case 'checks': return <ChecksScreen view={view} />;
    case 'check': return <CheckScreen view={view} />;
    case 'notyet': return <NotYetScreen view={view} />;
  }
}
