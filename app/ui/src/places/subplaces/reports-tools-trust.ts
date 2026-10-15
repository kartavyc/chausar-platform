import type { LaneSubPlace } from './types.ts';

/** Sub-places the reports-tools-trust lane adds to the rail. Only the owning lane edits this file.
 *  Each one needs its name under SH-01.sub.<place>.<id> in app/ui/src/text/lanes/reports-tools-trust.ts. */
export const subPlaces: readonly LaneSubPlace[] = [
  // TL tools
  { place: 'tools', id: 'wrap' },
  { place: 'tools', id: 'requests' },
  { place: 'tools', id: 'remote' },
  // end TL tools
];
