import { useId } from 'react';
import { useT } from '../../text';
import { Field } from '../../parts/Field';
import type { OfferIntakeLite } from '../../engine/types';
import { basisFor, type IntakeDraft } from './intake';
import s from './Work.module.css';

const FLAGS = ['aiVoice', 'aiPresenter', 'paidPromotion'] as const;

/**
 * The intake questions for the chosen offer, in the New order sheet: whose footage it is, on the bases the offer
 * accepts (a licence or a clip programme with its reference), then what the playbook's checks read. Nothing shows
 * for an offer that asks nothing.
 */
export function IntakeFields({ ask, draft, onChange }: { ask: OfferIntakeLite | null; draft: IntakeDraft; onChange: (next: IntakeDraft) => void }) {
  const t = useT();
  const id = useId();
  if (!ask) return null;
  const basis = basisFor(ask, draft);
  const flags = FLAGS.filter((flag) => ask.fields.includes(flag));
  return (
    <>
      {ask.rights.length > 0 && (
        <>
          <fieldset className={s.group} aria-describedby={`${id}-rights-hint`}>
            <legend className={s.label}>{t('work.intake.rights')}</legend>
            {ask.rights.map((option) => (
              <label key={option} className={s.choice}>
                <input type="radio" name={`${id}-basis`} checked={basis === option} onChange={() => onChange({ ...draft, basis: option })} />
                <span>{t(`work.intake.basis.${option}`)}</span>
              </label>
            ))}
            <p id={`${id}-rights-hint`} className={s.hint}>{t('work.intake.rightsHint')}</p>
          </fieldset>
          <Field label={t('work.intake.holder')} value={draft.holder} maxLength={160} autoComplete="off" onChange={(event) => onChange({ ...draft, holder: event.currentTarget.value })} />
          {basis !== '' && basis !== 'own-footage' && (
            <Field
              label={t(`work.intake.reference.${basis}`)} hint={t(`work.intake.referenceHint.${basis}`)} value={draft.reference} maxLength={300} autoComplete="off"
              onChange={(event) => onChange({ ...draft, reference: event.currentTarget.value })}
            />
          )}
        </>
      )}
      {ask.fields.includes('format') && (
        <fieldset className={s.group}>
          <legend className={s.label}>{t('work.intake.format')}</legend>
          <div className={s.choices}>
            {(['long', 'short'] as const).map((format) => (
              <label key={format} className={s.choice}>
                <input type="radio" name={`${id}-format`} checked={draft.format === format} onChange={() => onChange({ ...draft, format })} />
                <span>{t(`work.intake.format.${format}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {flags.length > 0 && (
        <div className={s.group}>
          {flags.map((flag) => (
            <label key={flag} className={s.choice}>
              <input type="checkbox" checked={draft[flag]} aria-describedby={`${id}-flags-hint`} onChange={(event) => onChange({ ...draft, [flag]: event.currentTarget.checked })} />
              <span>{t(`work.intake.${flag}`)}</span>
            </label>
          ))}
          <p id={`${id}-flags-hint`} className={s.hint}>{t('work.intake.flagsHint')}</p>
        </div>
      )}
      {ask.fields.includes('cutFile') && (
        <Field label={t('work.intake.cut')} hint={t('work.intake.cutHint')} value={draft.cutFile} maxLength={500} autoComplete="off" onChange={(event) => onChange({ ...draft, cutFile: event.currentTarget.value })} />
      )}
    </>
  );
}
