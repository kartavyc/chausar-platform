import { useEffect, useRef, useState } from 'react';
import { motionOff } from './motion';

/** How long the mark stays before it is taken away again; a little past the settle time. */
const CHANGED_MS = 450;

/**
 * One-shot C3 task 14: mark a value the owner just changed, once. Put the result on the element as `data-changed`; a
 * token tint fades from it over the settle time (tokens/motion.css [data-changed]). Only a change after mount: the first
 * render, and any render with the same value, marks nothing. With motion off, nothing.
 */
export function useChanged(value: unknown): '' | undefined {
  const first = useRef(true);
  const last = useRef(value);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (first.current) { first.current = false; last.current = value; return undefined; }
    if (Object.is(last.current, value)) return undefined;
    last.current = value;
    if (motionOff()) return undefined;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), CHANGED_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return changed ? '' : undefined;
}
