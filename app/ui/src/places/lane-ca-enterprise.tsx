import type { PlaceModule } from './types.ts';
import { firmPlaces } from '../screens/ca-enterprise/firm/index.tsx';
import { enterprisePlaces } from '../screens/ca-enterprise/enterprise/index.tsx';

/** Lane-owned screens. Only the owning lane edits this file and its own folders.
 *  Every address here exists only in the ca-firm or enterprise shell (or is a lane sub-place),
 *  so this list is looked up first (registry.ts); no desktop address is claimed. */
export const caEnterpriseFirstPlaces: readonly PlaceModule[] = [...firmPlaces, ...enterprisePlaces];
export const caEnterprisePlaces: readonly PlaceModule[] = [];
