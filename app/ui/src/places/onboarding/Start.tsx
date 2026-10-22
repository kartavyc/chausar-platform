import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { EngineError, type CountryLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import { saveTextFile } from '../../parts/custody';
import { goTo } from '../../shell/navigation';
import { browserRegion, cleanSentence, DEFAULT_NAME, makeVault, NeedsAnswer, PASSPHRASE_MIN, pickCountry, sentenceProblem, setUpPlan, type Sentence } from './flow';
import s from './Onboarding.module.css';

type Step = 'read' | 'vault' | 'plan';
type Stage = { kind: 'idle' } | { kind: 'working'; step: Step } | { kind: 'code'; code: string };
type Problem = { text: string; on: 'box' | 'passphrase' | 'engine' };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * One box, "What do you want to start?", the country and Start. Then the plan is Today's first row. Only what the
 * engine forces before the vault is asked here, inline under the box: a passphrase when this computer has no
 * protected storage, and the recovery code that the engine shows once (with a passphrase, and on hosted).
 */
export function Start({ variant, onStarted }: { variant: 'first-run' | 'place'; onStarted: () => void }) {
  const t = useT();
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
        setCountryCode((code) => code ?? pickCountry(list.map((c) => c.code), browserRegion(typeof navigator === 'undefined' ? undefined : navigator.language)));
      },
      (error: unknown) => setCountriesFailed(messageOf(error)),
    );
  }, [client]);
  useEffect(() => { loadCountries(); }, [loadCountries]);

  // The cursor goes in the box on a computer with a mouse; a phone keeps its keyboard closed until the owner taps.
  useEffect(() => {
    try { if (window.matchMedia('(pointer: fine)').matches) box.current?.focus(); } catch { /* focus is a convenience */ }
  }, []);

  const busy = stage.kind === 'working';

  function clearPassphrase() {
    if (passphrase.current) passphrase.current.value = '';
    if (again.current) again.current.value = '';
  }

  async function finish(sentence: Sentence) {
    setStage({ kind: 'working', step: 'plan' });
    await setUpPlan(client.request, sentence);
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

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || stage.kind === 'code') return;
    if (kept) { void act(() => finish(kept)); return; }
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
    const country = countryCode ?? 'XX';
    void act(async () => {
      setStage({ kind: 'working', step: 'read' });
      const preview = await client.request('venture.preview', { idea, countryCode: country });
      await keep({ idea, countryCode: country, name: preview.serviceLabel.trim() || DEFAULT_NAME });
    });
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

  return (
    <div className={variant === 'first-run' ? s.alone : s.inPlace}>
      {variant === 'first-run' && <p className={s.name}>{t('app.name')}</p>}
      <form className={s.form} onSubmit={submit} noValidate>
        <h1 className={s.question}><label htmlFor={boxId}>{t('onboarding.question')}</label></h1>
        <textarea
          ref={box}
          id={boxId}
          className={s.box}
          rows={3}
          value={text}
          placeholder={t('onboarding.placeholder')}
          readOnly={busy || kept !== null}
          aria-invalid={boxProblem ? true : undefined}
          aria-describedby={boxProblem ? problemId : undefined}
          onChange={(event) => {
            setText(event.target.value);
            if (asking) { setAsking(null); clearPassphrase(); }
            if (problem?.on !== 'engine') setProblem(null);
          }}
          onKeyDown={onBoxKey}
        />

        <div className={s.country}>
          {countriesFailed !== null ? (
            <>
              <span>{t('onboarding.countriesFailed', { message: countriesFailed })}</span>
              <Button variant="quiet" onClick={loadCountries}>{t('onboarding.retry')}</Button>
            </>
          ) : choosing && countries ? (
            <>
              <label htmlFor={countryId}>{t('onboarding.country')}</label>
              <select id={countryId} className={s.select} value={countryCode ?? 'XX'} disabled={busy || kept !== null} onChange={(event) => setCountryCode(event.target.value)}>
                {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </>
          ) : country ? (
            <>
              <span>{t('onboarding.basedIn', { country: country.name })}</span>
              {kept === null && (
                <>
                  <span aria-hidden="true"> · </span>
                  <Button variant="quiet" disabled={busy} onClick={() => setChoosing(true)}>{t('onboarding.change')}</Button>
                </>
              )}
            </>
          ) : null}
        </div>

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
              <Button variant="primary" disabled={!saved} onClick={() => { const sentence = kept; if (sentence) void act(() => finish(sentence)); }}>{t('onboarding.continue')}</Button>
            </div>
          </div>
        ) : (
          <>
            {problem && <p id={problemId} className={s.problem} role="alert">{problem.text}</p>}
            <div className={s.actions}>
              <Button variant="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>{label}</Button>
            </div>
          </>
        )}
        <p className={s.progress} role="status">{stage.kind === 'working' ? t(`onboarding.step.${stage.step}`) : ''}</p>
      </form>
    </div>
  );
}
