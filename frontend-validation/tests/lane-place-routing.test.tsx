import { expect, test } from 'vitest';
import { laneModules, placeModuleFor, placeModules } from '../../app/ui/src/places/registry.ts';
import { laneSubPlaces } from '../../app/ui/src/places/subplaces/index.ts';
import type { Address } from '../../app/ui/src/app/presentation.ts';
import type { PlaceModule } from '../../app/ui/src/places/types.ts';

test('every lane with sub-places has its own module list, and every module is in the lookup', () => {
  for (const lane of Object.keys(laneSubPlaces)) expect(lane in laneModules, lane).toBe(true);
  expect(placeModules).toEqual(Object.values(laneModules).flat());
});

test('without a lane-registered sub-place, lookup order decides', () => {
  const placeWide: PlaceModule = { id: 'place-wide', handles: a => a.place === 'work', render: () => null };
  const laneOwn: PlaceModule = { id: 'lane-own', handles: a => a.place === 'work' && a.sub === 'not-registered', render: () => null };
  expect(placeModuleFor({ place: 'work', sub: 'not-registered' }, [placeWide, laneOwn])?.id).toBe('place-wide');
});

test('a sub-place a lane added reaches that lane module before any place-wide module', () => {
  for (const [lane, subs] of Object.entries(laneSubPlaces)) for (const sub of subs) {
    const address: Address = { place: sub.place, sub: sub.id };
    const own = laneModules[lane]!.find(module => module.handles(address));
    if (own) expect(placeModuleFor(address), `${lane}: ${sub.place}/${sub.id}`).toBe(own);
  }
});
