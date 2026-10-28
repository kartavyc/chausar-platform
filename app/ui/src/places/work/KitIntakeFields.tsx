// Chausar kit order questions (5M). Original controls for the engine-provided intake schema; no outside source.
import { useId } from 'react';
import { useT } from '../../text';
import { kitIntakeWords } from './kit-intake-words';
import { useResource } from '../../engine/context';
import { Field } from '../../parts/Field';
import { Button } from '../../parts/Button';
import type { OfferIntakeLite } from '../../engine/types';
import { KIT_FILE_ACCEPT, isKitFile, kitFileProblem, type KitAnswers, type KitPerson } from './kit-intake';
import s from './Work.module.css';
/** The selected service alone supplies the questions. Every value remains owner input, with no UI money arithmetic. */
export function KitIntakeFields({ ask, answers, onChange }: { ask: OfferIntakeLite | null; answers: KitAnswers; onChange: (answers: KitAnswers) => void }) {
  const t = useT();
  const id = useId();
  const consents = useResource('venture.voiceConsent.list', {}, { skip: !ask?.kit?.some(field => field.kind === 'people') });
  const currentConsents = consents.data?.consents.filter(consent => consent.state === 'current') ?? [];
  const put = (key: string, value: string | boolean | KitPerson[] | File) => onChange({ ...answers, [key]: value });
  return <>{(ask?.kit ?? []).filter(field => field.kind !== 'rights').map(field => {
    const value = answers[field.id];
    const label = kitIntakeWords(t, field.label), help = kitIntakeWords(t, field.help);
    const inputId = `${id}-${field.id}`;
    if (field.kind === 'list' && field.options?.length) {
      const selected=typeof value==='string'?value.split('\n').filter(Boolean):[];
      return <fieldset className={s.group} key={field.id}><legend className={s.label}>{label}</legend><p className={s.hint}>{help}</p>{field.options.map(option=><label key={option} className={s.choice}><input type="checkbox" checked={selected.includes(option)} onChange={event=>put(field.id,(event.currentTarget.checked?[...selected,option]:selected.filter(item=>item!==option)).join('\n'))}/><span>{kitIntakeWords(t,option)}</span></label>)}</fieldset>;
    }
    if (field.id === 'questions' && ask?.kit?.some(item=>item.id==='incomeKinds')) return <details key={field.id}><summary>{label}</summary><Field multiline label={label} hint={help} value={typeof value==='string'?value:''} maxLength={2000} onChange={event=>put(field.id,event.currentTarget.value)}/></details>;
    if (field.kind === 'consent') return <div className={s.field} key={field.id}>
      <label className={s.choice}><input type="checkbox" checked={value === true} onChange={event => put(field.id, event.currentTarget.checked)} aria-describedby={`${inputId}-help`} /><span>{label}</span></label>
      <p id={`${inputId}-help`} className={s.hint}>{help}</p>
    </div>;
    if (field.kind === 'choice' || field.kind === 'yes-no') return <div className={s.field} key={field.id}>
      <label className={s.label} htmlFor={inputId}>{label}</label>
      <select id={inputId} className={s.select} aria-describedby={`${inputId}-help`} value={typeof value === 'boolean' ? value ? 'yes' : 'no' : typeof value === 'string' ? value : ''} onChange={event => put(field.id, field.kind === 'yes-no' && event.currentTarget.value !== '' ? event.currentTarget.value === 'yes' : event.currentTarget.value)}>
        <option value="">{t('kit-intake.choose')}</option>
        {field.kind === 'yes-no' ? <><option value="yes">{t('kit-intake.yes')}</option><option value="no">{t('kit-intake.no')}</option></> : field.options?.map(option => <option key={option} value={option}>{kitIntakeWords(t, option)}</option>)}
      </select><p id={`${inputId}-help`} className={s.hint}>{help}</p>
    </div>;
    if (field.kind === 'people') {
      const people = Array.isArray(value) ? value : [];
      return <fieldset className={s.group} key={field.id}><legend className={s.label}>{label}</legend><p className={s.hint}>{help}</p><p id={inputId + '-consent-help'} className={s.hint}>{t('kit-intake.consentHint')}</p>
        {people.map((person, index) => <div className={s.form} key={index}>
          <div className={s.field}>
            <label className={s.label} htmlFor={inputId + '-' + index}>{t('kit-intake.consent')}</label>
            <select className={s.select} id={inputId + '-' + index} value={person.consentId ?? ''} aria-describedby={inputId + '-consent-help'} onChange={event => {
              const consent = currentConsents.find(item => item.id === event.currentTarget.value);
              put(field.id, people.map((item, at) => at === index ? { name: consent?.speaker ?? '', consentId: consent?.id ?? null } : item));
            }}><option value="">{t('kit-intake.choose')}</option>{currentConsents.map(consent => <option key={consent.id} value={consent.id}>{consent.speaker}</option>)}</select>
          </div>
          <Button onClick={() => put(field.id, people.filter((_, at) => at !== index))}>{t('kit-intake.remove')}</Button>
        </div>)}<Button onClick={() => put(field.id, [...people, { name: '', consentId: null }])}>{t('kit-intake.addPerson')}</Button>
      </fieldset>;
    }
    if (field.kind === 'file') {
      const problem = isKitFile(value) ? kitFileProblem(value) : null;
      return <div className={s.field} key={field.id}>
        <label className={s.label} htmlFor={inputId}>{label}</label>
        <input id={inputId} className={s.file} type="file" accept={KIT_FILE_ACCEPT} aria-describedby={inputId + '-file-help'} onChange={event => put(field.id, event.currentTarget.files?.[0] ?? '')} />
        <p id={inputId + '-file-help'} className={s.hint}>{help} {t('kit-intake.fileHint')}</p>
        {problem && <p className={s.problem} role="status">{t('kit-intake.fileError')}</p>}
      </div>;
    }
    const hint = field.kind === 'money' ? `${help} ${t('kit-intake.rupees')}` : help;
    return field.kind === 'list'
      ? <Field key={field.id} multiline label={label} hint={hint} value={typeof value === 'string' ? value : ''} maxLength={10000} onChange={event => put(field.id, event.currentTarget.value)} />
      : <Field key={field.id} label={label} hint={hint} type={field.kind === 'date' ? 'date' : 'text'} inputMode={field.kind === 'money' ? 'decimal' : 'text'} value={typeof value === 'string' ? value : ''} maxLength={2000} onChange={event => put(field.id, event.currentTarget.value)} />;
  })}</>;
}
