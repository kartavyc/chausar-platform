import type { PlaceModule } from './types.ts';
import { jobsxPlace } from '../screens/jobs-ext/index.tsx';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const jobsExtPlaces: readonly PlaceModule[] = [jobsxPlace];
