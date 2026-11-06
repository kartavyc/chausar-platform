/**
 * Long tasks, in development only (one-shot C3 task 17): a PerformanceObserver keeps the last 200 long tasks on
 * `window.__chausarLongTasks`, each with the address at the time, so the screenshot walk can list any task over 50 ms
 * during a place change. main.tsx imports this only under `import.meta.env.DEV`: nothing in a production build, and
 * nothing ever leaves the window. The nightly budget on these numbers is D2's.
 */

export type LongTask = { at: number; duration: number; route: string };
type Holder = { __chausarLongTasks?: LongTask[] };

const KEEP = 200;

/** Start watching. Returns the stop; does nothing where the browser has no long-task entries. */
export function watchLongTasks(): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  const holder = window as unknown as Holder;
  holder.__chausarLongTasks ??= [];
  const ring = holder.__chausarLongTasks;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      ring.push({ at: entry.startTime, duration: entry.duration, route: window.location.hash });
      if (ring.length > KEEP) ring.splice(0, ring.length - KEEP);
    }
  });
  try {
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    return () => {};
  }
  return () => observer.disconnect();
}
