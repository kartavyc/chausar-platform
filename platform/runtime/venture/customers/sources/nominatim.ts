// Chausar city lookup. Official Nominatim policy informs this original implementation, no code copied.
import { check } from '../../../contracts.ts';
import { politeFetch, type PoliteNet } from '../../build/fetch-policy.ts';
import { cityBox, type CityBox } from './osm.ts';
/** City-only, cached, single-flight lookup. Never autocomplete, personal addresses or periodic geocoding. */
export class NominatimCities {
  private tail: Promise<unknown> = Promise.resolve();
  private nextAt = 0;
  private cache = new Map<string, Promise<CityBox>>();
  private now: () => number;
  private wait: (ms: number) => Promise<void>;
  private net: PoliteNet;
  constructor(options: { now?: () => number; wait?: (ms: number) => Promise<void>; net?: PoliteNet } = {}) {
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.net = options.net ?? {};
  }
  /** Resolves a city once; an unavailable answer is not cached as a success. */
  find(city: string): Promise<CityBox> {
    check(typeof city === 'string' && city.trim().length > 1 && city.length <= 100 && !/[\r\n\x00-\x1f]/.test(city), 'INVALID_VENTURE_REQUEST', 'Enter the city name.');
    const key = city.trim().toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key)!;
    const work = this.tail.catch(() => {}).then(async () => {
      const delay = Math.max(0, this.nextAt - this.now());
      if (delay) await this.wait(delay);
      this.nextAt = this.now() + 1000;
      const response = await politeFetch({ url: `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(city.trim())}&format=jsonv2&limit=1`, maxBytes: 100000, timeoutMs: 10000 }, this.net);
      check(response.status === 200, 'CITY_NOT_FOUND', 'Choose the city box yourself; city lookup is unavailable.');
      let rows: any;
      try { rows = JSON.parse(response.body.toString('utf8')); } catch { check(false, 'CITY_NOT_FOUND', 'Choose the city box yourself; city lookup is unavailable.'); }
      check(Array.isArray(rows) && Array.isArray(rows[0]?.boundingbox), 'CITY_NOT_FOUND', 'Choose the city box yourself; no city was found.');
      const [s, n, w, e] = rows[0].boundingbox.map(Number);
      return cityBox([s, w, n, e]);
    });
    this.tail = work;
    this.cache.set(key, work);
    work.catch(() => { this.cache.delete(key); });
    return work;
  }
}
/** Shared application limiter and city cache, used only after an owner asks for that city. */
export const leadCities = new NominatimCities();

const byNet = new WeakMap<object, NominatimCities>();
/** Keeps one serial limiter per trusted host network port; production uses the application-wide cache. */
export function citiesFor(net?: PoliteNet): NominatimCities { if (!net) return leadCities; let cities = byNet.get(net); if (!cities) { cities = new NominatimCities({ net }); byNet.set(net, cities); } return cities; }
