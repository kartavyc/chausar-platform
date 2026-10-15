import type { LaneSubPlace } from './types.ts';

/** Sub-places the writeback lane adds to the rail. Only the owning lane edits this file.
 *  Each one needs its name under SH-01.sub.<place>.<id> in app/ui/src/text/lanes/writeback.ts.
 *  work/write: write connections, grants and the sandbox test (WK-06). work/caps: limits (WK-12). */
export const subPlaces: readonly LaneSubPlace[] = [{ place: 'work', id: 'write' }, { place: 'work', id: 'caps' }];
