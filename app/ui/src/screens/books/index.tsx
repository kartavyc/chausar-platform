import type { ReactNode } from 'react';
import type { PlaceModule } from '../../places/types.ts';
import { laneSubPlaces } from '../../places/subplaces/index.ts';
import { MORE_SUBS, SUBS, type BooksProps, type Sub } from './shared.tsx';
import { Sources, Unmapped } from './Sources.tsx';
import { Meanings, Packs } from './Meanings.tsx';
import { Accounts } from './Accounts.tsx';
import { Customers, Matches, Conflicts } from './Records.tsx';
import { BeliefPage, History, Stale } from './History.tsx';
import { Memory } from './Memory.tsx';
import { BillPhoto } from './BillPhoto.tsx';
import { Rates } from './Rates.tsx';
import { AddSource } from './AddSource.tsx';
import { Recipes } from './Recipes.tsx';
import { Trial } from './Trial.tsx';

const SCREENS: Readonly<Record<Sub, (props: BooksProps) => ReactNode>> = {
  sources: Sources, unmapped: Unmapped, meanings: Meanings, packs: Packs, accounts: Accounts,
  customers: Customers, matches: Matches, conflicts: Conflicts, history: History, stale: Stale, memory: Memory,
  recipes: Recipes, add: AddSource, trial: Trial,
};
/** Pages reached by address only (no tab of their own): they draw under the tab they belong to. */
const EXTRA: Readonly<Record<string, (props: BooksProps) => ReactNode>> = { bill: BillPhoto, rates: Rates, belief: BeliefPage };
const isSub = (value: string | undefined): value is Sub => ([...SUBS, ...MORE_SUBS] as readonly string[]).includes(value ?? '');

/** True for a Books sub-place another lane registered in places/subplaces. */
const otherLaneSub = (sub: string | undefined): boolean => sub !== undefined
  && Object.entries(laneSubPlaces).some(([lane, subs]) => lane !== 'work-books' && subs.some(x => x.place === 'books' && x.id === sub));

/** The books place module: BK-01..BK-20 over the `books.*`, `accounts.*`, `records.*` and `history.*` contract. */
export const booksPlace: PlaceModule = {
  id: 'books',
  // A Books sub-place another lane added (connectors-ext's scheduled reads, database road, Tally export;
  // learning-ext's places) is that lane's to draw: this module leaves it alone.
  handles: address => address.place === 'books' && !otherLaneSub(address.sub),
  render: props => {
    const extra = props.address.sub !== undefined && Object.hasOwn(EXTRA, props.address.sub) ? EXTRA[props.address.sub] : undefined;
    if (extra) { const Extra = extra; return <Extra key={`${props.address.sub}:${props.language}`} {...props} />; }
    const sub: Sub = isSub(props.address.sub) ? props.address.sub : props.address.sub === 'records' ? 'customers' : 'sources';
    const Screen = SCREENS[sub];
    return <Screen key={`${sub}:${props.language}`} {...props} />;
  },
};
