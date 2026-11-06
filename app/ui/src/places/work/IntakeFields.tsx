import { useId } from 'react';
import { useT } from '../../text';
import { Field } from '../../parts/Field';
import type { OfferIntakeLite } from '../../engine/types';
import { basisFor, CALENDAR_CHANNELS, RULE_LISTS, WEEKDAYS, type IntakeDraft } from './intake';
import s from './Work.module.css';

const FLAGS = ['aiVoice', 'aiPresenter', 'paidPromotion'] as const;

/** The list with the item in it when on, without it when off. */
function toggled<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...list.filter((value) => value !== item), item] : list.filter((value) => value !== item);
}

/**
 * The intake questions for the chosen offer, in the New order sheet: whose footage it is, on the bases the offer
 * accepts (a licence or a clip programme with its reference), then what the playbook's checks read. A social content
 * calendar asks for its month, channels, posts per channel and posting days (the engine plans the dated slots), and a
 * social offer for the client's own word lists. Nothing shows for an offer that asks nothing.
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
      {ask.fields.includes('calendar') && (
        <fieldset className={s.group} aria-describedby={`${id}-calendar-hint`}>
          <legend className={s.label}>{t('work.intake.calendar')}</legend>
          <p id={`${id}-calendar-hint`} className={s.hint}>{t('work.intake.calendar.hint')}</p>
          <Field
            label={t('work.intake.calendar.month')} hint={t('work.intake.calendar.monthHint')} value={draft.month} maxLength={7} autoComplete="off" inputMode="numeric"
            onChange={(event) => onChange({ ...draft, month: event.currentTarget.value })}
          />
          <fieldset className={s.group}>
            <legend className={s.label}>{t('work.intake.calendar.channels')}</legend>
            <div className={s.choices}>
              {CALENDAR_CHANNELS.map((channel) => (
                <label key={channel} className={s.choice}>
                  <input type="checkbox" checked={draft.channels.includes(channel)} onChange={(event) => onChange({ ...draft, channels: toggled(draft.channels, channel, event.currentTarget.checked) })} />
                  <span>{t(`work.intake.channel.${channel}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field
            label={t('work.intake.calendar.posts')} value={draft.postsPerChannel} maxLength={2} autoComplete="off" inputMode="numeric"
            onChange={(event) => onChange({ ...draft, postsPerChannel: event.currentTarget.value })}
          />
          <fieldset className={s.group}>
            <legend className={s.label}>{t('work.intake.calendar.weekdays')}</legend>
            <div className={s.choices}>
              {WEEKDAYS.map((day) => (
                <label key={day} className={s.choice}>
                  <input type="checkbox" checked={draft.weekdays.includes(day)} onChange={(event) => onChange({ ...draft, weekdays: toggled(draft.weekdays, day, event.currentTarget.checked) })} />
                  <span>{t(`work.intake.weekday.${day}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
      )}
      {ask.fields.includes('clientRules') && (
        <fieldset className={s.group} aria-describedby={`${id}-rules-hint`}>
          <legend className={s.label}>{t('work.intake.rules')}</legend>
          {RULE_LISTS.map((list) => (
            <Field
              key={list} label={t(`work.intake.rules.${list}`)} value={draft.rules[list]} maxLength={2000} autoComplete="off"
              onChange={(event) => onChange({ ...draft, rules: { ...draft.rules, [list]: event.currentTarget.value } })}
            />
          ))}
          <p id={`${id}-rules-hint`} className={s.hint}>{t('work.intake.rulesHint')}</p>
        </fieldset>
      )}
    </>
  );
}
