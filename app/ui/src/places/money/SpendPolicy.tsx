/**
 * The owner's spend settings (venture.spend.policy.get and .set): a monthly limit across every paid call, a figure
 * above which a call waits for the owner, and the owner's own rate card. At rest it is the engine's words for each and
 * one quiet Change. Changing them asks a second time inside the section; keyboard A never confirms it.
 *
 * The engine takes whole micro-dollars (5000000 is 5 US dollars). What the owner types goes to the engine exactly as
 * typed, and an empty field clears that figure (null); the engine checks each figure, says in words what is wrong, and
 * answers with the settings written in its own words. Rate lines that were already on the card go back as they came.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { SpendPolicyView, SpendRateInput, SpendRateLine, SpendRateUnit } from '../../engine/types';
import { Failed, Figure, Section } from './parts';
import { localToday, messageOf, useDay } from './words';
import s from './Money.module.css';

const UNITS: readonly SpendRateUnit[] = ['per-million-tokens', 'per-call', 'per-run-cap'];

/** One rate card line as the owner edits it: every figure is the text in its field. */
interface RateDraft { key: string; item: string; unit: SpendRateUnit; input: string; output: string; perCall: string; source: string; checkedOn: string }

const draftOf = (line: SpendRateLine): RateDraft => ({
  key: `held:${line.item}`, item: line.item, unit: line.unit, input: line.inputMicrosPerMillion ?? '', output: line.outputMicrosPerMillion ?? '',
  perCall: line.microsPerCall ?? '', source: line.source, checkedOn: line.checkedOn,
});

/** The line as the engine takes it: the figures the unit needs, each as typed. */
function inputOf(draft: RateDraft): SpendRateInput {
  const shared = { item: draft.item.trim(), unit: draft.unit, source: draft.source.trim(), checkedOn: draft.checkedOn.trim() };
  return draft.unit === 'per-million-tokens'
    ? { ...shared, inputMicrosPerMillion: draft.input.trim(), outputMicrosPerMillion: draft.output.trim() }
    : { ...shared, microsPerCall: draft.perCall.trim() };
}

/** A typed figure, or null when the field was left empty (no limit, never ask first). */
const figureOrNull = (typed: string): string | null => (typed.trim() === '' ? null : typed.trim());

export function SpendPolicy() {
  const t = useT();
  const day = useDay();
  const engine = useEngine();
  const policy = useResource('venture.spend.policy.get', {}, { refreshOn: () => false });
  // The engine's answer to a save, shown until the settings are read again.
  const [saved, setSaved] = useState<SpendPolicyView | null>(null);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [cap, setCap] = useState('');
  const [askFirst, setAskFirst] = useState('');
  const [rates, setRates] = useState<RateDraft[]>([]);
  useEffect(() => { setSaved(null); }, [policy.data]);

  const view = saved ?? policy.data;

  function edit(current: SpendPolicyView) {
    setCap(current.capMicros ?? '');
    setAskFirst(current.askFirstMicros ?? '');
    setRates(current.rates.map(draftOf));
    setProblem(null);
    setDone(false);
    setAsking(false);
    setEditing(true);
  }

  function change(key: string, patch: Partial<RateDraft>) {
    setRates((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setAsking(false);
  }

  async function save() {
    setSending(true);
    setProblem(null);
    try {
      const reply = await engine.request('venture.spend.policy.set', { cap: figureOrNull(cap), askFirst: figureOrNull(askFirst), rates: rates.map(inputOf) });
      setSaved(reply);
      setEditing(false);
      setDone(true);
    } catch (error) {
      setProblem(t('money.policy.failed', { message: messageOf(error) }));
    } finally {
      setSending(false);
      setAsking(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!sending) { setProblem(null); setAsking(true); }
  }

  return (
    <Section title={t('money.policy.title')}>
      {policy.error && !view && <Failed error={policy.error} />}
      {view && !editing && (
        <>
          <p className={s.figures}>
            <Figure>{view.cap}</Figure>
            <span className={s.dot} aria-hidden="true">·</span>
            <Figure>{view.askFirst}</Figure>
          </p>
          {view.rates.length > 0 && (
            <ul className={s.lines}>
              {view.rates.map((rate) => (
                <li key={rate.item} className={s.line}>
                  <span className={`${s.label} mono`}>{rate.item}</span>
                  <span className={s.value}>
                    <Figure>{rate.price}</Figure>
                    <span className={s.note}>{t('money.policy.rateSource', { source: rate.source, date: day(rate.checkedOn) })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {done && <p className={s.quiet} role="status">{t('money.policy.saved')}</p>}
          <p className={s.sheetLine}>
            <Button variant="quiet" onClick={() => edit(view)}>{t('money.policy.change')}</Button>
          </p>
        </>
      )}
      {view && editing && (
        <form className={s.form} noValidate aria-label={t('money.policy.title')} onSubmit={submit}>
          <Field
            label={t('money.policy.cap')} hint={t('money.policy.capHint')} value={cap} inputMode="numeric" autoComplete="off" disabled={sending}
            onChange={(event) => { setCap(event.currentTarget.value); setAsking(false); }}
          />
          <Field
            label={t('money.policy.askFirst')} hint={t('money.policy.askFirstHint')} value={askFirst} inputMode="numeric" autoComplete="off" disabled={sending}
            onChange={(event) => { setAskFirst(event.currentTarget.value); setAsking(false); }}
          />
          <div className={s.rateCard} role="group" aria-label={t('money.policy.rates')}>
            <p className={s.fieldLabel}>{t('money.policy.rates')}</p>
            {rates.map((rate) => (
              <RateEditor
                key={rate.key} rate={rate} disabled={sending}
                onChange={(patch) => change(rate.key, patch)}
                onRemove={() => { setRates((lines) => lines.filter((line) => line.key !== rate.key)); setAsking(false); }}
              />
            ))}
            <p className={s.sheetLine}>
              <Button
                variant="quiet" disabled={sending}
                onClick={() => setRates((lines) => [...lines, { key: `new:${Date.now()}:${lines.length}`, item: '', unit: 'per-million-tokens', input: '', output: '', perCall: '', source: '', checkedOn: localToday() }])}
              >
                {t('money.policy.addRate')}
              </Button>
            </p>
          </div>
          {problem && <p className={s.refusal} role="alert">{problem}</p>}
          {asking ? (
            <div className={s.ask} data-second-ask="">
              <p>{t('money.policy.ask')}</p>
              <div className={s.buttons}>
                <Button disabled={sending} onClick={() => setAsking(false)}>{t('approval.cancel')}</Button>
                <Button variant="primary" data-confirm="" disabled={sending} onClick={() => void save()}>{t('money.policy.confirm')}</Button>
              </div>
            </div>
          ) : (
            <div className={s.buttons}>
              <Button variant="quiet" disabled={sending} onClick={() => { setEditing(false); setProblem(null); }}>{t('approval.cancel')}</Button>
              <Button variant="primary" type="submit" disabled={sending}>{t('money.policy.save')}</Button>
            </div>
          )}
        </form>
      )}
    </Section>
  );
}

/** One line of the rate card: what it prices, how, the figures that unit needs, where the rate comes from and when. */
function RateEditor({ rate, disabled, onChange, onRemove }: { rate: RateDraft; disabled: boolean; onChange: (patch: Partial<RateDraft>) => void; onRemove: () => void }) {
  const t = useT();
  const unitId = useId();
  const name = rate.item.trim() || t('money.policy.newRate');
  return (
    <div className={s.rateLine} role="group" aria-label={name}>
      <Field label={t('money.policy.item')} hint={t('money.policy.itemHint')} value={rate.item} autoComplete="off" disabled={disabled} onChange={(event) => onChange({ item: event.currentTarget.value })} />
      <div className={s.field}>
        <label htmlFor={unitId} className={s.fieldLabel}>{t('money.policy.unit')}</label>
        <select id={unitId} className={s.select} value={rate.unit} disabled={disabled} onChange={(event) => onChange({ unit: event.currentTarget.value as SpendRateUnit })}>
          {UNITS.map((unit) => <option key={unit} value={unit}>{t(`money.policy.unit.${unit}`)}</option>)}
        </select>
      </div>
      {rate.unit === 'per-million-tokens' ? (
        <>
          <Field label={t('money.policy.input')} hint={t('money.policy.microsHint')} value={rate.input} inputMode="numeric" autoComplete="off" disabled={disabled} onChange={(event) => onChange({ input: event.currentTarget.value })} />
          <Field label={t('money.policy.output')} value={rate.output} inputMode="numeric" autoComplete="off" disabled={disabled} onChange={(event) => onChange({ output: event.currentTarget.value })} />
        </>
      ) : (
        <Field
          label={rate.unit === 'per-call' ? t('money.policy.perCall') : t('money.policy.runCap')} hint={t('money.policy.microsHint')} value={rate.perCall}
          inputMode="numeric" autoComplete="off" disabled={disabled} onChange={(event) => onChange({ perCall: event.currentTarget.value })}
        />
      )}
      <Field label={t('money.policy.source')} value={rate.source} autoComplete="off" disabled={disabled} onChange={(event) => onChange({ source: event.currentTarget.value })} />
      <Field label={t('money.policy.checkedOn')} type="date" value={rate.checkedOn} disabled={disabled} onChange={(event) => onChange({ checkedOn: event.currentTarget.value })} />
      <p className={s.sheetLine}>
        <Button variant="quiet" disabled={disabled} aria-label={t('money.policy.removeLabel', { item: name })} onClick={onRemove}>{t('money.policy.remove')}</Button>
      </p>
    </div>
  );
}
