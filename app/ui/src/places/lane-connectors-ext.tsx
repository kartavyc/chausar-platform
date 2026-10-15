import type { PlaceModule } from './types.ts';
import { connectorsBooksPlace } from '../screens/connectors/index.tsx';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const connectorsExtPlaces: readonly PlaceModule[] = [connectorsBooksPlace];
