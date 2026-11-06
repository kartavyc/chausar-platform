import { useEffect, useRef, useState } from 'react';
import { afterExit, motionOff } from './motion';

/** One drawn item: the item itself, whether it is leaving, and its place in the arrival stagger (none past the fifth). */
export type Drawn<T> = { item: T; key: string; leaving: boolean; arriving: boolean };

/** The classes of the arrival stagger, one per place; past the fifth there is none, so a long list never waits. */
export const STAGGER_PLACES = 5;

/**
 * A list that lets its items leave and arrive (one-shot C3 task 13). An item gone from the data stays drawn in its old
 * place with `leaving` until its leave ends (call `left(key)` from its transitionend, or use `useLeaveEnd`), at once with
 * motion off. An item new to the list after the first render is `arriving`; the first render moves nothing. An item that
 * comes back while it was leaving is simply there again, the same element.
 */
export function useLeavingList<T>(items: readonly T[], keyOf: (item: T) => string): { drawn: Drawn<T>[]; left: (key: string) => void } {
  const before = useRef<{ order: string[]; byKey: Map<string, T> } | null>(null);
  const [leaving, setLeaving] = useState<ReadonlyMap<string, { item: T; after: string | null }>>(new Map());
  const keys = items.map(keyOf);
  const current = new Set(keys);

  // What just left, found while drawing, so the leaving row is never missing for a frame.
  let gone = leaving;
  const previous = before.current;
  if (previous && !motionOff()) {
    for (let index = 0; index < previous.order.length; index += 1) {
      const key = previous.order[index]!;
      if (current.has(key) || gone.has(key)) continue;
      if (gone === leaving) gone = new Map(leaving);
      (gone as Map<string, { item: T; after: string | null }>).set(key, { item: previous.byKey.get(key)!, after: index > 0 ? previous.order[index - 1]! : null });
    }
  }
  // A key back in the data is no longer leaving.
  for (const key of gone.keys()) {
    if (current.has(key)) {
      if (gone === leaving) gone = new Map(leaving);
      (gone as Map<string, unknown>).delete(key);
    }
  }
  if (gone !== leaving) setLeaving(gone);

  const known = useRef<Set<string> | null>(null);
  const seen = known.current;
  const drawn: Drawn<T>[] = items.map((item, index) => ({ item, key: keys[index]!, leaving: false, arriving: seen !== null && !seen.has(keys[index]!) }));
  // Each leaving row goes back where it stood: after the row it followed, or first.
  for (const [key, { item, after }] of gone) {
    const at = after === null ? 0 : drawn.findIndex((row) => row.key === after) + 1;
    drawn.splice(at, 0, { item, key, leaving: true, arriving: false });
  }

  useEffect(() => {
    before.current = { order: keys, byKey: new Map(items.map((item, index) => [keys[index]!, item])) };
    known.current = new Set(keys);
  });

  return {
    drawn,
    left: (key) => setLeaving((now) => {
      if (!now.has(key)) return now;
      const next = new Map(now);
      next.delete(key);
      return next;
    }),
  };
}

/** Ends a leaving row: `done` on its transition's end, on its own timer, or at once with motion off. */
export function useLeaveEnd(element: { current: Element | null }, leaving: boolean, done: () => void): void {
  const latest = useRef(done);
  latest.current = done;
  useEffect(() => {
    if (!leaving) return undefined;
    return afterExit(element.current, () => latest.current());
  }, [element, leaving]);
}

/** The class place of the nth arrival: `i0` to `i4`, none past the fifth. */
export function staggerClass(index: number): string | undefined {
  return index >= 0 && index < STAGGER_PLACES ? `i${index}` : undefined;
}

/**
 * Hold a value (a count) in the same area until a leave there ends, so two things never move together. While `holding`
 * it keeps what it was; the moment the leave ends it changes.
 */
export function useAfterLeave<T>(value: T, holding: boolean): T {
  const kept = useRef(value);
  if (!holding) kept.current = value;
  return kept.current;
}
