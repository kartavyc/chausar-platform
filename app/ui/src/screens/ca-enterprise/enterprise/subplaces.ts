import type { LaneSubPlace } from '../../../places/subplaces/types.ts';
/** Sub-places this part adds to the rail. Plain data only: app/places.ts imports it.
 *  Reviews, Teams and Holds exist only in the enterprise shell. Edition (turning the company
 *  version on and off) is listed on the desktop, where an owner turns it on, and in the
 *  enterprise shell, where it is turned off again. */
export const enterpriseSubPlaces: readonly LaneSubPlace[] = [
  { place: 'trust', id: 'reviews', shells: ['enterprise'] },
  { place: 'trust', id: 'teams', shells: ['enterprise'] },
  { place: 'trust', id: 'holds', shells: ['enterprise'] },
  { place: 'trust', id: 'edition', shells: ['desktop', 'enterprise'] },
];
