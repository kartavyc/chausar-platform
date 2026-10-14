/** Markings follow the data: a figure from a source carrying a marking the caller's seat does not see is printed as withheld. */
import type { Context, State } from '../contracts.ts';
import { markingsForSources, seatSees } from '../trust-ext/core-markings.ts';
import { markKinds, seatOf, type MarkKind, type Seat } from '../trust-ext/core-state.ts';
import type { EngineFigure, Language } from './common.ts';

export type { MarkKind };
export { markingsForSources, markKinds };
export const withheldFigure = (): EngineFigure => ({ kind: 'missing', missing: 'withheld' });

/** The marking kinds the caller's seat may not see. A member the workspace does not know sees no marked data. */
export function hiddenKinds(state: State, ctx: Context): MarkKind[] {
  const member = state.members.find(item => item.id === ctx.memberId);
  const seat: Seat = member ? seatOf(state, member) : 'viewer';
  const sees = seatSees(state, seat);
  return markKinds.filter(kind => !sees[kind]);
}
/** The hidden kinds carried by data from these sources. */
export function withheldKinds(state: State, sourceIds: readonly string[], hidden: readonly MarkKind[]): MarkKind[] {
  if (!hidden.length || !sourceIds.length) return [];
  return markingsForSources(state, sourceIds).filter(kind => hidden.includes(kind));
}

const kindWords: Record<Language, Record<MarkKind, string>> = {
  en: { personal: 'personal', financial: 'financial', confidential: 'confidential' },
  hi: { personal: 'निजी', financial: 'वित्तीय', confidential: 'गोपनीय' },
};
export function withheldGap(kind: MarkKind, lang: Language): string {
  return lang === 'hi' ? `कुछ आँकड़े रोके गए हैं: डेटा पर ${kindWords.hi[kind]} चिह्न है और आपकी सीट इसे नहीं देखती।`
    : `Some figures are withheld: the data is marked ${kindWords.en[kind]} and your seat does not see it.`;
}
