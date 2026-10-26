import { createContext, useContext, type ReactNode } from 'react';

/** Reads the time now. Places call it when they render (Today's date line and greeting), never to work out a figure. */
export type Clock = () => Date;

const ClockContext = createContext<Clock>(() => new Date());

/**
 * The time the app shows, one source for every place. Without a provider it is the computer's own clock; tests (and
 * the parts page) wrap the app in a `ClockProvider` with a fixed time, so a greeting or a date line is the same on
 * every run.
 */
export function ClockProvider({ now, children }: { now: Clock; children: ReactNode }) {
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

/** The clock in force: call it to read the time. */
export function useClock(): Clock {
  return useContext(ClockContext);
}
