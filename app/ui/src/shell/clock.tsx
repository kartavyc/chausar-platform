import { createContext, useContext, type ReactNode } from 'react';
import { useResource } from '../engine/context';
import { computerZone, ownerZone } from '../../../../platform/runtime/owner-format';

/** Reads the time now. Places call it when they render (Today's date line and greeting), never to work out a figure. */
export type Clock = () => Date;

const ClockContext = createContext<Clock>(() => new Date());

/** The zone instants read in, and the business's country code when one is open (counts group by it). */
type Zone = { zone: string; country: string | null; pinned: boolean };
const ZoneContext = createContext<Zone | null>(null);

/**
 * The time the app shows, one source for every place. Without a provider it is the computer's own clock; tests (and
 * the parts page) wrap the app in a `ClockProvider` with a fixed time, so a greeting or a date line is the same on
 * every run. A `zone` pins the zone instants read in (one-shot B2), so a test reads the same on every computer; the
 * business's own zone (`OwnerZone`) never overrides a pinned one.
 */
export function ClockProvider({ now, zone, children }: { now: Clock; zone?: string | undefined; children: ReactNode }) {
  const clock = <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
  return zone ? <ZoneContext.Provider value={{ zone, country: null, pinned: true }}>{clock}</ZoneContext.Provider> : clock;
}

/** The clock in force: call it to read the time. */
export function useClock(): Clock {
  return useContext(ClockContext);
}

const onQueue = (event: { type: string }) => event.type === 'queue.changed';

/**
 * The business's zone for everything inside (one-shot B2, row 37): instants read where the business is, by its
 * country code and the engine's own table, so a drill run at 00:50 in India on 3 Nov reads 3 Nov on any computer. With
 * no business open, or a business in another country, the computer's own zone.
 */
export function OwnerZone({ children }: { children: ReactNode }) {
  const outer = useContext(ZoneContext);
  const venture = useResource('venture.get', {}, { refreshOn: onQueue });
  const country = venture.data?.venture?.country?.code ?? null;
  const zone = outer?.pinned ? outer.zone : ownerZone(country, computerZone());
  return <ZoneContext.Provider value={{ zone, country, pinned: Boolean(outer?.pinned) }}>{children}</ZoneContext.Provider>;
}

/** The zone instants read in: the pinned one, else the business's, else the computer's. */
export function useOwnerZone(): string {
  return useContext(ZoneContext)?.zone ?? computerZone();
}

/** The open business's country code (counts group the Indian way for 'IN'), or null when none is known. */
export function useOwnerCountry(): string | null {
  return useContext(ZoneContext)?.country ?? null;
}
