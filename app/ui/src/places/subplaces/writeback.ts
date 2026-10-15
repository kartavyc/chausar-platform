import type { LaneSubPlace } from './types.ts';

/** Sub-places the writeback lane adds to the rail. Only the owning lane edits this file.
 *  Each one needs its name under SH-01.sub.<place>.<id> in app/ui/src/text/lanes/writeback.ts. */
export const subPlaces: readonly LaneSubPlace[] = [];
