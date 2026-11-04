import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { ComplianceCheck } from '../../parts/ComplianceCheck';
import { TileSection, messageOf } from './shared';
import b from './Business.module.css';
import s from './ProfessionSetting.module.css';

/**
 * Business > About you, the owner's profession (one-shot A5, founder answer 3a: confirmed in onboarding's "Which of these
 * are you?", changeable here). It names the profession the business's rules follow (venture.compliance.get), or says
 * none is picked yet (a business that kept only its field, or none). Change lists every profession by field, in the
 * engine's order (venture.about.families), then the same rules check onboarding shows, for the one picked: its own
 * rules, switch-offs, hard stops and, when a rule counts it, the size. That check's Continue records the profession
 * and the side-work answer (venture.compliance.set); when the field changed too, venture.owner.set { familyId } keeps
 * Connections' list in step. onChanged lets the page read the size again. Every rule word is the engine's.
 */
export function ProfessionSetting({ onChanged }: { onChanged?: () => void }) {
  const t = useT();
  const client = useEngine();
  const id = useId();
  const view = useResource('venture.compliance.get', {});
  const families = useResource('venture.about.families', {});
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const [said, setSaid] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const data = view.data;
  // The engine answers "Choose a profession" when nothing is recorded: that is "not picked yet", not a failure.
  const none = !data && view.error?.code === 'INVALID_VENTURE_REQUEST';
  const fieldOnly = data ? data.profession.id === data.profession.family : false;
  const current = data && !fieldOnly ? data.profession.id : '';
  const familyOf = (profession: string) => families.data?.families.find((tile) => tile.professions.some((item) => item.id === profession))?.id ?? null;

  function start() {
    setOpen(true);
    setPicked(current);
    setSaid(false);
    setProblem(null);
  }

  async function recorded(profession: string) {
    const family = familyOf(profession);
    try {
      if (family && family !== data?.profession.family) await client.request('venture.owner.set', { familyId: family });
      setSaid(true);
    } catch (error) {
      setProblem(messageOf(error));
    }
    setOpen(false);
    view.reload();
    onChanged?.();
  }

  if (view.error && !data && !none) return <TileSection title={t('business.profession.title')}><p className={b.problem} role="alert">{messageOf(view.error)}</p></TileSection>;
  if (!data && !none) return null;
  return (
    <TileSection title={t('business.profession.title')}>
      {data && !fieldOnly && <p className={b.line}>{data.profession.label}</p>}
      {data && fieldOnly && <p className={b.line}>{t('business.profession.field', { field: data.profession.label })}</p>}
      {none && <p className={b.line}>{t('business.profession.none')}</p>}
      {said && <p className={b.said} role="status">{t('business.profession.saved')}</p>}
      {problem && <p className={b.problem} role="alert">{problem}</p>}
      {!open && (
        <span className={b.buttons}>
          <Button variant="secondary" onClick={start}>{current ? t('business.profession.change') : t('business.profession.pick')}</Button>
        </span>
      )}
      {open && (
        <div className={s.change}>
          <div className={s.choice}>
            <label className={s.label} htmlFor={id}>{t('business.profession.label')}</label>
            <select id={id} className={s.select} value={picked} onChange={(event) => setPicked(event.currentTarget.value)}>
              <option value="">{t('business.profession.choose')}</option>
              {(families.data?.families ?? []).map((tile) => (
                <optgroup key={tile.id} label={tile.label}>
                  {tile.professions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </optgroup>
              ))}
            </select>
            <p className={b.note}>{t('business.profession.hint')}</p>
          </div>
          {families.error && <p className={b.problem} role="alert">{messageOf(families.error)}</p>}
          {picked && picked !== current && <ComplianceCheck key={picked} profession={picked} onDone={(answer) => void recorded(answer.profession)} />}
          <span className={b.buttons}>
            <Button variant="quiet" onClick={() => setOpen(false)}>{t('business.profession.cancel')}</Button>
          </span>
        </div>
      )}
    </TileSection>
  );
}
