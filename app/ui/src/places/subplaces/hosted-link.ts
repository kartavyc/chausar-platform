import type { LaneSubPlace } from './types.ts';

/** Sub-places the hosted-link lane adds to the rail. Only the owning lane edits this file.
 *  Each one needs its name under SH-01.sub.<place>.<id> in app/ui/src/text/lanes/hosted-link.ts.
 *  Both sit under Tools, next to Phone (TL-09): documents sent from the phone (PH-05) and the
 *  messages whose result was lost. */
export const subPlaces: readonly LaneSubPlace[] = [
  { place: 'tools', id: 'phonedocs' },
  { place: 'tools', id: 'phonelog' },
];
