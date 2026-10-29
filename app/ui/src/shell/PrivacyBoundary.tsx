import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useEngineEvents } from '../engine/context';
import type { ResultOf } from '../engine/types';
import { forgetAskWords } from './ask';
import { forgetFocusOrigin, useRoute } from './navigation';

type Forgotten = Pick<ResultOf<'venture.network.forget'>, 'line' | 'kept'>;
type Completion = (result: Forgotten) => void;
const ForgetContext = createContext<{ result: Forgotten | null; completed: boolean; begin: () => Completion } | null>(null);

/** Lives inside the business boundary, above the private buffers that Forget must discard. */
export function PrivacyBoundary({ children }: { children: (generation: number) => ReactNode }) {
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<Forgotten | null>(null);
  const [completed, setCompleted] = useState(false);
  const epoch = useRef(0);
  const pending = useRef<{ epoch: number } | null>(null);
  const scope = useRef<string | null>(null);
  const live = useRef(true);
  useRoute();
  useEffect(() => {
    live.current = true;
    let hash = window.location.hash;
    const clear = () => {
      if (hash === window.location.hash) return;
      hash = window.location.hash;
      pending.current = null; scope.current = null; setResult(null); setCompleted(false);
    };
    window.addEventListener('hashchange', clear);
    return () => { live.current = false; pending.current = null; scope.current = null; window.removeEventListener('hashchange', clear); };
  }, []);
  useEngineEvents((event) => {
    if (event.type !== 'privacy.forgotten') return;
    forgetAskWords();
    forgetFocusOrigin();
    epoch.current += 1;
    if (pending.current && epoch.current - pending.current.epoch > 1) pending.current = null;
    // Events deliberately carry no person identity. Never keep a named receipt across one, even if it is delayed.
    setResult(null);
    // Remount every page and sheet, including when their subsequent reads fail.
    setGeneration((value) => value + 1);
  });
  function begin(): Completion {
    const ticket = { epoch: epoch.current };
    pending.current = ticket;
    scope.current = window.location.hash;
    setResult(null);
    setCompleted(false);
    return (reply) => {
      if (!live.current || pending.current !== ticket || scope.current !== window.location.hash) return;
      pending.current = null;
      setCompleted(true);
      // Only the fresh command receipt survives. No old name, role, form or person record is retained.
      setResult({ line: reply.line, kept: [...reply.kept] });
    };
  }
  const sameRoute = scope.current === window.location.hash;
  return <ForgetContext.Provider value={{ result: sameRoute ? result : null, completed: sameRoute && completed, begin }}>{children(generation)}</ForgetContext.Provider>;
}

export function useForgetCompletion() {
  const context = useContext(ForgetContext);
  if (!context) throw new Error('Forget completion needs the business privacy boundary.');
  return context;
}
