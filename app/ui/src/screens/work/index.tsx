import type { PlaceModule } from '../../places/types.ts';
import { State } from '../../patterns/States';

/** The work place module. */
export const workPlace: PlaceModule = {
  id: 'work',
  handles: address => address.place === 'work',
  render: () => <State state={{ kind: 'not-built' }} />,
};
