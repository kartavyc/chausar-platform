/** Every place module, in lookup order. This list is fixed; each lane owns one file. */
import type { Address } from '../app/presentation.ts';
import type { PlaceModule } from './types.ts';
import { frameTodayPlaces } from './lane-frame-today.tsx';
import { askPlaces } from './lane-ask.tsx';
import { workBooksPlaces } from './lane-work-books.tsx';
import { reportsToolsTrustPlaces } from './lane-reports-tools-trust.tsx';

export const placeModules: readonly PlaceModule[] = [...frameTodayPlaces, ...askPlaces, ...workBooksPlaces, ...reportsToolsTrustPlaces];

export function placeModuleFor(address: Address, list: readonly PlaceModule[] = placeModules): PlaceModule | null {
  return list.find(module => module.handles(address)) ?? null;
}
