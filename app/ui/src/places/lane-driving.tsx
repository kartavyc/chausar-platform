import type { PlaceModule } from './types.ts';
import { ScreenDrivingPlace } from '../screens/driving/ScreenDriving.tsx';
import { handlesScreenDriving } from '../screens/driving/contract.ts';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const drivingPlaces: readonly PlaceModule[] = [
  {
    /** Work, Screen driving (experimental): this computer, the session now, export plans, earlier sessions, waiting exports. */
    id: 'driving.screen-driving',
    handles: handlesScreenDriving,
    render: (props) => <ScreenDrivingPlace key={`${props.language}:${props.member.id}`} {...props} />,
  },
];
