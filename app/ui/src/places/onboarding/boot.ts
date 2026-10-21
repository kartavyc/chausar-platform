/**
 * First run: with no business on this computer (no vault open and none listed; on hosted, none on the account) the
 * app shows only the one-sentence start. Anything else shows the app. While the engine is starting, offline or the
 * browser is not paired, the app shows with its status line, and the check runs again once the engine answers.
 * Starting a business, from the first run or from "New business", remounts the app so every place reads it.
 */

import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { useEngine, useEngineStatus } from '../../engine/context';
import type { EngineClient } from '../../engine/types';

export type Boot = 'checking' | 'first-run' | 'app';

export async function noBusinessYet(client: EngineClient): Promise<boolean> {
  const status = await client.request('workspace.status', {});
  if (status.open) return false;
  if (client.transport === 'hosted') return (status.hosted?.businesses.length ?? 0) === 0;
  const list = await client.request('workspace.list', {});
  return list.businesses.length === 0;
}

export function useFirstRun(): { boot: Boot; generation: number; started: () => void } {
  const client = useEngine();
  const ready = useEngineStatus().state === 'ok';
  const [boot, setBoot] = useState<Boot>('checking');
  const [generation, setGeneration] = useState(0);
  /** The engine answered the check, or a business was started here: nothing to check again. */
  const settled = useRef(false);

  useEffect(() => {
    if (settled.current) return;
    if (!ready) { setBoot((now) => (now === 'checking' ? 'app' : now)); return; }
    let live = true;
    noBusinessYet(client).then(
      (fresh) => {
        if (!live || settled.current) return;
        settled.current = true;
        setBoot(fresh ? 'first-run' : 'app');
      },
      () => { if (live && !settled.current) setBoot((now) => (now === 'checking' ? 'app' : now)); },
    );
    return () => { live = false; };
  }, [client, ready]);

  const started = useCallback(() => {
    settled.current = true;
    setBoot('app');
    setGeneration((g) => g + 1);
  }, []);
  return { boot, generation, started };
}

/** What a place calls once a new business exists; the app provides it. */
export const StartedContext = createContext<() => void>(() => {});
