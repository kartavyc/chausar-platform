import { useEffect, useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import s from './StartAtLogin.module.css';

/**
 * Start at login in the first run (one-shot A5, founder answer 5: asked in onboarding, ticked by default). Shown on
 * the services step only in the installed app (the desktop says it is supported) and only while this computer has no
 * answer yet; a preview, the web and the hosted app have no start at login, and a computer that answered keeps its
 * answer (it is changed in Business > Notifications). The tick starts as the desktop's suggestion. Nothing is
 * registered here: onChoice hands the tick to the first run, which saves it when the owner leaves the step.
 */
export function StartAtLogin({ onChoice }: { onChoice: (startAtLogin: boolean | null) => void }) {
  const t = useT();
  const client = useEngine();
  const hintId = useId();
  const [ticked, setTicked] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    client.getBackground?.().then((state) => {
      if (!live || !state.supported || state.asked) return;
      setTicked(state.startAtLogin);
      onChoice(state.startAtLogin);
    }, () => { /* Not readable: nothing is asked, and nothing is registered. */ });
    return () => { live = false; };
  }, [client, onChoice]);

  if (ticked === null) return null;
  return (
    <div className={s.ask}>
      <label className={s.choice}>
        <input type="checkbox" checked={ticked} aria-describedby={hintId} onChange={(event) => { const next = event.currentTarget.checked; setTicked(next); onChoice(next); }} />
        {t('first-run.login.label')}
      </label>
      <p id={hintId} className={s.hint}>{t('first-run.login.hint')}</p>
    </div>
  );
}
