import { useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { ComplianceCheck, type ComplianceAnswer } from '../../parts/ComplianceCheck';
import { TileSection, messageOf } from './shared';
import b from './Business.module.css';
import s from './ProfessionSetting.module.css';

/**
 * Business > About you, the owner's profession (one-shot A5, founder answer 3a: confirmed in onboarding's "Which of these
 * are you?", changeable here). It names the profession the business's rules follow (venture.compliance.get), or says
 * none is picked yet (a business that kept only its field, or none). Change lists every profession by field, in the
 * engine's order (venture.about.families), then the same rules check onboarding shows, for the one picked: its own
 * rules, switch-offs, hard stops and, when a rule counts it, the size. That check hands its answer back, and this
 * records it all or nothing (record): the field first when it changed (venture.owner.set { familyId }, which keeps
 * Connections' list in step), then the profession and side-work answer (venture.compliance.set). onChanged lets the
 * page read the size again. Every rule word is the engine's.
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
  /** A5 fix round 2: a second press while one write is on its way sends nothing. */
  const writing = useRef(false);
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

  /**
   * A5 fix round 1: all or nothing. The field goes first; if it fails nothing is recorded. Then the profession and the
   * side-work answer; if that fails, the field is put back, so the two never disagree. Fix round 2: the field kept or
   * put back is the owner's own (venture.owner.get), also when no profession is recorded yet; one write at a time.
   */
  async function record(answer: ComplianceAnswer) {
    if (writing.current) return;
    writing.current = true;
    try {
      const family = familyOf(answer.profession);
      const before = (await client.request('venture.owner.get', {})).familyId ?? null;
      const moves = family !== null && family !== before;
      setProblem(null);
      try {
        if (moves) await client.request('venture.owner.set', { familyId: family });
      } catch (error) {
        setProblem(messageOf(error));
        return;
      }
      try {
        await client.request('venture.compliance.set', { profession: answer.profession, sideWork: answer.sideWork, digest: answer.digest, ...(answer.size ? { size: answer.size } : {}) });
      } catch (error) {
        if (moves) await client.request('venture.owner.set', { familyId: before }).catch(() => undefined);
        setProblem(messageOf(error));
        return;
      }
      setSaid(true);
      setOpen(false);
      view.reload();
      onChanged?.();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      writing.current = false;
    }
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
          {picked && picked !== current && <ComplianceCheck key={picked} profession={picked} record={false} onDone={(answer) => void record(answer)} />}
          <span className={b.buttons}>
            <Button variant="quiet" onClick={() => setOpen(false)}>{t('business.profession.cancel')}</Button>
          </span>
        </div>
      )}
    </TileSection>
  );
}
