import { messageOf } from '../../../../../platform/shared/errors.ts';
import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { SizePicker, savedSize } from '../../parts/SizePicker';
import type { SizeAnswersLite } from '../../engine/types';
import { TileSection } from './shared';
import { ResultLine } from '../../parts/ResultLine';
import b from './Business.module.css';
import s from './SizeSetting.module.css';

/**
 * Business > About you, the business's size (W6, founder decisions of 3 November 2026). Shown only when the engine sends
 * a size question for the business's recorded profession, that is when one of its rules counts size: the same ranges as
 * onboarding (SizePicker), each sized rule with the engine's verdict (following the pick, as a preview), and Save size,
 * which sends venture.compliance.set { size } and changes nothing else. Every rule word is the engine's.
 */
export function SizeSetting() {
  const t = useT();
  const client = useEngine();
  const [picked, setPicked] = useState<SizeAnswersLite | null>(null);
  const view = useResource('venture.compliance.get', picked ? { size: picked } : {});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState(false);
  const data = view.data;
  if (!data?.size) return null;
  const ask = data.size;
  const value = picked ?? savedSize(ask);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setSaid(false);
    try {
      await client.request('venture.compliance.set', { size: value });
      setPicked(null);
      setSaid(true);
      view.reload();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const sized = data.rules.filter((rule) => rule.verdict);
  return (
    <TileSection title={t('business.size.title')}>
      <form className={s.form} onSubmit={(event) => void save(event)} noValidate>
        <SizePicker ask={ask} value={value} disabled={busy} onChange={(next) => { setPicked(next); setSaid(false); setProblem(null); }} />
        {sized.length > 0 && (
          <ul className={s.rules}>
            {sized.map((rule) => (
              <li key={rule.id} data-size-rule={rule.id}>
                <span className={s.title}>{rule.title}</span>
                <span className={s.verdict}>{rule.verdict}</span>
              </li>
            ))}
          </ul>
        )}
        <ResultLine tone={problem ? 'problem' : 'done'}>{problem ?? (said ? t('business.size.saved') : null)}</ResultLine>
        <span className={b.buttons}>
          <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>{t('business.size.save')}</Button>
        </span>
      </form>
    </TileSection>
  );
}
