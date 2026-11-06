import { messageOf } from '../../../../../platform/shared/errors.ts';
/**
 * The owner's spend settings (venture.spend.policy.get and .set): a monthly limit across every paid call, a figure
 * above which a call waits for the owner, and the owner's own rate card. At rest it is the engine's words for each and
 * one quiet Change. Changing them asks a second time inside the section; keyboard A never confirms it.
 *
 * Every figure is typed in US dollars, which is what the AI providers bill, like 20 or 12.50 (rates take up to six
 * decimals). What the owner types goes to the engine exactly as typed, and an empty field clears that figure (null);
 * the engine converts it, checks it, says in words what is wrong, and answers with the settings written in its own
 * words. Rate lines that were already on the card go back as the engine gave them, in dollars.
 *
 * The owner may also set their own rate of rupees per US dollar. Spend is still counted in dollars; with a rate, the
 * engine gives the limits (and every spend figure) in rupees too, with that rate and the day it was set, beside them.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { setQuery, useRoute } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Icon } from '../../parts/Icon';
import type { CurrencyLead, SpendPolicyView, SpendRateInput, SpendRateLine, SpendRateUnit } from '../../engine/types';
import { EngineWords, Failed, Rupees, Section } from './parts';
import { useDay, useLocalToday } from './words';
import { DraftRecover, DraftWord, useSettingsDraft } from '../business/settingsDraft';
// 4Z3: the rate said once per page (4A2's rule), on its own line; the limits show only their rupee amounts.
import { withoutRate } from '../team/departments';
import s from './Money.module.css';
import sLocal from './SpendPolicy.module.css';
import { Select } from '../../parts/Select';

const UNITS: readonly SpendRateUnit[] = ['per-million-tokens', 'per-call', 'per-run-cap'];
/** 4Z3: which currency leads AI spend: Auto (by where the business is), rupees first or dollars first. */
const LEADS: readonly CurrencyLead[] = ['auto', 'inr', 'usd'];

/** One rate card line as the owner edits it: every figure is the text in its field. */
interface RateDraft { key: string; item: string; model: string; unit: SpendRateUnit; input: string; output: string; cacheRead: string; cacheWrite: string; perCall: string; source: string; checkedOn: string }

const draftOf = (line: SpendRateLine): RateDraft => ({
  key: `held:${line.item}`, item: line.item, unit: line.unit, input: line.inputUsdPerMillion ?? '', output: line.outputUsdPerMillion ?? '',
  perCall: line.usdPerCall ?? '', source: line.source, checkedOn: line.checkedOn,
  model: line.model ?? '', cacheRead: line.cacheReadUsdPerMillion ?? '', cacheWrite: line.cacheWriteUsdPerMillion ?? '',
});

/** The line as the engine takes it: the figures the unit needs, each in US dollars as typed. */
function inputOf(draft: RateDraft): SpendRateInput {
  const shared = { item: draft.item.trim(), unit: draft.unit, source: draft.source.trim(), checkedOn: draft.checkedOn.trim() };
  return draft.unit === 'per-million-tokens'
    ? { ...shared, ...(draft.model.trim() ? { model: draft.model.trim() } : {}), inputUsdPerMillion: draft.input.trim(), outputUsdPerMillion: draft.output.trim(),
      ...(draft.cacheRead.trim() ? { cacheReadUsdPerMillion: draft.cacheRead.trim() } : {}), ...(draft.cacheWrite.trim() ? { cacheWriteUsdPerMillion: draft.cacheWrite.trim() } : {}) }
    : { ...shared, usdPerCall: draft.perCall.trim() };
}

/** A typed figure, or null when the field was left empty (no limit, never ask first). */
const figureOrNull = (typed: string): string | null => (typed.trim() === '' ? null : typed.trim());

/** onSaved (4Z3): the settings were saved, so the figures on the page that follow them are read again at once. */
export function SpendPolicy({ onSaved }: { onSaved?: (() => void) | undefined } = {}) {
  const t = useT();
  const day = useDay();
  const today = useLocalToday();
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
  const [inrPerUsd, setInrPerUsd] = useState('');
  const [lead, setLead] = useState<CurrencyLead>('auto');
  const [rates, setRates] = useState<RateDraft[]>([]);
  const leadId = useId();
  useEffect(() => { setSaved(null); }, [policy.data]);
  // C4 (T23): "Set a rupee rate" lands here with the settings open on the rate; the address is cleared so the link works again.
  const wantsRate = useRoute().query.set === 'rate';
  const current = policy.data;
  useEffect(() => {
    if (!wantsRate || !current) return;
    edit(current);
    setQuery({});
  }, [wantsRate, current]);
  // W4 4J21: the edits, kept as a draft of exactly what venture.spend.policy.set takes, and offered back.
  const [touched, setTouched] = useState(false);
  const values = { capUsd: figureOrNull(cap), askFirstUsd: figureOrNull(askFirst), inrPerUsd: figureOrNull(inrPerUsd), currencyLead: lead, rates: rates.map(inputOf) };
  const draft = useSettingsDraft<typeof values>('spend-policy', values, editing && touched);

  const view = saved ?? policy.data;

  function edit(current: SpendPolicyView) {
    setCap(current.capUsd ?? '');
    setAskFirst(current.askFirstUsd ?? '');
    setInrPerUsd(current.inrPerUsd ?? '');
    setLead(current.currencyLead ?? 'auto');
    setRates(current.rates.map(draftOf));
    setProblem(null);
    setDone(false);
    setAsking(false);
    setEditing(true);
  }

  function change(key: string, patch: Partial<RateDraft>) {
    setRates((lines) => lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setAsking(false);
    setTouched(true);
  }

  /** A draft left behind, back in the form: the figures as they were typed and each rate line as it was. */
  function recover(current: SpendPolicyView, kept: typeof values) {
    edit(current);
    setCap(kept.capUsd ?? '');
    setAskFirst(kept.askFirstUsd ?? '');
    setInrPerUsd(kept.inrPerUsd ?? '');
    setLead(LEADS.includes(kept.currencyLead) ? kept.currencyLead : 'auto');
    setRates(kept.rates.map((rate, index) => ({
      key: `kept:${index}`, item: rate.item, unit: rate.unit, input: rate.inputUsdPerMillion ?? '', output: rate.outputUsdPerMillion ?? '',
      perCall: rate.usdPerCall ?? '', source: rate.source, checkedOn: rate.checkedOn,
      model: rate.model ?? '', cacheRead: rate.cacheReadUsdPerMillion ?? '', cacheWrite: rate.cacheWriteUsdPerMillion ?? '',
    })));
    setTouched(true);
    draft.taken();
  }

  async function takeReference() {
    setSending(true);
    setProblem(null);
    try {
      const reply = await engine.request('venture.spend.policy.set', { useReference: true });
      setSaved(reply);
      onSaved?.();
      setEditing(false);
      setTouched(false);
    } catch (error) {
      setProblem(t('money.failed', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setSending(false);
    }
  }

  async function save() {
    setSending(true);
    setProblem(null);
    try {
      const reply = await engine.request('venture.spend.policy.set', values);
      setSaved(reply);
      // 4Z3: the engine sends no event for a settings change, so the page reads its spend again now.
      onSaved?.();
      setEditing(false);
      setTouched(false);
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
      {view && !editing && draft.offer && <DraftRecover offer={draft.offer} onRecover={(kept) => recover(view, kept)} onDecline={draft.decline} />}
      {view && !editing && (
        <>
          <ul className={sLocal.policyLines}>
            {/* The owner's own limits, said back in the engine's sentences ("USD 20.0000 a month"): engine words, in the
                body face, with no receipt of their own. */}
            <li className={sLocal.policyLine}>
              <Icon name="wallet" size={16} />
              <span className={sLocal.policyText}>{view.capLead
                ? <><EngineWords>{view.capLead.figure}</EngineWords><Rupees text={view.capLead.other} /></>
                : <><EngineWords>{view.cap}</EngineWords><Rupees text={view.capRupees && withoutRate(view.capRupees, view.rupeeRate ?? undefined)} /></>}</span>
            </li>
            <li className={sLocal.policyLine}>
              <Icon name="shield-check" size={16} />
              <span className={sLocal.policyText}>{view.askFirstLead
                ? <><EngineWords>{view.askFirstLead.figure}</EngineWords><Rupees text={view.askFirstLead.other} /></>
                : <><EngineWords>{view.askFirst}</EngineWords><Rupees text={view.askFirstRupees && withoutRate(view.askFirstRupees, view.rupeeRate ?? undefined)} /></>}</span>
            </li>
            {view.rupeeRate && (
              <li className={sLocal.policyLine}>
                {/* B2: the rupee icon only while rupees lead the spend. */}
                {view.leads === 'INR' && <Icon name="indian-rupee" size={16} />}
                <span className={sLocal.policyText}><span className={s.figureLabel}>{t('money.policy.inrPerUsd')}</span>{' '}<EngineWords>{view.rupeeRate}</EngineWords></span>
              </li>
            )}
            {/* 4Z3: which currency leads AI spend now, as the engine says (dollars without a rate), and why on Auto. */}
            {view.leads && (
              <li className={sLocal.policyLine} data-shown-first="">
                <Icon name="arrow-left-right" size={16} />
                <span className={sLocal.policyText}>
                  {t('money.policy.shownFirst', { currency: (view.currencyLead ?? 'auto') === 'auto' ? t('money.policy.shownFirst.auto', { currency: t(`money.policy.shownFirst.${view.leads}`) }) : t(`money.policy.shownFirst.${view.leads}`) })}
                </span>
              </li>
            )}
          </ul>
          {view.rates.length > 0 && (
            <>
              <h3 className={s.blockTitle}>{t('money.policy.rates')}</h3>
              <ul className={s.lines}>
                {view.rates.map((rate) => (
                  <li key={rate.item} className={s.line}>
                    <span data-code="" className={`${s.label} mono`}>{rate.item}</span>
                    <span className={s.value}>
                      <EngineWords>{rate.price}</EngineWords>
                      {rate.model && <span className={s.note} data-content="">{rate.model}</span>}
                      <span className={s.note}>{t('money.policy.rateSource', { source: rate.source, date: day(rate.checkedOn) })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {done && <p className={s.quietLine} role="status">{t('money.policy.saved')}</p>}
          <p className={s.sheetLine}>
            <Button variant="quiet" onClick={() => edit(view)}>{t('money.policy.change')}</Button>
          </p>
        </>
      )}
      {view && editing && (
        <form className={s.form} noValidate aria-label={t('money.policy.title')} onSubmit={submit}>
          <Field
            label={t('money.policy.cap')} hint={t('money.policy.capHint')} value={cap} inputMode="decimal" autoComplete="off" disabled={sending}
            onChange={(event) => { setCap(event.currentTarget.value); setAsking(false); setTouched(true); }}
          />
          <Field
            label={t('money.policy.askFirst')} hint={t('money.policy.askFirstHint')} value={askFirst} inputMode="decimal" autoComplete="off" disabled={sending}
            onChange={(event) => { setAskFirst(event.currentTarget.value); setAsking(false); setTouched(true); }}
          />
          {view.reference && (
            <p className={s.sheetLine}>
              {/* C5 task 15: one tap takes the dated figure shipped with this release; the owner can type their own. */}
              <Button variant="quiet" disabled={sending} onClick={() => void takeReference()}>{view.reference.line}</Button>
            </p>
          )}
          <Field
            label={t('money.policy.inrPerUsd')} hint={t('money.policy.inrPerUsdHint')} value={inrPerUsd} inputMode="decimal" autoComplete="off" disabled={sending}
            onChange={(event) => { setInrPerUsd(event.currentTarget.value); setAsking(false); setTouched(true); }}
          />
          {/* 4Z3: which currency leads AI spend everywhere it shows; the engine sends each figure led that way. */}
          <div className={s.field}>
            <label htmlFor={leadId} className={s.fieldLabel}>{t('money.policy.lead')}</label>
            <Select
              id={leadId} className={s.select} value={lead} disabled={sending} aria-describedby={`${leadId}-hint`}
              onChange={(event) => { setLead(event.currentTarget.value as CurrencyLead); setAsking(false); setTouched(true); }}
            >
              {LEADS.map((choice) => <option key={choice} value={choice}>{t(`money.policy.lead.${choice}`)}</option>)}
            </Select>
            <p id={`${leadId}-hint`} className={sLocal.fieldHint}>{t('money.policy.leadHint')}</p>
          </div>
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
                onClick={() => setRates((lines) => [...lines, { key: `new:${Date.now()}:${lines.length}`, item: '', model: '', unit: 'per-million-tokens', input: '', output: '', cacheRead: '', cacheWrite: '', perCall: '', source: '', checkedOn: today() }])}
              >
                {t('money.policy.addRate')}
              </Button>
            </p>
          </div>
          {problem && <p className={s.refusal} role="alert" data-engine-line="">{problem}</p>}
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
              <DraftWord saved={draft.saved} refused={draft.refused} shown={touched} />
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
    <div className={sLocal.rateLine} role="group" aria-label={name}>
      <Field label={t('money.policy.item')} hint={t('money.policy.itemHint')} value={rate.item} autoComplete="off" disabled={disabled} onChange={(event) => onChange({ item: event.currentTarget.value })} />
      <div className={s.field}>
        <label htmlFor={unitId} className={s.fieldLabel}>{t('money.policy.unit')}</label>
        <Select id={unitId} className={s.select} value={rate.unit} disabled={disabled} onChange={(event) => onChange({ unit: event.currentTarget.value as SpendRateUnit })}>
          {UNITS.map((unit) => <option key={unit} value={unit}>{t(`money.policy.unit.${unit}`)}</option>)}
        </Select>
      </div>
      {rate.unit === 'per-million-tokens' ? (
        <>
          <Field label={t('money.policy.model')} value={rate.model} autoComplete="off" disabled={disabled} onChange={(event) => onChange({ model: event.currentTarget.value })} />
          <Field label={t('money.policy.input')} hint={t('money.policy.usdHint')} value={rate.input} inputMode="decimal" autoComplete="off" disabled={disabled} onChange={(event) => onChange({ input: event.currentTarget.value })} />
          <Field label={t('money.policy.output')} value={rate.output} inputMode="decimal" autoComplete="off" disabled={disabled} onChange={(event) => onChange({ output: event.currentTarget.value })} />
          <Field label={t('money.policy.cacheRead')} value={rate.cacheRead} inputMode="decimal" autoComplete="off" disabled={disabled} onChange={(event) => onChange({ cacheRead: event.currentTarget.value })} />
          <Field label={t('money.policy.cacheWrite')} value={rate.cacheWrite} inputMode="decimal" autoComplete="off" disabled={disabled} onChange={(event) => onChange({ cacheWrite: event.currentTarget.value })} />
        </>
      ) : (
        <Field
          label={rate.unit === 'per-call' ? t('money.policy.perCall') : t('money.policy.runCap')} hint={t('money.policy.usdHint')} value={rate.perCall}
          inputMode="decimal" autoComplete="off" disabled={disabled} onChange={(event) => onChange({ perCall: event.currentTarget.value })}
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
