import type { LaneSubPlace } from './types.ts';

/** Sub-places the learning-ext lane adds to the rail. Only the owning lane edits this file.
 *  Each one needs its name under SH-01.sub.<place>.<id> in app/ui/src/text/lanes/learning-ext.ts. */
export const subPlaces: readonly LaneSubPlace[] = [{ place: 'books', id: 'learning' }];
