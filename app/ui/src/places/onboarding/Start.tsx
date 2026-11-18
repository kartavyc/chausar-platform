import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine } from '../../engine/context';
import { EngineError, type CountryLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import { saveTextFile } from '../../parts/custody';
import { Icon } from '../../parts/Icon';
import { Logo } from '../../parts/Logo';
import { goTo } from '../../shell/navigation';
import { computerCountry, cleanSentence, countryWords, DEFAULT_NAME, makeVault, NeedsAnswer, PASSPHRASE_MIN, pickCountry, sentenceProblem, setUpPlan, type Sentence } from './flow';
import s from './Onboarding.module.css';
import { Select } from '../../parts/Select';

type Step = 'read' | 'vault' | 'plan';
type Stage = { kind: 'idle' } | { kind: 'working'; step: Step } | { kind: 'code'; code: string };
type Problem = { text: string; on: 'box' | 'passphrase' | 'engine' };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Keeping a new business: the vault, the business in it, and its first plan. Only what the engine forces before the
 * vault is asked here, inline: a passphrase when this computer has no protected storage, and the recovery code that
 * the engine shows once (with a passphrase, and on hosted).
 *
 * On this computer it is the last step of the first run (FirstRun.tsx), for the first business and every later one:
 * `plan` is the plan About you kept (its idea, the confirmed country, the name and offers its card showed). There is
 * no box then: the plan is kept at once, and `onKept` goes on to the services step.
 *
 * The hosted web app adds an AI only after a business is kept, so its first run is this alone, with one box, "What do
 * you want to start?", the country and Start; the plan is then the built-in one, and Today shows it as its first row.
 *
 * `onBegin(true)` says keeping has left its resting state (reading, a passphrase asked, the vault made, the recovery
 * code shown), so the page around it stops offering ways away: the recovery code shows once. `onBegin(false)` when it
 * rests again (a refusal before the vault).
 */
export function Start({ onStarted, onBegin, plan, onKept }: {
  onStarted: () => void; onBegin?: ((begun: boolean) => void) | undefined;
  /**
   * W6 6C2: the plan About you kept (its idea and the confirmed country). Start then shows no box: it keeps that plan at
   * once, asking only what the engine forces (a passphrase, the recovery code), and calls onKept instead of opening Today.
   */
  plan?: { idea: string; countryCode: string; name?: string; offers?: readonly { name: string; line: string }[]; by?: 'model' | 'template' | 'owner'; callId?: string } | undefined;
  onKept?: (() => void | Promise<void>) | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const boxId = useId();
  const countryId = useId();
  const problemId = useId();
  const reasonId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const passphrase = useRef<HTMLInputElement>(null);
  const again = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [countries, setCountries] = useState<CountryLite[] | null>(null);
  const [countriesFailed, setCountriesFailed] = useState<string | null>(null);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [problem, setProblem] = useState<Problem | null>(null);
  /** Previewed and named, waiting for a passphrase: the engine's reason why. */
  const [asking, setAsking] = useState<{ sentence: Sentence; reason: string } | null>(null);
  /** The vault exists for this sentence; a retry carries on inside it. */
  const [kept, setKept] = useState<Sentence | null>(null);
  const [saved, setSaved] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const loadCountries = useCallback(() => {
    setCountriesFailed(null);
    client.request('venture.countries', {}).then(
      (list) => {
        setCountries(list);
        setCountryCode((code) => code ?? pickCountry(list.map((c) => c.code), computerCountry()));
      },
      (error: unknown) => setCountriesFailed(messageOf(error)),
    );
  }, [client]);
  // The country line belongs to the box; a kept plan brings its own confirmed country.
  useEffect(() => { if (!plan) loadCountries(); }, [loadCountries, plan]);

  // W6 6C2: a plan kept on About you is kept at once, once.
  const auto = useRef(false);
  useEffect(() => {
    if (!plan || auto.current) return;
    auto.current = true;
    void act(() => begin(plan.idea, plan.countryCode, plan));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the kept plan starts once
  }, []);

  // The cursor goes in the box on a computer with a mouse; a phone keeps its keyboard closed until the owner taps.
  useEffect(() => {
    try { if (window.matchMedia('(pointer: fine)').matches) box.current?.focus(); } catch { /* focus is a convenience */ }
  }, []);

  const busy = stage.kind === 'working';
  const begun = stage.kind !== 'idle' || asking !== null || kept !== null;
  const told = useRef(onBegin);
  told.current = onBegin;
  useEffect(() => { told.current?.(begun); }, [begun]);

  function clearPassphrase() {
    if (passphrase.current) passphrase.current.value = '';
    if (again.current) again.current.value = '';
  }

  async function finish(sentence: Sentence) {
    setStage({ kind: 'working', step: 'plan' });
    await setUpPlan(client.request, sentence);
    if (onKept) { await onKept(); return; }
    goTo('today');
    onStarted();
  }

  async function keep(sentence: Sentence, typed?: string) {
    setStage({ kind: 'working', step: 'vault' });
    let made;
    try { made = await makeVault(client.request, client.transport, sentence.name, typed); }
    catch (error) {
      if (typed === undefined && error instanceof EngineError && error.code === 'DEVICE_KEYS_UNAVAILABLE') {
        setAsking({ sentence, reason: error.message });
        setStage({ kind: 'idle' });
        return;
      }
      throw error;
    } finally { if (typed !== undefined) clearPassphrase(); }
    setAsking(null);
    setKept(sentence);
    if (made.recoveryCode) { setSaved(false); setCopyNote(null); setStage({ kind: 'code', code: made.recoveryCode }); return; }
    await finish(sentence);
  }

  async function act(work: () => Promise<void>) {
    setProblem(null);
    try { await work(); }
    catch (error) {
      setStage({ kind: 'idle' });
      setProblem({ text: error instanceof NeedsAnswer ? t('onboarding.needsAnswer', { question: error.question }) : messageOf(error), on: 'engine' });
    }
  }

  async function begin(idea: string, code: string, shown?: { name?: string; offers?: readonly { name: string; line: string }[]; by?: 'model' | 'template' | 'owner'; callId?: string }) {
    setStage({ kind: 'working', step: 'read' });
    // One-shot A1 (row 3): a plan kept on About you keeps the name and offers its card showed.
    const name = shown?.name?.trim() || (await client.request('venture.preview', { idea, countryCode: code })).serviceLabel.trim() || DEFAULT_NAME;
    await keep({ idea, countryCode: code, name, ...(shown?.offers?.length ? { offers: shown.offers, by: shown.by ?? 'template', ...(shown.callId ? { callId: shown.callId } : {}) } : {}) });
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || stage.kind === 'code') return;
    if (kept) { void act(() => finish(kept)); return; }
    if (plan && !asking) { void act(() => begin(plan.idea, plan.countryCode, plan)); return; }
    if (asking) {
      const first = passphrase.current?.value ?? '';
      if (first.length < PASSPHRASE_MIN) { setProblem({ text: t('onboarding.passphrase.short'), on: 'passphrase' }); passphrase.current?.focus(); return; }
      if (first !== (again.current?.value ?? '')) { setProblem({ text: t('onboarding.passphrase.mismatch'), on: 'passphrase' }); again.current?.focus(); return; }
      const { sentence } = asking;
      void act(() => keep(sentence, first));
      return;
    }
    const idea = cleanSentence(text);
    const wrong = sentenceProblem(idea);
    if (wrong) { setProblem({ text: t(wrong), on: 'box' }); box.current?.focus(); return; }
    void act(() => begin(idea, countryCode ?? 'XX'));
  }

  /** The sentence changed: a passphrase asked for the old one is dropped. */
  function changeText(value: string) {
    setText(value);
    if (asking) { setAsking(null); clearPassphrase(); }
    if (problem?.on !== 'engine') setProblem(null);
  }

  function onBoxKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setCopyNote(t('onboarding.code.copied')); }
    catch { setCopyNote(t('onboarding.code.copyFailed')); }
  }

  const country = countries?.find((c) => c.code === countryCode) ?? null;
  const boxProblem = problem?.on === 'box';
  const label = kept ? t('onboarding.tryAgain') : asking ? t('onboarding.lockAndStart') : t('onboarding.start');
  /** The box takes words: not while Chausar reads them, and not once the vault is made for them. */
  const editable = !busy && kept === null;
  const inBar = !plan && !asking && stage.kind !== 'code';
  const submitButton = (
    <Button variant="primary" size="lg" type="submit" disabled={busy} aria-busy={busy || undefined}>
      {label}
      <Icon name="arrow-right" size={16} />
    </Button>
  );

  const countryLine = (
    <div className={s.country}>
      {countriesFailed !== null ? (
        <>
          <span>{t('onboarding.countriesFailed', { message: countriesFailed })}</span>
          <Button variant="quiet" onClick={loadCountries}>{t('onboarding.retry')}</Button>
        </>
      ) : choosing && countries ? (
        <>
          <label htmlFor={countryId}>{t('onboarding.country')}</label>
          <Select id={countryId} className={s.select} value={countryCode ?? 'XX'} disabled={busy || kept !== null} onChange={(event) => setCountryCode(event.target.value)}>
            {countries.map((c) => <option key={c.code} value={c.code}>{countryWords(c, language, t)}</option>)}
          </Select>
        </>
      ) : country ? (
        <>
          <span>{t('onboarding.basedIn', { country: countryWords(country, language, t), currency: country.currency })}</span>
          {kept === null && (
            <>
              <span aria-hidden="true"> · </span>
              <Button variant="quiet" disabled={busy} onClick={() => setChoosing(true)}>{t('onboarding.change')}</Button>
            </>
          )}
        </>
      ) : null}
    </div>
  );

  return (
    <div className={s.alone}>
      {!plan && <Brand />}
      <form className={s.form} onSubmit={submit} noValidate>
        {plan ? (
          <h1 className={s.question}>{t('first-run.keep.title')}</h1>
        ) : (
          <>
            <h1 className={s.question}><label htmlFor={boxId}>{t('onboarding.question')}</label></h1>
            {countryLine}
          </>
        )}

        {!plan && <div className={s.box} data-invalid={boxProblem ? '' : undefined}>
          <textarea
            ref={box}
            id={boxId}
            className={s.boxInput}
            rows={2}
            value={text}
            placeholder={t('onboarding.placeholder')}
            readOnly={busy || kept !== null}
            aria-invalid={boxProblem ? true : undefined}
            aria-describedby={boxProblem ? problemId : undefined}
            onChange={(event) => changeText(event.target.value)}
            onKeyDown={onBoxKey}
          />
          {(editable || inBar) && (
            <div className={s.boxBar}>
              {editable && <span className={s.hint}>{t('onboarding.hint.line')}</span>}
              {inBar && submitButton}
            </div>
          )}
        </div>}

        {asking && (
          <div className={s.step}>
            <p id={reasonId} className={s.sentence}>{t('onboarding.passphrase.choose', { reason: asking.reason })}</p>
            <div className={s.fields}>
              <label className={s.field}>
                <span className={s.fieldLabel}>{t('onboarding.passphrase.label')}</span>
                <input ref={passphrase} className={s.input} type="password" autoComplete="new-password" minLength={PASSPHRASE_MIN} aria-describedby={reasonId} aria-invalid={problem?.on === 'passphrase' ? true : undefined} disabled={busy} />
              </label>
              <label className={s.field}>
                <span className={s.fieldLabel}>{t('onboarding.passphrase.again')}</span>
                <input ref={again} className={s.input} type="password" autoComplete="new-password" minLength={PASSPHRASE_MIN} aria-invalid={problem?.on === 'passphrase' ? true : undefined} disabled={busy} />
              </label>
            </div>
          </div>
        )}

        {stage.kind === 'code' ? (
          <div className={s.step}>
            <p className={s.sentence}>{t('onboarding.code.save')}</p>
            <div className={s.code} role="group" aria-label={t('onboarding.code.label')}>
              {(stage.code.match(/.{1,4}/g) ?? []).map((part, index) => <span key={index} className={s.chunk}>{part}</span>)}
            </div>
            <div className={s.codeTools}>
              <Button onClick={() => void copy(stage.code)}>{t('onboarding.code.copy')}</Button>
              <Button variant="quiet" onClick={() => saveTextFile('chausar-recovery-code.txt', `Chausar recovery code\n${kept ? `Business: ${kept.name}\n` : ''}\n${stage.code}\n`, 'text/plain')}>{t('onboarding.code.saveFile')}</Button>
              {copyNote && <span className={s.note} role="status">{copyNote}</span>}
            </div>
            <label className={s.check}>
              <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
              <span>{t('onboarding.code.saved')}</span>
            </label>
            {problem && <p id={problemId} className={s.problem} role="alert">{problem.text}</p>}
            <div className={s.actions}>
              <Button
                variant="primary" size="lg" locked={!saved} lockedReason={t('onboarding.code.savedFirst')}
                onClick={() => { const sentence = kept; if (sentence) void act(() => finish(sentence)); }}
              >
                {t('onboarding.continue')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {problem && <p id={problemId} className={s.problem} role="alert">{problem.text}</p>}
            {!inBar && <div className={s.actions}>{submitButton}</div>}
          </>
        )}
        <p className={s.progress} role="status">{stage.kind === 'working' ? t(`onboarding.step.${stage.step}`) : ''}</p>
      </form>
    </div>
  );
}

/** The logo at the top of the first run and Welcome back: the mark and wordmark for the eye, "Chausar" said once. */
export function Brand() {
  const t = useT();
  return (
    <p className={s.brand}>
      <span aria-hidden="true"><Logo wordmark size={24} /></span>
      <span className="sr-only">{t('app.name')}</span>
    </p>
  );
}
