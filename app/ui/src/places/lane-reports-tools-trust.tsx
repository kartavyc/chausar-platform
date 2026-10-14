import type { PlaceModule } from './types.ts';
import { reportsPlaces } from '../screens/reports/index.tsx';
import { toolsPlaces } from '../screens/tools/index.tsx';
import { trustPlaces } from '../screens/trust/index.tsx';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const reportsToolsTrustPlaces: readonly PlaceModule[] = [...reportsPlaces, ...toolsPlaces, ...trustPlaces];
