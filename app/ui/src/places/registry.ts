/** Every place module, in lookup order. This list is fixed; each lane owns one file. */
import type { Address } from '../app/presentation.ts';
import type { PlaceModule } from './types.ts';
import { laneSubPlaces } from './subplaces/index.ts';
import { frameTodayPlaces } from './lane-frame-today.tsx';
import { askPlaces } from './lane-ask.tsx';
import { workBooksPlaces } from './lane-work-books.tsx';
import { reportsToolsTrustPlaces } from './lane-reports-tools-trust.tsx';
import { connectorsExtPlaces } from './lane-connectors-ext.tsx';
import { writebackPlaces } from './lane-writeback.tsx';
import { jobsExtPlaces } from './lane-jobs-ext.tsx';
import { learningExtPlaces } from './lane-learning-ext.tsx';
import { hostedLinkPlaces } from './lane-hosted-link.tsx';
import { modelsExtPlaces } from './lane-models-ext.tsx';
import { releasePlaces } from './lane-release.tsx';
import { drivingPlaces } from './lane-driving.tsx';
import { caEnterpriseFirstPlaces, caEnterprisePlaces } from './lane-ca-enterprise.tsx';

/** Each lane's modules, by lane id (the same ids as places/subplaces). */
export const laneModules: Readonly<Record<string, readonly PlaceModule[]>> = {
  'frame-today': frameTodayPlaces, ask: askPlaces, 'work-books': workBooksPlaces, 'reports-tools-trust': reportsToolsTrustPlaces,
  'connectors-ext': connectorsExtPlaces, writeback: writebackPlaces, 'jobs-ext': jobsExtPlaces, 'learning-ext': learningExtPlaces,
  'hosted-link': hostedLinkPlaces, 'models-ext': modelsExtPlaces, release: releasePlaces, driving: drivingPlaces, 'ca-enterprise': caEnterprisePlaces,
};

export const placeModules: readonly PlaceModule[] = Object.values(laneModules).flat();

/** The lane that added this sub-place (places/subplaces/<lane>.ts), if a lane did. */
function subPlaceOwner(address: Address): string | undefined {
  if (address.sub === undefined) return undefined;
  return Object.entries(laneSubPlaces).find(([, subs]) => subs.some(s => s.place === address.place && s.id === address.sub))?.[0];
}

/** A sub-place a lane added is drawn by that lane's module first, so a place-wide module
 *  (one that handles every address of its place) never swallows it. Otherwise: lookup order. */
export function placeModuleFor(address: Address, list: readonly PlaceModule[] = placeModules): PlaceModule | null {
  const owner = subPlaceOwner(address);
  const owned = owner === undefined ? undefined : laneModules[owner]?.find(module => list.includes(module) && module.handles(address));
  // ca-enterprise: authored addresses that exist only in the ca-firm and enterprise shells come next.
  const shellOnly = caEnterpriseFirstPlaces.find(module => list.includes(module) && module.handles(address));
  return owned ?? shellOnly ?? list.find(module => module.handles(address)) ?? null;
}
