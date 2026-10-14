import type { Address } from '../../app/presentation.ts';
import type { PlaceModule, PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { Screen } from '../trust/kit/Screen';
import { DueDates } from './DueDates';
import { Exports } from './Exports';
import { Packs } from './Packs';
import { WeekAhead } from './WeekAhead';
import { WORDS } from './words.ts';

/** A module for one or more sub-places of Reports; a bare Reports address draws Packs. */
function at(id: string, subs: readonly string[], draw: (props: PlaceRenderProps) => ReturnType<PlaceModule['render']>, bare = false): PlaceModule {
  return {
    id: `reports.${id}`,
    handles: (a: Address) => a.place === 'reports' && (a.sub === undefined ? bare : subs.includes(a.sub)),
    render: (props) => draw(props),
  };
}

/** Enterprise "Sent": not built yet, said plainly. */
function Sent({ language }: PlaceRenderProps) {
  const w = words(WORDS, language);
  return <Screen where={w.where} title={w.sent} loaded={{ kind: 'not-built' }}>{() => null}</Screen>;
}

/** Reports: every sub-place drawn by this lane. */
export const reportsPlaces: readonly PlaceModule[] = [
  at('packs', ['packs'], (p) => <Packs key={p.address.sub ?? 'packs'} {...p} />, true),
  at('weekahead', ['weekahead', 'briefs'], (p) => <WeekAhead key={p.address.sub} {...p} />),
  at('duedates', ['duedates'], (p) => <DueDates {...p} />),
  at('exports', ['exports'], (p) => <Exports {...p} />),
  at('sent', ['sent'], (p) => <Sent {...p} />),
];
