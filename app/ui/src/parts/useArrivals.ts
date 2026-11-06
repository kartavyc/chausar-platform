import { useEffect, useRef } from 'react';
import { motionOff } from './motion';

/** Newly added keys after the first loaded list. Undefined is still loading, so its first answer stays still. */
export function useArrivals(keys: readonly string[] | undefined): ReadonlySet<string> {
  const known = useRef<ReadonlySet<string> | null>(null);
  const arriving = new Set(keys && known.current && !motionOff() ? keys.filter(key => !known.current!.has(key)) : []);
  useEffect(() => { known.current = keys === undefined ? null : new Set(keys); });
  return arriving;
}
