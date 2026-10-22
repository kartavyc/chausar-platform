/**
 * The window before the app. It asks the engine once what to show (boot.ts): the first run, "Welcome back" with the
 * businesses on this computer, or the app itself. While the engine is starting, offline or the browser is not paired,
 * the app shows with its status line, and the check runs again once the engine answers. Starting or opening a business
 * remounts the app so every place reads it. Closing, locking or deleting the open business (Keep this business) asks
 * again, and the app goes back to Welcome back: nothing the closed business showed stays on screen.
 *
 * The state and its hooks live in this component, never in a hook the shell calls: React Fast Refresh tracks the hooks
 * of a component in a .tsx file, so editing this file remounts it cleanly instead of reusing the shell's old hook list.
 */

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useEngine, useEngineStatus } from '../../engine/context';
import { goTo } from '../../shell/navigation';
import { FirstRun } from './FirstRun';
import { Welcome } from './Welcome';
import { LeftContext, StartedContext, type Leaving } from './started';
import { openByItself, readBoot, type Openable, type WelcomeFound } from './boot';
import s from './Onboarding.module.css';

type WelcomeShown = WelcomeFound & { ask?: Leaving['ask'] };
type Shown = { kind: 'checking' } | { kind: 'leaving' } | { kind: 'app' } | { kind: 'first-run'; back?: WelcomeShown } | WelcomeShown;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function BootScreen({ status, children }: { status: ReactNode; children: (checking: boolean) => ReactNode }) {
  const client = useEngine();
  const ready = useEngineStatus().state === 'ok';
  const hosted = client.transport === 'hosted';
  const [shown, setShown] = useState<Shown>({ kind: 'checking' });
  const [generation, setGeneration] = useState(0);
  const [check, setCheck] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  /** The engine answered the check, or a business was started or opened here: nothing to check again. */
  const settled = useRef(false);
  /** Set while the open business was just closed, locked or deleted: what Welcome back does next. */
  const leaving = useRef<Leaving | null>(null);

  const started = useCallback(() => {
    settled.current = true;
    leaving.current = null;
    setProblem(null);
    setShown({ kind: 'app' });
    setGeneration((g) => g + 1);
  }, []);

  const left = useCallback((after: Leaving = {}) => {
    leaving.current = after;
    settled.current = false;
    setProblem(null);
    // A sheet or page of the closed business must not come back with the next one.
    goTo('today');
    setShown({ kind: 'leaving' });
    setCheck((c) => c + 1);
  }, []);

  const open = useCallback(async (business: Openable) => {
    setProblem(null);
    try {
      await client.request('workspace.open', business.params);
      started();
    } catch (error) {
      setProblem(messageOf(error));
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
        const after = leaving.current;
        leaving.current = null;
        if (after?.problem) setProblem(after.problem);
        const only = after?.autoOpen === false || after?.problem ? null : openByItself(found);
        if (only) {
          try { await client.request('workspace.open', only.params); started(); return; }
          catch (error) { setProblem(messageOf(error)); }
        }
        setShown(found.kind === 'welcome' && after?.ask ? { ...found, ask: after.ask } : found);
      },
      (error: unknown) => {
        if (!live || settled.current) return;
        if (leaving.current) {
          // The business is closed but the list could not be read: Welcome back still offers every other way in.
          settled.current = true;
          leaving.current = null;
          setProblem(messageOf(error));
          setShown({ kind: 'welcome', businesses: [], closedByOwner: true, complete: false });
          return;
        }
        setShown((now) => (now.kind === 'checking' ? { kind: 'app' } : now));
      },
    );
    return () => { live = false; };
  }, [client, ready, started, check]);

  if (shown.kind === 'leaving') {
    return (
      <div className={s.first}>
        <div>{status}</div>
        <main id="main" tabIndex={-1} className={s.firstMain} aria-busy="true" />
      </div>
    );
  }
  if (shown.kind === 'first-run') {
    const back = shown.back;
    return (
      <FirstRun
        status={status} onStarted={started} onBack={back ? () => setShown(back) : undefined}
        onExisting={hosted || back ? undefined : () => { setProblem(null); setShown({ kind: 'welcome', businesses: [], closedByOwner: true, complete: false }); }}
      />
    );
  }
  if (shown.kind === 'welcome') {
    const { ask: _ask, ...found } = shown;
    return (
      <Welcome
        key={check} status={status} found={shown} problem={problem} hosted={hosted}
        onOpen={open} onOpened={started} onNew={() => { setProblem(null); setShown({ kind: 'first-run', back: found }); }}
      />
    );
  }
  return (
    <StartedContext.Provider value={started}>
      <LeftContext.Provider value={left}>
        <Fragment key={generation}>{children(shown.kind === 'checking')}</Fragment>
      </LeftContext.Provider>
    </StartedContext.Provider>
  );
}
