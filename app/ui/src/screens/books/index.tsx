import type { ReactNode } from 'react';
import type { PlaceModule } from '../../places/types.ts';
import { SUBS, type BooksProps, type Sub } from './shared.tsx';
import { Sources, Unmapped } from './Sources.tsx';
import { Meanings, Packs } from './Meanings.tsx';
import { Accounts } from './Accounts.tsx';
import { Customers, Matches, Conflicts } from './Records.tsx';
import { History, Stale } from './History.tsx';
import { Memory } from './Memory.tsx';

const SCREENS: Readonly<Record<Sub, (props: BooksProps) => ReactNode>> = {
  sources: Sources, unmapped: Unmapped, meanings: Meanings, packs: Packs, accounts: Accounts,
  customers: Customers, matches: Matches, conflicts: Conflicts, history: History, stale: Stale, memory: Memory,
};
const isSub = (value: string | undefined): value is Sub => (SUBS as readonly string[]).includes(value ?? '');

/** The books place module: BK-01..BK-20 over the `books.*`, `accounts.*`, `records.*` and `history.*` contract. */
export const booksPlace: PlaceModule = {
  id: 'books',
  handles: address => address.place === 'books',
  render: props => {
    const sub: Sub = isSub(props.address.sub) ? props.address.sub : props.address.sub === 'records' ? 'customers' : 'sources';
    const Screen = SCREENS[sub];
    return <Screen key={`${sub}:${props.language}`} {...props} />;
  },
};
