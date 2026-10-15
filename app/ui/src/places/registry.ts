/** Every place module, in lookup order. This list is fixed; each lane owns one file. */
import type { Address } from '../app/presentation.ts';
import type { PlaceModule } from './types.ts';
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

// ca-enterprise: addresses that exist only in the ca-firm and enterprise shells are looked up first.
export const placeModules: readonly PlaceModule[] = [...caEnterpriseFirstPlaces, ...frameTodayPlaces, ...askPlaces, ...workBooksPlaces, ...reportsToolsTrustPlaces,
  ...connectorsExtPlaces, ...writebackPlaces, ...jobsExtPlaces, ...learningExtPlaces, ...hostedLinkPlaces, ...modelsExtPlaces, ...releasePlaces, ...drivingPlaces, ...caEnterprisePlaces];

export function placeModuleFor(address: Address, list: readonly PlaceModule[] = placeModules): PlaceModule | null {
  return list.find(module => module.handles(address)) ?? null;
}
