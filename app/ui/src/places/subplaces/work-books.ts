import type { LaneSubPlace } from './types.ts';

/** Sub-places the work-books lane adds to the rail. Only the owning lane edits this file.
 *  Each one needs its name under SH-01.sub.<place>.<id> in app/ui/src/text/lanes/work-books.ts. */
export const subPlaces: readonly LaneSubPlace[] = [
  // WK-12: reminders to customers, with Prepare a reminder (Work).
  { place: 'work', id: 'reminders' },
];
