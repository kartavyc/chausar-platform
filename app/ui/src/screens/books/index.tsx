import type { PlaceModule } from '../../places/types.ts';
import { State } from '../../patterns/States';

/** The books place module. */
export const booksPlace: PlaceModule = {
  id: 'books',
  handles: address => address.place === 'books',
  render: () => <State state={{ kind: 'not-built' }} />,
};
