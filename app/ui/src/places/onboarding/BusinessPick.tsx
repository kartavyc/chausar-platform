import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { EngineError, type PlanSuggestionView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import s from './BusinessPick.module.css';

export type Target = 'new' | 'add';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The business picker under the one-sentence box (W4 4J21; founder decision): with a business open, the sentence can
 * "Start a new business" (the page's own flow) or "Add this to {business}", which asks venture.blueprint.suggest for a
 * plan change the owner applies. Two choices as one radio group; a new business is the page's first answer.
 */
export function BusinessPick({ business, target, onTarget, disabled }: { business: string; target: Target; onTarget: (target: Target) => void; disabled: boolean }) {
  const t = useT();
  const name = useId();
  return (
    <fieldset className={s.pick} disabled={disabled} data-business-pick="">
      <legend className="sr-only">{t('onboarding.ways.where')}</legend>
      {(['new', 'add'] as const).map((id) => (
        <label key={id} className={s.choice} data-on={target === id ? '' : undefined}>
          <input type="radio" className={s.radio} name={name} value={id} checked={target === id} onChange={() => onTarget(id)} />
          <span>{id === 'new' ? t('onboarding.ways.new') : t('onboarding.ways.add', { business })}</span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The plan change Chausar suggests for the open business (venture.blueprint.suggest, 4J8), before anything changes:
 * each change as before and after in the plan's own words, what was left out of a dropped file and why, and the
 * engine's line on what a suggestion can do (it rewords the plan and may add one offer, never a price). Apply sends
 * the patch to venture.blueprint.update with the plan it was based on, so a plan that changed meanwhile is refused;
 * the new version then waits on Today to be accepted. Nothing here writes a price or a number.
 */
export function Suggestion({ suggestion, business, onClose, onAgain }: { suggestion: PlanSuggestionView; business: string; onClose: () => void; onAgain: () => void }) {
  const t = useT();
  const client = useEngine();
  const headingId = useId();
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The plan changed since this was suggested (APPROVAL_STALE): this patch can't apply; only a new suggestion can.
  const [stale, setStale] = useState(false);
  const patch = suggestion.patch;

  async function apply() {
    if (!patch) return;
    setBusy(true);
    setProblem(null);
    try {
      await client.request('venture.blueprint.update', { patch, basedOn: suggestion.basedOn });
      setApplied(true);
    } catch (error) {
      if (error instanceof EngineError && error.code === 'APPROVAL_STALE') setStale(true);
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.suggestion} aria-labelledby={headingId} data-suggestion="">
      <h3 id={headingId} className={s.title}>{t('onboarding.ways.changesFor', { business })}</h3>
      <p className={s.line}>{suggestion.line}</p>
      {suggestion.attachment && !suggestion.attachment.used && suggestion.attachment.line && (
        <p className={s.left} role="status" data-attachment-left=""><Icon name="triangle-alert" size={16} />{suggestion.attachment.line}</p>
      )}
      {suggestion.changes.length > 0 && (
        <ul className={s.changes}>
          {suggestion.changes.map((change, index) => (
            <li key={`${change.field}-${change.offerId ?? index}`} className={s.change} data-change={change.field}>
              <p className={s.what}>{t(`onboarding.ways.field.${change.field}`)}</p>
              {change.field === 'offer-added' ? (
                // The engine's own line for a new offer: its name, description and how it is charged, never a price.
                <p className={s.after} data-content="">{change.line}</p>
              ) : (
                <>
                  {change.before && <p className={s.before} data-content=""><span className="sr-only">{t('onboarding.ways.before')} </span>{change.before}</p>}
                  <p className={s.after} data-content=""><span className="sr-only">{t('onboarding.ways.after')} </span>{change.after}</p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className={s.note}>{suggestion.left}</p>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      {applied ? (
        <p className={s.done} role="status">
          <Icon name="check" size={16} />
          <span>{t('onboarding.ways.applied')}</span>
          <a className={s.link} href="#/today">{t('onboarding.ways.toToday')}</a>
        </p>
      ) : (
        <div className={s.actions}>
          {stale
            ? <Button variant="primary" onClick={onAgain}>{t('onboarding.ways.again')}</Button>
            : patch && <Button variant="primary" disabled={busy} aria-busy={busy || undefined} onClick={() => void apply()}>{t('onboarding.ways.apply')}</Button>}
          <Button variant="quiet" disabled={busy} onClick={onClose}>{t('onboarding.ways.notNow')}</Button>
        </div>
      )}
    </section>
  );
}
