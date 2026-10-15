import type { PlaceModule } from './types.ts';
import { learningPlace } from '../screens/learning/index.tsx';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const learningExtPlaces: readonly PlaceModule[] = [learningPlace];
