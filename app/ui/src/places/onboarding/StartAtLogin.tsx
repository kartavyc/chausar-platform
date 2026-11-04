import { useEffect, useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import type { BackgroundStateLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import s from './StartAtLogin.module.css';

/**
 * Whether start at login is still to be asked on this computer: the installed app (the desktop says it is supported)
 * with no answer saved. The founder (A5 fix round 1): that includes an install that registered a login item silently
 * before one-shot A5; it is asked once on Today, ticked, and its login item stays as it is until the owner answers.
 */
export const asksStartAtLogin = (state: BackgroundStateLite): boolean => state.supported && !state.asked;

/**
 * Start at login, asked once (one-shot A5, founder answer 5: asked in onboarding, ticked by default).
 *   first-run: on the services step, above the services, so it is seen before any Set up. Nothing is registered
 *     here: onChoice hands the tick to the first run, which saves it when the owner leaves the step.
 *   today (A5 fix round 1): when the first run ended without an answer (the app closed on the services step, or Go to
 *     Today before the computer answered), Today asks with the same words and the same tick, and Save answers. Not
 *     now (fix round 2) is an answer too: it keeps what the computer has (Keep running sent as it is), so the question
 *     shows once only.
 * The tick starts as the desktop's suggestion, except that a login item the computer's own startup settings switched
 * off starts unticked (fix round 2): one Save never undoes the owner's own no there.
 * Shown only while asksStartAtLogin holds; a preview, the web and the hosted app have no start at login, and a
 * computer that answered keeps its answer (it is changed in Business > Notifications).
 */
export function StartAtLogin({ place, onChoice }: { place: 'first-run' | 'today'; onChoice?: (startAtLogin: boolean | null) => void }) {
  const t = useT();
  const client = useEngine();
  const hintId = useId();
  const [ticked, setTicked] = useState<boolean | null>(null);
  const [shown, setShown] = useState<BackgroundStateLite | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    client.getBackground?.().then((state) => {
      if (!live || !asksStartAtLogin(state)) return;
      const start = state.systemOff ? false : state.startAtLogin;
      setShown(state);
      setTicked(start);
      onChoice?.(start);
    }, () => { /* Not readable: nothing is asked, and nothing is registered. */ });
    return () => { live = false; };
  }, [client, onChoice]);

  /** Save answers with the tick; Not now (later) answers by keeping the computer as it is. */
  async function save(later = false) {
    if (ticked === null || busy || !client.setBackground || !shown) return;
    setBusy(true);
    setProblem(null);
    try {
      await client.setBackground(later ? { keepRunning: shown.keepRunning } : { startAtLogin: ticked });
      setTicked(null);
    } catch (error) {
      setProblem(t('business.notify.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  if (ticked === null) return null;
  return (
    <div className={s.ask} data-start-at-login={place}>
      <label className={s.choice}>
        <input type="checkbox" checked={ticked} disabled={busy} aria-describedby={hintId} onChange={(event) => { const next = event.currentTarget.checked; setTicked(next); onChoice?.(next); }} />
        {t('first-run.login.label')}
      </label>
      <p id={hintId} className={s.hint}>{t('first-run.login.hint')}</p>
      {place === 'today' && (
        <span className={s.buttons}>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void save()}>{t('first-run.login.save')}</Button>
          <Button variant="quiet" size="sm" disabled={busy} onClick={() => void save(true)}>{t('first-run.login.later')}</Button>
        </span>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}
