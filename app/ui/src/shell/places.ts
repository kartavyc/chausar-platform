/** Page code has one loader boundary. Tests keep eager modules for existing synchronous assertions. */
import type { ComponentType } from 'react';
import { chunkComponent } from './Chunk';
import { BASE_SHEETS, type SheetComponent } from './sheets';
import type { PlaceId } from './routes';

export interface PlaceModule { Place: ComponentType; sheets?: Readonly<Record<string, SheetComponent>> }
export type PlaceLoaders = Record<string, () => Promise<PlaceModule>>;
export const PLACE_LOADERS: PlaceLoaders = import.meta.glob<PlaceModule>('../places/*/index.tsx');
const EAGER_PLACES = import.meta.glob<PlaceModule>('../places/*/index.tsx', { eager: true });
const placeId = (path: string) => path.split('/').at(-2) as PlaceId;

/** Each loaded module is shared by repeated visits. A failed promise is forgotten so retry can fetch again. */
export function placesFor(mode: 'eager' | 'lazy', loaders: PlaceLoaders = PLACE_LOADERS): Readonly<Record<PlaceId, PlaceModule>> {
  if (mode === 'eager') return Object.fromEntries(Object.entries(EAGER_PLACES).map(([path, module]) => [placeId(path), module])) as Record<PlaceId, PlaceModule>;
  return Object.fromEntries(Object.entries(loaders).map(([path, loader]) => {
    let pending: Promise<PlaceModule> | undefined;
    const load = () => pending ??= loader().catch(error => { pending = undefined; throw error; });
    return [placeId(path), { Place: chunkComponent(async () => (await load()).Place) }];
  })) as Record<PlaceId, PlaceModule>;
}
export const PLACES = placesFor(import.meta.env.MODE === 'test' ? 'eager' : 'lazy');

// The following sheet exports move behind their owning loader in task 4.
export const SHEETS: Readonly<Record<string, SheetComponent>> = Object.assign(
  {}, ...Object.values(EAGER_PLACES).map(place => place.sheets ?? {}), BASE_SHEETS,
);
export { FirstRun } from '../places/onboarding/FirstRun';
export { Welcome } from '../places/onboarding/Welcome';
