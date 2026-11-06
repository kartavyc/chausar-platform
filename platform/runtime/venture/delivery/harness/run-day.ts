// Chausar delivery harness: the run's day on the business's own calendar (one-shot B2, the owner-day rule).
// A tool that checks a date (rights that end on a day, a consent's last day, a report's day, a price change's day)
// reads the day where the business is, from the run's injected clock, never the UTC day of the clock.
import type { CountryProfile, IsoDate, VentureDeps } from '../../contracts.ts';
import { localDayAt } from '../../local-day.ts';
import { findRecord } from '../../records.ts';
import type { ToolEnv } from './tools.ts';

/**
 * Today for this run, in the business's zone. Every run the engine starts has a vault and a business; a tool
 * environment built by hand (a unit test) may have no store, or a store without that business. In either case the engine's fallback for a business with no
 * country applies (UTC, local-day.ts ventureTimeZone).
 */
export function runDay(env: Pick<ToolEnv, 'deps' | 'ventureId' | 'now'>): IsoDate {
  return localDayAt(env.now(), runCountry(env));
}

/** The business's country for this run; null where a hand-built test environment has no business. */
export function runCountry(env: Pick<ToolEnv, 'deps' | 'ventureId'>): CountryProfile | null {
  const store = (env.deps as Partial<VentureDeps>).store;
  return (store ? findRecord(store.read(), 'venture-record', env.ventureId)?.country : null) ?? null;
}
