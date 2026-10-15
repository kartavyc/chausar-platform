import { expect, test } from 'vitest';
import { placeModuleFor } from '../../app/ui/src/places/registry.ts';
import { caEnterpriseFirstPlaces } from '../../app/ui/src/places/lane-ca-enterprise.tsx';
import type { Address } from '../../app/ui/src/app/presentation.ts';

const mine = (a: Address) => caEnterpriseFirstPlaces.includes(placeModuleFor(a)!);

test('shell-only authored addresses reach the ca-enterprise screens before place-wide modules', () => {
  for (const a of [{ place: 'today' }, { place: 'clients' }, { place: 'work', sub: 'cosign' }, { place: 'work', sub: 'many' }, { place: 'work', sub: 'questions' },
    { place: 'reports', sub: 'handover' }, { place: 'tools', sub: 'library' }, { place: 'tools', sub: 'invite' }, { place: 'trust', sub: 'firmname' }] as Address[]) {
    expect(mine(a), JSON.stringify(a)).toBe(true);
  }
});

test('desktop addresses are never taken from their own lanes', () => {
  for (const a of [{ place: 'work', sub: 'approvals' }, { place: 'work' }, { place: 'trust', sub: 'people' }, { place: 'trust', sub: 'access' }, { place: 'books', sub: 'sources' },
    { place: 'reports', sub: 'packs' }, { place: 'tools', sub: 'smallapps' }, { place: 'today', sub: 'activity' }] as Address[]) {
    expect(mine(a), JSON.stringify(a)).toBe(false);
  }
});
