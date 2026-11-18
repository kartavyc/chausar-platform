/**
 * The window before the app. It asks the engine once what to show (boot.ts): the first run, "Welcome back" with the
 * businesses on this computer, or the app itself. While the engine is offline or the browser is not paired, the app
 * shows with its status line, and the check runs again once the engine answers. While the desktop's engine is still
 * starting, only the status line shows ("Chausar is starting.") and the check waits. Starting or opening a business
 * remounts the app so every place reads it. Closing, locking or deleting the open business (Keep this business) asks
 * again, and the app goes back to Welcome back: nothing the closed business showed stays on screen.
 * "New business" inside the app (started.ts NewBusinessContext) closes the open business and shows the same first run
 * steps every business gets; Back opens that business again.
 *
 * The state and its hooks live in this component, never in a hook the shell calls: React Fast Refresh tracks the hooks
 * of a component in a .tsx file, so editing this file remounts it cleanly instead of reusing the shell's old hook list.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useBusinessHold, useEngine, useEngineStatus } from '../../engine/context';
import type { Hold } from '../../engine/reads';
import { goTo } from '../../shell/navigation';
import { FirstRun } from './FirstRun';
import { Welcome } from './Welcome';
import { LeftContext, NewBusinessContext, StartedContext, type Leaving } from './started';
import { leaveBusiness, openBusiness } from '../../shell/switchBusiness';
import { knownClosed, openByItself, readBoot, type Openable, type WelcomeFound } from './boot';
import type { Deleted } from '../../engine/types';
import s from './Onboarding.module.css';
import { withViewTransition } from '../../parts/motion';

type WelcomeShown = WelcomeFound & { ask?: Leaving['ask'] };
/**
 * The first run. `back`: reached from Welcome back, which Back shows again. `from`: reached from "New business" inside
 * the app on this computer, whose open business was closed for it: Back opens that business again (null when the
 * engine could not name it; Back is then Welcome back). `resume`: hosted, where the business stays open until the new
 * one is made, so Back is the app as it was, named by `resume`.
 */
type FirstRunShown = { kind: 'first-run'; back?: WelcomeShown; from?: { folder: string; name: string } | null; resume?: { name: string } };
type Shown = { kind: 'checking' } | { kind: 'leaving' } | { kind: 'app' } | FirstRunShown | WelcomeShown;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function BootScreen({ status, children }: { status: ReactNode; children: (checking: boolean) => ReactNode }) {
  const client = useEngine();
  const engineState = useEngineStatus().state;
  const ready = engineState === 'ok';
  const hosted = client.transport === 'hosted';
  const [shown, setShown] = useState<Shown>({ kind: 'checking' });
  const [generation, setGeneration] = useState(0);
  const [check, setCheck] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  /** B3: what a delete answered, shown on Welcome back above the list. */
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  /** The engine answered the check, or a business was started or opened here: nothing to check again. */
  const settled = useRef(false);
  /** Set while the open business was just closed, locked or deleted: what Welcome back does next. */
  const leaving = useRef<Leaving | null>(null);
  /**
   * 15 Nov 2026 (the first Windows walk): the app is mounted, hidden, while the first check is out, and its places
   * asked for business data before any business was open (18 requests refused VAULT_LOCKED at every start). What they
   * ask now waits for the check: sent once a business is open, never sent when none is. A layout effect, so the hold
   * is on before any place's own effect asks.
   */
  const holdBusiness = useBusinessHold();
  const hold = useRef<Hold | null>(null);
  const firstCheck = shown.kind === 'checking' && (ready || engineState === 'starting');
  /** The check answered: what waited goes to the engine (a business is open, or the check failed) or is refused here. */
  const endHold = useCallback((how: keyof Hold) => { const held = hold.current; hold.current = null; held?.[how](); }, []);
  // The window goes while the check is out: nothing is left waiting. The refusal waits one turn, because the
  // development app (React's strict mode) unmounts and mounts again at once: that second mount keeps the same hold and
  // what the frame asked, where refusing at the unmount left an open business saying it was closed (15 Nov 2026).
  const leavingHold = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    if (leavingHold.current !== null) { clearTimeout(leavingHold.current); leavingHold.current = null; }
    if (firstCheck && !hold.current) hold.current = holdBusiness();
    return () => { leavingHold.current = setTimeout(() => { leavingHold.current = null; endHold('refuse'); }, 0); };
  }, [firstCheck, holdBusiness, endHold]);

  /** The app opens on a business. `swap`: the window cross-fades to it once (one-shot C3); never at the first boot. */
  const enter = useCallback((swap: boolean) => {
    const go = () => {
      // A business the check opened by itself remounts the app, and the new places ask afresh: what the hidden ones
      // asked before it was open is not sent as well.
      endHold('refuse');
      settled.current = true;
      leaving.current = null;
      setProblem(null);
      setDeleted(null);
      setShown({ kind: 'app' });
      setGeneration((g) => g + 1);
    };
    if (swap) void withViewTransition(go, 'window');
    else go();
  }, [endHold]);
  const started = useCallback(() => enter(true), [enter]);

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
      // A busy answer is tried again (switchBusiness.ts), so the list never sits there with nothing opening.
      await openBusiness(client, business.params);
      started();
    } catch (error) {
      setProblem(messageOf(error));
    }
  }, [client, started]);

  /**
   * New business, from inside the app. On this computer the open business closes first (the window stops asking it for
   * data, then locks it: switchBusiness.ts), and the first run steps show with a way back to it. A refused lock is
   * answered to the caller and nothing changes.
   */
  const newBusiness = useCallback(async (): Promise<unknown | null> => {
    const show = (next: FirstRunShown) => {
      settled.current = true;
      leaving.current = null;
      setProblem(null);
      setDeleted(null);
      // A sheet or page of the business being left must not come back with the next one.
      goTo('today');
      void withViewTransition(() => setShown(next), 'window');
    };
    let from: { folder: string; name: string } | null = null;
    let name = '';
    try {
      const status = await client.request('workspace.status', {});
      name = status.open ? status.workspace?.name ?? '' : '';
      if (status.open && status.folder) from = { folder: status.folder, name };
    } catch { /* Back is then Welcome back, which lists every business. */ }
    if (hosted) { show({ kind: 'first-run', resume: { name } }); return null; }
    const outcome = await leaveBusiness(client);
    if (!outcome.left) return outcome.error;
    show({ kind: 'first-run', from });
    return null;
  }, [client, hosted]);

  /** Back from a new business's first run: the business the owner came from opens again, else Welcome back says why. */
  const reopen = useCallback(async (from: { folder: string; name: string }) => {
    try {
      await openBusiness(client, { folder: from.folder });
      started();
    } catch (error) {
      left({ problem: messageOf(error) });
    }
  }, [client, started, left]);

  // C5 task 29: a restarted worker has no business open, so once it is back the start-up check runs again: a business
  // this computer can open comes back by itself, and one that needs its passphrase asks on Welcome back.
  const reconnected = useRef(false);
  useEffect(() => {
    if (engineState === 'reconnecting') reconnected.current = true;
    else if (engineState === 'ok' && reconnected.current) {
      reconnected.current = false;
      settled.current = false;
      setCheck((c) => c + 1);
    }
  }, [engineState]);

  useEffect(() => {
    if (settled.current) return;
    // The desktop opens its window before the engine has started (15 Nov 2026): while it says "starting", the window
    // shows the status line alone and the hidden app asks nothing; the check runs once the engine is up.
    if (engineState === 'starting') return;
    if (!ready) { endHold('release'); setShown((now) => (now.kind === 'checking' ? { kind: 'app' } : now)); return; }
    let live = true;
    readBoot(client).then(
      async (found) => {
        if (!live || settled.current) return;
        settled.current = true;
        const after = leaving.current;
        leaving.current = null;
        if (after?.problem) setProblem(after.problem);
        setDeleted(after?.deleted ?? null);
        const only = after?.autoOpen === false || after?.problem ? null : openByItself(found);
        if (only) {
          try { await openBusiness(client, only.params); enter(Boolean(after)); return; }
          catch (error) { setProblem(messageOf(error)); }
        }
        endHold(found.kind === 'app' ? 'release' : 'refuse');
        const show = () => setShown(found.kind === 'welcome' && after?.ask ? { ...found, ask: after.ask } : found);
        // One-shot C3: after a close, lock or delete, Welcome back cross-fades in once; the first boot never moves.
        if (after) void withViewTransition(show, 'window');
        else show();
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
        // The check could not say: what waited goes to the engine and shows its own answer. When it had already learnt
        // that no business is open, that answer is known, and nothing is sent.
        endHold(knownClosed(error) ? 'refuse' : 'release');
        setShown((now) => (now.kind === 'checking' ? { kind: 'app' } : now));
      },
    );
    return () => { live = false; };
  }, [client, ready, engineState, enter, check, endHold]);

  if (shown.kind === 'leaving') {
    return (
      <div className={s.first}>
        <div>{status}</div>
        <main id="main" tabIndex={-1} className={s.firstMain} aria-busy="true" />
      </div>
    );
  }
  if (shown.kind === 'first-run') {
    const { back, from, resume } = shown;
    // A business already on this computer: the AI connected there is used again when it can be (FirstRun `later`).
    const later = !hosted && (from !== undefined || Boolean(back?.businesses.length));
    const onBack = back ? () => setShown(back)
      : resume ? () => enter(true)
        : from ? () => void reopen(from)
          : from === null ? () => left() : undefined;
    return (
      <FirstRun
        status={status} onStarted={started} later={later} onBack={onBack} backTo={from?.name || resume?.name || undefined}
        onExisting={hosted || back ? undefined
          // From inside the app: Welcome back lists every business here, with every other way in beside it.
          : from !== undefined ? () => left()
            : () => { setProblem(null); setShown({ kind: 'welcome', businesses: [], closedByOwner: true, complete: false }); }}
      />
    );
  }
  if (shown.kind === 'welcome') {
    const { ask: _ask, ...found } = shown;
    return (
      <Welcome
        key={check} status={status} found={shown} problem={problem} hosted={hosted} deleted={deleted}
        onOpen={open} onOpened={started} onNew={() => { setProblem(null); setShown({ kind: 'first-run', back: found }); }}
      />
    );
  }
  return (
    <StartedContext.Provider value={started}>
      <LeftContext.Provider value={left}>
        <NewBusinessContext.Provider value={newBusiness}>
          <Fragment key={generation}>{children(shown.kind === 'checking')}</Fragment>
        </NewBusinessContext.Provider>
      </LeftContext.Provider>
    </StartedContext.Provider>
  );
}
