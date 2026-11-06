import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { MotionPreferenceLite } from '../../engine/types';
import { applyMotionPreference } from '../../shell/motionPreference';
import { BuildLine } from './BuildLine';
import { LanguageSetting } from './LanguageSetting';
import { TileSection } from './shared';
import s from './ThisAppView.module.css';

/**
 * Settings, This app (one-shot C3 task 3): how Chausar itself behaves on this computer, the same for every business.
 * Animations follow this computer's own reduce-motion setting, or are off. The choice is the app's preference
 * (app.preferences, kept beside the businesses, not in one), and it applies at once: <html data-motion="off"> sets every
 * motion time to 0 (tokens/motion.css) and parts/motion.ts stops the moves made in code. The language (C5 task 36) and
 * the build line (C4 task 41) are here too.
 */
export function ThisAppView() {
  const t = useT();
  const client = useEngine();
  const name = useId();
  const legend = useId();
  const kept = useResource('app.preferences.get', {});
  const [chosen, setChosen] = useState<MotionPreferenceLite | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const motion = chosen ?? kept.data?.motion ?? (kept.error ? 'system' : null);

  async function choose(next: MotionPreferenceLite) {
    const before = motion;
    setChosen(next);
    setProblem(null);
    applyMotionPreference(next);
    try {
      const answer = await client.request('app.preferences.set', { motion: next });
      setChosen(answer.motion);
      applyMotionPreference(answer.motion);
    } catch (error) {
      setChosen(before);
      if (before) applyMotionPreference(before);
      setProblem(messageOf(error));
    }
  }

  const options: { id: MotionPreferenceLite; label: string }[] = [
    { id: 'system', label: t('business.app.motion.system') },
    { id: 'off', label: t('business.app.motion.off') },
  ];
  return (
    <>
      <TileSection title={t('business.app.motion')}>
        <fieldset className={s.group} role="radiogroup" aria-labelledby={legend} data-app-motion="">
          <legend id={legend} className="sr-only">{t('business.app.motion')}</legend>
          {options.map((option) => (
            <label key={option.id} className={s.choice}>
              <input type="radio" name={name} value={option.id} checked={motion === option.id} disabled={motion === null}
                onChange={() => void choose(option.id)} /> {option.label}
            </label>
          ))}
        </fieldset>
        <p className={s.line}>{t('business.app.motion.line')}</p>
        {problem && <p role="alert" className={s.problem}>{problem}</p>}
      </TileSection>
      <LanguageSetting />
      <BuildLine />
    </>
  );
}
