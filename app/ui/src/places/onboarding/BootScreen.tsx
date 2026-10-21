/**
 * The window before the app. It asks the engine once what to show (boot.ts): the first run, "Welcome back" with the
 * businesses on this computer, or the app itself. While the engine is starting, offline or the browser is not paired,
 * the app shows with its status line, and the check runs again once the engine answers. Starting or opening a business
 * remounts the app so every place reads it.
 *
 * The state and its hooks live in this component, never in a hook the shell calls: React Fast Refresh tracks the hooks
 * of a component in a .tsx file, so editing this file remounts it cleanly instead of reusing the shell's old hook list.
 */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useEngine, useEngineStatus } from '../../engine/context';
import { FirstRun } from './FirstRun';
import { Welcome } from './Welcome';
import { StartedContext } from './started';
import { openByItself, readBoot, type BootFound, type Openable } from './boot';

type Shown = { kind: 'checking' } | { kind: 'app' } | { kind: 'first-run'; back?: Extract<BootFound, { kind: 'welcome' }> } | Extract<BootFound, { kind: 'welcome' }>;

export function BootScreen({ status, children }: { status: ReactNode; children: (checking: boolean) => ReactNode }) {
  const client = useEngine();
  const ready = useEngineStatus().state === 'ok';
  const [shown, setShown] = useState<Shown>({ kind: 'checking' });
  const [generation, setGeneration] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  /** The engine answered the check, or a business was started or opened here: nothing to check again. */
  const settled = useRef(false);

  const started = useCallback(() => {
    settled.current = true;
    setShown({ kind: 'app' });
    setGeneration((g) => g + 1);
  }, []);

  const open = useCallback(async (business: Openable) => {
    setProblem(null);
    try {
      await client.request('workspace.open', business.params);
      started();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [client, started]);

  useEffect(() => {
    if (settled.current) return;
    if (!ready) { setShown((now) => (now.kind === 'checking' ? { kind: 'app' } : now)); return; }
    let live = true;
    readBoot(client).then(
      async (found) => {
        if (!live || settled.current) return;
        settled.current = true;
        const only = openByItself(found);
        if (only) {
          try { await client.request('workspace.open', only.params); started(); return; }
          catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
        }
        setShown(found);
      },
      () => { if (live && !settled.current) setShown((now) => (now.kind === 'checking' ? { kind: 'app' } : now)); },
    );
    return () => { live = false; };
  }, [client, ready, started]);

  if (shown.kind === 'first-run') {
    const back = shown.back;
    return <FirstRun status={status} onStarted={started} onBack={back ? () => setShown(back) : undefined} />;
  }
  if (shown.kind === 'welcome') {
    return <Welcome status={status} businesses={shown.businesses} problem={problem} onOpen={open} onNew={() => { setProblem(null); setShown({ kind: 'first-run', back: shown }); }} />;
  }
  return (
    <StartedContext.Provider value={started}>
      <Fragment key={generation}>{children(shown.kind === 'checking')}</Fragment>
    </StartedContext.Provider>
  );
}
