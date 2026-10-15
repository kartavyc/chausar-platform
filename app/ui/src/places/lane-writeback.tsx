import type { PlaceModule } from './types.ts';
import { writebackPlace } from '../screens/writeback/index.tsx';

/** Lane-owned screens. Only the owning lane edits this file and its own folders.
 *  work/write (write connections, WK-06) and work/caps (limits, WK-12). */
export const writebackPlaces: readonly PlaceModule[] = [writebackPlace];
