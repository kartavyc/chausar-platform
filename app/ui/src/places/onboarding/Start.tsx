import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine } from '../../engine/context';
import { EngineError, type CountryLite, type PlanSuggestionView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { saveTextFile } from '../../parts/custody';
import { Icon } from '../../parts/Icon';
import { Logo } from '../../parts/Logo';
import { Tile } from '../../parts/Tile';
import { goTo } from '../../shell/navigation';
import { BusinessPick, Suggestion, type Target } from './BusinessPick';
import { Examples } from './Examples';
import { FileDrop, type DroppedFile } from './FileDrop';
import { browserRegion, cleanSentence, countryWords, DEFAULT_NAME, makeVault, NeedsAnswer, PASSPHRASE_MIN, pickCountry, sentenceProblem, setUpPlan, type Sentence } from './flow';
import s from './Onboarding.module.css';

type Step = 'read' | 'vault' | 'plan' | 'suggest';
type Stage = { kind: 'idle' } | { kind: 'working'; step: Step } | { kind: 'code'; code: string };
/** link: where to fix it, when the engine's refusal names a place (W4 4J21: no AI connected, to Your AI). */
type Problem = { text: string; on: 'box' | 'passphrase' | 'engine'; link?: { href: string; label: string } | undefined };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * One box, "What do you want to start?", the country and Start. Then the plan is Today's first row. Only what the
 * engine forces before the vault is asked here, inline under the box: a passphrase when this computer has no
 * protected storage, and the recovery code that the engine shows once (with a passphrase, and on hosted).
 *
 * The look is D-Start's one-sentence tile (`.desc`, `.d-box`, `.d-bar`, `.ex`): on the first run a single tile under
 * the logo, with nothing else (no steps, no examples); inside the app a tile on the Start page with the examples.
 * At rest Start sits in the box's bar; while a passphrase is asked it moves under the fields it sends, and while the
 * recovery code shows only Continue is offered. `orDescribe` (a gallery is shown above) makes the box "Or describe it
 * in one sentence". Inside the app the button says what it does, "Make my plan"; the first run keeps "Start".
 *
 * `onBegin(true)` says Start has left its resting state (reading, a passphrase asked, the vault made, the recovery code
 * shown), so the page around it can stop offering ways away from it: the open business was locked on the way, and the
 * recovery code shows once. `onBegin(false)` when it rests again (a refusal before the vault).
 */
export function Start({ variant, onStarted, orDescribe = false, onBegin, fill, business, home }: {
  variant: 'first-run' | 'place'; onStarted: () => void; orDescribe?: boolean | undefined; onBegin?: ((begun: boolean) => void) | undefined;
  /** Words another tile puts in the box (W4 4C2: the fit's Start with this), each with its own count; never sent. */
  fill?: { text: string; n: number } | undefined;
  /** W4 4J21: the business open now, so the sentence can be added to it instead (the business picker). */
  business?: string | undefined;
  /** 4Z2: the open business's country code: a new business starts there, ahead of the browser's region. */
  home?: string | undefined;
}) {
  const t = useT();
  const language = useLanguage();
  const client = useEngine();
  const headingId = useId();
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
  // W4 4J21: where the sentence goes (a new business, or the open one), the file dropped with it, and the plan change
  // Chausar suggests for the open business.
  const [target, setTarget] = useState<Target>('new');
  const [file, setFile] = useState<DroppedFile | null>(null);
  const [suggestion, setSuggestion] = useState<PlanSuggestionView | null>(null);

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
  // 4Z2: the open business's country may arrive after the list; it is still the first choice until the owner picks one.
  const picked = useRef(false);
  useEffect(() => {
    if (home && !picked.current && countries?.some((c) => c.code === home)) setCountryCode(home);
  }, [home, countries]);

  // The cursor goes in the box on a computer with a mouse; a phone keeps its keyboard closed until the owner taps.
  useEffect(() => {
    try { if (window.matchMedia('(pointer: fine)').matches) box.current?.focus(); } catch { /* focus is a convenience */ }
  }, []);

  const busy = stage.kind === 'working';
  const begun = stage.kind !== 'idle' || asking !== null || kept !== null;
  const told = useRef(onBegin);
  told.current = onBegin;
  useEffect(() => { told.current?.(begun); }, [begun]);

  // W4 4C2: words from another tile go in the box (as an example's do) while it takes words, with the cursor there.
  const filled = useRef(fill);
  filled.current = fill;
  useEffect(() => {
    const words = filled.current;
    if (!words || busy || kept !== null || stage.kind === 'code') return;
    changeText(words.text);
    box.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new fill puts words in the box
  }, [fill?.n]);

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
      const noAi = error instanceof EngineError && error.code === 'NO_MODEL_CONNECTED';
      setProblem({
        text: error instanceof NeedsAnswer ? t('onboarding.needsAnswer', { question: error.question }) : messageOf(error), on: 'engine',
        link: noAi ? { href: '#/connections/ai', label: t('onboarding.ways.connectAi') } : undefined,
      });
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
    if (adding) { suggest(idea); return; }
    const country = countryCode ?? 'XX';
    void act(async () => {
      setStage({ kind: 'working', step: 'read' });
      const preview = await client.request('venture.preview', { idea, countryCode: country });
      await keep({ idea, countryCode: country, name: preview.serviceLabel.trim() || DEFAULT_NAME });
    });
  }

  /** W4 4J21: a plan change for the open business, suggested and shown; nothing changes until the owner applies it. */
  function suggest(idea: string) {
    void act(async () => {
      setSuggestion(null);
      setStage({ kind: 'working', step: 'suggest' });
      setSuggestion(await client.request('venture.blueprint.suggest', { text: idea, ...(file ? { attachment: file } : {}) }));
      setStage({ kind: 'idle' });
    });
  }

  /** The sentence changed, typed or from an example: a passphrase asked for the old one is dropped. */
  function changeText(value: string) {
    setText(value);
    setSuggestion(null);
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
  const place = variant === 'place';
  /** W4 4J21: the sentence goes to the open business (Add this to it), not a new one. */
  const picking = place && business !== undefined && kept === null && asking === null && stage.kind !== 'code';
  const adding = picking && target === 'add';
  const label = adding ? t('onboarding.ways.suggest') : kept ? t('onboarding.tryAgain') : asking ? t('onboarding.lockAndStart') : t(place ? 'onboarding.makePlan' : 'onboarding.start');
  /** The box takes words: not while Chausar reads them, and not once the vault is made for them. */
  const editable = !busy && kept === null;
  const question = place && orDescribe ? t('onboarding.describe.or') : t('onboarding.question');
  const inBar = !asking && stage.kind !== 'code';
  const submitButton = (
    // While a suggested plan change shows, its Apply is the tile's one primary (W4 4J21).
    <Button variant={adding && suggestion?.patch ? 'secondary' : 'primary'} size="lg" type="submit" disabled={busy} aria-busy={busy || undefined}>
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
          <select id={countryId} className={s.select} value={countryCode ?? 'XX'} disabled={busy || kept !== null} onChange={(event) => { picked.current = true; setCountryCode(event.target.value); }}>
            {countries.map((c) => <option key={c.code} value={c.code}>{countryWords(c, language, t)}</option>)}
          </select>
        </>
      ) : country ? (
        <>
          <span>{t('onboarding.basedIn', { country: countryWords(country, language, t) })}</span>
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

  const form = (
    <form className={s.form} onSubmit={submit} noValidate>
      {place ? (
        <>
          <div className={s.formHead}>
            <h2 id={headingId} className={s.formTitle}><label htmlFor={boxId}>{question}</label></h2>
            {!adding && countryLine}
          </div>
          <p className={s.formLine}>{t('onboarding.describe.line')}</p>
        </>
      ) : (
        <>
          <h1 className={s.question}><label htmlFor={boxId}>{question}</label></h1>
          {countryLine}
        </>
      )}

      <div className={s.box} data-invalid={boxProblem ? '' : undefined}>
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
            {editable && <Hint />}
            {inBar && submitButton}
          </div>
        )}
      </div>

      {picking && business !== undefined && (
        <BusinessPick business={business} target={target} onTarget={(next) => { setTarget(next); setSuggestion(null); setProblem(null); }} disabled={busy} />
      )}
      {adding && client.transport !== 'hosted' && <FileDrop file={file} onFile={(next) => { setFile(next); setSuggestion(null); }} disabled={busy} />}

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
          {problem && <p id={problemId} className={s.problem} role="alert">{problem.text}{problem.link && <> <a href={problem.link.href}>{problem.link.label}</a></>}</p>}
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
          {problem && <p id={problemId} className={s.problem} role="alert">{problem.text}{problem.link && <> <a href={problem.link.href}>{problem.link.label}</a></>}</p>}
          {!inBar && <div className={s.actions}>{submitButton}</div>}
        </>
      )}
      <p className={s.progress} role="status">{stage.kind === 'working' ? t(stage.step === 'suggest' ? 'onboarding.ways.suggesting' : `onboarding.step.${stage.step}`) : ''}</p>
      {adding && suggestion && business !== undefined && <Suggestion key={suggestion.basedOn.digest + suggestion.line} suggestion={suggestion} business={business} onClose={() => setSuggestion(null)} onAgain={() => suggest(cleanSentence(text))} />}
    </form>
  );

  if (place) {
    return (
      <Tile as="section" labelledBy={headingId} className={s.describe}>
        {form}
        <Examples onPick={changeText} disabled={busy || kept !== null || stage.kind === 'code'} adding={adding} />
      </Tile>
    );
  }
  return (
    <div className={s.alone}>
      <Brand />
      {form}
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

/** "Write in English or हिन्दी" (D's `.hint`): the word Hindi in Hindi, marked as Hindi in the English app. */
function Hint() {
  const t = useT();
  const language = useLanguage();
  const hindi = t('onboarding.hint.hindi');
  const line = t('onboarding.hint.line', { hindi });
  const at = line.indexOf(hindi);
  return (
    <span className={s.hint}>
      {at < 0 ? line : (
        <>
          {line.slice(0, at)}
          <span lang={language === 'hi' ? undefined : 'hi'}>{hindi}</span>
          {line.slice(at + hindi.length)}
        </>
      )}
    </span>
  );
}
