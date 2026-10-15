import type { PlaceModule } from './types.ts';
import { hostedLinkScreens } from '../screens/hosted-link/index.tsx';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const hostedLinkPlaces: readonly PlaceModule[] = hostedLinkScreens;
