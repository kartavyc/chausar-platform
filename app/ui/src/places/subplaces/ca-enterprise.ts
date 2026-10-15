import type { LaneSubPlace } from './types.ts';
import { firmSubPlaces } from '../../screens/ca-enterprise/firm/subplaces.ts';
import { enterpriseSubPlaces } from '../../screens/ca-enterprise/enterprise/subplaces.ts';

/** Sub-places the ca-enterprise lane adds to the rail. Only the owning lane edits this file.
 *  Each one needs its name under SH-01.sub.<place>.<id> in app/ui/src/text/lanes/ca-enterprise.ts. */
export const subPlaces: readonly LaneSubPlace[] = [...firmSubPlaces, ...enterpriseSubPlaces];
