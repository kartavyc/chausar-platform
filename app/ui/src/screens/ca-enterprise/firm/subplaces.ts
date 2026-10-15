import type { LaneSubPlace } from '../../../places/subplaces/types.ts';
/** Sub-places this part adds to the rail. Plain data only: app/places.ts imports it.
 *  trust/clientaccess (CA-08): who in the firm may open which client; the authored trust/people
 *  stays the firm workspace's own seats. trust/cafirm: the client's own "Your CA firm" (desktop). */
export const firmSubPlaces: readonly LaneSubPlace[] = [
  { place: 'trust', id: 'clientaccess', shells: ['ca-firm'] },
  { place: 'trust', id: 'cafirm' },
];
