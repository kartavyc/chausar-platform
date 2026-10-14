import type { PlaceModule } from './types.ts';
import { ActivityPlace } from '../screens/today/Activity';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const frameTodayPlaces: readonly PlaceModule[] = [
  {
    /** TD-04: the activity list, a time line of typed events from `todayx.activity`. */
    id: 'frame-today.activity',
    handles: (address) => address.place === 'today' && address.sub === 'activity',
    render: (props) => <ActivityPlace key={`${props.language}:${props.member.id}`} {...props} />,
  },
];
