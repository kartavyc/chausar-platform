/** Page code has one loader boundary. Tests keep eager modules for existing synchronous assertions. */
import type { ComponentType } from 'react';
import { chunkComponent } from './Chunk';
import { BASE_SHEETS, SHEET_OWNERS, type SheetComponent, type SheetComponentProps } from './sheets';
import type { PlaceId } from './routes';

export interface PlaceModule { Place: ComponentType; sheets?: Readonly<Record<string, SheetComponent>> }
export type PlaceLoaders = Record<string, () => Promise<PlaceModule>>;
type OnboardingModule = typeof import('../places/onboarding/index');
export const PLACE_LOADERS: PlaceLoaders = import.meta.glob<PlaceModule>('../places/*/index.tsx');
const EAGER_PLACES = import.meta.env.MODE === 'test' ? import.meta.glob<PlaceModule & Partial<OnboardingModule>>('../places/*/index.tsx', { eager: true }) : {};
const placeId = (path: string) => path.split('/').at(-2) as PlaceId;
const modulePath = (id: PlaceId) => `../places/${id}/index.tsx`;
const caches = new WeakMap<PlaceLoaders, Map<string, Promise<PlaceModule>>>();

/** Pages, sheets and idle prefetch share one promise. A failure is forgotten so a press can retry it. */
function loadModule(path: string, loaders: PlaceLoaders): Promise<PlaceModule> {
  let cache = caches.get(loaders);
  if (!cache) { cache = new Map(); caches.set(loaders, cache); }
  let pending = cache.get(path);
  if (!pending) {
    pending = Promise.resolve().then(() => {
      const loader = loaders[path];
      if (!loader) throw new Error('Missing page loader');
      return loader();
    }).catch(error => { cache!.delete(path); throw error; });
    cache.set(path, pending);
  }
  return pending;
}
export function loadPlace(id: PlaceId): Promise<PlaceModule> { return loadModule(modulePath(id), PLACE_LOADERS); }
export function placesFor(mode: 'eager' | 'lazy', loaders: PlaceLoaders = PLACE_LOADERS): Readonly<Record<PlaceId, PlaceModule>> {
  if (mode === 'eager') return Object.fromEntries(Object.entries(EAGER_PLACES).map(([path, module]) => [placeId(path), module])) as Record<PlaceId, PlaceModule>;
  return Object.fromEntries(Object.keys(loaders).map(path => [placeId(path), {
    Place: chunkComponent(async () => (await loadModule(path, loaders)).Place),
  }])) as Record<PlaceId, PlaceModule>;
}
export function sheetsFor(mode: 'eager' | 'lazy', loaders: PlaceLoaders = PLACE_LOADERS): Readonly<Record<string, SheetComponent>> {
  if (mode === 'eager') return Object.assign({}, ...Object.values(EAGER_PLACES).map(place => place.sheets ?? {}), BASE_SHEETS);
  return { ...Object.fromEntries(Object.entries(SHEET_OWNERS).map(([kind, owner]) => [kind,
    chunkComponent<SheetComponentProps>(async () => {
      const sheet = (await loadModule(modulePath(owner), loaders)).sheets?.[kind];
      if (!sheet) throw new Error('Missing sheet in its page');
      return sheet;
    }),
  ])), ...BASE_SHEETS };
}
const mode = import.meta.env.MODE === 'test' ? 'eager' : 'lazy';
export const PLACES = placesFor(mode);
export const SHEETS = sheetsFor(mode);
const onboarding = EAGER_PLACES[modulePath('onboarding')];
export const FirstRun = import.meta.env.MODE === 'test' ? onboarding!.FirstRun! : chunkComponent(async () => ((await loadPlace('onboarding')) as OnboardingModule).FirstRun);
export const Welcome = import.meta.env.MODE === 'test' ? onboarding!.Welcome! : chunkComponent(async () => ((await loadPlace('onboarding')) as OnboardingModule).Welcome);
